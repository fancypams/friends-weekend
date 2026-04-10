create table if not exists public.magic_link_attempts (
  id bigint generated always as identity primary key,
  attempt_id uuid not null default gen_random_uuid() unique,
  email text not null,
  status text not null check (status in ('success', 'failed')),
  failure_stage text,
  error_message text,
  error_code text,
  http_status integer,
  redirect_to text,
  source text,
  user_agent text,
  request_ip text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_magic_link_attempts_created
  on public.magic_link_attempts (created_at desc);

create index if not exists idx_magic_link_attempts_email_created
  on public.magic_link_attempts ((public.normalize_email(email)), created_at desc);

create index if not exists idx_magic_link_attempts_status_created
  on public.magic_link_attempts (status, created_at desc);

alter table public.magic_link_attempts enable row level security;

drop policy if exists magic_link_attempts_admin_select on public.magic_link_attempts;
create policy magic_link_attempts_admin_select
on public.magic_link_attempts
for select
using (public.is_admin());
