import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side auth helper for API routes.
 * Returns the user's role from the allowlist table, or null if not authenticated/authorized.
 */
export async function getUserRole() {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options);
              });
            } catch {
              // setAll can fail in read-only contexts (e.g. Server Components)
            }
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user?.email) return null;

    const { data, error } = await supabase
      .from('allowlist')
      .select('role')
      .eq('email', user.email.toLowerCase())
      .limit(1);

    if (error || !data?.length) return null;
    return data[0].role;
  } catch {
    return null;
  }
}

export function isEditor(role) {
  return role === 'finance' || role === 'admin';
}

export function isAdminRole(role) {
  return role === 'admin';
}
