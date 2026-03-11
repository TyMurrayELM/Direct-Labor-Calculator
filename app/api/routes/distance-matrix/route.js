import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// Round lat/lng to 5 decimal places (~1.1m precision) for cache key consistency
function roundCoord(val) {
  return Math.round(val * 100000) / 100000;
}

/**
 * POST /api/routes/distance-matrix
 * Builds an NxN distance matrix for depot + properties.
 * Checks cache first, fetches missing pairs from Google Distance Matrix API.
 * Body: { locations: [{ lat, lng }, ...] } where index 0 = depot
 * Returns: { matrix: [[seconds, ...], ...] }
 */
export async function POST(request) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'GOOGLE_MAPS_API_KEY not configured' }, { status: 500 });
  }

  try {
    const { locations } = await request.json();
    if (!locations || locations.length < 2) {
      return NextResponse.json({ success: false, error: 'Need at least 2 locations (depot + 1 property)' }, { status: 400 });
    }

    const n = locations.length;
    const supabase = getSupabase();

    // Initialize matrix with nulls
    const matrix = Array.from({ length: n }, () => Array(n).fill(null));
    for (let i = 0; i < n; i++) matrix[i][i] = 0; // self-distance = 0

    // Check cache for all pairs
    const { data: cached } = await supabase
      .from('distance_cache')
      .select('origin_lat, origin_lng, dest_lat, dest_lng, duration_seconds');

    const cacheMap = new Map();
    if (cached) {
      for (const row of cached) {
        const key = `${roundCoord(row.origin_lat)},${roundCoord(row.origin_lng)}|${roundCoord(row.dest_lat)},${roundCoord(row.dest_lng)}`;
        cacheMap.set(key, row.duration_seconds);
      }
    }

    // Fill matrix from cache and identify missing pairs
    const missingPairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const key = `${roundCoord(locations[i].lat)},${roundCoord(locations[i].lng)}|${roundCoord(locations[j].lat)},${roundCoord(locations[j].lng)}`;
        const cachedVal = cacheMap.get(key);
        if (cachedVal !== undefined) {
          matrix[i][j] = cachedVal;
        } else {
          missingPairs.push({ i, j });
        }
      }
    }

    if (missingPairs.length > 0) {
      console.log(`[Distance Matrix] ${missingPairs.length} pairs missing from cache, fetching from Google...`);

      // Google Distance Matrix API allows max 25 origins x 25 destinations per request
      // Build unique origin/destination indices
      const uniqueOrigins = [...new Set(missingPairs.map(p => p.i))];
      const uniqueDests = [...new Set(missingPairs.map(p => p.j))];

      // Fetch in chunks of 25 origins x 25 destinations
      const CHUNK = 10; // Google allows max 100 elements per request
      for (let oi = 0; oi < uniqueOrigins.length; oi += CHUNK) {
        const originChunk = uniqueOrigins.slice(oi, oi + CHUNK);
        for (let di = 0; di < uniqueDests.length; di += CHUNK) {
          const destChunk = uniqueDests.slice(di, di + CHUNK);

          const origins = originChunk.map(idx => `${locations[idx].lat},${locations[idx].lng}`).join('|');
          const destinations = destChunk.map(idx => `${locations[idx].lat},${locations[idx].lng}`).join('|');

          const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origins}&destinations=${destinations}&key=${apiKey}&mode=driving`;

          const res = await fetch(url);
          const data = await res.json();

          if (data.status !== 'OK') {
            console.error('[Distance Matrix] Google API error:', data.status, data.error_message);
            continue;
          }

          const rowsToInsert = [];

          for (let oi2 = 0; oi2 < originChunk.length; oi2++) {
            const origIdx = originChunk[oi2];
            for (let di2 = 0; di2 < destChunk.length; di2++) {
              const destIdx = destChunk[di2];
              if (origIdx === destIdx) continue;

              const element = data.rows[oi2]?.elements[di2];
              if (element?.status === 'OK') {
                const duration = element.duration.value; // seconds
                const distance = element.distance?.value; // meters
                matrix[origIdx][destIdx] = duration;

                rowsToInsert.push({
                  origin_lat: roundCoord(locations[origIdx].lat),
                  origin_lng: roundCoord(locations[origIdx].lng),
                  dest_lat: roundCoord(locations[destIdx].lat),
                  dest_lng: roundCoord(locations[destIdx].lng),
                  duration_seconds: duration,
                  distance_meters: distance || null,
                });
              }
            }
          }

          // Cache the results
          if (rowsToInsert.length > 0) {
            const { error } = await supabase
              .from('distance_cache')
              .upsert(rowsToInsert, { onConflict: 'origin_lat,origin_lng,dest_lat,dest_lng' });

            if (error) {
              console.warn('[Distance Matrix] Cache insert error:', error.message);
            }
          }

          // Respect rate limits
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    // Fill any still-missing values with Haversine estimate (fallback)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (matrix[i][j] === null) {
          matrix[i][j] = haversineSeconds(locations[i], locations[j]);
        }
      }
    }

    const cachedCount = n * (n - 1) - missingPairs.length;
    console.log(`[Distance Matrix] Built ${n}x${n} matrix (${cachedCount} cached, ${missingPairs.length} fetched)`);

    return NextResponse.json({ success: true, matrix, size: n });
  } catch (error) {
    console.error('Distance matrix error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Haversine fallback — estimates drive time as 1.4x straight-line distance at 30mph
function haversineSeconds(a, b) {
  const R = 6371000; // Earth radius meters
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sin2 = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * R * Math.asin(Math.sqrt(sin2));
  const driveMeters = meters * 1.4; // road factor
  return Math.round(driveMeters / 13.4); // 30mph ≈ 13.4 m/s
}
