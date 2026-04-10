create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  email text not null,
  last_seen_at timestamptz not null default now(),
  last_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_presence_last_seen
  on public.user_presence (last_seen_at desc);

create index if not exists idx_user_presence_email
  on public.user_presence ((public.normalize_email(email)));

drop trigger if exists trg_user_presence_set_updated_at on public.user_presence;
create trigger trg_user_presence_set_updated_at
before update on public.user_presence
for each row
execute function public.set_updated_at();

alter table public.user_presence enable row level security;

drop policy if exists user_presence_admin_select on public.user_presence;
create policy user_presence_admin_select
on public.user_presence
for select
using (public.is_admin());
