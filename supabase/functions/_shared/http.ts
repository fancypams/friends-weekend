import { withCors } from './cors.ts'

export function json(payload: unknown, status = 200) {
  return withCors(
    new Response(JSON.stringify(payload), {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    }),
  )
}

export function badRequest(message: string, details?: unknown) {
  return json({ error: message, details }, 400)
}

export function unauthorized(message = 'Unauthorized') {
  return json({ error: message }, 401)
}

export function forbidden(message = 'Forbidden') {
  return json({ error: message }, 403)
}

export function notFound(message = 'Not found') {
  return json({ error: message }, 404)
}

export function conflict(message = 'Conflict') {
  return json({ error: message }, 409)
}

export function methodNotAllowed(method: string, allowed: string[]) {
  return json({ error: `Method ${method} not allowed`, allowed }, 405)
}

export function serverError(message = 'Server error', details?: unknown) {
  return json({ error: message, details }, 500)
}

export function assertMethod(req: Request, allowed: string[]) {
  if (!allowed.includes(req.method)) {
    return methodNotAllowed(req.method, allowed)
  }
  return null
}
