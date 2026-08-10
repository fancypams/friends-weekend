import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { handleOptions, withCors } from '../_shared/cors.ts'
import { assertMethod, forbidden, json, serverError } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'
import { BUCKET, FILE_EXT_BY_MIME } from '../_shared/constants.ts'

const ARCHIVE_UNLOCK_AT_ISO = '2026-08-10T07:00:00.000Z' // Aug 10 00:00 Pacific
const ARCHIVE_UNLOCK_AT_MS = Date.parse(ARCHIVE_UNLOCK_AT_ISO)
const ARCHIVE_FILENAME = 'friends-weekend-2026.zip'
const MAX_ZIP32_BYTES = 0xffffffff
const MAX_ZIP32_ENTRIES = 0xffff
const PAGE_SIZE = 1000
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60
const SIGNED_URL_BATCH_SIZE = 100

type MediaArchiveRow = {
  id: string
  owner_id: string
  mime_type: string
  original_filename: string | null
  original_path: string
  bytes: number
  published_at: string
}

type ZipEntry = {
  name: string
  path: string
  bytes: number
  publishedAt: string
}

type CentralEntry = {
  nameBytes: Uint8Array
  crc: number
  bytes: number
  offset: number
  dosTime: number
  dosDate: number
}

const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i += 1) {
  let c = i
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[i] = c >>> 0
}

function updateCrc(crc: number, chunk: Uint8Array) {
  let next = crc
  for (const byte of chunk) {
    next = crcTable[(next ^ byte) & 0xff] ^ (next >>> 8)
  }
  return next >>> 0
}

function u16(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff]
}

function u32(value: number) {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]
}

