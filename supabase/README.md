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
- `RESEND_API_KEY`
- `RESEND_FROM`
- `GITHUB_ARCHIVE_TOKEN`
- `GITHUB_ARCHIVE_REPOSITORY`

`download-media-archive` uses the Resend secrets to email each requester a
confirmation when the job starts, then dispatches the durable GitHub Actions
worker in `.github/workflows/media-archive-worker.yml`. The worker builds the
ZIP outside the Edge Function runtime, uploads it resumably into the private
`media-archives` bucket, and emails a seven-day signed link. The ZIP includes
published originals from other guests and intentionally excludes the
requester's own uploads.

`GITHUB_ARCHIVE_TOKEN` must be a fine-grained token scoped only to the archive
worker repository with **Contents: write**, which GitHub requires for repository
dispatch events. Set `GITHUB_ARCHIVE_REPOSITORY` to `owner/repository`.

Configure these GitHub Actions repository secrets for the worker:

- `ARCHIVE_SUPABASE_URL`
- `ARCHIVE_SUPABASE_SERVICE_ROLE_KEY`
- `ARCHIVE_RESEND_API_KEY`
- `ARCHIVE_RESEND_FROM`

Keep the service-role and Resend credentials scoped to this private repository.
The workflow never stores the finished ZIP as a GitHub artifact; its temporary
runner files are deleted when the job ends.

### Monitor archive jobs

Each request creates a service-role-only row in `media_archive_jobs`. In the
Supabase Dashboard, open **Table Editor → media_archive_jobs**, or run:

```sql
select
  id,
  recipient_email,
  status,
  worker_stage,
  processed_items,
  item_count,
  case
    when total_bytes = 0 then 0
    else round(least(100, processed_bytes * 100.0 / total_bytes), 1)
  end as progress_percent,
  uploaded_bytes,
  archive_bytes,
  case
    when coalesce(archive_bytes, 0) = 0 then 0
    else round(least(100, uploaded_bytes * 100.0 / archive_bytes), 1)
  end as upload_percent,
  reused,
  worker_run_id,
  attempt_count,
  provider_message_id,
  error_message,
  requested_at,
  started_at,
  uploaded_at,
  signed_at,
  emailed_at,
  heartbeat_at,
  updated_at,
  completed_at
from public.media_archive_jobs
order by requested_at desc;
```

Jobs move through `queued`, `building`, `uploading`, `signing`, `emailing`, and
then `sent` or `failed`. `worker_stage` distinguishes downloading from zipping.
During downloading, the processed item and byte counters update after each
source file; during uploading, `uploaded_bytes` advances against
`archive_bytes`. `heartbeat_at` updates every 15 seconds even when a large file
or ZIP step leaves the item count unchanged. A reused archive skips building and
uploading and records `reused = true`. Confirmation delivery is recorded in
`audit_log` as `media_archive.confirmation_sent` or
`media_archive.confirmation_failed`; a confirmation failure does not cancel the
archive job.

To retry a nonterminal or failed request manually:

```bash
gh workflow run media-archive-worker.yml -f request_id=REQUEST_UUID
```

## 4) Deploy Functions

Deploy these functions:

- `create-upload-ticket`
- `complete-upload`
- `gallery-feed`
- `my-uploads`
- `sign-media-url`
- `download-media-archive`
- `upload-window`
- `invites`
- `invite-and-send`
- `media`
- `process-media`
- `flight-entry-context`
- `migrate-flight-travelers`

For this project, auth is enforced inside each function via `requireAuth()` in `functions/_shared/auth.ts`.
Deploy user-facing functions with gateway JWT verification disabled:

```bash
supabase functions deploy create-upload-ticket --no-verify-jwt
supabase functions deploy complete-upload --no-verify-jwt
supabase functions deploy gallery-feed --no-verify-jwt
supabase functions deploy my-uploads --no-verify-jwt
supabase functions deploy sign-media-url --no-verify-jwt
supabase functions deploy download-media-archive --no-verify-jwt
supabase functions deploy upload-window --no-verify-jwt
supabase functions deploy invites --no-verify-jwt
supabase functions deploy invite-and-send --no-verify-jwt
supabase functions deploy media --no-verify-jwt
supabase functions deploy process-media
supabase functions deploy flight-entry-context --no-verify-jwt
supabase functions deploy migrate-flight-travelers --no-verify-jwt
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

Current processing pipeline publishes secure derivatives:
- JPEG/PNG/WEBP uploads are copied into `processed/` and `thumbs/`
- HEIC/HEIF uploads keep the original file and upload browser-converted JPEG derivatives into `processed/` and `thumbs/`
- media is published only after processing step succeeds
- capture-window policy:
  - `admin` uploads are exempt
  - missing capture metadata is allowed
  - non-admin uploads are rejected only when capture metadata is present and outside Jul 30-Aug 9, 2026 (Seattle time)

If you need MP4 transcoding, EXIF stripping, or resized image thumbnails, plug those transformations into `functions/_shared/media-processor.ts` or move processing to a dedicated worker service.

## Upload Limits

Set optional function secrets to control max upload sizes without code changes:

- `IMAGE_MAX_BYTES` (default `26214400`, 25 MB)
- `VIDEO_MAX_BYTES` (default `262144000`, 250 MB)

For Supabase Free plan, set `VIDEO_MAX_BYTES=52428800` (50 MB max file size).
