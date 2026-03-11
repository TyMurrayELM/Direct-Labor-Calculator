import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * GET /api/routes/optimizations?crew_id=X
 * Returns past optimization runs for a crew.
 *
 * GET /api/routes/optimizations?id=X
 * Returns a single optimization with its results (for viewing history).
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const supabase = getSupabase();

    // Single optimization detail view
    const optId = searchParams.get('id');
    if (optId) {
      const { data: opt, error: optErr } = await supabase
        .from('route_optimizations')
        .select('*')
        .eq('id', optId)
        .single();

      if (optErr || !opt) {
        return NextResponse.json({ success: false, error: 'Optimization not found' }, { status: 404 });
      }

      const { data: results, error: resErr } = await supabase
        .from('route_optimization_results')
        .select('*')
        .eq('optimization_id', optId)
        .order('service_day')
        .order('route_order');

      if (resErr) throw resErr;

      // Fetch branch name
      let branchName = '';
      if (opt.branch_id) {
        const { data: branch } = await supabase
          .from('branches')
          .select('name')
          .eq('id', opt.branch_id)
          .single();
        branchName = branch?.name || '';
      }

      // Fetch complex info for properties
      const propertyIds = results.map(r => r.property_id);
      const { data: props } = await supabase
        .from('properties')
        .select('id, complex_id, service_window_start, service_window_end')
        .in('id', propertyIds);

      const propComplexMap = {};
      const propWindowMap = {};
      const complexIds = new Set();
      if (props) {
        for (const p of props) {
          if (p.complex_id) {
            propComplexMap[p.id] = p.complex_id;
            complexIds.add(p.complex_id);
          }
          if (p.service_window_start || p.service_window_end) {
            const parseTime = (t) => {
              if (!t) return null;
              const [h, m] = t.split(':').map(Number);
              return h * 60 + (m || 0);
            };
            propWindowMap[p.id] = {
              start: parseTime(p.service_window_start),
              end: parseTime(p.service_window_end),
            };
          }
        }
      }

      const complexNameMap = {};
      if (complexIds.size > 0) {
        const { data: complexes } = await supabase
          .from('complexes')
          .select('id, name')
          .in('id', [...complexIds]);
        if (complexes) {
          for (const c of complexes) complexNameMap[c.id] = c.name;
        }
      }

      // Build routes structure from results
      const routes = {};
      const propertyNames = {};
      for (const r of results) {
        if (!routes[r.service_day]) routes[r.service_day] = [];
        const window = propWindowMap[r.property_id];
        routes[r.service_day].push({
          property_id: r.property_id,
          route_order: r.route_order,
          drive_time_seconds: r.drive_time_seconds,
          onsite_minutes: Number(r.onsite_minutes),
          window_start: window?.start || null,
          window_end: window?.end || null,
        });
        propertyNames[r.property_id] = r.property_name;
      }

      // Build day totals
      const day_totals = {};
      for (const [day, stops] of Object.entries(routes)) {
        const driveMin = stops.reduce((sum, s) => sum + (s.drive_time_seconds || 0) / 60, 0);
        const serviceMin = stops.reduce((sum, s) => sum + (s.onsite_minutes || 0), 0);
        day_totals[day] = {
          drive_minutes: Math.round(driveMin * 10) / 10,
          service_minutes: Math.round(serviceMin * 10) / 10,
          total_minutes: Math.round((driveMin + serviceMin) * 10) / 10,
          stop_count: stops.length,
        };
      }

      return NextResponse.json({
        success: true,
        optimization_id: opt.id,
        crew_name: opt.crew_name,
        branch_name: branchName,
        crew_size: null,
        properties_count: opt.properties_count,
        solver_status: opt.solver_status,
        original_drive_minutes: Number(opt.original_drive_minutes),
        optimized_drive_minutes: Number(opt.total_drive_minutes),
        drive_time_saved_minutes: Math.round((Number(opt.original_drive_minutes) - Number(opt.total_drive_minutes)) * 10) / 10,
        routes,
        propertyNames,
        propertyComplexes: propComplexMap,
        complexNames: complexNameMap,
        day_totals,
        status: opt.status,
        created_at: opt.created_at,
      });
    }

    // List view
    const crewId = searchParams.get('crew_id');
    if (!crewId) {
      return NextResponse.json({ success: false, error: 'crew_id or id required' }, { status: 400 });
    }

    const { data: optimizations, error } = await supabase
      .from('route_optimizations')
      .select('*')
      .eq('crew_id', crewId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    return NextResponse.json({ success: true, optimizations: optimizations || [] });
  } catch (error) {
    console.error('Optimizations list error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/routes/optimizations
 * Body: { id: number }
 * Deletes an optimization run and its results (CASCADE).
 */
export async function DELETE(request) {
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    }

    const supabase = getSupabase();

    const { error } = await supabase
      .from('route_optimizations')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete optimization error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
