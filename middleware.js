import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

export async function middleware(req) {
  // Skip middleware for auth callback route
  if (req.nextUrl.pathname.startsWith('/auth/callback')) {
    return NextResponse.next();
  }

  // Allow bots/crawlers to access pages for Open Graph metadata
  const userAgent = req.headers.get('user-agent') || '';
  const isBot = /Slackbot|facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|Googlebot|bingbot|Discordbot/i.test(userAgent);
  
  if (isBot) {
    return NextResponse.next();
  }

  let res = NextResponse.next({
    request: {
      headers: req.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
          });
          res = NextResponse.next({
            request: {
              headers: req.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

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