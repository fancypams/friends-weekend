create table if not exists public.funnel_events (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  journey text not null,
  step text not null,
  status text not null,
  request_id text,
  user_id uuid references auth.users(id) on delete set null,
  email_hash text,
  invite_email_hash text,
  error_code text,
  error_message text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_funnel_events_journey_step_created
  on public.funnel_events (journey, step, created_at desc);

create index if not exists idx_funnel_events_request_id
  on public.funnel_events (request_id);

create index if not exists idx_funnel_events_email_hash_created
  on public.funnel_events (email_hash, created_at desc);

create index if not exists idx_funnel_events_created
  on public.funnel_events (created_at desc);

alter table public.funnel_events enable row level security;

drop policy if exists funnel_events_admin_select on public.funnel_events;
create policy funnel_events_admin_select
on public.funnel_events
for select
using (public.is_admin());

create or replace function public.funnel_summary(window_minutes integer default 1440)
returns table (
  magic_link_requested_success bigint,
  magic_link_requested_failed bigint,
  magic_link_requested_rate_limited bigint,
  magic_link_clicked_observed bigint,
  callback_session_exchange_success bigint,
  callback_session_exchange_failed bigint,
  callback_session_exchange_expired bigint,
  callback_session_exchange_invalid bigint,
  post_login_redirect_success bigint,
  post_login_redirect_failed bigint,
  invite_sent_success bigint,
  invite_sent_failed bigint
)
language sql
security definer
set search_path = public
as $$
  with scoped as (
    select *
    from public.funnel_events
    where created_at >= now() - make_interval(mins => greatest(coalesce(window_minutes, 1440), 1))
      and journey = 'invite_auth'
  )
  select
    count(*) filter (where step = 'magic_link_requested' and status = 'success') as magic_link_requested_success,
    count(*) filter (where step = 'magic_link_requested' and status = 'failed') as magic_link_requested_failed,
    count(*) filter (where step = 'magic_link_requested' and status = 'rate_limited') as magic_link_requested_rate_limited,
    count(*) filter (where step = 'magic_link_clicked' and status = 'observed') as magic_link_clicked_observed,
    count(*) filter (where step = 'callback_session_exchange' and status = 'success') as callback_session_exchange_success,
    count(*) filter (where step = 'callback_session_exchange' and status = 'failed') as callback_session_exchange_failed,
    count(*) filter (where step = 'callback_session_exchange' and status = 'expired') as callback_session_exchange_expired,
    count(*) filter (where step = 'callback_session_exchange' and status = 'invalid') as callback_session_exchange_invalid,
    count(*) filter (where step = 'post_login_redirect' and status = 'success') as post_login_redirect_success,
    count(*) filter (where step = 'post_login_redirect' and status = 'failed') as post_login_redirect_failed,
    count(*) filter (where step = 'invite_sent' and status = 'success') as invite_sent_success,
    count(*) filter (where step = 'invite_sent' and status = 'failed') as invite_sent_failed
  from scoped;
$$;

grant execute on function public.funnel_summary(integer) to authenticated, service_role;
