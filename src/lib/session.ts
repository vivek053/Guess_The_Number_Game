import { supabase } from "@/integrations/supabase/client";

export async function ensureSession(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error || !anon.user) throw error ?? new Error("Could not start a session");
  return anon.user.id;
}

const NAME_KEY = "hol-name";
export const getSavedName = () => (typeof window === "undefined" ? "" : localStorage.getItem(NAME_KEY) ?? "");
export const saveName = (n: string) => localStorage.setItem(NAME_KEY, n.trim().slice(0, 20));
