import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';

export async function middleware(req) {
  // Skip middleware for auth callback route
  if (req.nextUrl.pathname.startsWith('/auth/callback')) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // If no session and not on login page, redirect to login
  if (!session && !req.nextUrl.pathname.startsWith('/login')) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  // If has session and on login page, redirect to home
  if (session && req.nextUrl.pathname.startsWith('/login')) {
    const homeUrl = new URL('/', req.url);
    return NextResponse.redirect(homeUrl);
  }

  return res;
}

// Apply middleware to all routes except those specified
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};