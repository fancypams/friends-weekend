import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  archiveRecipientName,
  sendArchiveConfirmationEmail,
} from '../_shared/media-archive-email.ts'
import {
  archiveVersion,
  buildZipEntries,
  estimateZipBytes,
  loadArchiveRows,
  MAX_ZIP32_BYTES,
  MAX_ZIP32_ENTRIES,
} from '../_shared/media-archive-zip.ts'
import { audit } from '../_shared/audit.ts'
import { requireAuth } from '../_shared/auth.ts'
import { POST_TRIP_UPLOAD_END_ISO } from '../_shared/capture-window.ts'
import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, forbidden, json, serverError } from '../_shared/http.ts'

const ARCHIVE_BUCKET = 'media-archives'
const ARCHIVE_FILENAME = 'friends-weekend-2026.zip'
const ARCHIVE_UNLOCK_AT_MS = Date.parse(POST_TRIP_UPLOAD_END_ISO)

type ArchiveJob = {
  admin: SupabaseClient
  userId: string
  email: string
  displayName: string | null
  itemCount: number
  requestId: string
  archivePath: string
  resendApiKey: string
  resendFrom: string
}

function requireEnv(name: string) {
  const value = String(Deno.env.get(name) ?? '').trim()
  if (!value) throw new Error(`Missing env ${name}`)
  return value
}

async function updateArchiveJob(job: ArchiveJob, values: Record<string, unknown>) {
  const { error } = await job.admin
    .from('media_archive_jobs')
    .update(values)
    .eq('id', job.requestId)
  if (error) throw new Error(`Could not update archive job: ${error.message}`)
}

type ArchiveAuditAction = 'confirmation_sent' | 'confirmation_failed' | 'dispatch_failed'

async function recordAudit(job: ArchiveJob, action: ArchiveAuditAction, details: Record<string, unknown>) {
  await audit(job.admin, {
    actorId: job.userId,
    action: `media_archive.${action}`,
    entity: 'storage.objects',
    entityId: `${ARCHIVE_BUCKET}/${job.archivePath}`,
    details: {
      item_count: job.itemCount,
      request_id: job.requestId,
      ...details,
    },
  })
}

async function sendConfirmation(job: ArchiveJob) {
  let emailId = ''
  try {
    emailId = await sendArchiveConfirmationEmail({
      apiKey: job.resendApiKey,
      from: job.resendFrom,
      to: job.email,
      name: archiveRecipientName(job.displayName, job.email),
      itemCount: job.itemCount,
      requestId: job.requestId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Could not send media archive confirmation email', {
      requestId: job.requestId,
      error: message,
    })
    await recordAudit(job, 'confirmation_failed', { error: message }).catch(() => undefined)
    return
  }

  await recordAudit(job, 'confirmation_sent', {
    email_id: emailId || null,
  }).catch((error) => {
    console.error('Could not record media archive confirmation audit event', {
      requestId: job.requestId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

async function dispatchArchiveJob(token: string, repository: string, requestId: string) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GITHUB_ARCHIVE_REPOSITORY must use owner/repository format')
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      event_type: 'media_archive_requested',
      client_payload: { request_id: requestId },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 204) return

  const message = (await response.text()).slice(0, 500)
  throw new Error(`GitHub worker dispatch failed (${response.status}): ${message}`)
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response
  if (Date.now() < ARCHIVE_UNLOCK_AT_MS) {
    return forbidden(`Archive is available after ${POST_TRIP_UPLOAD_END_ISO}`)
  }

  const email = String(auth.profile.email || auth.user.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) return serverError('No delivery email is configured for this profile')

  let resendApiKey = ''
  let resendFrom = ''
  let githubArchiveToken = ''
  let githubArchiveRepository = ''
  try {
    resendApiKey = requireEnv('RESEND_API_KEY')
    resendFrom = requireEnv('RESEND_FROM')
    githubArchiveToken = requireEnv('GITHUB_ARCHIVE_TOKEN')
    githubArchiveRepository = requireEnv('GITHUB_ARCHIVE_REPOSITORY')
  } catch (error) {
    return serverError('Missing archive worker configuration', String(error))
  }

  let rows: Awaited<ReturnType<typeof loadArchiveRows>>
  try {
    rows = await loadArchiveRows(auth.admin, auth.user.id)
  } catch (error) {
    return serverError('Failed to load media archive list', error instanceof Error ? error.message : String(error))
  }
  if (!rows.length) return json({ error: 'No media from other guests is available for your archive.' }, 404)
  if (rows.length > MAX_ZIP32_ENTRIES) return json({ error: 'Archive has too many files for a single ZIP.' }, 413)

  const entries = buildZipEntries(rows)
  if (estimateZipBytes(entries) > MAX_ZIP32_BYTES) {
    return json({ error: 'Archive is too large for a single ZIP.' }, 413)
  }

  const requestId = crypto.randomUUID()
  let version = ''
  try {
    version = await archiveVersion(rows)
  } catch (error) {
    return serverError('Could not prepare media archive', error instanceof Error ? error.message : String(error))
  }
  const archivePath = `${auth.user.id}/${version}/${ARCHIVE_FILENAME}`
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  const { error: jobError } = await auth.admin.from('media_archive_jobs').insert({
    id: requestId,
    user_id: auth.user.id,
    recipient_email: email,
    status: 'queued',
    worker_stage: 'queued',
    item_count: entries.length,
    total_bytes: totalBytes,
    archive_path: archivePath,
    archive_version: version,
  })
  if (jobError) return serverError('Could not queue media archive', jobError.message)

  const job: ArchiveJob = {
    admin: auth.admin,
    userId: auth.user.id,
    email,
    displayName: auth.profile.display_name,
    itemCount: entries.length,
    requestId,
    archivePath,
    resendApiKey,
    resendFrom,
  }

  try {
    await dispatchArchiveJob(githubArchiveToken, githubArchiveRepository, requestId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await updateArchiveJob(job, {
      status: 'failed',
      worker_stage: 'failed',
      error_message: message.slice(0, 2000),
      completed_at: new Date().toISOString(),
    }).catch(() => undefined)
    await recordAudit(job, 'dispatch_failed', { error: message }).catch(() => undefined)
    return serverError('Could not start media archive worker')
  }

  await sendConfirmation(job)

  return json({ status: 'queued', email, itemCount: entries.length, requestId }, 202)
})
