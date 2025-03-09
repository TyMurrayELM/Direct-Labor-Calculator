import './globals.css'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import AuthProvider from './auth-provider';

export const metadata = {
  title: 'Direct Labor Maintenance Calculator',
  description: 'Calculate and manage direct labor for landscape maintenance',
}

export default async function RootLayout({ children }) {
  // Get the initial session server-side
  const supabase = createServerComponentClient({ cookies });
  
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return (
    <html lang="en">
      <body className="bg-gray-100">
        <AuthProvider initialSession={session}>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}