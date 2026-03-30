import { createClient } from "https://esm.sh/@supabase/supabase-js";

const SUPABASE_URL = "https://quwkqaovjxczuahjcmmh.supabase.co";
const SUPABASE_KEY = "sb_publishable_1FWxC_BAnvblEtpTdUXrEg_iLKZDb6d";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);