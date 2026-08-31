import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { archiveRecipientName, sendArchiveEmail } from '../_shared/media-archive-email.ts'
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
  resendApiKey: string
  resendFrom: string
}

function requireEnv(name: string) {
  const value = String(Deno.env.get(name) ?? '').trim()
  if (!value) throw new Error(`Missing env ${name}`)
  return value
}

async function uploadArchive(job: ArchiveJob, archivePath: string) {
  const { data: existing } = await job.admin.storage.from(ARCHIVE_BUCKET).info(archivePath)
  const metadata = (existing?.metadata || {}) as Record<string, unknown>
  const canReuse = String(metadata.archiveVersion || '') === job.version
  if (canReuse) return true

  const { stream, completed } = createZipStream(job.admin, job.entries)
  const upload = job.admin.storage.from(ARCHIVE_BUCKET).upload(archivePath, stream, {
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

async function recordJob(job: ArchiveJob, action: 'sent' | 'failed', details: Record<string, unknown>) {
  const archivePath = `${job.userId}/${ARCHIVE_FILENAME}`
  await audit(job.admin, {
    actorId: job.userId,
    action: `media_archive.${action}`,
    entity: 'storage.objects',
    entityId: `${ARCHIVE_BUCKET}/${archivePath}`,
    details: {
      item_count: job.entries.length,
      request_id: job.requestId,
      ...details,
    },
  })
}

async function prepareAndEmailArchive(job: ArchiveJob) {
  const archivePath = `${job.userId}/${ARCHIVE_FILENAME}`
  try {
    const reused = await uploadArchive(job, archivePath)
    const downloadUrl = await createDownloadUrl(job.admin, archivePath)
    const emailId = await sendArchiveEmail({
      apiKey: job.resendApiKey,
      from: job.resendFrom,
      to: job.email,
      name: archiveRecipientName(job.displayName, job.email),
      downloadUrl,
      itemCount: job.entries.length,
      requestId: job.requestId,
    })

    await recordJob(job, 'sent', {
      email_id: emailId || null,
      link_expires_in_seconds: ARCHIVE_LINK_TTL_SECONDS,
      reused,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Failed to prepare media archive', {
      userId: job.userId,
      requestId: job.requestId,
      error: message,
    })
    await recordJob(job, 'failed', { error: message }).catch(() => undefined)
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
  EdgeRuntime.waitUntil(prepareAndEmailArchive({
    admin: auth.admin,
    userId: auth.user.id,
    email,
    displayName: auth.profile.display_name,
    entries,
    version: await archiveVersion(rows),
    requestId,
    resendApiKey,
    resendFrom,
  }))

  return json({ status: 'queued', email, itemCount: entries.length, requestId }, 202)
})
