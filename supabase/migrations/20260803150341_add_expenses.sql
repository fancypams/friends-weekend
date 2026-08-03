create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  description text not null,
  amount_cents integer not null check (amount_cents > 0),
  paid_by_family text not null check (
    paid_by_family in ('Ekanger', 'Dzambo', 'Schambach', 'Montañez', 'Habibi', 'Donaldson')
  ),
  created_by uuid default auth.uid() references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_expenses_expense_date_created_at
on public.expenses (expense_date desc, created_at desc);

create index if not exists idx_expenses_paid_by_family
on public.expenses (paid_by_family);

create index if not exists idx_expenses_created_by
on public.expenses (created_by);

alter table public.expenses enable row level security;

drop policy if exists expenses_active_member_select on public.expenses;
create policy expenses_active_member_select
on public.expenses
for select
using (public.is_active_member());

drop policy if exists expenses_active_member_insert on public.expenses;
create policy expenses_active_member_insert
on public.expenses
for insert
with check (
  public.is_active_member()
  and created_by = auth.uid()
);

drop policy if exists expenses_creator_delete on public.expenses;
create policy expenses_creator_delete
on public.expenses
for delete
using (
  public.is_active_member()
  and created_by = auth.uid()
);

grant select, insert, delete on public.expenses to authenticated;
