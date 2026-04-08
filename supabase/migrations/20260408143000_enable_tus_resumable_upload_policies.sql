-- Allow authenticated active members to upload directly to Storage via TUS
-- for only the object paths that belong to their own pending media asset rows.

drop policy if exists shared_media_tus_insert on storage.objects;
create policy shared_media_tus_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'shared-media'
  and public.is_active_member()
  and exists (
    select 1
    from public.media_assets m
    where m.original_path = name
      and m.owner_id = auth.uid()
      and m.status = 'uploading'
  )
);

drop policy if exists shared_media_tus_update on storage.objects;
create policy shared_media_tus_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'shared-media'
  and public.is_active_member()
  and exists (
    select 1
    from public.media_assets m
    where m.original_path = name
      and m.owner_id = auth.uid()
  )
)
with check (
  bucket_id = 'shared-media'
  and public.is_active_member()
  and exists (
    select 1
    from public.media_assets m
    where m.original_path = name
      and m.owner_id = auth.uid()
  )
);

drop policy if exists shared_media_tus_select on storage.objects;
create policy shared_media_tus_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'shared-media'
  and (
    owner = auth.uid()
    or public.is_admin()
  )
);
