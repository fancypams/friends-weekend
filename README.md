# Friends Weekend

Vue 3 + Vite app with an invite-only Supabase auth flow and a private shared media gallery.

## Stack
- Vue 3
- Vue Router (hash history)
- Vite
- Supabase (Auth, Storage, Edge Functions)
- Leaflet

## Prerequisites
- Node `22.12.0` (see `.nvmrc`)
- npm `10.9.x`

## Local Development
```bash
nvm use
npm install
npm run dev
```

Default dev URL: `http://localhost:5173`

## Build
```bash
npm run build
npm run preview
```

## Routes
- `#/` Home
- `#/basics`
- `#/itinerary`
- `#/photos` (auth required)
- `#/login`

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
- Callback URL cleanup removes auth params like `code` and `error_*` after navigation

## Local Auth Modes
1. Full auth locally (default): keep `VITE_BYPASS_AUTH=false`
2. Bypass auth locally:
```bash
VITE_BYPASS_AUTH=true
```
3. Force localhost callback for magic links:
```bash
VITE_MAGIC_LINK_REDIRECT_ORIGIN=http://localhost:5173
```
or
```bash
VITE_MAGIC_LINK_REDIRECT_URL=http://localhost:5173/#/login
```

`VITE_MAGIC_LINK_REDIRECT_URL` takes precedence over `VITE_MAGIC_LINK_REDIRECT_ORIGIN`.

## Supabase Setup (Summary)
1. Enable Email auth (Magic Link).
2. Apply migration in `supabase/migrations/`.
3. Deploy Edge Functions in `supabase/functions/`.
4. Configure function secrets:
```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
PROCESSOR_SECRET=<secret>
IMAGE_MAX_BYTES=26214400
VIDEO_MAX_BYTES=52428800
```
5. Configure Auth URL settings:
- Site URL: your prod app URL
- Redirect URLs: include both prod and localhost login callbacks as needed

## Session And Rate Policy
Configured in `supabase/config.toml` (local CLI reference):
- JWT expiry: `3600` seconds
- Session timebox: `336h`
- Session inactivity timeout: `168h`
- Auth rate limits for email/sign-in/token verification

For hosted Supabase projects, set equivalent values in Dashboard Auth settings.

## Project Structure
- `src/pages` page views
- `src/components` reusable UI
- `src/lib` Supabase/auth/media API helpers
- `src/router/index.js` route guards and URL cleanup
- `supabase/` SQL, function code, backend docs

## Troubleshooting
- Wrong Node version errors:
```bash
nvm use
node -v
npm -v
```
- Magic links redirecting to wrong host:
  - Check Supabase `Authentication -> URL Configuration`
  - Check local redirect override env vars
- Frequent email send blocks:
  - Check Supabase Auth rate limits
  - Use custom SMTP for higher limits and better deliverability

## More Repo Rules
See [AGENTS.md](./AGENTS.md) for coding workflow and quality gates.
