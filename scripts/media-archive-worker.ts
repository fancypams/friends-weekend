import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as tus from 'tus-js-client'
import { audit } from '../supabase/functions/_shared/audit.ts'
import {
  archiveRecipientName,
  sendArchiveEmail,
} from '../supabase/functions/_shared/media-archive-email.ts'

const ARCHIVE_BUCKET = 'media-archives'
const ARCHIVE_FILENAME = 'friends-weekend-2026.zip'
const ARCHIVE_LINK_TTL_SECONDS = 7 * 24 * 60 * 60
const TUS_CHUNK_BYTES = 6 * 1024 * 1024
const UPLOAD_PROGRESS_STEP_BYTES = 24 * 1024 * 1024
const HEARTBEAT_INTERVAL_MS = 15_000

type ArchiveJobRow = {
  id: string
  user_id: string
  recipient_email: string
  status: string
  item_count: number
  total_bytes: number
  archive_path: string
  archive_version: string
  attempt_count: number
}

function requireEnv(name: string) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`Missing environment variable ${name}`)
  return value
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000)
}

async function updateJob(
  admin: SupabaseClient,
  requestId: string,
  values: Record<string, unknown>,
) {
  const { error } = await admin.from('media_archive_jobs').update(values).eq('id', requestId)
  if (error) throw new Error(`Could not update archive job: ${error.message}`)
}

async function loadJob(admin: SupabaseClient, requestId: string) {
  const { data, error } = await admin
    .from('media_archive_jobs')
    .select('id,user_id,recipient_email,status,item_count,total_bytes,archive_path,archive_version,attempt_count')
    .eq('id', requestId)
    .single<ArchiveJobRow>()
  if (error || !data) throw new Error(error?.message || `Archive job ${requestId} was not found`)
  return data
}

async function runCommand(command: string, args: string[], cwd?: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? signal ?? 'unknown status'}`))
    })
  })
}

async function downloadEntry(
  admin: SupabaseClient,
  storagePath: string,
  destination: string,
  expectedBytes: number,
) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { data, error } = await admin.storage.from('shared-media').createSignedUrl(storagePath, 900)
      if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not sign source media URL')

      const response = await fetch(data.signedUrl)
      if (!response.ok || !response.body) {
        throw new Error(`Source media download failed (${response.status})`)
      }
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        createWriteStream(destination),
      )

      const downloaded = await stat(destination)
      if (downloaded.size !== expectedBytes) {
        throw new Error(`Source media size mismatch: expected ${expectedBytes}, received ${downloaded.size}`)
      }
      return downloaded.size
    } catch (error) {
      lastError = error
      await rm(destination, { force: true }).catch(() => undefined)
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
    }
  }
  throw lastError
}

function directStorageEndpoint(supabaseUrl: string) {
  const projectId = new URL(supabaseUrl).hostname.split('.')[0]
  if (!projectId) throw new Error('Could not derive Supabase project ID')
  return `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`
}

async function uploadArchive(params: {
  admin: SupabaseClient
  requestId: string
  supabaseUrl: string
  serviceRoleKey: string
  archivePath: string
  localPath: string
  archiveBytes: number
  archiveVersion: string
}) {
  let lastReported = 0
  let progressWrite = Promise.resolve()

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(createReadStream(params.localPath), {
      endpoint: directStorageEndpoint(params.supabaseUrl),
      uploadSize: params.archiveBytes,
      chunkSize: TUS_CHUNK_BYTES,
      retryDelays: [0, 3000, 5000, 10_000, 20_000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${params.serviceRoleKey}`,
        'x-upsert': 'true',
      },
      metadata: {
        bucketName: ARCHIVE_BUCKET,
        objectName: params.archivePath,
        contentType: 'application/zip',
        cacheControl: '0',
        metadata: JSON.stringify({ archiveVersion: params.archiveVersion }),
      },
      onProgress: (uploadedBytes, totalBytes) => {
        if (
          uploadedBytes !== totalBytes &&
          uploadedBytes - lastReported < UPLOAD_PROGRESS_STEP_BYTES
        ) return
        lastReported = uploadedBytes
        progressWrite = progressWrite
          .then(() => updateJob(params.admin, params.requestId, {
            uploaded_bytes: uploadedBytes,
            heartbeat_at: new Date().toISOString(),
          }))
          .catch((error) => {
            console.error('Could not record resumable upload progress', errorMessage(error))
          })
      },
      onError: (error) => reject(error),
      onSuccess: () => {
        progressWrite.then(() => resolve(), reject)
      },
    })
    upload.start()
  })
}

