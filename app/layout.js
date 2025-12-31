import './globals.css'
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import AuthProvider from './auth-provider';

export const metadata = {
  title: 'Direct Labor Maintenance Calculator',
  description: 'Calculate and manage direct labor for landscape maintenance',
}

export default async function RootLayout({ children }) {
  const cookieStore = await cookies();
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
      },
    }
  );
  
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