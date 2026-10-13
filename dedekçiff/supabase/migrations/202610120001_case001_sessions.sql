create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id text not null,
  case_version text not null default '1.0.0',
  unlocked_evidence_ids text[] not null default '{}',
  completed_interviews jsonb not null default '[]'::jsonb,
  actions text[] not null default '{}',
  notes text[] not null default '{}',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prosecution_submissions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  submission jsonb not null,
  decision jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.game_sessions enable row level security;
alter table public.prosecution_submissions enable row level security;

create policy "players read own game sessions"
  on public.game_sessions for select
  using (auth.uid() = user_id);

create policy "players insert own game sessions"
  on public.game_sessions for insert
  with check (auth.uid() = user_id);

create policy "players update own game sessions"
  on public.game_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "players read own prosecution submissions"
  on public.prosecution_submissions for select
  using (auth.uid() = user_id);

create policy "players insert own prosecution submissions"
  on public.prosecution_submissions for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.game_sessions s
      where s.id = session_id
        and s.user_id = auth.uid()
    )
  );
