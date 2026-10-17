-- DaBrawl party rooms: expand from 2 to 6 slots and store each player's public username.
-- Run this once in Supabase Dashboard -> SQL Editor. This does not delete existing rows.
ALTER TABLE public.game_room_players
  ADD COLUMN IF NOT EXISTS display_name text;

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.game_room_players'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%player_slot%'
  LOOP
    EXECUTE format('ALTER TABLE public.game_room_players DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.game_room_players
  ADD CONSTRAINT game_room_players_slot_1_to_6 CHECK (player_slot BETWEEN 1 AND 6);

CREATE OR REPLACE FUNCTION public.join_dabrawl_room(
  p_room_code text,
  p_character_id text DEFAULT 'kuku'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_room public.game_rooms%ROWTYPE;
  v_slot integer;
  v_user uuid := auth.uid();
  v_name text := COALESCE(NULLIF(auth.jwt() -> 'user_metadata' ->> 'username',''), 'Player');
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in before joining a room';
  END IF;

  SELECT * INTO v_room
  FROM public.game_rooms
  WHERE upper(room_code) = upper(trim(p_room_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room code not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.game_room_players
    WHERE room_id = v_room.id AND user_id = v_user
  ) THEN
    RETURN v_room.id;
  END IF;

  SELECT COALESCE(MAX(player_slot), 0) + 1 INTO v_slot
  FROM public.game_room_players
  WHERE room_id = v_room.id;

  IF v_slot > 6 THEN
    RAISE EXCEPTION 'This room is full (6/6)';
  END IF;

  INSERT INTO public.game_room_players
    (room_id, user_id, player_slot, character_id, is_ready, display_name)
  VALUES
    (v_room.id, v_user, v_slot, COALESCE(NULLIF(p_character_id,''),'kuku'), false, v_name);

  RETURN v_room.id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.join_dabrawl_room(text, text) TO authenticated;

-- Let a signed-in player change their own ready flag, without editing another player's row.
ALTER TABLE public.game_room_players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Players can update their own ready status" ON public.game_room_players;
CREATE POLICY "Players can update their own ready status"
ON public.game_room_players
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
