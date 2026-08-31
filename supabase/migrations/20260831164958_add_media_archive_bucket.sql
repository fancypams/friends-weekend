-- Archive objects are written only by the service-role Edge Function. The
-- bucket remains private; recipients get a time-limited signed URL by email.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-archives',
  'media-archives',
  false,
  4294967295,
  array['application/zip']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
