-- Singleton table for admin-configurable P&L default version & compare-to
CREATE TABLE IF NOT EXISTS pnl_defaults (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_version_name text DEFAULT NULL,
  compare_version_name text DEFAULT NULL,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO pnl_defaults (id) VALUES (1) ON CONFLICT DO NOTHING;
