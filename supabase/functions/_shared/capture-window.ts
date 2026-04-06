export const CAPTURE_WINDOW_START_ISO = '2026-07-31T07:00:00.000Z' // Jul 31 00:00 Seattle (PDT)
export const CAPTURE_WINDOW_END_ISO = '2026-08-05T06:59:59.999Z' // Aug 4 23:59:59 Seattle (PDT)

export const CAPTURE_WINDOW_START = new Date(CAPTURE_WINDOW_START_ISO)
export const CAPTURE_WINDOW_END = new Date(CAPTURE_WINDOW_END_ISO)

export function isWithinCaptureWindow(date: Date) {
  const ms = date.getTime()
  return ms >= CAPTURE_WINDOW_START.getTime() && ms <= CAPTURE_WINDOW_END.getTime()
}

export function captureWindowLabel() {
  return 'Jul 31-Aug 4, 2026 (Seattle time)'
}
