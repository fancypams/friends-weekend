create extension if not exists pgcrypto;

create or replace function public.normalize_email(value text)
returns text
language sql
immutable
as $$
  select lower(trim(value));
$$;

create table if not exists public.invite_allowlist (
  email text primary key,
  role text not null default 'member' check (role in ('admin', 'member')),
  active boolean not null default true,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  mime_type text not null,
  original_filename text not null,
  bytes bigint not null check (bytes > 0),
  status text not null default 'uploading' check (status in ('uploading', 'processing', 'published', 'failed', 'removed')),
  original_path text not null unique,
  processed_path text,
  thumbnail_path text,
  poster_path text,
  captured_at timestamptz,
  capture_source text,
  failure_reason text,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  processed_at timestamptz,
  published_at timestamptz,
  removed_at timestamptz
);

create table if not exists public.upload_quota_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  upload_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, window_start)
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_email on public.profiles ((public.normalize_email(email)));
create index if not exists idx_profiles_active_role on public.profiles (active, role);
create index if not exists idx_invite_allowlist_active_role on public.invite_allowlist (active, role);
create index if not exists idx_media_assets_owner_created on public.media_assets (owner_id, created_at desc);
create index if not exists idx_media_assets_status_published on public.media_assets (status, published_at desc);
create index if not exists idx_media_assets_status_created on public.media_assets (status, created_at asc);
create index if not exists idx_media_assets_captured_at on public.media_assets (captured_at);
create index if not exists idx_media_assets_removed on public.media_assets (removed_at);
create index if not exists idx_audit_log_created on public.audit_log (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_invite_allowlist_set_updated_at on public.invite_allowlist;
create trigger trg_invite_allowlist_set_updated_at
before update on public.invite_allowlist
for each row
execute function public.set_updated_at();

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists trg_upload_quota_usage_set_updated_at on public.upload_quota_usage;
create trigger trg_upload_quota_usage_set_updated_at
before update on public.upload_quota_usage
for each row
execute function public.set_updated_at();

create or replace function public.is_active_member(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = coalesce(uid, auth.uid())
      and p.active = true
      and p.role in ('admin', 'member')
  );
$$;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = coalesce(uid, auth.uid())
      and p.active = true
      and p.role = 'admin'
  );
$$;

create or replace function public.handle_user_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
  invited_role text;
  invited_active boolean;
begin
  normalized_email := public.normalize_email(new.email);

  select ia.role, ia.active
  into invited_role, invited_active
  from public.invite_allowlist ia
  where ia.email = normalized_email;

  insert into public.profiles (user_id, email, role, active)
  values (
    new.id,
    normalized_email,
    coalesce(invited_role, 'member'),
    coalesce(invited_active, false)
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    role = case
      when coalesce(invited_active, false) then coalesce(invited_role, public.profiles.role)
      else public.profiles.role
    end,
    active = coalesce(invited_active, false),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_auth_users_sync_profile on auth.users;
create trigger trg_auth_users_sync_profile
after insert or update of email on auth.users
for each row
execute function public.handle_user_sync();

create or replace function public.sync_profile_from_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.profiles
    set active = false,
        updated_at = now()
    where public.normalize_email(email) = old.email;
    return old;
  end if;

  new.email := public.normalize_email(new.email);

  update public.profiles
  set role = new.role,
      active = new.active,
      updated_at = now()
  where public.normalize_email(email) = new.email;

  return new;
end;
$$;

drop trigger if exists trg_invite_sync_profile on public.invite_allowlist;
create trigger trg_invite_sync_profile
before insert or update or delete on public.invite_allowlist
for each row
execute function public.sync_profile_from_invite();

create or replace function public.consume_upload_quota(
  p_user_id uuid,
  p_limit integer default 40
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window timestamptz;
  next_count integer;
begin
  current_window := date_trunc('hour', now());

  insert into public.upload_quota_usage (user_id, window_start, upload_count)
  values (p_user_id, current_window, 1)
  on conflict (user_id, window_start)
  do update set upload_count = public.upload_quota_usage.upload_count + 1,
                updated_at = now()
  returning upload_count into next_count;

  return next_count <= p_limit;
end;
$$;

alter table public.invite_allowlist enable row level security;
alter table public.profiles enable row level security;
alter table public.media_assets enable row level security;
alter table public.upload_quota_usage enable row level security;
alter table public.audit_log enable row level security;

-- Invite list: admins only.
drop policy if exists invite_admin_select on public.invite_allowlist;
create policy invite_admin_select
on public.invite_allowlist
for select
using (public.is_admin());

drop policy if exists invite_admin_insert on public.invite_allowlist;
create policy invite_admin_insert
on public.invite_allowlist
for insert
with check (public.is_admin());

drop policy if exists invite_admin_update on public.invite_allowlist;
create policy invite_admin_update
on public.invite_allowlist
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists invite_admin_delete on public.invite_allowlist;
create policy invite_admin_delete
on public.invite_allowlist
for delete
using (public.is_admin());

-- Profiles: user can read own profile, admins can read all.
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select
on public.profiles
for select
using (auth.uid() = user_id or public.is_admin());

-- Media assets: member read published + own, and insert own uploads.
drop policy if exists media_select_scope on public.media_assets;
create policy media_select_scope
on public.media_assets
for select
using (
  public.is_active_member()
  and (
    status = 'published'
    or owner_id = auth.uid()
    or public.is_admin()
  )
);

drop policy if exists media_insert_own on public.media_assets;
create policy media_insert_own
on public.media_assets
for insert
with check (
  public.is_active_member()
  and owner_id = auth.uid()
);

drop policy if exists media_update_own_admin on public.media_assets;
create policy media_update_own_admin
on public.media_assets
for update
using (
  public.is_active_member()
  and (owner_id = auth.uid() or public.is_admin())
)
with check (
  public.is_active_member()
  and (owner_id = auth.uid() or public.is_admin())
);

-- Upload quota + audit visibility: admins only.
drop policy if exists upload_quota_admin_select on public.upload_quota_usage;
create policy upload_quota_admin_select
on public.upload_quota_usage
for select
using (public.is_admin());

drop policy if exists audit_admin_select on public.audit_log;
create policy audit_admin_select
on public.audit_log
for select
using (public.is_admin());

grant execute on function public.is_active_member(uuid) to anon, authenticated, service_role;
grant execute on function public.is_admin(uuid) to anon, authenticated, service_role;
grant execute on function public.consume_upload_quota(uuid, integer) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shared-media',
  'shared-media',
  false,
  262144000,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
