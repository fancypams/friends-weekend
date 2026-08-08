drop policy if exists expense_settlements_payer_insert on public.expense_settlements;
drop policy if exists expense_settlements_involved_insert on public.expense_settlements;

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
      raise exception 'Only the receiving family can confirm payment receipt';
    end if;

    return new;
  end if;

  if actor_family = old.to_family then
    if new.confirmation_path is distinct from old.confirmation_path then
      raise exception 'Only the paying family can update payment confirmation';
    end if;

    if old.settled and not new.settled then
      raise exception 'Received payments cannot be unconfirmed';
    end if;

    if new.settled then
      new.settled_by := coalesce(old.settled_by, auth.uid());
      new.settled_at := coalesce(old.settled_at, now());
    end if;

    return new;
  end if;

  raise exception 'Only involved families can update settlements';
end;
$$;

create or replace function public.enforce_expense_settlement_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor_family text;
begin
  actor_family := public.current_profile_family();

  if actor_family is null then
    raise exception 'Only active members can record settlements';
  end if;

  if actor_family not in (new.from_family, new.to_family) then
    raise exception 'Only involved families can record settlements';
  end if;

  if new.created_by is distinct from auth.uid() then
    raise exception 'Settlement recorder must match the current user';
  end if;

  if actor_family = new.from_family then
    if new.settled
      or new.settled_by is not null
      or new.settled_at is not null then
      raise exception 'Only the receiving family can confirm payment receipt';
    end if;

    return new;
  end if;

  if new.settled then
    new.settled_by := auth.uid();
    new.settled_at := coalesce(new.settled_at, now());
  elsif new.settled_by is not null or new.settled_at is not null then
    raise exception 'Receipt metadata requires a received payment';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_expense_settlements_enforce_insert on public.expense_settlements;
create trigger trg_expense_settlements_enforce_insert
before insert on public.expense_settlements
for each row
execute function public.enforce_expense_settlement_insert();

create policy expense_settlements_involved_insert
on public.expense_settlements
for insert
with check (
  public.is_active_member()
  and created_by = auth.uid()
  and public.current_profile_family() in (from_family, to_family)
);
