import { callFunction } from './functionsApi'

export function listInvites() {
  return callFunction('invites')
}

export function upsertInvite(payload) {
  return callFunction('invites', {
    method: 'POST',
    body: payload,
  })
}

export function inviteAndSend(payload) {
  return callFunction('invite-and-send', {
    method: 'POST',
    body: payload,
  })
}

export function listInviteDeliveryAttempts({ limit = 50, email = '' } = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (normalizedEmail) params.set('email', normalizedEmail)
  return callFunction(`invite-delivery-attempts?${params.toString()}`)
}

export function listMagicLinkAttempts({ limit = 50, email = '' } = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (normalizedEmail) params.set('email', normalizedEmail)
  return callFunction(`magic-link-attempts?${params.toString()}`)
}

export function removeInvite(email) {
  return callFunction(`invites/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  })
}
