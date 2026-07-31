function titleCaseName(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

function normalizeEmailHandle(value) {
  const localPart = String(value || '').trim().toLowerCase().split('@')[0] || ''
  const spaced = localPart.replace(/[._-]+/g, ' ')
  if (spaced.includes(' ')) return spaced

  const compactKnownNames = {
    johnhabibi: 'John Habibi',
  }

  return compactKnownNames[localPart] || spaced
}

export function uploaderDisplayName(item, fallback = 'Friend') {
  if (item?.embargoed_for_viewer) return 'Anonymous'

  const displayName = titleCaseName(item?.owner_display_name)
  if (displayName) return displayName

  const email = String(item?.owner_email || '').trim().toLowerCase()
  const fromEmail = titleCaseName(normalizeEmailHandle(email))
  return fromEmail || fallback
}
