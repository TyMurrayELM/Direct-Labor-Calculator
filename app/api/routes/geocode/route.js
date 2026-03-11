import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * POST /api/routes/geocode
 * Geocodes properties and/or branches that are missing lat/lng.
 * Body: { branch_id: number }
 * Uses Google Maps Geocoding API.
 */
export async function POST(request) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'GOOGLE_MAPS_API_KEY not configured' }, { status: 500 });
  }

  try {
    const { branch_id } = await request.json();
    if (!branch_id) {
      return NextResponse.json({ success: false, error: 'branch_id required' }, { status: 400 });
    }

    const supabase = getSupabase();
    const results = { geocoded: 0, failed: 0, errors: [] };

    // 1. Geocode branch if missing lat/lng
    const { data: branch } = await supabase
      .from('branches')
      .select('id, name, address, lat, lng')
      .eq('id', branch_id)
      .single();

    if (branch && !branch.lat && branch.address) {
      const coords = await geocodeAddress(branch.address, apiKey);
      if (coords) {
        await supabase.from('branches').update({ lat: coords.lat, lng: coords.lng }).eq('id', branch.id);
        results.geocoded++;
      } else {
        results.failed++;
        results.errors.push(`Branch "${branch.name}": geocoding failed`);
      }
    }

    // 2. Geocode properties missing lat/lng for this branch
    const { data: properties } = await supabase
      .from('properties')
      .select('id, name, address, lat, lng')
      .eq('branch_id', branch_id)
      .is('lat', null)
      .not('address', 'is', null);

    if (properties && properties.length > 0) {
      // Process in batches of 10 to respect rate limits
      for (let i = 0; i < properties.length; i += 10) {
        const batch = properties.slice(i, i + 10);
        const promises = batch.map(async (prop) => {
          if (!prop.address) return;
          const coords = await geocodeAddress(prop.address, apiKey);
          if (coords) {
            await supabase.from('properties').update({ lat: coords.lat, lng: coords.lng }).eq('id', prop.id);
            results.geocoded++;
          } else {
            results.failed++;
            results.errors.push(`Property "${prop.name}": geocoding failed for "${prop.address}"`);
          }
        });
        await Promise.all(promises);

        // Small delay between batches
        if (i + 10 < properties.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }

    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    console.error('Geocode error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

async function geocodeAddress(address, apiKey) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.status === 'OK' && data.results.length > 0) {
      const { lat, lng } = data.results[0].geometry.location;
      return { lat, lng };
    }
    console.warn(`Geocoding failed for "${address}": ${data.status}`);
    return null;
  } catch (err) {
    console.error(`Geocoding error for "${address}":`, err);
    return null;
  }
}
