create table public.media_archive_jobs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  status text not null default 'queued'
    check (status in ('queued', 'building', 'uploading', 'signing', 'emailing', 'sent', 'failed')),
  item_count integer not null check (item_count > 0),
  processed_items integer not null default 0
    check (processed_items >= 0 and processed_items <= item_count),
  total_bytes bigint not null check (total_bytes >= 0),
  processed_bytes bigint not null default 0 check (processed_bytes >= 0),
  archive_path text not null,
  archive_version text not null check (length(archive_version) = 64),
  reused boolean,
  provider_message_id text,
  error_message text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  uploaded_at timestamptz,
  signed_at timestamptz,
  emailed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.media_archive_jobs is
  'Service-role-only progress and delivery history for personalized media archives.';
comment on column public.media_archive_jobs.processed_bytes is
  'Source media bytes streamed into the ZIP; excludes ZIP headers and directory bytes.';

create index idx_media_archive_jobs_user_requested
  on public.media_archive_jobs (user_id, requested_at desc);
create index idx_media_archive_jobs_status_requested
  on public.media_archive_jobs (status, requested_at desc);

create trigger trg_media_archive_jobs_set_updated_at
before update on public.media_archive_jobs
for each row
execute function public.set_updated_at();

alter table public.media_archive_jobs enable row level security;

-- Archive jobs include recipient and storage details. App clients do not need
-- direct access; the service-role Edge Function owns all inserts and updates.
revoke all on table public.media_archive_jobs from anon, authenticated;
grant select, insert, update on table public.media_archive_jobs to service_role;
