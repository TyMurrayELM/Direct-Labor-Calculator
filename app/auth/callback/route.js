import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// Function to check if user's email is in allowlist
async function checkAllowlist(supabase, email) {
  try {
    const { data, error } = await supabase
      .from('allowlist')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();
    
    if (error) {
      console.error('Error checking allowlist:', error);
      return false;
    }
    
    return !!data; // Return true if the email is in the allowlist
  } catch (err) {
    console.error('Exception when checking allowlist:', err);
    return false;
  }
}

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  
  if (code) {
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
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );
    
    try {
      // Exchange the code for a session
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      
      if (error) {
        throw error;
      }
      
      console.log("Successfully exchanged code for session");
      
      // Get the user's email
      const user = data?.session?.user;
      
      if (user?.email) {
        // Check if the user's email is in the allowlist
        const isAllowed = await checkAllowlist(supabase, user.email);
        
        if (!isAllowed) {
          // Not in allowlist, sign them out
          await supabase.auth.signOut();
          
          // Redirect to unauthorized page
          return NextResponse.redirect(new URL('/login?error=unauthorized', requestUrl.origin));
        }
      }
    } catch (error) {
      console.error("Error exchanging code for session:", error);
      return NextResponse.redirect(new URL('/login?error=auth_error', requestUrl.origin));
    }
  }

  // All good, redirect to the home page
  return NextResponse.redirect(new URL('/', requestUrl.origin));
}