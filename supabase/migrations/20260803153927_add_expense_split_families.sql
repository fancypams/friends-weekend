alter table public.expenses
  add column if not exists split_families text[] not null
  default array['Ekanger', 'Dzambo', 'Schambach', 'Montañez', 'Habibi', 'Donaldson']::text[];

alter table public.expenses
  add constraint expenses_split_families_not_empty
  check (cardinality(split_families) > 0) not valid;

alter table public.expenses
  add constraint expenses_split_families_valid
  check (
    split_families <@ array['Ekanger', 'Dzambo', 'Schambach', 'Montañez', 'Habibi', 'Donaldson']::text[]
  ) not valid;

alter table public.expenses
  add constraint expenses_paid_by_in_split_families
  check (paid_by_family = any(split_families)) not valid;

alter table public.expenses
  validate constraint expenses_split_families_not_empty;

alter table public.expenses
  validate constraint expenses_split_families_valid;

alter table public.expenses
  validate constraint expenses_paid_by_in_split_families;
