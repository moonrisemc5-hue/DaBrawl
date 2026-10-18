# Browser-client integration contract

This document is the safety checklist for connecting the existing browser game to the separate authoritative WebSocket service. It is documentation only: it does not change the live game or Supabase Realtime path.

## Existing browser contract (from `index.html`)

The current match client joins a Supabase Realtime channel named `dabrawl-match-<matchId>` and listens for:

- `match-state`: `payload.players[]`
- `player-state`: `payload.player`
- `player-action`: action payloads consumed by `DaBrawlGame.applyRemoteAction`
- `match-ended` and `match-control`: match UI / rematch lifecycle

Game state uses fields such as `id`, `x`, `y`, `a`, `hp`, `mh`, `alive`, `sc`, `am`, `cd`, `gcd`, `kcd`, `tf`, `tfn`, `form`, `chg`, `holdT`, `hw`, `muiCharging`, `burst`, `bt`, `dash`, `dodge`, `kaioken`, `ss2`, `ss2Cooldown`, `walk`, `rec`, `fl`, `sw`, `sd`, `nh`, `mx`, and `my`. The game exposes `startNetworkGame(roster, matchId, mode, localId, hostId, startAt)`, `getLocalState()`, `getNetworkStates()`, `applyRemoteState(state)`, and `applyRemoteAction(msg)`.

The new service instead sends `state` snapshots shaped as `{ state: { mode, phase, startedAt, endsAt, winner, ownerId, tick, players, projectiles } }`, plus `event` packets. Its player schema currently uses `id`, `name`, `brawler`, `team`, `slot`, `x`, `y`, `aim`, `hp`, `maxHp`, `alive`, `meter`, `form`, `transforming`, `connected`, and `ready`. These are not interchangeable without a mapping layer.

## Required adapter mappings

| Concern | Browser representation | Server representation / required work |
|---|---|---|
| Position | `x`, `y` | Same coordinate names, but reconcile world dimensions, collision, and movement speed before enabling |
| Facing | `a` | `aim`; map to the game angle convention and clamp consistently |
| Health | `hp`, `mh`, `alive` | `hp`, `maxHp`, `alive`; map `maxHp` to `mh` |
| Super meter | `sc` / game-specific charging fields | `meter`; determine exact units and when meter is awarded |
| Character identity | roster brawler id / `p.b` | `brawler`; normalize ids explicitly rather than defaulting unknown characters |
| Transform state | `tf`, `tfn`, `form`, and character-specific fields | `transforming`, `form`; preserve character-specific forms only after rules are ported |
| Display name | Roster/player display name | Adapter preserves `name`; confirm roster ownership and fallback behavior before UI integration |
| Gadget state | `chg` and `gcd` (browser-specific units) | Adapter preserves `gadgetCharges` and `gadgetCooldownMs` as explicitly named values; convert units only after verifying the browser's exact contract |
| Projectiles and hits | `applyRemoteAction` action names such as `damage`, `wall-break`, `transform`, `hit-feedback` | Server `event` names such as `attack-fired`, `super-fired`, `hit`, `knockout`, `transform`, `gadget`; map each intentionally |
| Lifecycle | channel events `match-ended`, `match-control` | Server phases `waiting`, `countdown`, `playing`, `ended`; provide client-side UI translation |
| Bot simulation | host browser includes bots in `getNetworkStates()` | Server has no bot AI yet; do not assume parity |
| Terrain | browser can broadcast `wall-break` | server uses tile-based walls/water for movement and projectile collision; wall-break events must be mapped into browser terrain updates |

## Safe integration sequence

1. **Keep existing Realtime live.** Do not redirect or remove its broadcasts as part of adapter work.
2. **Normalize identities and roster first.** Ensure the server receives the actual authenticated user id, selected brawler id, roster order, team/mode, and a stable match id. Reject mismatches rather than silently assigning a default character.
3. **Pure adapter module added.** `client-adapter.js` normalizes server snapshots, player names, player fields, gadget charge/cooldown values, projectiles, lifecycle events, acknowledgements, and errors into a browser-facing schema. Gadget timing remains in explicit server units rather than guessing browser-specific units. Its tests are included in the server checks. It intentionally does not open a socket, mutate gameplay, or turn server-confirmed hits into client-side damage. This is a mapping foundation, not full gameplay parity.
4. **Add an opt-in development connection path.** Use a separate test match and feature flag; never let a client connect to both authorities for the same match.
5. **Move authority one category at a time.** Server must own movement, cooldowns, damage, health, knockouts, meter, transformations, gadget effects, match clocks, and winner selection. Client must not apply duplicate local damage or allow remote clients to authoritatively report hits.
6. **Port game rules before parity claims.** Match the browser's map bounds, obstacles/wall breaking, all brawler stats, forms, abilities, hitboxes, cooldowns, bots, and animation/effect events. Current server's simplified rules are not a full port.
7. **Verify 2-player, 3v3, reconnect, late join, disconnect during countdown, rematch, browser backgrounding, and server restart.** Confirm teams and roster are identical for every client.
8. **Only after repeatable tests**, add a deliberate rollout switch and rollback plan. Do not deploy or incur hosting costs without explicit approval.

## Non-goals / current limitations

- This contract does not connect the server to the browser game.
- It does not deploy the Node service or change hosting.
- The Node service stores rooms in memory; restart recovery is not implemented.
- The existing Supabase Edge Function prototype and the live Realtime match path remain separate.
