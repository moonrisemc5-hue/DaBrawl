# DaBrawl Supabase match-server prototype

This is an isolated transport experiment. It does not change the existing Realtime party/matchmaking implementation.

## Current stage: WebSocket timing and authentication
- Validates a signed-in Supabase user using their access token.
- Sends a server-generated tick every 100 ms.
- Measures ping and acknowledges input-test messages.
- Closes after 110 seconds so reconnect handling can be tested.
- Does **not** yet simulate players, attacks, bots, damage, or a shared match state.

## Test page
After GitHub Pages publishes the commit, open:
`https://moonrisemc5-hue.github.io/DaBrawl/supabase/prototype-test.html`

Sign in with an existing DaBrawl account. Open the page in two browsers/devices to compare tick and ping behavior. Use the same test-room label only for convenience; the current stage does not yet share room state between connections.

## Endpoint
`https://xqbfjpjdweibdbpeefze.supabase.co/functions/v1/dabrawl-match-prototype`

A normal HTTP GET returns a health/description response. WebSocket authentication uses the `jwt-<access token>` subprotocol rather than putting the token in the URL.

The next stage must add durable, atomic shared match state and reconnect/replay before this can be used for actual matches. Supabase Edge Functions have finite execution limits; this prototype intentionally does not claim to be a persistent dedicated game server.
