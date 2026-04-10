create table if not exists public.resend_email_events (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  svix_id text not null unique,
  svix_timestamp text,
  event_type text not null,
  email_id text,
  to_email text,
  from_email text,
  subject text,
  occurred_at timestamptz,
  bounce_type text,
  bounce_subtype text,
  bounce_message text,
  complaint_feedback_type text,
  raw_event jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_resend_email_events_created
  on public.resend_email_events (created_at desc);

create index if not exists idx_resend_email_events_email_id_created
  on public.resend_email_events (email_id, created_at desc);

create index if not exists idx_resend_email_events_type_created
  on public.resend_email_events (event_type, created_at desc);

alter table public.resend_email_events enable row level security;

drop policy if exists resend_email_events_admin_select on public.resend_email_events;
create policy resend_email_events_admin_select
on public.resend_email_events
for select
using (public.is_admin());
