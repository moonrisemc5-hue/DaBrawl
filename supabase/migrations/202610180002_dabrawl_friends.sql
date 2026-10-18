-- DaBrawl friends, requests, and public usernames.
-- Apply once in Supabase Dashboard -> SQL Editor. Existing accounts are backfilled.
create table if not exists public.dabrawl_player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.dabrawl_friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint dabrawl_friend_requests_not_self check (requester_id <> addressee_id)
);

create unique index if not exists dabrawl_friend_requests_one_pair
  on public.dabrawl_friend_requests (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists dabrawl_friend_requests_addressee_status
  on public.dabrawl_friend_requests (addressee_id, status);
create index if not exists dabrawl_friend_requests_requester_status
  on public.dabrawl_friend_requests (requester_id, status);

alter table public.dabrawl_player_profiles enable row level security;
alter table public.dabrawl_friend_requests enable row level security;

drop policy if exists "Signed-in users can view public DaBrawl usernames" on public.dabrawl_player_profiles;
create policy "Signed-in users can view public DaBrawl usernames"
  on public.dabrawl_player_profiles for select to authenticated using (true);

drop policy if exists "Users can insert their own DaBrawl profile" on public.dabrawl_player_profiles;
create policy "Users can insert their own DaBrawl profile"
  on public.dabrawl_player_profiles for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update their own DaBrawl profile" on public.dabrawl_player_profiles;
create policy "Users can update their own DaBrawl profile"
  on public.dabrawl_player_profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can view requests involving them" on public.dabrawl_friend_requests;
create policy "Users can view requests involving them"
  on public.dabrawl_friend_requests for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "Users can send requests as themselves" on public.dabrawl_friend_requests;
create policy "Users can send requests as themselves"
  on public.dabrawl_friend_requests for insert to authenticated
  with check (auth.uid() = requester_id and auth.uid() <> addressee_id and status = 'pending');

drop policy if exists "Recipients can respond to pending requests" on public.dabrawl_friend_requests;
create policy "Recipients can respond to pending requests"
  on public.dabrawl_friend_requests for update to authenticated
  using (auth.uid() = addressee_id and status = 'pending')
  with check (auth.uid() = addressee_id and status in ('accepted','declined'));

create or replace function public.dabrawl_sync_player_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
begin
  v_username := lower(coalesce(nullif(new.raw_user_meta_data ->> 'username',''), split_part(coalesce(new.email,''),'@',1)));
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    v_username := 'player_' || replace(new.id::text,'-','');
  end if;
  insert into public.dabrawl_player_profiles(user_id, username)
  values (new.id, v_username)
  on conflict (user_id) do update set username = excluded.username;
  return new;
end;
$$;

drop trigger if exists dabrawl_auth_user_profile_sync on auth.users;
create trigger dabrawl_auth_user_profile_sync
  after insert or update of raw_user_meta_data, email on auth.users
  for each row execute function public.dabrawl_sync_player_profile();

insert into public.dabrawl_player_profiles(user_id, username)
select u.id,
       case
         when lower(coalesce(nullif(u.raw_user_meta_data ->> 'username',''), split_part(coalesce(u.email,''),'@',1))) ~ '^[a-z0-9_]{3,20}$'
         then lower(coalesce(nullif(u.raw_user_meta_data ->> 'username',''), split_part(coalesce(u.email,''),'@',1)))
         else 'player_' || replace(u.id::text,'-','')
       end
from auth.users u
on conflict (user_id) do nothing;

grant select on public.dabrawl_player_profiles to authenticated;
grant insert, update on public.dabrawl_player_profiles to authenticated;
grant select, insert, update on public.dabrawl_friend_requests to authenticated;
