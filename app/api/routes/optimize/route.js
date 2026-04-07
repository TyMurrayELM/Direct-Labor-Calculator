import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

const SOLVER_URL = process.env.SOLVER_URL || 'http://localhost:8001';

/**
 * POST /api/routes/optimize
 * Orchestrator: geocodes, builds distance matrix, calls OR-Tools solver, saves results.
 * Body: { crew_id: number, days?: string[] }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    // Support single crew_id or array of crew_ids
    const crewIds = body.crew_ids || (body.crew_id ? [body.crew_id] : []);
    if (crewIds.length === 0) {
      return NextResponse.json({ success: false, error: 'crew_id or crew_ids required' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 1. Fetch all crews
    const { data: crewsData, error: crewErr } = await supabase
      .from('crews')
      .select('id, name, branch_id, size, crew_type')
      .in('id', crewIds);

    if (crewErr || !crewsData || crewsData.length === 0) {
      return NextResponse.json({ success: false, error: `Crews not found. Error: ${crewErr?.message || 'no matching rows'}` }, { status: 404 });
    }

    // Use first crew's branch as depot (all selected crews should share a branch)
    const crew = crewsData[0];

    // 2. Fetch branch (depot)
    const { data: branch } = await supabase
      .from('branches')
      .select('id, name, address, lat, lng')
      .eq('id', crew.branch_id)
      .single();

    if (!branch) {
      return NextResponse.json({ success: false, error: 'Branch not found' }, { status: 404 });
    }

    if (!branch.lat || !branch.lng) {
      return NextResponse.json({
        success: false,
        error: `Branch "${branch.name}" is missing lat/lng. Set the branch address and geocode first.`,
      }, { status: 400 });
    }

    // 3. Fetch properties from ALL selected crews
    const { data: properties, error: propErr } = await supabase
      .from('properties')
      .select('id, name, address, lat, lng, current_hours, adjusted_hours, service_day, route_order, complex_id, service_window_start, service_window_end, crew_id')
      .in('crew_id', crewIds)
      .not('service_day', 'is', null)
      .order('service_day')
      .order('route_order');

    if (propErr) {
      return NextResponse.json({ success: false, error: propErr.message }, { status: 500 });
    }

    if (!properties || properties.length === 0) {
      return NextResponse.json({ success: false, error: 'No scheduled properties found for selected crews' }, { status: 400 });
    }

    // Build crew lookup for per-property crew size
    const crewMap = {};
    for (const c of crewsData) crewMap[c.id] = c;
    const crewNames = crewsData.map(c => c.name).join(', ');

    // 4. Check for missing lat/lng — auto-geocode if needed
    const needGeocoding = properties.filter(p => !p.lat || !p.lng);
    console.log(`Properties: ${properties.length} total, ${needGeocoding.length} need geocoding`);

    if (needGeocoding.length > 0) {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        return NextResponse.json({
          success: false,
          error: `${needGeocoding.length} properties missing lat/lng and no GOOGLE_MAPS_API_KEY configured`,
        }, { status: 400 });
      }

      const withAddress = needGeocoding.filter(p => p.address);
      const withoutAddress = needGeocoding.filter(p => !p.address);
      console.log(`Geocoding: ${withAddress.length} have addresses, ${withoutAddress.length} missing addresses`);
      if (withoutAddress.length > 0) {
        console.log('Properties missing addresses:', withoutAddress.map(p => `${p.id}: ${p.name}`));
      }

      // Geocode inline
      for (const prop of needGeocoding) {
        if (!prop.address) continue;
        try {
          const geoRes = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(prop.address)}&key=${apiKey}`
          );
          const geoData = await geoRes.json();
          if (geoData.status === 'OK' && geoData.results.length > 0) {
            const { lat, lng } = geoData.results[0].geometry.location;
            prop.lat = lat;
            prop.lng = lng;
            await supabase.from('properties').update({ lat, lng }).eq('id', prop.id);
            console.log(`Geocoded ${prop.name}: ${lat}, ${lng}`);
          } else {
            console.warn(`Geocoding returned ${geoData.status} for "${prop.address}"`, geoData.error_message || '');
          }
        } catch (err) {
          console.warn(`Geocoding failed for property ${prop.id}:`, err.message);
        }
      }
    }

    // Filter to properties that have coordinates
    const validProps = properties.filter(p => p.lat && p.lng);
    if (validProps.length === 0) {
      const sample = properties.slice(0, 3).map(p => `"${p.name}" addr=${p.address || 'NONE'} lat=${p.lat} lng=${p.lng}`);
      return NextResponse.json({
        success: false,
        error: `No properties with valid coordinates (${properties.length} properties, ${needGeocoding.length} needed geocoding). Samples: ${sample.join('; ')}`,
      }, { status: 400 });
    }

    // 5. Build locations array (index 0 = depot)
    const locations = [
      { lat: branch.lat, lng: branch.lng },
      ...validProps.map(p => ({ lat: p.lat, lng: p.lng })),
    ];

    // 6. Build distance matrix (inline to avoid internal HTTP call issues)
    const matrixData = await buildDistanceMatrix(locations, supabase);

    if (!matrixData.success) {
      return NextResponse.json({ success: false, error: `Distance matrix failed: ${matrixData.error}` }, { status: 500 });
    }

    // 7. Build solver request
    const workDays = ['Route 1', 'Route 2', 'Route 3', 'Route 4', 'Route 5'];

    const solverProps = validProps.map(p => {
      // Use the property's own crew size for on-site time calculation
      const propCrew = crewMap[p.crew_id] || crew;
      const crewSize = propCrew.size || 1;
      const manHours = (p.adjusted_hours !== null && p.adjusted_hours !== undefined)
        ? p.adjusted_hours
        : (p.current_hours || 0);
      const onsiteMinutes = (manHours / crewSize) * 60;

      // Extract base property name for multi-visit grouping
      // e.g., "McCarran Marketplace (Visit 1)" -> "McCarran Marketplace"
      const baseNameMatch = p.name?.match(/^(.+?)\s*\(Visit\s+\d+\)/i);
      const baseName = baseNameMatch ? baseNameMatch[1].trim() : null;

      // Convert service window times to minutes from midnight (default 6:00-14:30)
      const parseTime = (t) => {
        if (!t) return null;
        const [h, m] = t.split(':').map(Number);
        return h * 60 + (m || 0);
      };
      // Onsite crews are exempt from service-window enforcement
      const isOnsiteCrew = (propCrew.crew_type || '').toLowerCase() === 'onsite';
      const windowStart = isOnsiteCrew ? null : parseTime(p.service_window_start);
      const windowEnd = isOnsiteCrew ? null : parseTime(p.service_window_end);

      return {
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        onsite_minutes: Math.max(1, onsiteMinutes),
        current_day: p.service_day,
        group: baseName,
        window_start_minutes: windowStart,
        window_end_minutes: windowEnd,
      };
    });

    // Build same-property groups (multi-visits that must be on DIFFERENT days)
    const groupMap = {};
    solverProps.forEach((p, idx) => {
      if (p.group) {
        if (!groupMap[p.group]) groupMap[p.group] = [];
        groupMap[p.group].push(idx);
      }
    });
    const separateDayGroups = Object.values(groupMap).filter(g => g.length > 1);

    // Build complex groups (properties that must be on the SAME day, adjacent in route)
    const complexMap = {};
    validProps.forEach((p, idx) => {
      if (p.complex_id) {
        if (!complexMap[p.complex_id]) complexMap[p.complex_id] = [];
        complexMap[p.complex_id].push(idx);
      }
    });
    const sameDayGroups = Object.values(complexMap).filter(g => g.length > 1);

    console.log('Multi-visit groups (diff days):', JSON.stringify(separateDayGroups));
    console.log('Complex groups (same day):', JSON.stringify(sameDayGroups));

    const solverPayload = {
      crew_id: crew.id,
      crew_size: crew.size || 1,
      depot: { lat: branch.lat, lng: branch.lng },
      max_day_minutes: 480,
      days: workDays,
      properties: solverProps,
      distance_matrix: matrixData.matrix,
      time_limit_seconds: 30,
      separate_day_groups: separateDayGroups,
      same_day_groups: sameDayGroups,
    };

    console.log('Multi-visit groups:', JSON.stringify(separateDayGroups), 'from groups:', JSON.stringify(groupMap));

    // 8. Call solver
    console.log(`Calling solver at ${SOLVER_URL}/solve with ${solverProps.length} properties, ${workDays.length} days`);
    let solverResult;
    try {
      const solverRes = await fetch(`${SOLVER_URL}/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(solverPayload),
      });

      console.log(`Solver responded: status=${solverRes.status}`);

      if (!solverRes.ok) {
        const errText = await solverRes.text();
        console.error('Solver error response:', errText);
        return NextResponse.json({
          success: false,
          error: `Solver error (${solverRes.status}): ${errText}`,
        }, { status: 500 });
      }

      solverResult = await solverRes.json();
      console.log(`Solver result: status=${solverResult.status}, dropped=${solverResult.dropped_properties?.length || 0}, routes_needed=${solverResult.routes_needed}`);
    } catch (err) {
      console.error('Solver fetch error:', err.message);
      return NextResponse.json({
        success: false,
        error: `Cannot reach solver at ${SOLVER_URL}. Is the Python solver running? (cd solver && python -m uvicorn main:app --port 8001)`,
      }, { status: 503 });
    }

    // 9. Calculate original drive time for comparison
    // Group current schedule by day and sum drive times from distance matrix
    let originalDriveMinutes = 0;
    const currentByDay = {};
    for (const p of validProps) {
      if (!currentByDay[p.service_day]) currentByDay[p.service_day] = [];
      currentByDay[p.service_day].push(p);
    }
    for (const day of Object.keys(currentByDay)) {
      const dayProps = currentByDay[day].sort((a, b) => (a.route_order || 0) - (b.route_order || 0));
      let prevIdx = 0; // depot
      for (const p of dayProps) {
        const pIdx = validProps.indexOf(p) + 1; // +1 for depot offset
        originalDriveMinutes += (matrixData.matrix[prevIdx][pIdx] || 0) / 60;
        prevIdx = pIdx;
      }
      // Return to depot
      if (prevIdx !== 0) {
        originalDriveMinutes += (matrixData.matrix[prevIdx][0] || 0) / 60;
      }
    }

    // 10. Save optimization to Supabase
    const { data: optRow, error: optErr } = await supabase
      .from('route_optimizations')
      .insert({
        branch_id: crew.branch_id,
        crew_id: crewIds[0],
        crew_name: crewNames,
        status: 'completed',
        total_drive_minutes: solverResult.total_drive_time_minutes,
        original_drive_minutes: Math.round(originalDriveMinutes * 10) / 10,
        solver_status: solverResult.status,
        properties_count: validProps.length,
      })
      .select('id')
      .single();

    if (optErr) {
      console.error('Failed to save optimization:', optErr);
      return NextResponse.json({ success: false, error: 'Failed to save optimization results' }, { status: 500 });
    }

    // Build property name and complex lookup
    const propNameMap = {};
    const propComplexMap = {};
    for (const p of validProps) {
      propNameMap[p.id] = p.name;
      if (p.complex_id) propComplexMap[p.id] = p.complex_id;
    }

    // Fetch complex names for display
    const complexIds = [...new Set(Object.values(propComplexMap))];
    const complexNameMap = {};
    if (complexIds.length > 0) {
      const { data: complexes } = await supabase
        .from('complexes')
        .select('id, name')
        .in('id', complexIds);
      if (complexes) {
        for (const c of complexes) complexNameMap[c.id] = c.name;
      }
    }

    // Save individual results
    const resultRows = [];
    for (const [day, stops] of Object.entries(solverResult.routes)) {
      for (const stop of stops) {
        resultRows.push({
          optimization_id: optRow.id,
          property_id: stop.property_id,
          property_name: propNameMap[stop.property_id] || '',
          service_day: day,
          route_order: stop.route_order,
          drive_time_seconds: stop.drive_time_seconds,
          onsite_minutes: stop.onsite_minutes,
        });
      }
    }

    if (resultRows.length > 0) {
      const { error: resErr } = await supabase
        .from('route_optimization_results')
        .insert(resultRows);

      if (resErr) {
        console.error('Failed to save optimization results:', resErr);
      }
    }

    return NextResponse.json({
      success: true,
      optimization_id: optRow.id,
      crew_name: crewNames,
      crew_names: crewsData.map(c => c.name),
      crew_count: crewsData.length,
      branch_name: branch.name,
      properties_count: validProps.length,
      solver_status: solverResult.status,
      original_drive_minutes: Math.round(originalDriveMinutes * 10) / 10,
      optimized_drive_minutes: solverResult.total_drive_time_minutes,
      drive_time_saved_minutes: Math.round((originalDriveMinutes - solverResult.total_drive_time_minutes) * 10) / 10,
      routes: solverResult.routes,
      propertyNames: propNameMap,
      propertyComplexes: propComplexMap,
      complexNames: complexNameMap,
      day_totals: solverResult.day_totals,
      routes_needed: solverResult.routes_needed,
      constraints_applied: solverResult.constraints_applied || [],
      dropped_properties: solverResult.dropped_properties,
    });
  } catch (error) {
    console.error('Optimize error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ---- Distance matrix logic (inlined to avoid internal HTTP calls) ----

function roundCoord(val) {
  return Math.round(val * 100000) / 100000;
}

function haversineSeconds(a, b) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sin2 = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * R * Math.asin(Math.sqrt(sin2));
  const driveMeters = meters * 1.4;
  return Math.round(driveMeters / 13.4);
}

async function buildDistanceMatrix(locations, supabase) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'GOOGLE_MAPS_API_KEY not configured' };
  }

  try {
    const n = locations.length;
    const matrix = Array.from({ length: n }, () => Array(n).fill(null));
    for (let i = 0; i < n; i++) matrix[i][i] = 0;

    // Check cache
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
      const uniqueOrigins = [...new Set(missingPairs.map(p => p.i))];
      const uniqueDests = [...new Set(missingPairs.map(p => p.j))];
      const CHUNK = 10; // Google allows max 100 elements (origins x destinations) per request

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
                const duration = element.duration.value;
                const distance = element.distance?.value;
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

          if (rowsToInsert.length > 0) {
            const { error } = await supabase
              .from('distance_cache')
              .upsert(rowsToInsert, { onConflict: 'origin_lat,origin_lng,dest_lat,dest_lng' });
            if (error) console.warn('[Distance Matrix] Cache insert error:', error.message);
          }

          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    // Haversine fallback for any remaining nulls
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (matrix[i][j] === null) {
          matrix[i][j] = haversineSeconds(locations[i], locations[j]);
        }
      }
    }

    console.log(`[Distance Matrix] Built ${n}x${n} matrix`);
    return { success: true, matrix, size: n };
  } catch (error) {
    console.error('Distance matrix error:', error);
    return { success: false, error: error.message };
  }
}
