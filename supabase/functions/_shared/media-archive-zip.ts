import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { FILE_EXT_BY_MIME } from './constants.ts'

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
