# DaBrawl multiplayer backend

## Free test-server deployment

Use the [Render Blueprint deploy page](https://render.com/deploy?repo=https://github.com/moonrisemc5-hue/DaBrawl) to create a **free test server** from this repository. Review the proposed service before creating it, and keep the plan set to **Free**.

When Render asks for environment variables, enter the DaBrawl Supabase project's URL and its **publishable/anon client key** as `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Never use a service-role or secret key. After deployment, test `https://YOUR-SERVICE.onrender.com/health` (should return JSON with `ok: true`) and `/ready` (should return `ready: true` once the Supabase settings are valid).

This free host is for testing only: it can sleep after 15 minutes without traffic, and restarts erase in-memory rooms. **The new server is not connected to live DaBrawl matches**, so this deployment will not change the existing game.


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
