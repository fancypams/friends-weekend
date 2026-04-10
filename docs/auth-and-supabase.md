# Auth + Supabase Setup

## Environment
Create `.env.local`:

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_BYPASS_AUTH=false

# Optional local magic-link callback overrides
VITE_MAGIC_LINK_REDIRECT_ORIGIN=
VITE_MAGIC_LINK_REDIRECT_URL=
```

## Auth Behavior
- Invite-only magic link sign-in (`shouldCreateUser=false`)
- Route-level protection for private routes
- Local-only bypass support
- Callback URL cleanup removes auth params after navigation

## Local Auth Modes
1. Full auth locally (default): `VITE_BYPASS_AUTH=false`
2. Bypass auth locally:
```bash
VITE_BYPASS_AUTH=true
```
3. Force localhost callback:
```bash
VITE_MAGIC_LINK_REDIRECT_ORIGIN=http://localhost:5173
```
or
```bash
VITE_MAGIC_LINK_REDIRECT_URL=http://localhost:5173/#/login
```

`VITE_MAGIC_LINK_REDIRECT_URL` takes precedence over `VITE_MAGIC_LINK_REDIRECT_ORIGIN`.

## Supabase Setup
1. Enable Email auth (Magic Link).
2. Apply migrations from `supabase/migrations/`.
3. Deploy edge functions from `supabase/functions/`.
4. Configure required function secrets:
```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
PROCESSOR_SECRET=<secret>
IMAGE_MAX_BYTES=26214400
VIDEO_MAX_BYTES=52428800
```
5. Configure Auth URL settings:
- Site URL: production app URL
- Redirect URLs: include production and localhost callbacks

## Session + Rate Policy
Configured in `supabase/config.toml` for local CLI:
- JWT expiry: `3600` seconds
- Session timebox: `336h`
- Session inactivity timeout: `168h`
- Auth rate limits for email/sign-in/token verification

For hosted Supabase, set equivalent values in Dashboard Auth settings.

## Common Issues
Magic links redirect to wrong host:
- Check Supabase `Authentication -> URL Configuration`
- Check local redirect override vars

Frequent email send blocks:
- Check Supabase Auth rate limits
- Use custom SMTP for higher limits/deliverability