function dosDateTime(value: string) {
  const date = new Date(value)
  const safe = Number.isNaN(date.getTime()) ? new Date() : date
  const year = Math.max(1980, safe.getUTCFullYear())
  return {
    dosTime: (safe.getUTCHours() << 11) | (safe.getUTCMinutes() << 5) | Math.floor(safe.getUTCSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((safe.getUTCMonth() + 1) << 5) | safe.getUTCDate(),
  }
}

function concatParts(parts: (number[] | Uint8Array)[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function localHeader(nameBytes: Uint8Array, dosTime: number, dosDate: number, crc: number, bytes: number) {
  return concatParts([
    u32(0x04034b50),
    u16(20),
    u16(0x0800), // UTF-8 filenames.
    u16(0),
    u16(dosTime),
    u16(dosDate),
    u32(crc),
    u32(bytes),
    u32(bytes),
    u16(nameBytes.length),
    u16(0),
    nameBytes,
  ])
}

function centralHeader(entry: CentralEntry) {
  return concatParts([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0x0800),
    u16(0),
    u16(entry.dosTime),
    u16(entry.dosDate),
    u32(entry.crc),
    u32(entry.bytes),
    u32(entry.bytes),
    u16(entry.nameBytes.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(entry.offset),
    entry.nameBytes,
  ])
}

function endOfCentralDirectory(entryCount: number, centralBytes: number, centralOffset: number) {
  return concatParts([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entryCount),
    u16(entryCount),
    u32(centralBytes),
    u32(centralOffset),
    u16(0),
  ])
}

function extensionFor(row: MediaArchiveRow) {
  const fromName = String(row.original_filename || '').match(/\.([A-Za-z0-9]{1,8})$/)?.[1]
  if (fromName) return fromName.toLowerCase()
  return FILE_EXT_BY_MIME[String(row.mime_type || '').toLowerCase()] || 'bin'
}

function sanitizeFilename(name: string) {
  return name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\x00-\x1f\x7f]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

function archiveName(row: MediaArchiveRow, used: Map<string, number>) {
  const ext = extensionFor(row)
  const fallback = `media-${row.id}.${ext}`
  let clean = sanitizeFilename(String(row.original_filename || fallback)) || fallback
  if (!/\.[A-Za-z0-9]{1,8}$/.test(clean)) clean = `${clean}.${ext}`

  const dot = clean.lastIndexOf('.')
  const stem = dot > 0 ? clean.slice(0, dot) : clean
  const suffix = dot > 0 ? clean.slice(dot) : ''
  const key = clean.toLowerCase()
  const count = (used.get(key) || 0) + 1
  used.set(key, count)
  if (count === 1) return clean

  const deduped = `${stem} (${count})${suffix}`
  used.set(deduped.toLowerCase(), 1)
  return deduped
}

async function loadArchiveRows(admin: SupabaseClient, userId: string) {
  const rows: MediaArchiveRow[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('media_assets')
      .select('id,owner_id,mime_type,original_filename,original_path,bytes,published_at')
      .eq('status', 'published')
      .is('removed_at', null)
      .neq('owner_id', userId)
      .order('published_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<MediaArchiveRow[]>()

    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }

  return rows
}

async function signedManifest(admin: SupabaseClient, entries: ZipEntry[], totalBytes: number) {
  const signedUrlByPath = new Map<string, string>()

  for (let index = 0; index < entries.length; index += SIGNED_URL_BATCH_SIZE) {
    const batch = entries.slice(index, index + SIGNED_URL_BATCH_SIZE)
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrls(batch.map((entry) => entry.path), SIGNED_URL_EXPIRES_IN_SECONDS)
    if (error || !Array.isArray(data)) {
      throw new Error(error?.message || 'Could not sign archive media')
    }

    for (const signed of data) {
      if (signed.error || !signed.path || !signed.signedUrl) {
        throw new Error(signed.error || `Could not sign ${signed.path || 'archive media'}`)
      }
      signedUrlByPath.set(signed.path, signed.signedUrl)
    }
  }

  const signedEntries = entries.map((entry) => {
    const url = signedUrlByPath.get(entry.path)
    if (!url) throw new Error(`Could not sign ${entry.name}`)

    return {
      name: entry.name,
      url,
      bytes: entry.bytes,
      publishedAt: entry.publishedAt,
    }
  })

  return {
    filename: ARCHIVE_FILENAME,
    totalBytes,
    itemCount: entries.length,
    entries: signedEntries,
  }
}

function crc32(bytes: Uint8Array) {
  return (updateCrc(0xffffffff, bytes) ^ 0xffffffff) >>> 0
}

function zipStream(admin: SupabaseClient, entries: ZipEntry[]) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const centralEntries: CentralEntry[] = []
      let written = 0

      const enqueue = (chunk: Uint8Array) => {
        controller.enqueue(chunk)
        written += chunk.length
      }

      try {
        for (const entry of entries) {
          const { dosTime, dosDate } = dosDateTime(entry.publishedAt)
          const nameBytes = encoder.encode(entry.name)
          const offset = written

          const { data: blob, error } = await admin.storage.from(BUCKET).download(entry.path)
          if (error || !blob) throw new Error(error?.message || `Could not read ${entry.name}`)

          const bytes = new Uint8Array(await blob.arrayBuffer())
          if (bytes.length > MAX_ZIP32_BYTES) {
            throw new Error(`${entry.name} is too large for ZIP32`)
          }

          const crc = crc32(bytes)
          enqueue(localHeader(nameBytes, dosTime, dosDate, crc, bytes.length))
          enqueue(bytes)
          centralEntries.push({ nameBytes, crc, bytes: bytes.length, offset, dosTime, dosDate })
        }

        const centralOffset = written
        let centralBytes = 0
        for (const entry of centralEntries) {
          const header = centralHeader(entry)
          centralBytes += header.length
          enqueue(header)
        }
        enqueue(endOfCentralDirectory(centralEntries.length, centralBytes, centralOffset))
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['GET'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response

  if (Date.now() < ARCHIVE_UNLOCK_AT_MS) {
    return forbidden(`Archive is available after ${ARCHIVE_UNLOCK_AT_ISO}`)
  }

  let rows: MediaArchiveRow[]
  try {
    rows = await loadArchiveRows(auth.admin, auth.user.id)
  } catch (err) {
    return serverError('Failed to load media archive list', err instanceof Error ? err.message : String(err))
  }

  if (!rows.length) {
    return json({ error: 'No media from other guests is available to download.' }, 404)
  }

  if (rows.length > MAX_ZIP32_ENTRIES) {
    return json({ error: 'Archive has too many files to download as a single ZIP.' }, 413)
  }

  const usedNames = new Map<string, number>()
  const encoder = new TextEncoder()
  const entries = rows.map((row) => ({
    name: archiveName(row, usedNames),
    path: row.original_path,
    bytes: Number(row.bytes || 0),
    publishedAt: row.published_at,
  }))

  const estimatedZipBytes = entries.reduce((sum, entry) => (
    sum + entry.bytes + 30 + encoder.encode(entry.name).length + 46 + encoder.encode(entry.name).length
  ), 22)

  if (estimatedZipBytes > MAX_ZIP32_BYTES) {
    return json({ error: 'Archive is too large to download as a single ZIP.' }, 413)
  }

  if (new URL(req.url).searchParams.get('manifest') === '1') {
    try {
      return json(await signedManifest(auth.admin, entries, estimatedZipBytes))
    } catch (err) {
      return serverError('Could not prepare archive', err instanceof Error ? err.message : String(err))
    }
  }

  return withCors(new Response(zipStream(auth.admin, entries), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${ARCHIVE_FILENAME}"`,
      'X-Archive-Item-Count': String(entries.length),
      'X-Archive-Total-Bytes': String(estimatedZipBytes),
      'Cache-Control': 'no-store',
    },
  }))
})
