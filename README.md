# Higher or Lower — Number Battle

Free 2-player online number guessing game. Built with TanStack Start + Lovable Cloud (database, anonymous sessions, realtime).

## Play / test with two devices
1. Open the site on device A, enter a name, tap **Create Room**, share the 6-digit code.
2. On device B (any network), enter a name, tap **Join Room**, type the code.
3. Both lock a secret number (1–100). A random player starts; clues are Higher / Lower / Correct.
4. Refreshing or reopening `/room/<code>` rejoins the same seat.

## Security
- Secrets are stored in a table the browser cannot read. Guesses are checked inside the database (`submit_guess`) with a row lock, so turns, ranges and winners can't be faked.
- Rooms expire after 2 hours without activity; expired rooms are removed when new rooms are created.

## Deploy
Click **Publish** in Lovable. Hosting on lovable.app and the free Cloud tier cost nothing for light use; heavy traffic may exceed free usage limits.

## Tests
`bunx vitest run`
