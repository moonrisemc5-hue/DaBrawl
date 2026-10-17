-- DaBrawl multiplayer lobby schema
create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (room_code ~ '^[A-Z0-9]{5,8}$'),
  host_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','playing','finished')),
  created_at timestamptz not null default now()
);
create table if not exists public.game_room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_slot smallint not null check (player_slot in (1,2)),
  character_id text,
  is_ready boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (room_id, user_id),
  unique (room_id, player_slot)
);
create index if not exists game_rooms_host_id_idx on public.game_rooms(host_id);
create index if not exists game_room_players_user_id_idx on public.game_room_players(user_id);
create index if not exists game_room_players_room_id_idx on public.game_room_players(room_id);
alter table public.game_rooms enable row level security;
alter table public.game_room_players enable row level security;
