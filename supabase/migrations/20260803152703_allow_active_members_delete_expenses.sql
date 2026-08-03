drop policy if exists expenses_creator_delete on public.expenses;
drop policy if exists expenses_active_member_delete on public.expenses;

create policy expenses_active_member_delete
on public.expenses
for delete
using (public.is_active_member());
