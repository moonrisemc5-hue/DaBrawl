create or replace function public.disband_dabrawl_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_host_id uuid;
  v_status text;
begin
  if v_user_id is null then
    raise exception 'Sign in first.';
  end if;

  select host_id, status
    into v_host_id, v_status
  from public.game_rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Room no longer exists.';
  end if;
  if v_host_id <> v_user_id then
    raise exception 'Only the room host can disband this room.';
  end if;
  if v_status <> 'waiting' then
    raise exception 'A room can only be disbanded while waiting.';
  end if;

  delete from public.game_room_players where room_id = p_room_id;
  update public.game_rooms set status = 'finished' where id = p_room_id;
end;
$function$;

revoke all on function public.disband_dabrawl_room(uuid) from public;
grant execute on function public.disband_dabrawl_room(uuid) to authenticated;
