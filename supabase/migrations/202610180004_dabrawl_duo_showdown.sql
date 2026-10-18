alter table public.game_rooms drop constraint if exists game_rooms_game_mode_check;
alter table public.game_rooms add constraint game_rooms_game_mode_check check (game_mode = any (array['knockout','showdown','duel','duo']));
