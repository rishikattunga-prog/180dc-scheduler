/* ============================================================
   SHARED STORAGE — Supabase (free tier)
   ------------------------------------------------------------
   1. Create a free project at https://supabase.com
   2. Paste your Project URL and anon public key below
   3. Run the SQL from README.md (creates the app_state table)

   Until keys are pasted, the app falls back to this browser's
   localStorage so you can still run and test it locally —
   but data will NOT be shared between devices in that mode.
   ============================================================ */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "";       // e.g. "https://abcdefgh.supabase.co"
const SUPABASE_ANON_KEY = "";  // the long "anon public" key

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export const usingSharedStorage = () => Boolean(supabase);

export async function storageGet(key) {
  if (!supabase) {
    const raw = localStorage.getItem(key);
    return raw ? { value: raw } : null;
  }
  const { data, error } = await supabase.from("app_state").select("value").eq("key", key).maybeSingle();
  if (error) { console.error("storageGet", error); return null; }
  return data ? { value: JSON.stringify(data.value) } : null;
}

export async function storageSet(key, value) {
  if (!supabase) {
    localStorage.setItem(key, value);
    return { key };
  }
  const { error } = await supabase
    .from("app_state")
    .upsert({ key, value: JSON.parse(value), updated_at: new Date().toISOString() });
  if (error) { console.error("storageSet", error); return null; }
  return { key };
}

/* Subscribe to live changes so every open browser stays in sync.
   Returns an unsubscribe function. Falls back to polling if
   realtime isn't available. */
export function storageSubscribe(key, onChange) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel("app_state_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "app_state", filter: `key=eq.${key}` },
      (payload) => {
        if (payload.new && payload.new.value) onChange(payload.new.value);
      }
    )
    .subscribe();
  /* belt-and-suspenders: light polling in case realtime is disabled */
  const poll = setInterval(async () => {
    const r = await storageGet(key);
    if (r) onChange(JSON.parse(r.value));
  }, 20000);
  return () => { supabase.removeChannel(channel); clearInterval(poll); };
}
