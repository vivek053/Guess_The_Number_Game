export type Clue = "higher" | "lower" | "correct";

/** Mirrors the server rule in submit_guess (the server is the source of truth). */
export function clueFor(guess: number, secret: number): Clue {
  if (guess < secret) return "higher";
  if (guess > secret) return "lower";
  return "correct";
}

export function parseNumber(input: string): number | null {
  if (!/^\d{1,3}$/.test(input.trim())) return null;
  const n = Number(input.trim());
  return n >= 1 && n <= 100 ? n : null;
}

export function isRoomCode(input: string): boolean {
  return /^\d{6}$/.test(input.trim());
}

export const clueLabel: Record<Clue, string> = {
  higher: "Higher!",
  lower: "Lower!",
  correct: "Correct!",
};

export function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: string }).message);
  return "Something went wrong";
}
