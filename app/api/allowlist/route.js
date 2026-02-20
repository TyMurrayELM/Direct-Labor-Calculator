import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserRole, isAdminRole } from '../../lib/getUserRole';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function GET() {
  try {
    const role = await getUserRole();
    if (!role || !isAdminRole(role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('allowlist')
      .select('email, role')
      .order('email');

    if (error) throw error;

    return NextResponse.json({ success: true, users: data });
  } catch (error) {
    console.error('Allowlist GET error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const role = await getUserRole();
    if (!role || !isAdminRole(role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabase();
    const { email, role: newRole } = await request.json();

    if (!email || !newRole) {
      return NextResponse.json(
        { success: false, error: 'Missing email or role' },
        { status: 400 }
      );
    }

    const validRoles = ['viewer', 'finance', 'admin'];
    if (!validRoles.includes(newRole)) {
      return NextResponse.json(
        { success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('allowlist')
      .upsert(
        { email: email.toLowerCase().trim(), role: newRole },
        { onConflict: 'email' }
      );

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Allowlist POST error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const role = await getUserRole();
    if (!role || !isAdminRole(role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabase();
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Missing email' },
        { status: 400 }
      );
    }

    // Prevent admin from removing themselves
    const { createServerClient } = await import('@supabase/ssr');
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() {},
        },
      }
    );
    const { data: { user } } = await authClient.auth.getUser();
    if (user?.email?.toLowerCase() === email.toLowerCase().trim()) {
      return NextResponse.json(
        { success: false, error: 'Cannot remove yourself from the allowlist' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('allowlist')
      .delete()
      .eq('email', email.toLowerCase().trim());

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Allowlist DELETE error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
