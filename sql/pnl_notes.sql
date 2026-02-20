-- P&L Notes Migration
-- Run this in Supabase SQL Editor

-- 1. Add cell_notes JSONB column to pnl_line_items
-- Keys are month keys (jan, feb, etc.), values are note strings
-- Example: {"jan": "Adjusted for one-time expense", "mar": "Includes Q1 accrual"}
ALTER TABLE pnl_line_items
  ADD COLUMN IF NOT EXISTS cell_notes jsonb DEFAULT '{}'::jsonb;

-- 2. Add notes column to pnl_versions
ALTER TABLE pnl_versions
  ADD COLUMN IF NOT EXISTS notes text DEFAULT NULL;
