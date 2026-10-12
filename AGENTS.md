<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Game architecture
- All game rules (join, secrets, turns, guesses, scoring) live in Postgres SECURITY DEFINER functions called via supabase.rpc — why: atomic row locks and secrets never leave the database.
- `room_secrets` has no grants for browser roles; secrets are only exposed via `my_secret` (own) and `reveal_secrets` (after a round ends) — why: opponents must never read them.
- Players use anonymous sessions; connection status uses Realtime presence, not DB heartbeats — why: no login required and no write traffic.
