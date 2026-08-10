export const CAPTURE_WINDOW_START_ISO = '2026-07-30T07:00:00.000Z' // Jul 30 00:00 Seattle (PDT)
export const CAPTURE_WINDOW_END_ISO = '2026-08-10T06:59:59.999Z' // Aug 9 23:59:59 Seattle (PDT)
export const TRIP_END_ISO = '2026-08-10T07:00:00.000Z' // Aug 10 00:00 Seattle (PDT)
export const POST_TRIP_UPLOAD_END_ISO = '2026-08-13T07:00:00.000Z' // Aug 13 00:00 Seattle (PDT)

export const CAPTURE_WINDOW_START = new Date(CAPTURE_WINDOW_START_ISO)
export const CAPTURE_WINDOW_END = new Date(CAPTURE_WINDOW_END_ISO)
export const TRIP_END = new Date(TRIP_END_ISO)
export const POST_TRIP_UPLOAD_END = new Date(POST_TRIP_UPLOAD_END_ISO)

export function isWithinCaptureWindow(date: Date) {
  const ms = date.getTime()
  return ms >= CAPTURE_WINDOW_START.getTime() && ms <= CAPTURE_WINDOW_END.getTime()
}

export function captureWindowLabel() {
  return 'Jul 30-Aug 9, 2026 (Seattle time)'
}
