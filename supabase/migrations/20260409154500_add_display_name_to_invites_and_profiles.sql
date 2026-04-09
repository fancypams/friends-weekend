alter table public.invite_allowlist
  add column if not exists display_name text;

alter table public.profiles
  add column if not exists display_name text;

update public.invite_allowlist
set display_name = nullif(btrim(display_name), '')
where display_name is not null;

update public.profiles
set display_name = nullif(btrim(display_name), '')
where display_name is not null;

update public.profiles p
set display_name = ia.display_name
from public.invite_allowlist ia
where public.normalize_email(p.email) = ia.email
  and p.display_name is distinct from ia.display_name;

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
  invited_display_name text;
begin
  normalized_email := public.normalize_email(new.email);

  select
    ia.role,
    ia.active,
    nullif(btrim(ia.display_name), '')
  into invited_role, invited_active, invited_display_name
  from public.invite_allowlist ia
  where ia.email = normalized_email;

  insert into public.profiles (user_id, email, role, active, display_name)
  values (
    new.id,
    normalized_email,
    coalesce(invited_role, 'member'),
    coalesce(invited_active, false),
    invited_display_name
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    role = case
      when coalesce(invited_active, false) then coalesce(invited_role, public.profiles.role)
      else public.profiles.role
    end,
    active = coalesce(invited_active, false),
    display_name = coalesce(invited_display_name, public.profiles.display_name),
    updated_at = now();

  return new;
end;
$$;

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
  new.display_name := nullif(btrim(new.display_name), '');

  update public.profiles
  set role = new.role,
      active = new.active,
      display_name = coalesce(new.display_name, public.profiles.display_name),
      updated_at = now()
  where public.normalize_email(email) = new.email;

  return new;
end;
$$;
