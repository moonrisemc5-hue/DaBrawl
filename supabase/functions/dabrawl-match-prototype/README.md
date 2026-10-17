# DaBrawl Supabase match-server prototype

This is an isolated transport experiment. It does not change the existing Realtime party/matchmaking implementation.

## Current stage: WebSocket timing and authentication
- Validates a signed-in Supabase user using their access token.
- Sends a server-generated tick every 100 ms.
- Acknowledges ping/input test messages.
- Closes after 110 seconds so the client can exercise reconnect handling.
- Does **not** yet simulate players, attacks, bots, damage, or a shared match state.

## Endpoint
`https://xqbfjpjdweibdbpeefze.supabase.co/functions/v1/dabrawl-match-prototype`

A normal HTTP GET returns a health/description response. WebSocket clients must connect with `?token=<access_token>&room=<test-room-id>`.

The next stage must add durable, atomic shared match state and reconnect/replay before this can be used for actual matches. Supabase Edge Functions have finite execution limits; this prototype intentionally does not claim to be a persistent dedicated game server.
