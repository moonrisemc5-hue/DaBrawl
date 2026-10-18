# DaBrawl persistent match server (deployment foundation)

This is a separate Node.js/WebSocket service intended for a persistent host (for example, a container service). It is deliberately separate from GitHub Pages and from the existing Supabase Edge Function prototype. It validates Supabase access tokens and owns room state, movement, basic projectile simulation, health, transformations, super-meter, knockouts, readiness, and match clocks in server memory. It limits rooms and per-socket message rates, validates input payloads, and does not echo the access token as the negotiated WebSocket subprotocol.

## Important status

This service is **not yet connected to live DaBrawl matches**. The server now includes explicit baseline rules for Kuku, Shachi and Saiyan, including Shachi's slam and sequential Saiyan form progression with form-specific health, damage, range and projectile speed. Projectile collision uses a swept segment between ticks to avoid fast shots passing through targets, and registers the first valid opponent along that segment. Saiyan's full charged beam/wall-breaking move and form-specific dodge/charge effects are not ported yet. Gadget use now has a server-owned single charge, cooldown enforcement, and cooldown values matching the browser's visible gadget timers (including Saiyan form variants); state snapshots expose charges and remaining cooldown. The server still uses a simplified 70-unit dash for accepted gadget activations, so the form-specific gadget effects are not yet gameplay-parity complete. Player movement and gadget dashes now clamp the entire player collision radius inside the arena bounds. Shared boundary helpers have regression tests and are included in the production Docker image. Actual map obstacles/walls, exact ability timings, all form-specific stats, and bot AI still need to be reconciled with the browser game. Do not switch production matchmaking to it until the client protocol and all brawler rules are ported and verified. The existing Supabase Realtime path remains untouched.

## Host

Deploy this directory as a Node 20+ container. Set the Dockerfile path to `server/Dockerfile` and the build context to the repository root (equivalent to `docker build -f server/Dockerfile .`). Configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the DaBrawl Supabase project. Start command: `npm start`; health endpoint: `/health`; WebSocket path: `/match?room=ROOM_CODE`. Do not add a service-role key.

## Local checks

Run `npm run check` and `npm test` from this directory. Unit tests cover message parsing, room-code validation, movement-axis validation, supported modes, player-name sanitization, active-match phase guards, team assignment, browser adapter mapping, Saiyan form stats and bounded progression, gadget charge/cooldown boundaries, and deterministic projectile movement, first-contact collision filtering, swept collision, range and world bounds. GitHub Actions also builds the production Docker image so missing files or invalid container build steps are caught before deployment.

## Wire protocol

Authenticate with WebSocket subprotocols `jwt-<Supabase access token>` and `dabrawl-v1`. Send `join` with a player name, brawler id, mode, and readiness state after connection. A match starts only after at least two players have joined and every player is ready. Knockout teams split the ordered roster into two balanced sides; duel alternates sides; showdown treats each player as a separate team. Then send sequenced `input` messages (`x`, `y`, `aim`) and action messages (`fire`, `super`, `transform`, `gadget`). Combat actions are ignored outside the active `playing` phase, and projectiles are cleared outside that phase. The server sends complete `state` snapshots, `ack`, and `event` messages. If the process restarts, clients receive a WebSocket close (code 1012); in-memory rooms are lost, so durable room recovery is still a separate task.

## Live-client integration boundary

See [CLIENT-INTEGRATION.md](./CLIENT-INTEGRATION.md) for the field/event mapping and safe rollout checklist.

The current browser game still uses Supabase Realtime broadcasts (`match-state`, `player-state`, `player-action`) and a game-specific state shape (`x`, `y`, `a`, `hp`, `mh`, `sc`, `am`, and other combat fields). That wire format is not compatible with this service protocol yet. Integration must use an explicit adapter, move authority for damage and abilities to the server, and stop the browser host from simulating the same match twice. Do not simply redirect the existing broadcasts to this socket: doing so would create mismatched snapshots and desynchronized combat.
