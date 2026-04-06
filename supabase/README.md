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
- `media`
- `process-media`

## Processing Behavior

Current processing pipeline is **copy-through** for secure publishing:
- uploaded objects are copied into `processed/` and `thumbs/`
- media is published only after processing step succeeds
- uploads are rejected unless capture metadata falls within Jul 31-Aug 4, 2026 (Seattle time)

If you need true HEIC to JPEG conversion, MP4 transcoding, or EXIF stripping, plug those transformations into `functions/_shared/media-processor.ts` or move processing to a dedicated worker service.

## Upload Limits

Set optional function secrets to control max upload sizes without code changes:

- `IMAGE_MAX_BYTES` (default `26214400`, 25 MB)
- `VIDEO_MAX_BYTES` (default `262144000`, 250 MB)

For Supabase Free plan, set `VIDEO_MAX_BYTES=52428800` (50 MB max file size).
