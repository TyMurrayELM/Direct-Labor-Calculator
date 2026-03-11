-- Route Optimization Schema Changes
-- Run in Supabase SQL Editor

-- 1. Add lat/lng to branches (depot locations)
ALTER TABLE branches ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- 2. Add lat/lng to properties (already have address)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- 3. Distance cache — stores pairwise drive times from Google Distance Matrix API
CREATE TABLE IF NOT EXISTS distance_cache (
  id BIGSERIAL PRIMARY KEY,
  origin_lat DOUBLE PRECISION NOT NULL,
  origin_lng DOUBLE PRECISION NOT NULL,
  dest_lat DOUBLE PRECISION NOT NULL,
  dest_lng DOUBLE PRECISION NOT NULL,
  duration_seconds INTEGER NOT NULL,
  distance_meters INTEGER,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (origin_lat, origin_lng, dest_lat, dest_lng)
);

-- 4. Optimization run metadata
CREATE TABLE IF NOT EXISTS route_optimizations (
  id BIGSERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id),
  crew_id INTEGER REFERENCES crews(id),
  crew_name TEXT,
  status TEXT DEFAULT 'completed',
  total_drive_minutes NUMERIC,
  original_drive_minutes NUMERIC,
  solver_status TEXT,
  properties_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  applied_at TIMESTAMPTZ
);

-- 5. Optimization results — individual stops per run
CREATE TABLE IF NOT EXISTS route_optimization_results (
  id BIGSERIAL PRIMARY KEY,
  optimization_id BIGINT REFERENCES route_optimizations(id) ON DELETE CASCADE,
  property_id INTEGER REFERENCES properties(id),
  property_name TEXT,
  service_day TEXT NOT NULL,
  route_order INTEGER NOT NULL,
  drive_time_seconds INTEGER,
  onsite_minutes NUMERIC
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_distance_cache_coords
  ON distance_cache (origin_lat, origin_lng, dest_lat, dest_lng);

CREATE INDEX IF NOT EXISTS idx_route_opt_results_opt_id
  ON route_optimization_results (optimization_id);

CREATE INDEX IF NOT EXISTS idx_route_optimizations_crew
  ON route_optimizations (crew_id, created_at DESC);
