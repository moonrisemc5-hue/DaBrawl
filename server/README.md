# DaBrawl persistent match server (deployment foundation)

This is a separate Node.js/WebSocket service intended for a persistent host (for example, a container service). It is deliberately separate from GitHub Pages and from the existing Supabase Edge Function prototype. It validates Supabase access tokens and owns room state, movement, basic projectile simulation, health, transformations, super-meter, knockouts, and match clocks in server memory.

## Important status

This service is **not yet connected to live DaBrawl matches**. The current browser game has more nuanced brawler-specific attacks and collision rules than this first server engine. Do not switch production matchmaking to it until the client protocol and all brawler rules are ported and verified. The existing Supabase Realtime path remains untouched.

## Host

Deploy this directory as a Node 20+ container. Build from the repository root with `server/Dockerfile` or set the build context to `server/`. Configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the DaBrawl Supabase project. Start command: `npm start`; health endpoint: `/health`; WebSocket path: `/match?room=ROOM_CODE`. Do not add a service-role key.

## Wire protocol

Authenticate with WebSocket subprotocols `jwt-<Supabase access token>` and `dabrawl-v1`. Send `join` with a player name, brawler id, and mode after connection. Then send sequenced `input` messages (`x`, `y`, `aim`) and action messages (`fire`, `super`, `transform`, `gadget`). The server sends complete `state` snapshots, `ack`, `event`, and `reconnect-required` messages. Server process restart currently ends in-memory rooms; durable room recovery is a separate task.
