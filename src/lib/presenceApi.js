import { callFunction } from './functionsApi'

export function sendPresenceHeartbeat(path) {
  return callFunction('presence-heartbeat', {
    method: 'POST',
    body: {
      path: String(path || '/'),
    },
  })
}

export function fetchActiveUsersSummary({ inactivityMinutes = 15 } = {}) {
  const params = new URLSearchParams()
  params.set('inactivity_minutes', String(inactivityMinutes))
  return callFunction(`active-users?${params.toString()}`)
}
