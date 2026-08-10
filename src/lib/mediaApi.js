import * as tus from 'tus-js-client'
import { bypassAuth, supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient'
import { callFunction, getValidSession } from './functionsApi'

export async function fetchProfile(userId) {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,email,role,active,display_name')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

export function createUploadTicket(payload) {
  return callFunction('create-upload-ticket', {
    method: 'POST',
    body: payload,
  })
}

export function fetchUploadWindow() {
  return callFunction('upload-window')
}

export async function uploadWithSignedTicket(ticket, file) {
  if (!supabase) throw new Error('Supabase is not configured')

  const objectPath = String(ticket?.objectPath || ticket?.uploadPath || '').trim()
  if (!objectPath) throw new Error('Upload target path is missing')

  const session = bypassAuth ? null : await getValidSession()
  const accessToken = String(session?.access_token || '').trim()

  if (!accessToken && ticket?.uploadPath && ticket?.uploadToken) {
    const { error } = await supabase.storage
      .from('shared-media')
      .uploadToSignedUrl(ticket.uploadPath, ticket.uploadToken, file)
    if (error) throw error
    return
  }

  if (!accessToken) {
    throw new Error('No active session')
  }

  const endpoint = `${supabaseUrl}/storage/v1/upload/resumable`
  const contentType = String(file?.type || ticket?.mimeType || 'application/octet-stream')

  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 2500, 5000],
      metadata: {
        bucketName: 'shared-media',
        objectName: objectPath,
        contentType,
        cacheControl: '3600',
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      onError: (err) => reject(err),
      onSuccess: () => resolve(true),
    })

    upload.findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads?.length) {
          upload.resumeFromPreviousUpload(previousUploads[0])
        }
        upload.start()
      })
      .catch(() => {
        upload.start()
      })
  })
}

export async function uploadWithSignedUploadUrl(uploadTarget, file) {
  if (!supabase) throw new Error('Supabase is not configured')

  const path = String(uploadTarget?.path || '').trim()
  const token = String(uploadTarget?.token || '').trim()
  if (!path || !token) throw new Error('Derivative upload target is missing')

  const { error } = await supabase.storage
    .from('shared-media')
    .uploadToSignedUrl(path, token, file, {
      contentType: String(file?.type || 'image/jpeg'),
    })

  if (error) throw error
}

export function completeUpload(mediaId) {
  return callFunction('complete-upload', {
    method: 'POST',
    body: { mediaId },
  })
}

export function fetchGalleryFeed(cursor = null, limit = 20) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (cursor) params.set('cursor', cursor)
  return callFunction(`gallery-feed?${params.toString()}`)
}

export function fetchMyUploads(cursor = null, limit = 20) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (cursor) params.set('cursor', cursor)
  return callFunction(`my-uploads?${params.toString()}`)
}

export function signMediaUrl(mediaId, variant = 'processed') {
  return callFunction('sign-media-url', {
    method: 'POST',
    body: { mediaId, variant },
  })
}

const zipCrcTable = new Uint32Array(256)
for (let i = 0; i < 256; i += 1) {
  let c = i
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  zipCrcTable[i] = c >>> 0
}

function updateZipCrc(crc, chunk) {
  let next = crc
  for (const byte of chunk) {
    next = zipCrcTable[(next ^ byte) & 0xff] ^ (next >>> 8)
  }
  return next >>> 0
}

function zipU16(value) {
  return [value & 0xff, (value >>> 8) & 0xff]
}

function zipU32(value) {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]
}

