# DaBrawl multiplayer backend

This repository is being prepared for the separate DaBrawl Supabase project:
- Supabase project: `xqbfjpjdweibdbpeefze`
- Region: Frankfurt (`eu-central-1`)
- Project URL: `https://xqbfjpjdweibdbpeefze.supabase.co`

## Important status
The repository was empty before this setup, so the original DaBrawl game client is not present here yet. These files provide the first integration scaffold; the actual game UI must import the module for multiplayer to be connected in-game.

## Database
Migration `dabrawl_multiplayer_rooms` creates `game_rooms` and `game_room_players`, enables row-level security, and adds both tables to Supabase Realtime.

## Client setup
Use Supabase Auth to sign users in, then create a client with the project URL and the publishable key. Never put a service-role or secret key in browser code.

For local development, set:
- `VITE_SUPABASE_URL=https://xqbfjpjdweibdbpeefze.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=<your Supabase publishable key>`

Do not commit secrets or private keys.
