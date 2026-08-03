create or replace function public.current_profile_family(uid uuid default auth.uid())
returns text
language sql
stable
set search_path = public
as $$
  select p.family
  from public.profiles p
  where p.user_id = coalesce(uid, auth.uid())
    and p.active = true
    and p.role in ('admin', 'member')
  limit 1;
$$;

create table if not exists public.expense_settlements (
  id uuid primary key default gen_random_uuid(),
  from_family text not null check (
    from_family in ('Ekanger', 'Dzambo', 'Schambach', 'Montañez', 'Habibi', 'Donaldson')
  ),
  to_family text not null check (
    to_family in ('Ekanger', 'Dzambo', 'Schambach', 'Montañez', 'Habibi', 'Donaldson')
  ),
  amount_cents integer not null check (amount_cents > 0),
  confirmation_path text,
  settled boolean not null default false,
  settled_by uuid references public.profiles(user_id) on delete set null,
  settled_at timestamptz,
  created_by uuid default auth.uid() references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  constraint expense_settlements_distinct_families check (from_family <> to_family),
  constraint expense_settlements_confirmation_path_not_blank check (
    confirmation_path is null or length(btrim(confirmation_path)) > 0
  ),
  constraint expense_settlements_settled_metadata check (
    (settled = false and settled_by is null and settled_at is null)
    or (settled = true and settled_by is not null and settled_at is not null)
  )
);

create index if not exists idx_expense_settlements_pair_created
on public.expense_settlements (from_family, to_family, created_at desc);

create index if not exists idx_expense_settlements_created_by
on public.expense_settlements (created_by);

create index if not exists idx_expense_settlements_settled
on public.expense_settlements (settled, settled_at);

create or replace function public.enforce_expense_settlement_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor_family text;
begin
  actor_family := public.current_profile_family();

  if actor_family is null then
    raise exception 'Only active members can update settlements';
  end if;

  if new.id is distinct from old.id
    or new.from_family is distinct from old.from_family
    or new.to_family is distinct from old.to_family
    or new.amount_cents is distinct from old.amount_cents
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Settlement identity fields cannot be changed';
  end if;

  if actor_family = old.from_family then
    if new.settled is distinct from old.settled
      or new.settled_by is distinct from old.settled_by
      or new.settled_at is distinct from old.settled_at then
      raise exception 'Only the receiving family can mark a settlement settled';
    end if;

    return new;
  end if;

  if actor_family = old.to_family then
    if new.confirmation_path is distinct from old.confirmation_path then
      raise exception 'Only the paying family can update payment confirmation';
    end if;

    if new.settled then
      new.settled_by := auth.uid();
      new.settled_at := coalesce(new.settled_at, now());
    else
      new.settled_by := null;
      new.settled_at := null;
    end if;

    return new;
  end if;

  raise exception 'Only involved families can update settlements';
end;
$$;

drop trigger if exists trg_expense_settlements_enforce_update on public.expense_settlements;
create trigger trg_expense_settlements_enforce_update
before update on public.expense_settlements
for each row
execute function public.enforce_expense_settlement_update();

alter table public.expense_settlements enable row level security;

drop policy if exists expense_settlements_active_member_select on public.expense_settlements;
create policy expense_settlements_active_member_select
on public.expense_settlements
for select
using (public.is_active_member());

drop policy if exists expense_settlements_payer_insert on public.expense_settlements;
create policy expense_settlements_payer_insert
on public.expense_settlements
for insert
with check (
  public.is_active_member()
  and created_by = auth.uid()
  and from_family = public.current_profile_family()
);

drop policy if exists expense_settlements_involved_update on public.expense_settlements;
create policy expense_settlements_involved_update
on public.expense_settlements
for update
using (
  public.is_active_member()
  and public.current_profile_family() in (from_family, to_family)
)
with check (
  public.is_active_member()
  and public.current_profile_family() in (from_family, to_family)
);

drop policy if exists expense_settlements_creator_delete on public.expense_settlements;
create policy expense_settlements_creator_delete
on public.expense_settlements
for delete
using (
  public.is_active_member()
  and created_by = auth.uid()
);

grant execute on function public.current_profile_family(uuid) to anon, authenticated, service_role;
grant select, insert, update, delete on public.expense_settlements to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-confirmations',
  'expense-confirmations',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists expense_confirmations_active_member_select on storage.objects;
create policy expense_confirmations_active_member_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'expense-confirmations'
  and public.is_active_member()
);

drop policy if exists expense_confirmations_payer_insert on storage.objects;
create policy expense_confirmations_payer_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'expense-confirmations'
  and public.is_active_member()
  and (storage.foldername(name))[1] = public.current_profile_family()
);
