# DaBrawl persistent match server (deployment foundation)

This is a separate Node.js/WebSocket service intended for a persistent host (for example, a container service). It is deliberately separate from GitHub Pages and from the existing Supabase Edge Function prototype. It validates Supabase access tokens and owns room state, movement, basic projectile simulation, health, transformations, super-meter, knockouts, readiness, and match clocks in server memory. It limits rooms and per-socket message rates, validates input payloads, and does not echo the access token as the negotiated WebSocket subprotocol.

## Important status

This service is **not yet connected to live DaBrawl matches**. The server now includes explicit baseline rules for Kuku, Shachi and Saiyan, including Shachi's slam and Saiyan's transform super. This is not yet a full port: terrain, exact ability timings, form-specific stats, gadgets and bot AI still need to be reconciled with the browser game. Do not switch production matchmaking to it until the client protocol and all brawler rules are ported and verified. The existing Supabase Realtime path remains untouched.

## Host

Deploy this directory as a Node 20+ container. Build from the repository root with `server/Dockerfile` or set the build context to `server/`. Configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the DaBrawl Supabase project. Start command: `npm start`; health endpoint: `/health`; WebSocket path: `/match?room=ROOM_CODE`. Do not add a service-role key.

## Local checks

Run `npm run check` and `npm test` from this directory. The unit tests cover message parsing, room-code validation, movement-axis validation, supported modes, and player-name sanitization.

## Wire protocol

Authenticate with WebSocket subprotocols `jwt-<Supabase access token>` and `dabrawl-v1`. Send `join` with a player name, brawler id, and mode after connection. Then send sequenced `input` messages (`x`, `y`, `aim`) and action messages (`fire`, `super`, `transform`, `gadget`). The server sends complete `state` snapshots, `ack`, and `event` messages. If the process restarts, clients receive a WebSocket close (code 1012); in-memory rooms are lost, so durable room recovery is still a separate task.
