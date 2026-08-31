import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { BUCKET, FILE_EXT_BY_MIME } from './constants.ts'

export const MAX_ZIP32_BYTES = 0xffffffff
export const MAX_ZIP32_ENTRIES = 0xffff

const PAGE_SIZE = 1000

export type MediaArchiveRow = {
  id: string
  mime_type: string
  original_filename: string | null
  original_path: string
  bytes: number
  published_at: string
}

export type ZipEntry = {
  name: string
  path: string
  bytes: number
  publishedAt: string
}

export type ZipProgress = {
  processedItems: number
  processedBytes: number
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
  let crc = i
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  crcTable[i] = crc >>> 0
}

function updateCrc(crc: number, chunk: Uint8Array) {
  let next = crc
  for (const byte of chunk) next = crcTable[(next ^ byte) & 0xff] ^ (next >>> 8)
  return next >>> 0
}

function u16(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff]
}

function u32(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
}

function concatParts(parts: (number[] | Uint8Array)[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
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

function streamingLocalHeader(nameBytes: Uint8Array, dosTime: number, dosDate: number) {
  return concatParts([
    u32(0x04034b50), u16(20), u16(0x0808), u16(0), u16(dosTime), u16(dosDate),
    u32(0), u32(0), u32(0), u16(nameBytes.length), u16(0), nameBytes,
  ])
}

function dataDescriptor(crc: number, bytes: number) {
  return concatParts([u32(0x08074b50), u32(crc), u32(bytes), u32(bytes)])
}

function centralHeader(entry: CentralEntry) {
  return concatParts([
    u32(0x02014b50), u16(20), u16(20), u16(0x0808), u16(0),
    u16(entry.dosTime), u16(entry.dosDate), u32(entry.crc), u32(entry.bytes), u32(entry.bytes),
    u16(entry.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(entry.offset), entry.nameBytes,
  ])
}

function endOfCentralDirectory(entryCount: number, centralBytes: number, centralOffset: number) {
  return concatParts([
    u32(0x06054b50), u16(0), u16(0), u16(entryCount), u16(entryCount),
    u32(centralBytes), u32(centralOffset), u16(0),
  ])
}

function sanitizeFilename(name: string) {
  return name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\x00-\x1f\x7f]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

function uniqueArchiveName(row: MediaArchiveRow, used: Map<string, number>) {
  const fromName = String(row.original_filename || '').match(/\.([A-Za-z0-9]{1,8})$/)?.[1]
  const ext = fromName?.toLowerCase() || FILE_EXT_BY_MIME[String(row.mime_type || '').toLowerCase()] || 'bin'
  const fallback = `media-${row.id}.${ext}`
  let clean = sanitizeFilename(String(row.original_filename || fallback)) || fallback
  if (!/\.[A-Za-z0-9]{1,8}$/.test(clean)) clean = `${clean}.${ext}`

  const dot = clean.lastIndexOf('.')
  const key = clean.toLowerCase()
  const count = (used.get(key) || 0) + 1
  used.set(key, count)
  if (count === 1) return clean

  const deduped = `${dot > 0 ? clean.slice(0, dot) : clean} (${count})${dot > 0 ? clean.slice(dot) : ''}`
  used.set(deduped.toLowerCase(), 1)
  return deduped
}

export async function loadArchiveRows(admin: SupabaseClient, userId: string) {
  const rows: MediaArchiveRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('media_assets')
      .select('id,mime_type,original_filename,original_path,bytes,published_at')
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

export function buildZipEntries(rows: MediaArchiveRow[]) {
  const usedNames = new Map<string, number>()
  return rows.map((row) => ({
    name: uniqueArchiveName(row, usedNames),
    path: row.original_path,
    bytes: Number(row.bytes || 0),
    publishedAt: row.published_at,
  }))
}

export function estimateZipBytes(entries: ZipEntry[]) {
  const encoder = new TextEncoder()
  return entries.reduce((sum, entry) => {
    const nameBytes = encoder.encode(entry.name).length
    return sum + entry.bytes + 30 + nameBytes + 16 + 46 + nameBytes
  }, 22)
}

export async function archiveVersion(rows: MediaArchiveRow[]) {
  const source = rows
    .map((row) => [row.id, row.original_path, row.bytes, row.published_at].join(':'))
    .join('\n')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createZipStream(
  admin: SupabaseClient,
  entries: ZipEntry[],
  onEntryComplete?: (progress: ZipProgress) => Promise<void> | void,
) {
  const pipe = new TransformStream<Uint8Array, Uint8Array>()
  const writer = pipe.writable.getWriter()

  const completed = (async () => {
    const encoder = new TextEncoder()
    const centralEntries: CentralEntry[] = []
    let written = 0
    let processedBytes = 0

    const write = async (chunk: Uint8Array) => {
      if (written + chunk.length > MAX_ZIP32_BYTES) throw new Error('Archive is too large for ZIP32')
      await writer.write(chunk)
      written += chunk.length
    }

    try {
      for (const entry of entries) {
        const { dosTime, dosDate } = dosDateTime(entry.publishedAt)
        const nameBytes = encoder.encode(entry.name)
        const offset = written
        await write(streamingLocalHeader(nameBytes, dosTime, dosDate))

        const { data: source, error } = await admin.storage.from(BUCKET).download(entry.path).asStream()
        if (error || !source) throw new Error(error?.message || `Could not read ${entry.name}`)

        const reader = source.getReader()
        let crc = 0xffffffff
        let bytes = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value) continue
          crc = updateCrc(crc, value)
          bytes += value.length
          if (bytes > MAX_ZIP32_BYTES) throw new Error(`${entry.name} is too large for ZIP32`)
          await write(value)
        }

        crc = (crc ^ 0xffffffff) >>> 0
        await write(dataDescriptor(crc, bytes))
        centralEntries.push({ nameBytes, crc, bytes, offset, dosTime, dosDate })
        processedBytes += bytes
        await onEntryComplete?.({
          processedItems: centralEntries.length,
          processedBytes,
        })
      }

      const centralOffset = written
      let centralBytes = 0
      for (const entry of centralEntries) {
        const header = centralHeader(entry)
        centralBytes += header.length
        await write(header)
      }
      await write(endOfCentralDirectory(centralEntries.length, centralBytes, centralOffset))
      await writer.close()
    } catch (error) {
      await writer.abort(error).catch(() => undefined)
      throw error
    }
  })()

  completed.catch(() => undefined)
  return { stream: pipe.readable, completed }
}
