import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * POST /api/routes/apply
 * Applies an optimization result to the actual schedule.
 * Updates service_day and route_order on properties.
 * Body: { optimization_id: number }
 */
export async function POST(request) {
  try {
    const { optimization_id } = await request.json();
    if (!optimization_id) {
      return NextResponse.json({ success: false, error: 'optimization_id required' }, { status: 400 });
    }

    const supabase = getSupabase();

    // Fetch optimization and results
    const { data: opt } = await supabase
      .from('route_optimizations')
      .select('id, status, crew_id')
      .eq('id', optimization_id)
      .single();

    if (!opt) {
      return NextResponse.json({ success: false, error: 'Optimization not found' }, { status: 404 });
    }

    if (opt.status === 'applied') {
      return NextResponse.json({ success: false, error: 'This optimization has already been applied' }, { status: 400 });
    }

    const { data: results } = await supabase
      .from('route_optimization_results')
      .select('property_id, service_day, route_order')
      .eq('optimization_id', optimization_id)
      .order('service_day')
      .order('route_order');

    if (!results || results.length === 0) {
      return NextResponse.json({ success: false, error: 'No results found for this optimization' }, { status: 400 });
    }

    // Apply each property's new service_day and route_order
    let updated = 0;
    let errors = [];

    for (const result of results) {
      const { error } = await supabase
        .from('properties')
        .update({
          service_day: result.service_day,
          route_order: result.route_order,
        })
        .eq('id', result.property_id);

      if (error) {
        errors.push(`Property ${result.property_id}: ${error.message}`);
      } else {
        updated++;
      }
    }

    // Mark optimization as applied
    await supabase
      .from('route_optimizations')
      .update({ status: 'applied', applied_at: new Date().toISOString() })
      .eq('id', optimization_id);

    return NextResponse.json({
      success: true,
      updated,
      total: results.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Apply error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
