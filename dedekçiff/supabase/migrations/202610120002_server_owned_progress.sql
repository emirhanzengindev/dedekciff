alter table public.game_sessions
  add column if not exists session_state jsonb not null default '{}'::jsonb;

drop policy if exists "players insert own game sessions" on public.game_sessions;
drop policy if exists "players update own game sessions" on public.game_sessions;
drop policy if exists "players insert own prosecution submissions" on public.prosecution_submissions;

create index if not exists game_sessions_user_updated_idx
  on public.game_sessions (user_id, updated_at desc);