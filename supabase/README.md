# Supabase Secure Photos Backend

This folder contains the database migration and edge functions for the secure shared photo/video flow.

## 1) Apply Migration

Run the SQL in `migrations/20260406130000_secure_shared_media.sql` (or use Supabase CLI migration tooling).

This creates:
- `invite_allowlist`
- `profiles`
- `media_assets`
- `upload_quota_usage`
- `audit_log`
- private `shared-media` storage bucket
- RLS policies and auth/profile sync triggers

## 2) Seed Initial Admin Invite

Before first sign-in, seed at least one admin email:

```sql
insert into public.invite_allowlist (email, role, active)
values ('your-admin@email.com', 'admin', true)
on conflict (email) do update
set role = excluded.role,
    active = excluded.active;
```

## 3) Configure Function Secrets

Set these environment variables for edge functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PROCESSOR_SECRET`

## 4) Deploy Functions

Deploy these functions:

- `create-upload-ticket`
- `complete-upload`
- `gallery-feed`
- `my-uploads`
- `sign-media-url`
- `invites`
- `invite-and-send`
- `media`
- `process-media`

For this project, auth is enforced inside each function via `requireAuth()` in `functions/_shared/auth.ts`.
Deploy user-facing functions with gateway JWT verification disabled:

```bash
supabase functions deploy create-upload-ticket --no-verify-jwt
supabase functions deploy complete-upload --no-verify-jwt
supabase functions deploy gallery-feed --no-verify-jwt
supabase functions deploy my-uploads --no-verify-jwt
supabase functions deploy sign-media-url --no-verify-jwt
supabase functions deploy invites --no-verify-jwt
supabase functions deploy invite-and-send --no-verify-jwt
supabase functions deploy media --no-verify-jwt
supabase functions deploy process-media
```

Why: some projects can hit Edge gateway `Invalid JWT` despite valid Auth-issued access tokens.
Keeping verification in `requireAuth()` avoids that gateway mismatch while preserving access control.

## 5) Session Lifetime Policy

Set and document explicit auth session limits so login behavior is predictable:

- JWT expiry: `3600` seconds (1 hour)
- Session max lifetime (timebox): `336h` (14 days)
- Session inactivity timeout: `168h` (7 days)

For local Supabase CLI, these values are configured in `supabase/config.toml` under:

- `[auth] jwt_expiry`
- `[auth.sessions] timebox`
- `[auth.sessions] inactivity_timeout`

For hosted Supabase projects, set equivalent values in **Auth settings** in the Supabase Dashboard.

## 6) Auth Rate Limits (Backend)

Set server-side rate limits for login flows to complement client cooldowns:

- `auth.rate_limit.email_sent = 4` (magic-link emails per hour per IP)
- `auth.rate_limit.sign_in_sign_ups = 8` (sign-in attempts per 5 minutes per IP)
- `auth.rate_limit.token_verifications = 10` (magic-link/OTP verifications per 5 minutes per IP)

For local Supabase CLI, these values are in `supabase/config.toml`.
For hosted Supabase projects, set the equivalent values in **Auth settings** in the Dashboard.

## Processing Behavior

Current processing pipeline is **copy-through** for secure publishing:
- uploaded objects are copied into `processed/` and `thumbs/`
- media is published only after processing step succeeds
- capture-window policy:
  - `admin` uploads are exempt
  - non-admin uploads are rejected unless capture metadata falls within Jul 31-Aug 4, 2026 (Seattle time)

If you need true HEIC to JPEG conversion, MP4 transcoding, or EXIF stripping, plug those transformations into `functions/_shared/media-processor.ts` or move processing to a dedicated worker service.

## Upload Limits

Set optional function secrets to control max upload sizes without code changes:

- `IMAGE_MAX_BYTES` (default `26214400`, 25 MB)
- `VIDEO_MAX_BYTES` (default `262144000`, 250 MB)

For Supabase Free plan, set `VIDEO_MAX_BYTES=52428800` (50 MB max file size).
