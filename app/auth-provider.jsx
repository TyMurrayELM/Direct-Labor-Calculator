"use client";

import { createBrowserClient } from '@supabase/ssr';
import { SessionContextProvider } from '@supabase/auth-helpers-react';
import { useState } from 'react';

export default function AuthProvider({ initialSession, children }) {
  const [supabaseClient] = useState(() => 
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  );

  return (
    <SessionContextProvider
      supabaseClient={supabaseClient}
      initialSession={initialSession}
    >
      {children}
    </SessionContextProvider>
  );
}