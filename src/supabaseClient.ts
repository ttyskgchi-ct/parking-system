import { createClient } from '@supabase/supabase-js'

// ここが重要です！
const supabaseUrl = 'https://glnajeflysbwvzxsutac.supabase.co' 
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsbmFqZWZseXNid3Z6eHN1dGFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NDk5OTQsImV4cCI6MjA4NTQyNTk5NH0.b5RkPVkZeI8BlNByb8ftv7_mH8AAWsIM3X-RMaTfNJ0'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)