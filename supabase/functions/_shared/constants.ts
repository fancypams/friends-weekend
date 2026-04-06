export const BUCKET = 'shared-media'

const DEFAULT_IMAGE_MAX_BYTES = 25 * 1024 * 1024
const DEFAULT_VIDEO_MAX_BYTES = 250 * 1024 * 1024

function envInt(name: string, fallback: number) {
  const value = Number(Deno.env.get(name) ?? NaN)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export const IMAGE_MAX_BYTES = envInt('IMAGE_MAX_BYTES', DEFAULT_IMAGE_MAX_BYTES)
export const VIDEO_MAX_BYTES = envInt('VIDEO_MAX_BYTES', DEFAULT_VIDEO_MAX_BYTES)

export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
])

export const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

export const VIDEO_MIME = new Set([
  'video/mp4',
  'video/quicktime',
])

export const FILE_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
}

export const UPLOADS_PER_HOUR_LIMIT = 80
export const SIGNED_URL_TTL_SECONDS = 90
