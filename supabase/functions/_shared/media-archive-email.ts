function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function archiveRecipientName(displayName: string | null, email: string) {
  const display = String(displayName || '').trim()
  if (display) return display.split(/\s+/)[0] || display
  const token = (email.split('@')[0] || '').split(/[._-]+/)[0] || ''
  return token ? `${token.charAt(0).toUpperCase()}${token.slice(1)}` : 'friend'
}

function buildHtml(name: string, downloadUrl: string, itemCount: number) {
  const safeName = escapeHtml(name)
  const safeUrl = escapeHtml(downloadUrl)
  const fileLabel = `${itemCount} file${itemCount === 1 ? '' : 's'}`
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f7f8;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f7f8;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e4e8eb;">
<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;color:#1f2d22;">
<p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6a8a97;font-weight:700;">Friends Weekend</p>
<h1 style="margin:0 0 14px;font-size:30px;line-height:1.2;">Your trip archive is ready</h1>
<p style="margin:0 0 16px;font-size:17px;line-height:1.7;">Hey ${safeName},</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#5e625e;">Your ZIP contains ${fileLabel} shared by everyone else. Your own originals are left out, since you already have those.</p>
</td></tr><tr><td style="padding:4px 28px 12px;">
<a href="${safeUrl}" style="display:inline-block;background:#243123;color:#fff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;line-height:1;padding:14px 22px;border-radius:999px;">Download ZIP</a>
</td></tr><tr><td style="padding:8px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
<p style="margin:0;font-size:13px;line-height:1.6;color:#7a807a;">This private link expires in 7 days. If it expires, request a fresh one from the gallery.</p>
</td></tr></table></td></tr></table></body></html>`
}

function buildText(name: string, downloadUrl: string, itemCount: number) {
  return [
    `Hey ${name},`, '',
    `Your Friends Weekend ZIP is ready with ${itemCount} file${itemCount === 1 ? '' : 's'} shared by everyone else. Your own originals are left out, since you already have those.`,
    '', `Download ZIP: ${downloadUrl}`, '',
    'This private link expires in 7 days. If it expires, request a fresh one from the gallery.',
  ].join('\n')
}

export async function sendArchiveEmail(params: {
  apiKey: string
  from: string
  to: string
  name: string
  downloadUrl: string
  itemCount: number
  requestId: string
}) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `media-archive/${params.requestId}`,
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: 'Your Friends Weekend photos are ready',
      html: buildHtml(params.name, params.downloadUrl, params.itemCount),
      text: buildText(params.name, params.downloadUrl, params.itemCount),
    }),
  })

  const raw = await response.text()
  let body: Record<string, unknown> = {}
  try {
    body = raw ? JSON.parse(raw) : {}
  } catch {
    body = { raw }
  }
  if (!response.ok) {
    throw new Error(`Resend API error: ${String(body?.message || body?.error || response.status)}`)
  }
  return String(body?.id || '')
}