async function main() {
  const requestId = String(process.argv[2] || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error('A valid archive request UUID is required')
  }

  const supabaseUrl = requireEnv('SUPABASE_URL')
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = requireEnv('RESEND_API_KEY')
  const resendFrom = requireEnv('RESEND_FROM')
  const workerRunId = String(process.env.GITHUB_RUN_ID || 'local')
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let job: ArchiveJobRow | null = null
  let workDirectory = ''
  let heartbeatBusy = false
  let heartbeat: ReturnType<typeof setInterval> | undefined

  try {
    job = await loadJob(admin, requestId)
    if (job.status === 'sent') {
      console.log(`Archive job ${requestId} is already complete`)
      return
    }

    const startedAt = new Date().toISOString()
    await updateJob(admin, requestId, {
      status: 'building',
      worker_stage: 'downloading',
      worker_run_id: workerRunId,
      heartbeat_at: startedAt,
      started_at: startedAt,
      processed_items: 0,
      processed_bytes: 0,
      archive_bytes: null,
      uploaded_bytes: 0,
      attempt_count: Number(job.attempt_count || 0) + 1,
      completed_at: null,
      error_message: null,
      reused: false,
    })

    heartbeat = setInterval(() => {
      if (heartbeatBusy) return
      heartbeatBusy = true
      updateJob(admin, requestId, { heartbeat_at: new Date().toISOString() })
        .catch((error) => console.error('Archive worker heartbeat failed', errorMessage(error)))
        .finally(() => { heartbeatBusy = false })
    }, HEARTBEAT_INTERVAL_MS)
    heartbeat.unref()

    const { loadArchiveRows, archiveVersion, buildZipEntries, estimateZipBytes, MAX_ZIP32_BYTES } =
      await import('../supabase/functions/_shared/media-archive-zip.ts')
    const rows = await loadArchiveRows(admin, job.user_id)
    const currentVersion = await archiveVersion(rows)
    if (currentVersion !== job.archive_version) {
      throw new Error('Available media changed after this archive was requested; please request a fresh archive')
    }
    const entries = buildZipEntries(rows)
    if (entries.length !== job.item_count || estimateZipBytes(entries) > MAX_ZIP32_BYTES) {
      throw new Error('Archive contents no longer match the queued request')
    }

    const { data: existing } = await admin.storage.from(ARCHIVE_BUCKET).info(job.archive_path)
    const existingMetadata = (existing?.metadata || {}) as Record<string, unknown>
    const canReuse = String(existingMetadata.archiveVersion || existingMetadata.archive_version || '') === job.archive_version

    let archiveBytes = Number((existing as { size?: number } | null)?.size || 0)
    if (!canReuse) {
      workDirectory = await mkdtemp(join(tmpdir(), 'friends-weekend-archive-'))
      const sourceDirectory = join(workDirectory, 'files')
      const localArchivePath = join(workDirectory, ARCHIVE_FILENAME)
      await mkdir(sourceDirectory)

      let processedBytes = 0
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        const destination = join(sourceDirectory, entry.name)
        processedBytes += await downloadEntry(admin, entry.path, destination, entry.bytes)
        await updateJob(admin, requestId, {
          processed_items: index + 1,
          processed_bytes: processedBytes,
          heartbeat_at: new Date().toISOString(),
        })
      }

      await updateJob(admin, requestId, {
        worker_stage: 'zipping',
        heartbeat_at: new Date().toISOString(),
      })
      await runCommand('zip', ['-0', '-q', '-r', localArchivePath, '.'], sourceDirectory)
      await runCommand('unzip', ['-tqq', localArchivePath])
      archiveBytes = (await stat(localArchivePath)).size
      if (archiveBytes > MAX_ZIP32_BYTES) throw new Error('Built archive exceeds ZIP32 size limit')

      await rm(sourceDirectory, { recursive: true, force: true })
      await updateJob(admin, requestId, {
        status: 'uploading',
        worker_stage: 'uploading',
        archive_bytes: archiveBytes,
        uploaded_bytes: 0,
        heartbeat_at: new Date().toISOString(),
      })
      await uploadArchive({
        admin,
        requestId,
        supabaseUrl,
        serviceRoleKey,
        archivePath: job.archive_path,
        localPath: localArchivePath,
        archiveBytes,
        archiveVersion: job.archive_version,
      })
    }

    const uploadedAt = new Date().toISOString()
    await updateJob(admin, requestId, {
      status: 'signing',
      worker_stage: 'signing',
      reused: canReuse,
      processed_items: job.item_count,
      processed_bytes: job.total_bytes,
      archive_bytes: archiveBytes,
      uploaded_bytes: archiveBytes,
      uploaded_at: uploadedAt,
      heartbeat_at: uploadedAt,
    })

    const { data: signed, error: signError } = await admin.storage
      .from(ARCHIVE_BUCKET)
      .createSignedUrl(job.archive_path, ARCHIVE_LINK_TTL_SECONDS, { download: ARCHIVE_FILENAME })
    if (signError || !signed?.signedUrl) {
      throw new Error(signError?.message || 'Could not sign archive download URL')
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('display_name')
      .eq('user_id', job.user_id)
      .maybeSingle<{ display_name: string | null }>()
    const signedAt = new Date().toISOString()
    await updateJob(admin, requestId, {
      status: 'emailing',
      worker_stage: 'emailing',
      signed_at: signedAt,
      heartbeat_at: signedAt,
    })

    const emailId = await sendArchiveEmail({
      apiKey: resendApiKey,
      from: resendFrom,
      to: job.recipient_email,
      name: archiveRecipientName(profile?.display_name || null, job.recipient_email),
      downloadUrl: signed.signedUrl,
      itemCount: job.item_count,
      requestId,
    })
    const completedAt = new Date().toISOString()
    await updateJob(admin, requestId, {
      status: 'sent',
      worker_stage: 'complete',
      provider_message_id: emailId || null,
      emailed_at: completedAt,
      completed_at: completedAt,
      heartbeat_at: completedAt,
      error_message: null,
    })
    await audit(admin, {
      actorId: job.user_id,
      action: 'media_archive.sent',
      entity: 'storage.objects',
      entityId: `${ARCHIVE_BUCKET}/${job.archive_path}`,
      details: {
        request_id: requestId,
        item_count: job.item_count,
        email_id: emailId || null,
        link_expires_in_seconds: ARCHIVE_LINK_TTL_SECONDS,
        reused: canReuse,
        worker_run_id: workerRunId,
      },
    })
    console.log(`Archive job ${requestId} completed`)
  } catch (error) {
    const message = errorMessage(error)
    console.error(`Archive job ${requestId} failed: ${message}`)
    if (job) {
      const completedAt = new Date().toISOString()
      await updateJob(admin, requestId, {
        status: 'failed',
        worker_stage: 'failed',
        error_message: message,
        completed_at: completedAt,
        heartbeat_at: completedAt,
      }).catch(() => undefined)
      await audit(admin, {
        actorId: job.user_id,
        action: 'media_archive.failed',
        entity: 'storage.objects',
        entityId: `${ARCHIVE_BUCKET}/${job.archive_path}`,
        details: { request_id: requestId, error: message, worker_run_id: workerRunId },
      }).catch(() => undefined)
    }
    throw error
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    if (workDirectory) await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

await main()
