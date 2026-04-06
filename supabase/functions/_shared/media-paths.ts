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
  return `originals/${userId}/${mediaId}/${safeName}.${ext}`
}

export function buildDerivedPaths(
  userId: string,
  mediaId: string,
  mediaType: 'image' | 'video',
  mimeType: string,
) {
  const ext = FILE_EXT_BY_MIME[mimeType] ?? (mediaType === 'image' ? 'jpg' : 'mp4')

  if (mediaType === 'image') {
    return {
      processedPath: `processed/${userId}/${mediaId}/image.${ext}`,
      thumbPath: `thumbs/${userId}/${mediaId}/thumb.${ext}`,
      posterPath: null,
    }
  }

  return {
    processedPath: `processed/${userId}/${mediaId}/video.${ext}`,
    thumbPath: null,
    posterPath: null,
  }
}

export function mediaTypeFromMime(mimeType: string): 'image' | 'video' | null {
  if (IMAGE_MIME.has(mimeType)) return 'image'
  if (VIDEO_MIME.has(mimeType)) return 'video'
  return null
}
