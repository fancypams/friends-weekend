import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  archiveRecipientName,
  sendArchiveConfirmationEmail,
  sendArchiveEmail,
} from '../_shared/media-archive-email.ts'
import {
  archiveVersion,
  buildZipEntries,
  createZipStream,
  estimateZipBytes,
  loadArchiveRows,
  MAX_ZIP32_BYTES,
  MAX_ZIP32_ENTRIES,
  type ZipEntry,
} from '../_shared/media-archive-zip.ts'
import { audit } from '../_shared/audit.ts'
import { requireAuth } from '../_shared/auth.ts'
import { POST_TRIP_UPLOAD_END_ISO } from '../_shared/capture-window.ts'
import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, forbidden, json, serverError } from '../_shared/http.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

const ARCHIVE_BUCKET = 'media-archives'
const ARCHIVE_FILENAME = 'friends-weekend-2026.zip'
const ARCHIVE_LINK_TTL_SECONDS = 7 * 24 * 60 * 60
const ARCHIVE_UNLOCK_AT_MS = Date.parse(POST_TRIP_UPLOAD_END_ISO)

type ArchiveJob = {
  admin: SupabaseClient
  userId: string
  email: string
  displayName: string | null
  entries: ZipEntry[]
  version: string
  requestId: string
  archivePath: string
  totalBytes: number
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

async function updateArchiveProgress(
  job: ArchiveJob,
  processedItems: number,
  processedBytes: number,
) {
  try {
    await updateArchiveJob(job, {
      processed_items: processedItems,
      processed_bytes: processedBytes,
    })
  } catch (error) {
    console.error('Could not record media archive progress', {
      requestId: job.requestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function uploadArchive(job: ArchiveJob) {
  const { data: existing } = await job.admin.storage.from(ARCHIVE_BUCKET).info(job.archivePath)
  const metadata = (existing?.metadata || {}) as Record<string, unknown>
  const canReuse = String(metadata.archiveVersion || '') === job.version
  if (canReuse) return true

  await updateArchiveJob(job, { status: 'uploading' })
  const { stream, completed } = createZipStream(job.admin, job.entries, (progress) =>
    updateArchiveProgress(job, progress.processedItems, progress.processedBytes)
  )
  const upload = job.admin.storage.from(ARCHIVE_BUCKET).upload(job.archivePath, stream, {
    cacheControl: '0',
    contentType: 'application/zip',
    metadata: { archive_version: job.version },
    upsert: true,
  })
  const [{ error }] = await Promise.all([upload, completed])
  if (error) throw new Error(error.message)
  return false
}

async function createDownloadUrl(admin: SupabaseClient, archivePath: string) {
  const { data, error } = await admin.storage
    .from(ARCHIVE_BUCKET)
    .createSignedUrl(archivePath, ARCHIVE_LINK_TTL_SECONDS, { download: ARCHIVE_FILENAME })
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not sign archive link')
  return data.signedUrl
}

type ArchiveAuditAction = 'confirmation_sent' | 'confirmation_failed' | 'sent' | 'failed'

async function recordAudit(job: ArchiveJob, action: ArchiveAuditAction, details: Record<string, unknown>) {
  await audit(job.admin, {
    actorId: job.userId,
    action: `media_archive.${action}`,
    entity: 'storage.objects',
    entityId: `${ARCHIVE_BUCKET}/${job.archivePath}`,
    details: {
      item_count: job.entries.length,
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
      itemCount: job.entries.length,
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

async function prepareAndEmailArchive(job: ArchiveJob) {
  try {
    await updateArchiveJob(job, {
      status: 'building',
      started_at: new Date().toISOString(),
    })
    await sendConfirmation(job)

    const reused = await uploadArchive(job)
    await updateArchiveJob(job, {
      status: 'signing',
      reused,
      processed_items: job.entries.length,
      processed_bytes: job.totalBytes,
      uploaded_at: new Date().toISOString(),
    })

    const downloadUrl = await createDownloadUrl(job.admin, job.archivePath)
    await updateArchiveJob(job, {
      status: 'emailing',
      signed_at: new Date().toISOString(),
    })

    const emailId = await sendArchiveEmail({
      apiKey: job.resendApiKey,
      from: job.resendFrom,
      to: job.email,
      name: archiveRecipientName(job.displayName, job.email),
      downloadUrl,
      itemCount: job.entries.length,
      requestId: job.requestId,
    })

    const completedAt = new Date().toISOString()
    await updateArchiveJob(job, {
      status: 'sent',
      provider_message_id: emailId || null,
      emailed_at: completedAt,
      completed_at: completedAt,
      error_message: null,
    })

    await recordAudit(job, 'sent', {
      email_id: emailId || null,
      link_expires_in_seconds: ARCHIVE_LINK_TTL_SECONDS,
      reused,
    }).catch((error) => {
      console.error('Could not record successful media archive audit event', {
        requestId: job.requestId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Failed to prepare media archive', {
      userId: job.userId,
      requestId: job.requestId,
      error: message,
    })
    await updateArchiveJob(job, {
      status: 'failed',
      error_message: message.slice(0, 2000),
      completed_at: new Date().toISOString(),
    }).catch(() => undefined)
    await recordAudit(job, 'failed', { error: message }).catch(() => undefined)
  }
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
  try {
    resendApiKey = requireEnv('RESEND_API_KEY')
    resendFrom = requireEnv('RESEND_FROM')
  } catch (error) {
    return serverError('Missing email provider configuration', String(error))
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
  const archivePath = `${auth.user.id}/${ARCHIVE_FILENAME}`
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  const { error: jobError } = await auth.admin.from('media_archive_jobs').insert({
    id: requestId,
    user_id: auth.user.id,
    recipient_email: email,
    status: 'queued',
    item_count: entries.length,
    total_bytes: totalBytes,
    archive_path: archivePath,
    archive_version: version,
  })
  if (jobError) return serverError('Could not queue media archive', jobError.message)

  EdgeRuntime.waitUntil(prepareAndEmailArchive({
    admin: auth.admin,
    userId: auth.user.id,
    email,
    displayName: auth.profile.display_name,
    entries,
    version,
    requestId,
    archivePath,
    totalBytes,
    resendApiKey,
    resendFrom,
  }))

  return json({ status: 'queued', email, itemCount: entries.length, requestId }, 202)
})
