import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error("Erro: Variáveis de ambiente do Supabase estão faltando no arquivo .env!")
}

export const supabase = createClient(supabaseUrl, supabaseKey)