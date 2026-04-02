import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// FIX 5: versione SDK pinned (@2.45.4) invece di "latest".
// In questo modo anche tra anni l'import funzionerà sempre allo stesso modo,
// senza rischiare breaking changes da aggiornamenti automatici dell'SDK.
//
// OPZIONE MIGLIORE (offline-first): scarica supabase-sdk.js una volta sola
// da https://esm.sh/@supabase/supabase-js@2.45.4 e salvalo nella cartella
// del progetto, poi sostituisci l'import con:
//   import { createClient } from "./supabase-sdk.js";

const SUPABASE_URL = "https://quwkqaovjxczuahjcmmh.supabase.co";
const SUPABASE_KEY = "sb_publishable_1FWxC_BAnvblEtpTdUXrEg_iLKZDb6d";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
