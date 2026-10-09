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

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.queue_items;
  end if;
end $$;
