# Higher or Lower — Number Battle

A real online 2-player game: create a room, share a 6-digit code, pick secret numbers, take turns guessing with Higher / Lower / Correct clues.

## What players will see
- **Home** (`/`): colorful title, name input, big "Create Room" and "Join Room" buttons.
- **Room** (`/room/$code`):
  - Lobby: large room code + Copy button, two player cards with online/offline dots, "waiting for opponent".
  - Secret pick: each player enters 1–100 privately; shows "Opponent ready" without the number.
  - Battle: turn banner, guess input (disabled when not your turn), animated clue, guess history for both sides, live timer, scoreboard (guesses, wins, losses, rounds).
  - Victory screen: winner name, stats, both secrets revealed, "Play again" (new round, same room), "Leave Room".
- Dark premium theme, neon gradient title, rounded cards, smooth animations, mobile-first layout.
- Clear errors: invalid code, room full, room expired, opponent disconnected.

## Backend (Lovable Cloud)
- Anonymous sign-in on first visit gives each browser a secure session (no login needed; survives refresh).
- Tables:
  - `rooms`: code (unique 6 digits), status (lobby/picking/playing/finished), current turn, round number, winner, timestamps, expires_at.
  - `room_players`: room, user, name, seat (1/2), wins, losses, guess count, ready flag, last_seen.
  - `room_secrets`: room, user, round, secret — **no read access for anyone in the browser**; only server code touches it.
  - `guesses`: room, round, player, value, result.
- Row-level security: players can read only rooms/players/guesses of rooms they belong to; all writes go through server functions.
- Server functions (authenticated): createRoom, joinRoom, setSecret, submitGuess, newRound, leaveRoom, heartbeat. They validate turn, range 1–100, room status, and use a row lock so double-clicks can't corrupt state. First player chosen randomly server-side.
- Realtime subscriptions on rooms, room_players, guesses so both screens update instantly; presence/heartbeat for connection status and reconnection.
- Cleanup: rooms expire after 2 hours of inactivity; expired rooms are rejected on join and purged by a scheduled cleanup.

## Testing
- Unit tests for the clue rule (lower/higher/correct) and input validation.
- End-to-end check with two browser sessions: create, join, pick, alternate turns, win, confirm the opponent's secret is never in any response before the end.

## Delivery
- README with setup, two-device testing, and publishing steps; free-tier notes (Lovable Cloud free usage limits, publishing is free on lovable.app).
- Publishing is done by you with the Publish button; the URL is shared only after it succeeds.

## Technical details
- TanStack Start + `createServerFn` with `requireSupabaseAuth`; admin client loaded inside handlers for secret reads.
- `submitGuess` runs a Postgres `security definer` function (`SELECT ... FOR UPDATE`) to compare and switch turns atomically.
- Secrets revealed to clients only after status = finished, returned by server function.
