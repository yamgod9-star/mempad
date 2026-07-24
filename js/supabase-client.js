/* ============================================================
   MEMпад — supabase-client.js
   Инициализация Supabase клиента для работы с БД
   ============================================================ */

const SUPABASE_URL = 'https://hfueocqfpbhnemeiiqzq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uDvvzqsLWKHvOn81amkfrw_L9YrMFw9';

// Use window.supabase (CDN) to create a client instance without re-declaring global 'supabase'
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.supabaseClient = supabaseClient;

console.log('✅ Supabase client initialized (supabaseClient)');
