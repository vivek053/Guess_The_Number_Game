import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureSession, getSavedName, saveName } from "@/lib/session";
import { errorMessage, isRoomCode } from "@/lib/game";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Higher or Lower — Number Battle | Play free online" },
      { name: "description", content: "Pick a secret number, share a 6-digit room code, and out-guess your friend. Free 2-player game, no install." },
      { property: "og:title", content: "Higher or Lower — Number Battle" },
      { property: "og:description", content: "Free online 2-player number guessing battle with room codes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"menu" | "join">("menu");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setName(getSavedName()), []);

  const needName = () => {
    if (!name.trim()) { setError("Enter your name first"); return true; }
    saveName(name);
    return false;
  };

  const create = async () => {
    if (needName()) return;
    setBusy(true); setError("");
    try {
      await ensureSession();
      const { data, error } = await supabase.rpc("create_room", { p_name: name });
      if (error) throw error;
      navigate({ to: "/room/$code", params: { code: data as string } });
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  const join = async () => {
    if (needName()) return;
    if (!isRoomCode(code)) { setError("Room code must be 6 digits"); return; }
    setBusy(true); setError("");
    try {
      await ensureSession();
      const { error } = await supabase.rpc("join_room", { p_code: code.trim(), p_name: name });
      if (error) throw error;
      navigate({ to: "/room/$code", params: { code: code.trim() } });
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-12">
      <div className="mb-10 text-center">
        <div className="mb-4 flex justify-center gap-3 font-display text-sm font-semibold">
          <span className="animate-floaty rounded-full bg-higher/15 px-3 py-1 text-higher">▲ Higher</span>
          <span className="animate-floaty rounded-full bg-lower/15 px-3 py-1 text-lower [animation-delay:.5s]">▼ Lower</span>
        </div>
        <h1 className="font-display text-5xl font-extrabold leading-[1.05] sm:text-6xl">
          <span className="text-gradient">Higher or Lower</span>
        </h1>
        <p className="mt-3 font-display text-lg text-muted-foreground">Number Battle</p>
        <p className="mx-auto mt-5 max-w-sm text-muted-foreground">
          Hide a number from 1 to 100. Take turns guessing. First to crack the other's number wins.
        </p>
      </div>

      <div className="glass space-y-4 rounded-3xl p-6">
        <label className="block text-sm font-medium text-muted-foreground">
          Your name
          <input className="field mt-2" maxLength={20} value={name} placeholder="e.g. Vivek"
            onChange={(e) => setName(e.target.value)} />
        </label>

        {mode === "menu" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button className="btn btn-primary py-5 text-lg" disabled={busy} onClick={create}>Create Room</button>
            <button className="btn btn-ghost py-5 text-lg" disabled={busy} onClick={() => { setMode("join"); setError(""); }}>Join Room</button>
          </div>
        ) : (
          <div className="space-y-3">
            <input className="field text-center font-display text-3xl tracking-[0.4em]" inputMode="numeric"
              maxLength={6} placeholder="000000" value={code} autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && join()} />
            <div className="grid grid-cols-2 gap-3">
              <button className="btn btn-ghost" onClick={() => { setMode("menu"); setError(""); }}>Back</button>
              <button className="btn btn-primary" disabled={busy} onClick={join}>Join</button>
            </div>
          </div>
        )}
        {error && <p className="animate-pop text-center text-sm font-medium text-destructive">{error}</p>}
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">Free to play · No sign-up · Works on any device</p>
    </main>
  );
}
