create table if not exists public.dabrawl_room_invites (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  room_code text not null check (room_code ~ '^[A-Z0-9]{6,8}$'),
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  constraint dabrawl_room_invites_not_self check (sender_id <> recipient_id)
);
create index if not exists dabrawl_room_invites_recipient_pending_idx on public.dabrawl_room_invites(recipient_id, created_at desc) where status='pending';
alter table public.dabrawl_room_invites enable row level security;
grant select, insert, update on public.dabrawl_room_invites to authenticated;
drop policy if exists "Users can view their room invites" on public.dabrawl_room_invites;
create policy "Users can view their room invites" on public.dabrawl_room_invites for select to authenticated
using (auth.uid() = sender_id or auth.uid() = recipient_id);
drop policy if exists "Friends can invite to a room they host" on public.dabrawl_room_invites;
create policy "Friends can invite to a room they host" on public.dabrawl_room_invites for insert to authenticated
with check (
  auth.uid() = sender_id
  and exists (
    select 1 from public.dabrawl_friend_requests f
    where f.status='accepted'
      and ((f.requester_id=auth.uid() and f.addressee_id=dabrawl_room_invites.recipient_id)
        or (f.addressee_id=auth.uid() and f.requester_id=dabrawl_room_invites.recipient_id))
  )
  and exists (
    select 1 from public.game_rooms r
    join public.game_room_players p on p.room_id=r.id
    where r.room_code=upper(dabrawl_room_invites.room_code) and r.host_id=auth.uid() and p.user_id=auth.uid()
  )
);
drop policy if exists "Recipients can respond to room invites" on public.dabrawl_room_invites;
create policy "Recipients can respond to room invites" on public.dabrawl_room_invites for update to authenticated
using (auth.uid() = recipient_id and status='pending')
with check (auth.uid() = recipient_id and status in ('accepted','declined'));
do $$ begin
  alter publication supabase_realtime add table public.dabrawl_room_invites;
exception when duplicate_object then null;
when undefined_object then null;
end $$;