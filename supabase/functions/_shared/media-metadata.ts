import * as exifr from 'npm:exifr@7.1.3'

type CaptureParseSuccess = {
  capturedAt: Date
  source: string
}

type CaptureParseResult = CaptureParseSuccess | null

const QUICKTIME_TO_UNIX_SECONDS = 2082844800n

function asValidDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }

    const exif = parseExifDateString(value)
    if (exif) return exif
  }

  return null
}

function parseExifDateString(value: string): Date | null {
  const m = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = Number(m[6] ?? '0')

  // EXIF date strings often omit timezone. For this event gate, interpret
  // naive timestamps as Seattle local time (PDT in this window).
  const utcMs = Date.UTC(year, month - 1, day, hour + 7, minute, second)
  const date = new Date(utcMs)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function bytesToArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

async function parseImageCaptureDate(bytes: Uint8Array): Promise<CaptureParseResult> {
  const tags = await exifr.parse(bytesToArrayBuffer(bytes), {
    pick: ['DateTimeOriginal', 'CreateDate', 'DateTime', 'ModifyDate'],
    reviveValues: true,
  })

  if (!tags || typeof tags !== 'object') {
    return null
  }

  const candidates = [
    tags.DateTimeOriginal,
    tags.CreateDate,
    tags.DateTime,
    tags.ModifyDate,
  ]

  for (const candidate of candidates) {
    const date = asValidDate(candidate)
    if (date) {
      return {
        capturedAt: date,
        source: 'image.exif',
      }
    }
  }

  return null
}

type AtomInfo = {
  offset: number
  size: number
  headerSize: number
  type: string
}

function readUint32BE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0
}

function readUint64BE(bytes: Uint8Array, offset: number): bigint | null {
  if (offset + 8 > bytes.length) return null
  let value = 0n
  for (let i = 0; i < 8; i += 1) {
    value = (value << 8n) | BigInt(bytes[offset + i] ?? 0)
  }
  return value
}

function readAsciiType(bytes: Uint8Array, offset: number): string {
  if (offset + 4 > bytes.length) return ''
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  )
}

function iterateAtoms(bytes: Uint8Array, start: number, end: number): AtomInfo[] {
  const atoms: AtomInfo[] = []
  let offset = start

  while (offset + 8 <= end && offset + 8 <= bytes.length) {
    const size32 = readUint32BE(bytes, offset)
    if (!size32) break

    const type = readAsciiType(bytes, offset + 4)
    let size = size32
    let headerSize = 8

    if (size32 === 1) {
      const size64 = readUint64BE(bytes, offset + 8)
      if (!size64) break
      if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) break
      size = Number(size64)
      headerSize = 16
    } else if (size32 === 0) {
      size = end - offset
    }

    if (size < headerSize || offset + size > end || offset + size > bytes.length) {
      break
    }

    atoms.push({ offset, size, headerSize, type })
    offset += size
  }

  return atoms
}

function findAtomRecursive(
  bytes: Uint8Array,
  start: number,
  end: number,
  targetType: string,
  maxDepth = 5,
): AtomInfo | null {
  const containerTypes = new Set(['moov', 'trak', 'mdia', 'udta', 'meta'])
  const atoms = iterateAtoms(bytes, start, end)

  for (const atom of atoms) {
    if (atom.type === targetType) {
      return atom
    }

    if (maxDepth > 0 && containerTypes.has(atom.type)) {
      const childStart = atom.offset + atom.headerSize
      const childEnd = atom.offset + atom.size
      const found = findAtomRecursive(bytes, childStart, childEnd, targetType, maxDepth - 1)
      if (found) return found
    }
  }

  return null
}

function quickTimeSecondsToDate(seconds: bigint): Date | null {
  const unixSeconds = seconds - QUICKTIME_TO_UNIX_SECONDS
  if (unixSeconds < 0n) return null
  if (unixSeconds > BigInt(Number.MAX_SAFE_INTEGER)) return null

  const date = new Date(Number(unixSeconds) * 1000)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function parseMvhdCaptureDate(bytes: Uint8Array, atom: AtomInfo): Date | null {
  const payload = atom.offset + atom.headerSize
  const version = bytes[payload] ?? 0

  if (version === 1) {
    const creation = readUint64BE(bytes, payload + 4)
    if (!creation) return null
    return quickTimeSecondsToDate(creation)
  }

  const creation = readUint32BE(bytes, payload + 4)
  if (creation == null) return null
  return quickTimeSecondsToDate(BigInt(creation))
}

async function parseVideoCaptureDate(bytes: Uint8Array): Promise<CaptureParseResult> {
  const mvhd = findAtomRecursive(bytes, 0, bytes.length, 'mvhd')
  if (mvhd) {
    const date = parseMvhdCaptureDate(bytes, mvhd)
    if (date) {
      return {
        capturedAt: date,
        source: 'video.mvhd',
      }
    }
  }

  const mdhd = findAtomRecursive(bytes, 0, bytes.length, 'mdhd')
  if (mdhd) {
    const date = parseMvhdCaptureDate(bytes, mdhd)
    if (date) {
      return {
        capturedAt: date,
        source: 'video.mdhd',
      }
    }
  }

  return null
}

export async function extractCaptureTimestamp(
  mediaType: 'image' | 'video',
  bytes: Uint8Array,
): Promise<CaptureParseResult> {
  try {
    if (mediaType === 'image') {
      return await parseImageCaptureDate(bytes)
    }

    return await parseVideoCaptureDate(bytes)
  } catch {
    return null
  }
}
