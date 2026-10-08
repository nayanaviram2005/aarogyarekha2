-- 0009 Storage + realtime. Requires a Supabase project (storage / realtime schemas).
-- Bucket is PRIVATE. Access is decided by the `documents` row (migration 0003/0007), never by path alone:
--   * read   : the document exists, is not deleted, scan_status = 'clean', and the caller can access the patient
--   * upload : the caller created the pending `documents` row for exactly this path
-- Mutation/deletion of objects is service_role only (scan pipeline, erasure).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-documents', 'patient-documents', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy patient_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'patient-documents' and app.can_read_document_object(name));

create policy patient_docs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'patient-documents' and app.can_upload_document_object(name));

-- Realtime queue board (RLS still applies to realtime). Guarded: publication exists only on Supabase.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.queue_items;
  end if;
end $$;
