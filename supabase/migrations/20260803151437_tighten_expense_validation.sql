alter table public.expenses
  add constraint expenses_description_not_blank
  check (length(btrim(description)) > 0) not valid;

alter table public.expenses
  add constraint expenses_description_length
  check (char_length(description) <= 120) not valid;

alter table public.expenses
  add constraint expenses_amount_cents_max
  check (amount_cents <= 9999999) not valid;

alter table public.expenses
  validate constraint expenses_description_not_blank;

alter table public.expenses
  validate constraint expenses_description_length;

alter table public.expenses
  validate constraint expenses_amount_cents_max;
