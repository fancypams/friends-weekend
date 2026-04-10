create table if not exists public.invite_delivery_attempts (
  id bigint generated always as identity primary key,
  attempt_id uuid not null default gen_random_uuid() unique,
  invited_by uuid references auth.users(id) on delete set null,
  email text not null,
  display_name text,
  family text,
  role text not null default 'member' check (role in ('admin', 'member')),
  active boolean not null default true,
  provider text not null default 'resend',
  status text not null check (status in ('success', 'failed')),
  failure_stage text,
  provider_message_id text,
  error_message text,
  error_code text,
  http_status integer,
  redirect_to text,
  host_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_invite_delivery_attempts_created
  on public.invite_delivery_attempts (created_at desc);

create index if not exists idx_invite_delivery_attempts_email_created
  on public.invite_delivery_attempts ((public.normalize_email(email)), created_at desc);

create index if not exists idx_invite_delivery_attempts_status_created
  on public.invite_delivery_attempts (status, created_at desc);

alter table public.invite_delivery_attempts enable row level security;

drop policy if exists invite_delivery_attempts_admin_select on public.invite_delivery_attempts;
create policy invite_delivery_attempts_admin_select
on public.invite_delivery_attempts
for select
using (public.is_admin());
