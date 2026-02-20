-- P&L Versioning Migration
-- Run this in Supabase SQL Editor

-- 1. Create pnl_versions table
CREATE TABLE IF NOT EXISTS pnl_versions (
  id bigserial PRIMARY KEY,
  branch_id int REFERENCES branches(id),
  department text NOT NULL,
  year int NOT NULL,
  version_name text NOT NULL,
  actual_months int DEFAULT 0,
  is_locked boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(branch_id, department, year, version_name)
);

-- 2. Add version_id column to pnl_line_items
-- NULL = working draft, set = saved version snapshot
ALTER TABLE pnl_line_items
  ADD COLUMN IF NOT EXISTS version_id bigint REFERENCES pnl_versions(id);

-- 3. Drop old unique constraint (if it exists)
ALTER TABLE pnl_line_items
  DROP CONSTRAINT IF EXISTS pnl_line_items_branch_id_department_year_row_order_key;

-- 4. Add new index for versioned lookups
CREATE INDEX IF NOT EXISTS idx_pnl_line_items_version
  ON pnl_line_items(branch_id, department, year, version_id);
