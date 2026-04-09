-- P&L Summary Notes Migration
-- Run this in Supabase SQL Editor
--
-- Free-text summary notes shown above Key Items on each forecast.
-- Tied to (branch_id, department, year, version_id). version_id NULL = working draft.

CREATE TABLE IF NOT EXISTS pnl_summary_notes (
  id bigserial PRIMARY KEY,
  branch_id int NOT NULL REFERENCES branches(id),
  department text NOT NULL,
  year int NOT NULL,
  version_id bigint REFERENCES pnl_versions(id) ON DELETE CASCADE,
  notes text,
  updated_at timestamptz DEFAULT now()
);

-- Postgres treats NULLs as distinct in UNIQUE constraints, so split into two
-- partial unique indexes: one for saved versions, one for the draft row.
CREATE UNIQUE INDEX IF NOT EXISTS pnl_summary_notes_unique_versioned
  ON pnl_summary_notes (branch_id, department, year, version_id)
  WHERE version_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pnl_summary_notes_unique_draft
  ON pnl_summary_notes (branch_id, department, year)
  WHERE version_id IS NULL;
