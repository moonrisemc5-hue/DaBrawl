import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before using DaBrawl multiplayer.');
}

export const supabase = createClient(url, key);

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Sign in before using multiplayer.');
  return data.user;
}

export async function createRoom(characterId = null) {
  const user = await requireUser();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomCode = makeRoomCode();
    const { data: room, error } = await supabase
      .from('game_rooms')
      .insert({ room_code: roomCode, host_id: user.id })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') continue;
      throw error;
    }

    const { error: playerError } = await supabase.from('game_room_players').insert({
      room_id: room.id,
      user_id: user.id,
      player_slot: 1,
      character_id: characterId,
      is_ready: false,
    });

    if (playerError) {
      await supabase.from('game_rooms').delete().eq('id', room.id);
      throw playerError;
    }
    return { ...room, players: [{ user_id: user.id, player_slot: 1, character_id: characterId, is_ready: false }] };
  }
  throw new Error('Could not allocate a unique room code. Try again.');
}

export async function joinRoom(roomCode, characterId = null) {
  await requireUser();
  const code = String(roomCode).trim().toUpperCase();
  const { data: roomId, error } = await supabase.rpc('join_dabrawl_room', {
    p_room_code: code,
    p_character_id: characterId,
  });
  if (error) throw new Error(error.message || 'Could not join that room.');
  const { data: room, error: roomError } = await supabase
    .from('game_rooms').select('*').eq('id', roomId).single();
  if (roomError) throw roomError;
  return room;
}

export async function setReady(roomId, isReady, characterId = null) {
  const user = await requireUser();
  const { data, error } = await supabase.from('game_room_players')
    .update({ is_ready: Boolean(isReady), character_id: characterId })
    .eq('room_id', roomId).eq('user_id', user.id).select('*').single();
  if (error) throw error;
  return data;
}

export function watchRoom(roomId, onChange) {
  const channel = supabase.channel(`dabrawl-room-${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_room_players', filter: `room_id=eq.${roomId}` }, () => onChange())
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

export async function getRoomState(roomId) {
  const { data: room, error: roomError } = await supabase.from('game_rooms').select('*').eq('id', roomId).single();
  if (roomError) throw roomError;
  const { data: players, error: playersError } = await supabase.from('game_room_players')
    .select('user_id, player_slot, character_id, is_ready, joined_at')
    .eq('room_id', roomId).order('player_slot');
  if (playersError) throw playersError;
  return { ...room, players };
}
