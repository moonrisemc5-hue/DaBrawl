# DaBrawl Supabase match-server prototype

This is an isolated prototype. It does **not** replace or modify the existing Realtime party/matchmaking flow in live DaBrawl matches.

## Current stage: shared server-authoritative movement
- Authenticates a signed-in DaBrawl user using their Supabase access token.
- Stores prototype room state in the isolated `public.dabrawl_prototype_matches` table.
- Uses database-locked RPC functions to join a room, accept sequenced movement inputs, advance positions on server time, and mark a player disconnected.
- Supports two players per prototype room. Both clients receive shared snapshots and can see each other's server-calculated position.
- Sends server ticks and ping responses; closes after 110 seconds so reconnect handling can be exercised.

## Not implemented yet
This is **not the full DaBrawl game server**. It does not yet simulate brawler-specific attacks, transformations, supers, hit detection, damage, bots, teams, knockout rules, or round endings. The main game's current matchmaking and client simulation remain unchanged.

## Test page
After GitHub Pages publishes the commit, open:
`https://moonrisemc5-hue.github.io/DaBrawl/supabase/prototype-test.html`

Sign in with an existing DaBrawl account. Open the page on two browsers/devices, enter the exact same room name, and connect both. Use WASD or arrow keys to move. The arena shows the shared positions received from the server. A room holds at most two signed-in users; use a fresh room name for a fresh test.

## Endpoint
`https://xqbfjpjdweibdbpeefze.supabase.co/functions/v1/dabrawl-match-prototype`

A normal HTTP GET returns a health/description response. WebSocket authentication uses the `jwt-<access token>` subprotocol rather than putting the token in the URL.

Supabase Edge Functions have finite execution limits, so this prototype still reconnects after 110 seconds and is not a permanently running dedicated game server. The next stage is to port combat and bot simulation into authoritative server rules and test them before connecting real matches.
