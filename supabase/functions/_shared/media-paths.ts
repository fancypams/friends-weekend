import { FILE_EXT_BY_MIME, IMAGE_MIME, VIDEO_MIME } from './constants.ts'

export function sanitizeFilename(filename: string) {
  return filename
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80) || 'upload'
}

export function buildOriginalPath(userId: string, mediaId: string, mimeType: string, filename: string) {
  const ext = FILE_EXT_BY_MIME[mimeType] ?? 'bin'
  const safeName = sanitizeFilename(filename)
  const baseName = safeName.replace(/\.[a-z0-9]{2,8}$/i, '') || 'upload'
  return `originals/${userId}/${mediaId}/${baseName}.${ext}`
}

export function buildDerivedPaths(
  userId: string,
  mediaId: string,
  mediaType: 'image' | 'video',
  mimeType: string,
  originalPath?: string,
) {
  const derivedExt = mediaType === 'image'
    ? 'jpg'
    : FILE_EXT_BY_MIME[mimeType] ?? 'mp4'
  const sourceName = String(originalPath || '').split('/').pop() || ''
  const safeSource = sanitizeFilename(sourceName)
  const fallbackBase = mediaType === 'image' ? 'image' : 'video'
  const hasExt = safeSource.includes('.')
  const baseName = (hasExt ? safeSource.replace(/\.[^.]+$/, '') : safeSource) || fallbackBase
  const processedFilename = `${baseName}.${derivedExt}`
  const thumbFilename = `${baseName}-thumb.${derivedExt}`

  if (mediaType === 'image') {
    return {
      processedPath: `processed/${userId}/${mediaId}/${processedFilename}`,
      thumbPath: `thumbs/${userId}/${mediaId}/${thumbFilename}`,
      posterPath: null,
    }
  }

  return {
    processedPath: `processed/${userId}/${mediaId}/${processedFilename}`,
    thumbPath: null,
    posterPath: null,
  }
}

export function mediaTypeFromMime(mimeType: string): 'image' | 'video' | null {
  if (IMAGE_MIME.has(mimeType)) return 'image'
  if (VIDEO_MIME.has(mimeType)) return 'video'
  return null
}
