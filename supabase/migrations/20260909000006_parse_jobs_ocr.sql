-- Add OCR output columns to parse_jobs (Stage 1 → Stage 2 handoff).
-- The parse-worker writes these after OCR completes; Stage 2 (LLM extraction)
-- reads ocr_text as its input. Not exposed in the public API response.
alter table public.parse_jobs
  add column ocr_text     text,
  add column ocr_provider text check (ocr_provider in ('claude', 'textract'));
