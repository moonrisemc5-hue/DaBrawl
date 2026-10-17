create table if not exists public.dabrawl_prototype_matches (
  room text primary key check (length(room) between 1 and 80),
  state jsonb not null default '{"players":{},"tick":0,"startedAt":null}'::jsonb,
  last_tick_at timestamptz not null default '-infinity',
  updated_at timestamptz not null default now()
);
alter table public.dabrawl_prototype_matches enable row level security;

create or replace function public.dabrawl_prototype_join(p_room text, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.dabrawl_prototype_matches%rowtype; players jsonb; existing jsonb; slot_no int; player_key text := p_user_id::text;
begin
  if p_room is null or length(trim(p_room)) < 1 or length(p_room) > 80 then raise exception 'Invalid room'; end if;
  insert into public.dabrawl_prototype_matches(room) values (p_room) on conflict (room) do nothing;
  select * into m from public.dabrawl_prototype_matches where room=p_room for update;
  players := coalesce(m.state->'players','{}'::jsonb); existing := players->player_key;
  if existing is null then
    if (select count(*) from jsonb_object_keys(players)) >= 2 then raise exception 'Prototype room is full (2 players maximum)'; end if;
    slot_no := case when (select count(*) from jsonb_object_keys(players))=0 then 1 else 2 end;
    existing := jsonb_build_object('userId',player_key,'slot',slot_no,'x',case when slot_no=1 then 180 else 620 end,'y',260,'hp',100,'input',jsonb_build_object('x',0,'y',0),'seq',0,'connected',true);
    players := players || jsonb_build_object(player_key,existing);
  else existing := existing || jsonb_build_object('connected',true); players := players || jsonb_build_object(player_key,existing);
  end if;
  m.state := jsonb_set(m.state,'{players}',players,true);
  if m.state->>'startedAt' is null then m.state := jsonb_set(m.state,'{startedAt}',to_jsonb(extract(epoch from now())*1000),true); end if;
  update public.dabrawl_prototype_matches set state=m.state,updated_at=now() where room=p_room;
  return m.state;
end; $$;

create or replace function public.dabrawl_prototype_input(p_room text,p_user_id uuid,p_seq bigint,p_x double precision,p_y double precision)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.dabrawl_prototype_matches%rowtype; players jsonb; player jsonb; k text:=p_user_id::text; ax double precision; ay double precision;
begin
  if p_x is null or p_y is null or abs(p_x)>1 or abs(p_y)>1 then raise exception 'Invalid input axes'; end if;
  select * into m from public.dabrawl_prototype_matches where room=p_room for update; if not found then raise exception 'Room not found'; end if;
  players:=m.state->'players'; player:=players->k; if player is null then raise exception 'Player is not in this room'; end if;
  if p_seq<=coalesce((player->>'seq')::bigint,0) then return m.state; end if;
  ax:=p_x; ay:=p_y; if abs(ax)+abs(ay)>1 then ax:=ax/sqrt(ax*ax+ay*ay); ay:=ay/sqrt(ax*ax+ay*ay); end if;
  player:=jsonb_set(player,'{input}',jsonb_build_object('x',ax,'y',ay),true); player:=jsonb_set(player,'{seq}',to_jsonb(p_seq),true);
  players:=players||jsonb_build_object(k,player); m.state:=jsonb_set(m.state,'{players}',players,true);
  update public.dabrawl_prototype_matches set state=m.state,updated_at=now() where room=p_room; return m.state;
end; $$;

create or replace function public.dabrawl_prototype_step(p_room text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.dabrawl_prototype_matches%rowtype; players jsonb; k text; player jsonb; inp jsonb; elapsed double precision; dt double precision; nx double precision; ny double precision; now_at timestamptz:=clock_timestamp();
begin
  select * into m from public.dabrawl_prototype_matches where room=p_room for update; if not found then raise exception 'Room not found'; end if;
  elapsed:=extract(epoch from (now_at-m.last_tick_at))*1000; if elapsed<45 then return m.state; end if; dt:=least(elapsed,100)/1000.0;
  players:=coalesce(m.state->'players','{}'::jsonb);
  for k,player in select key,value from jsonb_each(players) loop
    inp:=coalesce(player->'input','{"x":0,"y":0}'::jsonb);
    nx:=greatest(32,least(768,coalesce((player->>'x')::double precision,400)+coalesce((inp->>'x')::double precision,0)*210*dt));
    ny:=greatest(32,least(488,coalesce((player->>'y')::double precision,260)+coalesce((inp->>'y')::double precision,0)*210*dt));
    player:=jsonb_set(player,'{x}',to_jsonb(nx),true); player:=jsonb_set(player,'{y}',to_jsonb(ny),true); players:=players||jsonb_build_object(k,player);
  end loop;
  m.state:=jsonb_set(m.state,'{players}',players,true); m.state:=jsonb_set(m.state,'{tick}',to_jsonb(coalesce((m.state->>'tick')::bigint,0)+1),true);
  update public.dabrawl_prototype_matches set state=m.state,last_tick_at=now_at,updated_at=now_at where room=p_room; return m.state;
end; $$;

create or replace function public.dabrawl_prototype_leave(p_room text,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.dabrawl_prototype_matches%rowtype; players jsonb; player jsonb; k text:=p_user_id::text;
begin
  select * into m from public.dabrawl_prototype_matches where room=p_room for update; if not found then return '{}'::jsonb; end if;
  players:=coalesce(m.state->'players','{}'::jsonb); player:=players->k;
  if player is not null then player:=jsonb_set(player,'{connected}','false'::jsonb,true); players:=players||jsonb_build_object(k,player); m.state:=jsonb_set(m.state,'{players}',players,true); update public.dabrawl_prototype_matches set state=m.state,updated_at=now() where room=p_room; end if;
  return m.state;
end; $$;

revoke all on function public.dabrawl_prototype_join(text,uuid) from public,anon,authenticated;
revoke all on function public.dabrawl_prototype_input(text,uuid,bigint,double precision,double precision) from public,anon,authenticated;
revoke all on function public.dabrawl_prototype_step(text) from public,anon,authenticated;
revoke all on function public.dabrawl_prototype_leave(text,uuid) from public,anon,authenticated;
grant execute on function public.dabrawl_prototype_join(text,uuid) to service_role;
grant execute on function public.dabrawl_prototype_input(text,uuid,bigint,double precision,double precision) to service_role;
grant execute on function public.dabrawl_prototype_step(text) to service_role;
grant execute on function public.dabrawl_prototype_leave(text,uuid) to service_role;
