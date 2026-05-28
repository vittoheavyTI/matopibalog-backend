import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rjahjogidyndphdxevom.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqYWhqb2dpZHluZHBoZHhldm9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MTcyMzQsImV4cCI6MjA5NDE5MzIzNH0.l7jJ8hDqm4YAC7ZnQBuH5TOlR8Eljwab0dEp6sQZzfw';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