function zipDateTime(value) {
  const date = new Date(value)
  const safe = Number.isNaN(date.getTime()) ? new Date() : date
  const year = Math.max(1980, safe.getUTCFullYear())
  return {
    dosTime: (safe.getUTCHours() << 11) | (safe.getUTCMinutes() << 5) | Math.floor(safe.getUTCSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((safe.getUTCMonth() + 1) << 5) | safe.getUTCDate(),
  }
}

function zipConcat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function zipLocalHeader(nameBytes, dosTime, dosDate, crc, bytes) {
  return zipConcat([
    zipU32(0x04034b50),
    zipU16(20),
    zipU16(0x0800),
    zipU16(0),
    zipU16(dosTime),
    zipU16(dosDate),
    zipU32(crc),
    zipU32(bytes),
    zipU32(bytes),
    zipU16(nameBytes.length),
    zipU16(0),
    nameBytes,
  ])
}

function zipCentralHeader(entry) {
  return zipConcat([
    zipU32(0x02014b50),
    zipU16(20),
    zipU16(20),
    zipU16(0x0800),
    zipU16(0),
    zipU16(entry.dosTime),
    zipU16(entry.dosDate),
    zipU32(entry.crc),
    zipU32(entry.bytes),
    zipU32(entry.bytes),
    zipU16(entry.nameBytes.length),
    zipU16(0),
    zipU16(0),
    zipU16(0),
    zipU16(0),
    zipU32(0),
    zipU32(entry.offset),
    entry.nameBytes,
  ])
}

function zipEnd(entryCount, centralBytes, centralOffset) {
  return zipConcat([
    zipU32(0x06054b50),
    zipU16(0),
    zipU16(0),
    zipU16(entryCount),
    zipU16(entryCount),
    zipU32(centralBytes),
    zipU32(centralOffset),
    zipU16(0),
  ])
}

async function fetchArchiveEntry(entry, onChunk) {
  const res = await fetch(entry.url)
  if (!res.ok) throw new Error(`Could not download ${entry.name}`)

  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer())
    onChunk(bytes.length)
    return {
      chunks: [bytes],
      bytes: bytes.length,
      crc: (updateZipCrc(0xffffffff, bytes) ^ 0xffffffff) >>> 0,
    }
  }

  const reader = res.body.getReader()
  const chunks = []
  let crc = 0xffffffff
  let bytes = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    crc = updateZipCrc(crc, value)
    bytes += value.length
    onChunk(value.length)
  }

  return {
    chunks,
    bytes,
    crc: (crc ^ 0xffffffff) >>> 0,
  }
}

async function buildArchiveFromManifest(manifest, onProgress) {
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : []
  if (!entries.length) throw new Error('No media from other guests is available to download.')

  const encoder = new TextEncoder()
  const parts = []
  const centralEntries = []
  const totalBytes = Number(manifest.totalBytes || 0)
  let loadedBytes = 0
  let written = 0

  onProgress?.({
    phase: 'downloading',
    loadedBytes: 0,
    totalBytes,
    itemCount: entries.length,
  })

  for (const entry of entries) {
    const downloaded = await fetchArchiveEntry(entry, (chunkBytes) => {
      loadedBytes += chunkBytes
      onProgress?.({
        phase: 'downloading',
        loadedBytes,
        totalBytes,
        itemCount: entries.length,
      })
    })
    const { dosTime, dosDate } = zipDateTime(entry.publishedAt)
    const nameBytes = encoder.encode(entry.name)
    const offset = written
    const header = zipLocalHeader(nameBytes, dosTime, dosDate, downloaded.crc, downloaded.bytes)

    parts.push(header, ...downloaded.chunks)
    written += header.length + downloaded.bytes
    centralEntries.push({ nameBytes, crc: downloaded.crc, bytes: downloaded.bytes, offset, dosTime, dosDate })
  }

  const centralOffset = written
  let centralBytes = 0
  for (const entry of centralEntries) {
    const header = zipCentralHeader(entry)
    centralBytes += header.length
    parts.push(header)
  }
  parts.push(zipEnd(centralEntries.length, centralBytes, centralOffset))

  const blob = new Blob(parts, { type: 'application/zip' })
  onProgress?.({
    phase: 'complete',
    loadedBytes: blob.size,
    totalBytes: blob.size,
    itemCount: entries.length,
  })

  return {
    blob,
    filename: manifest.filename || 'friends-weekend-2026.zip',
    itemCount: entries.length,
    totalBytes: blob.size,
  }
}

export async function downloadMediaArchive(options = {}) {
  options.onProgress?.({
    phase: 'requesting',
    loadedBytes: 0,
    totalBytes: 0,
    itemCount: 0,
  })
  const manifest = await callFunction('download-media-archive?manifest=1', {
    timeoutMs: 120000,
  })
  return buildArchiveFromManifest(manifest, options.onProgress)
}

export function removeMedia(mediaId) {
  return callFunction(`media/${encodeURIComponent(mediaId)}`, {
    method: 'DELETE',
  })
}
