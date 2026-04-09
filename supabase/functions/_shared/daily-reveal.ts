const PT_UTC_OFFSET_HOURS = 7 // Event dates are in summer (PDT, UTC-7)
const PT_OFFSET_MS = PT_UTC_OFFSET_HOURS * 60 * 60 * 1000
const REVEAL_HOUR_PT = 21 // 9:00 PM PT
const OPEN_WINDOW_END_HOUR_PT = 3 // 3:00 AM PT (exclusive)

export function revealAtIsoForUpload(uploadedAtRaw: string | null | undefined) {
  const uploadedAt = new Date(String(uploadedAtRaw || ''))
  if (Number.isNaN(uploadedAt.getTime())) return null

  const uploadedMs = uploadedAt.getTime()
  const ptShifted = new Date(uploadedMs - PT_OFFSET_MS)

  const year = ptShifted.getUTCFullYear()
  const month = ptShifted.getUTCMonth()
  const day = ptShifted.getUTCDate()
  const hourPt = ptShifted.getUTCHours()

  if (hourPt >= REVEAL_HOUR_PT || hourPt < OPEN_WINDOW_END_HOUR_PT) {
    return uploadedAt.toISOString()
  }

  let revealUtcMs = Date.UTC(year, month, day, REVEAL_HOUR_PT + PT_UTC_OFFSET_HOURS, 0, 0, 0)

  return new Date(revealUtcMs).toISOString()
}

export function isEmbargoedForViewer(uploadedAtRaw: string | null | undefined, nowMs = Date.now()) {
  const revealAt = revealAtIsoForUpload(uploadedAtRaw)
  if (!revealAt) {
    return {
      revealAt: null,
      embargoed: false,
    }
  }

  const revealMs = new Date(revealAt).getTime()
  return {
    revealAt,
    embargoed: Number.isFinite(revealMs) && nowMs < revealMs,
  }
}
