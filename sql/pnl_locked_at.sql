-- Add locked_at timestamp to pnl_versions
-- Run this in Supabase SQL Editor

ALTER TABLE pnl_versions
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;
