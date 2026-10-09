alter table public.extracted_fields
  add column if not exists second_read text,
  add column if not exists agreement text;

alter table public.extracted_fields
  drop constraint if exists extracted_fields_agreement_chk;
alter table public.extracted_fields
  add constraint extracted_fields_agreement_chk check (agreement is null or agreement in ('agree', 'differ', 'ocr_only', 'ai_only'));

alter table public.extracted_fields
  drop constraint if exists extracted_fields_second_read_len_chk;
alter table public.extracted_fields
  add constraint extracted_fields_second_read_len_chk check (second_read is null or char_length(second_read) <= 80);

comment on column public.extracted_fields.second_read is 'What an AI model read for this row, as printed. A draft for the verifier, never a decision.';
comment on column public.extracted_fields.agreement is 'agree | differ | ocr_only | ai_only: how the AI read compares with the local OCR read.';
