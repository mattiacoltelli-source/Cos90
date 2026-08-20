import { createClient } from "./supabase-sdk.js";

// FIX 5: SDK Supabase vendorizzato in locale (supabase-sdk.js, build pinned
// di @supabase/supabase-js@2.45.4) invece di caricato da esm.sh ad ogni avvio.
// Prima, se esm.sh non rispondeva, questo `import` a livello di modulo falliva
// in un punto non intercettabile da try/catch e bloccava l'intera app (anche
// funzioni offline come voto e backup, che non usano affatto Supabase).
// Con il file nel progetto l'app si avvia sempre, indipendentemente dalla rete.

const SUPABASE_URL = "https://quwkqaovjxczuahjcmmh.supabase.co";
const SUPABASE_KEY = "sb_publishable_1FWxC_BAnvblEtpTdUXrEg_iLKZDb6d";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
