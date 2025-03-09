// This file will be used for actual Supabase integration in the future
import { createClient } from '@supabase/supabase-js';

// These will be set from environment variables in production
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Initialize the Supabase client
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export { supabase };