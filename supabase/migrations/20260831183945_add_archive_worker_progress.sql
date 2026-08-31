alter table public.media_archive_jobs
  add column worker_stage text
    check (worker_stage in ('queued', 'downloading', 'zipping', 'uploading', 'signing', 'emailing', 'complete', 'failed')),
  add column worker_run_id text,
  add column heartbeat_at timestamptz,
  add column archive_bytes bigint check (archive_bytes >= 0),
  add column uploaded_bytes bigint not null default 0 check (uploaded_bytes >= 0),
  add column attempt_count integer not null default 0 check (attempt_count >= 0);

comment on column public.media_archive_jobs.worker_stage is
  'Detailed durable-worker phase shown alongside the public job status.';
comment on column public.media_archive_jobs.heartbeat_at is
  'Most recent worker heartbeat; stale nonterminal jobs can be diagnosed from this timestamp.';
comment on column public.media_archive_jobs.uploaded_bytes is
  'Bytes uploaded to the archive bucket through the resumable TUS upload.';
