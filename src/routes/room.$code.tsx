import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { ensureSession, getSavedName } from "@/lib/session";
import { clueLabel, errorMessage, formatTime, parseNumber, type Clue } from "@/lib/game";

export const Route = createFileRoute("/room/$code")({
  ssr: false,
  head: ({ params }) => ({
    meta: [
      { title: `Room ${params.code} — Higher or Lower` },
      { name: "description", content: "Join this Higher or Lower number battle room." },
      { property: "og:title", content: "Join my Higher or Lower battle" },
      { property: "og:description", content: `Room code ${params.code}. Pick a secret number and play.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RoomPage,
});

type Room = Tables<"rooms">;
type Player = Tables<"room_players">;
type Guess = Tables<"guesses">;

function RoomPage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const [uid, setUid] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [fatal, setFatal] = useState("");
  const [mySecret, setMySecret] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<Record<string, number>>({});

  const load = useCallback(async (roomId?: string) => {
    const q = roomId
      ? supabase.from("rooms").select("*").eq("id", roomId).maybeSingle()
      : supabase.from("rooms").select("*").eq("code", code).maybeSingle();
    const { data: r } = await q;
    if (!r) { setRoom(null); return null; }
    const [{ data: p }, { data: g }] = await Promise.all([
      supabase.from("room_players").select("*").eq("room_id", r.id).order("seat"),
      supabase.from("guesses").select("*").eq("room_id", r.id).eq("round", r.round).order("id"),
    ]);
    setRoom(r); setPlayers(p ?? []); setGuesses(g ?? []);
    return r;
  }, [code]);

  // Join (or rejoin after refresh) then load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await ensureSession();
        if (cancelled) return;
        setUid(id);
        const { error } = await supabase.rpc("join_room", { p_code: code, p_name: getSavedName() || "Player" });
        if (error) throw error;
        const r = await load();
        if (!r && !cancelled) setFatal("Room not found");
      } catch (e) { if (!cancelled) setFatal(errorMessage(e)); }
    })();
    return () => { cancelled = true; };
  }, [code, load]);

  // Realtime updates + presence
  const roomId = room?.id;
  useEffect(() => {
    if (!roomId || !uid) return;
    const refresh = () => { void load(roomId).then((r) => { if (!r) setFatal("This room was closed"); }); };
    const ch = supabase
      .channel(`room-${roomId}`, { config: { presence: { key: uid } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${roomId}` }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "guesses", filter: `room_id=eq.${roomId}` }, refresh)
      .on("presence", { event: "sync" }, () => setOnline(new Set(Object.keys(ch.presenceState()))))
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") { await ch.track({ at: Date.now() }); refresh(); }
      });
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("focus", onFocus); void supabase.removeChannel(ch); };
  }, [roomId, uid, load]);

  // My own secret (for display) and revealed secrets after a round
  useEffect(() => {
    if (!room) return;
    if (room.status === "picking" || room.status === "playing") {
      void supabase.rpc("my_secret", { p_room: room.id }).then(({ data }) => setMySecret((data as number | null) ?? null));
    }
    if (room.status === "finished") {
      void supabase.rpc("reveal_secrets", { p_room: room.id }).then(({ data }) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach((s: { user_id: string; secret: number }) => (map[s.user_id] = s.secret));
        setRevealed(map);
      });
    } else setRevealed({});
  }, [room?.id, room?.status, room?.round]);

  const leave = async () => {
    if (room) await supabase.rpc("leave_room", { p_room: room.id });
    navigate({ to: "/" });
  };

  if (fatal) {
    return (
      <Centered>
        <h1 className="font-display text-3xl font-extrabold">Can't open room</h1>
        <p className="mt-3 text-muted-foreground">{fatal}</p>
        <Link to="/" className="btn btn-primary mt-6">Back home</Link>
      </Centered>
    );
  }
  if (!room || !uid) return <Centered><p className="animate-pulse text-muted-foreground">Connecting…</p></Centered>;

  const me = players.find((p) => p.user_id === uid);
  const opp = players.find((p) => p.user_id !== uid);
  const winner = players.find((p) => p.user_id === room.winner);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="font-display text-lg font-extrabold"><span className="text-gradient">Higher or Lower</span></Link>
        <div className="flex items-center gap-2">
          <Timer room={room} />
          <button className="btn btn-ghost px-4 py-2 text-sm" onClick={leave}>Leave Room</button>
        </div>
      </header>

      <RoomCode code={room.code} />

      <section className="my-6 grid grid-cols-2 gap-3 sm:gap-4">
        {[1, 2].map((seat) => {
          const p = players.find((x) => x.seat === seat);
          return <PlayerCard key={seat} player={p} isMe={p?.user_id === uid} online={!!p && online.has(p.user_id)}
            turn={room.status === "playing" && room.current_turn === p?.user_id} status={room.status} />;
        })}
      </section>

      {room.status === "lobby" && (
        <Panel>
          <p className="font-display text-2xl font-bold">Waiting for opponent…</p>
          <p className="mt-2 text-muted-foreground">Share the code above with a friend.</p>
        </Panel>
      )}

      {room.status === "picking" && <PickSecret room={room} me={me} opp={opp} mySecret={mySecret} onPicked={setMySecret} />}

      {room.status === "playing" && <Battle room={room} uid={uid} opp={opp} guesses={guesses} players={players} mySecret={mySecret} />}

      {room.status === "finished" && (
        <Victory room={room} uid={uid} winner={winner} players={players} guesses={guesses} revealed={revealed} onLeave={leave} />
      )}

      {opp && !online.has(opp.user_id) && room.status !== "lobby" && (
        <p className="mt-4 text-center text-sm text-lower">{opp.name} seems disconnected — they can rejoin with the same code.</p>
      )}

      <Scoreboard players={players} room={room} />
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen flex-col items-center justify-center px-5 text-center">{children}</main>;
}
function Panel({ children }: { children: React.ReactNode }) {
  return <section className="glass animate-pop rounded-3xl p-6 text-center sm:p-8">{children}</section>;
}

function RoomCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="glass flex flex-col items-center justify-between gap-3 rounded-3xl p-5 sm:flex-row">
      <div className="text-center sm:text-left">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Room code</p>
        <p className="font-display text-4xl font-extrabold tracking-[0.3em] text-primary sm:text-5xl">{code}</p>
      </div>
      <button className="btn btn-primary" onClick={copy}>{copied ? "Copied!" : "Copy Code"}</button>
    </div>
  );
}

function PlayerCard({ player, isMe, online, turn, status }: { player: Player | undefined; isMe: boolean; online: boolean; turn: boolean; status: string }) {
  if (!player) {
    return <div className="rounded-3xl border border-dashed p-4 text-center text-muted-foreground sm:p-6">Waiting…</div>;
  }
  return (
    <div className={`glass rounded-3xl p-4 transition-all sm:p-6 ${turn ? "ring-2 ring-primary shadow-[var(--glow-primary)]" : ""}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-correct" : "bg-muted-foreground"}`} />
        <span className="text-xs text-muted-foreground">{online ? "Online" : "Offline"}</span>
        {isMe && <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs">You</span>}
      </div>
      <p className="mt-2 truncate font-display text-lg font-bold sm:text-2xl">{player.name}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {status === "picking" ? (player.ready ? "✓ Number locked in" : "Choosing number…") : turn ? "Guessing now" : `Player ${player.seat}`}
      </p>
    </div>
  );
}

function PickSecret({ room, me, opp, mySecret, onPicked }: { room: Room; me: Player | undefined; opp: Player | undefined; mySecret: number | null; onPicked: (n: number) => void }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const n = parseNumber(val);
    if (n === null) { setErr("Pick a whole number from 1 to 100"); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("set_secret", { p_room: room.id, p_secret: n });
    setBusy(false);
    if (error) setErr(error.message); else onPicked(n);
  };
  if (me?.ready) {
    return (
      <Panel>
        <p className="text-muted-foreground">Your secret number</p>
        <p className="font-display text-6xl font-extrabold text-primary">{mySecret ?? "•••"}</p>
        <p className="mt-4">{opp?.ready ? "Starting…" : `Waiting for ${opp?.name ?? "opponent"} to pick…`}</p>
      </Panel>
    );
  }
  return (
    <Panel>
      <p className="font-display text-2xl font-bold">Choose your secret number</p>
      <p className="mt-1 text-muted-foreground">1 to 100 · your opponent will never see it until the end</p>
      <div className="mx-auto mt-5 flex max-w-xs gap-2">
        <input type="password" inputMode="numeric" className="field text-center font-display text-2xl" maxLength={3}
          value={val} onChange={(e) => setVal(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="??" />
        <button className="btn btn-primary" disabled={busy} onClick={submit}>Lock</button>
      </div>
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
      {opp?.ready && <p className="mt-3 text-sm text-correct">{opp.name} is ready</p>}
    </Panel>
  );
}

const clueClass: Record<Clue, string> = { higher: "text-higher", lower: "text-lower", correct: "text-correct" };

function Battle({ room, uid, opp, guesses, players, mySecret }: { room: Room; uid: string; opp: Player | undefined; guesses: Guess[]; players: Player[]; mySecret: number | null }) {
  const myTurn = room.current_turn === uid;
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (myTurn) inputRef.current?.focus(); }, [myTurn]);
  const last = guesses[guesses.length - 1];
  const nameOf = (id: string) => players.find((p) => p.user_id === id)?.name ?? "?";

  const submit = async () => {
    if (busy || !myTurn) return;
    const n = parseNumber(val);
    if (n === null) { setErr("Guess a whole number from 1 to 100"); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("submit_guess", { p_room: room.id, p_value: n });
    setBusy(false);
    if (error) setErr(error.message); else setVal("");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Panel>
        <p className={`font-display text-2xl font-extrabold sm:text-3xl ${myTurn ? "text-primary" : "text-muted-foreground"}`}>
          {myTurn ? "Your turn!" : `${opp?.name ?? "Opponent"}'s turn`}
        </p>
        {last && (
          <div key={last.id} className="animate-pop mt-4">
            <p className="text-sm text-muted-foreground">{last.user_id === uid ? "You" : nameOf(last.user_id)} guessed {last.value}</p>
            <p className={`font-display text-5xl font-extrabold ${clueClass[last.result as Clue]}`}>{clueLabel[last.result as Clue]}</p>
          </div>
        )}
        <div className="mx-auto mt-6 flex max-w-xs gap-2">
          <input ref={inputRef} inputMode="numeric" className="field text-center font-display text-2xl" maxLength={3}
            disabled={!myTurn || busy} value={val} placeholder={myTurn ? "1-100" : "wait…"}
            onChange={(e) => setVal(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <button className="btn btn-primary" disabled={!myTurn || busy} onClick={submit}>Guess</button>
        </div>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        {mySecret !== null && <p className="mt-5 text-xs text-muted-foreground">Your secret: <span className="font-bold text-foreground">{mySecret}</span></p>}
      </Panel>
      <History guesses={guesses} uid={uid} nameOf={nameOf} />
    </div>
  );
}

function History({ guesses, uid, nameOf }: { guesses: Guess[]; uid: string; nameOf: (id: string) => string }) {
  return (
    <section className="glass rounded-3xl p-5">
      <p className="mb-3 font-display font-bold">Guess history</p>
      {guesses.length === 0 && <p className="text-sm text-muted-foreground">No guesses yet.</p>}
      <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
        {[...guesses].reverse().map((g) => (
          <li key={g.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-sm">
            <span className="truncate">{g.user_id === uid ? "You" : nameOf(g.user_id)}</span>
            <span className="font-display font-bold">{g.value}</span>
            <span className={`w-20 text-right font-bold ${clueClass[g.result as Clue]}`}>{clueLabel[g.result as Clue]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Victory({ room, uid, winner, players, guesses, revealed, onLeave }: { room: Room; uid: string; winner: Player | undefined; players: Player[]; guesses: Guess[]; revealed: Record<string, number>; onLeave: () => void }) {
  const [busy, setBusy] = useState(false);
  const iWon = room.winner === uid;
  const duration = room.round_started_at && room.round_ended_at
    ? new Date(room.round_ended_at).getTime() - new Date(room.round_started_at).getTime() : 0;
  const nameOf = (id: string) => players.find((p) => p.user_id === id)?.name ?? "?";
  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Panel>
        <p className="font-display text-5xl font-extrabold text-correct">Correct!</p>
        <p className="mt-3 font-display text-3xl font-extrabold"><span className="text-gradient">{iWon ? "You win! 🏆" : `${winner?.name ?? "Opponent"} wins`}</span></p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          {players.map((p) => (
            <div key={p.user_id} className="rounded-2xl bg-muted p-3">
              <p className="truncate text-sm text-muted-foreground">{p.name}'s number</p>
              <p className="font-display text-3xl font-bold">{revealed[p.user_id] ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{guesses.filter((g) => g.user_id === p.user_id).length} guesses this round</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Round {room.round} · {formatTime(duration)}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button className="btn btn-primary" disabled={busy || players.length < 2}
            onClick={async () => { setBusy(true); await supabase.rpc("new_round", { p_room: room.id }); setBusy(false); }}>
            Play Again
          </button>
          <button className="btn btn-ghost" onClick={onLeave}>Leave Room</button>
        </div>
      </Panel>
      <History guesses={guesses} uid={uid} nameOf={nameOf} />
    </div>
  );
}

function Scoreboard({ players, room }: { players: Player[]; room: Room }) {
  return (
    <section className="glass mt-6 overflow-x-auto rounded-3xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-display font-bold">Scoreboard</p>
        <p className="text-sm text-muted-foreground">Rounds played: {room.round - (room.status === "finished" ? 0 : 1)}</p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-muted-foreground">
          <tr><th className="py-1 text-left font-medium">Player</th><th className="font-medium">Wins</th><th className="font-medium">Losses</th><th className="font-medium">Total guesses</th></tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.user_id} className="border-t text-center">
              <td className="py-2 text-left font-bold">{p.name}</td><td className="text-correct">{p.wins}</td><td className="text-lower">{p.losses}</td><td>{p.guesses_total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Timer({ room }: { room: Room }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!room.round_started_at) return null;
  const end = room.round_ended_at ? new Date(room.round_ended_at).getTime() : now;
  return <span className="rounded-xl bg-secondary px-3 py-2 font-display text-sm font-bold tabular-nums">⏱ {formatTime(end - new Date(room.round_started_at).getTime())}</span>;
}
