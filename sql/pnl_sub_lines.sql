-- Add parent_id column for sub-line support
ALTER TABLE pnl_line_items
  ADD COLUMN IF NOT EXISTS parent_id bigint REFERENCES pnl_line_items(id) ON DELETE CASCADE;

-- Index for efficient sub-line lookups
CREATE INDEX IF NOT EXISTS idx_pnl_line_items_parent
  ON pnl_line_items(parent_id) WHERE parent_id IS NOT NULL;
