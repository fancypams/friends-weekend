const PT_UTC_OFFSET_HOURS = 7 // Event dates are in summer (PDT, UTC-7)
const PT_OFFSET_MS = PT_UTC_OFFSET_HOURS * 60 * 60 * 1000
const REVEAL_HOUR_PT = 21 // 9:00 PM PT
const FIRST_REVEAL_AT_MS = Date.parse('2026-08-01T04:00:00.000Z') // Jul 31 21:00 Seattle (PDT)

export function revealAtIsoForUpload(uploadedAtRaw: string | null | undefined) {
  const uploadedAt = new Date(String(uploadedAtRaw || ''))
  if (Number.isNaN(uploadedAt.getTime())) return null

  const uploadedMs = uploadedAt.getTime()
  const ptShifted = new Date(uploadedMs - PT_OFFSET_MS)

  const year = ptShifted.getUTCFullYear()
  const month = ptShifted.getUTCMonth()
  const day = ptShifted.getUTCDate()
  const hourPt = ptShifted.getUTCHours()

  let revealUtcMs = Date.UTC(year, month, day, REVEAL_HOUR_PT + PT_UTC_OFFSET_HOURS, 0, 0, 0)
  if (hourPt >= REVEAL_HOUR_PT) {
    revealUtcMs = uploadedMs
  }

  if (Number.isFinite(FIRST_REVEAL_AT_MS) && revealUtcMs < FIRST_REVEAL_AT_MS) {
    revealUtcMs = FIRST_REVEAL_AT_MS
  }

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
