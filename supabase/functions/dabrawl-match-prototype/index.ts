import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  const upgrade = (req.headers.get("upgrade") || "").toLowerCase();
  if (upgrade !== "websocket") {
    return new Response(JSON.stringify({
      ok: true,
      prototype: "dabrawl-match-prototype",
      stage: "transport-check",
      note: "Isolated WebSocket timing/authentication test. Does not replace live matchmaking.",
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  const protocols = (req.headers.get("sec-websocket-protocol") || "").split(",").map(p => p.trim());
  const tokenProtocol = protocols.find(p => p.startsWith("jwt-"));
  const token = tokenProtocol?.slice(4);
  const room = (new URL(req.url).searchParams.get("room") || "").trim().slice(0, 80);
  if (!token || token.length > 8192 || !room || !protocols.includes("dabrawl-prototype")) {
    return new Response("Missing auth protocol or room", { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !publishableKey) {
    return new Response("Supabase auth environment is not configured", { status: 500 });
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user) return new Response("Unauthorized", { status: 401 });

  const { socket, response } = Deno.upgradeWebSocket(req, { protocol: "dabrawl-prototype", idleTimeout: 0 });
  const startedAt = Date.now();
  let closed = false;
  let tick = 0;
  let interval: number | undefined;
  let closeTimer: number | undefined;
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => { resolveClosed = resolve; });
  // @ts-ignore Supabase Edge Runtime provides EdgeRuntime.waitUntil.
  EdgeRuntime.waitUntil(closedPromise);

  const send = (data: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
  };

  socket.onopen = () => {
    send({ type: "connected", room, userId: user.id, serverTime: Date.now(), maxSessionMs: 110000 });
    interval = setInterval(() => {
      tick++;
      send({ type: "server-tick", tick, serverTime: Date.now(), elapsedMs: Date.now() - startedAt });
    }, 100) as unknown as number;
    closeTimer = setTimeout(() => {
      send({ type: "reconnect-required", reason: "prototype-session-limit", elapsedMs: Date.now() - startedAt });
      socket.close(1012, "Prototype session restart");
    }, 110000) as unknown as number;
  };

  socket.onmessage = (event) => {
    if (typeof event.data !== "string" || event.data.length > 4096) {
      send({ type: "error", message: "Invalid message" });
      return;
    }
    try {
      const message = JSON.parse(event.data);
      if (message?.type === "ping") {
        send({ type: "pong", clientSentAt: Number(message.clientSentAt) || 0, serverTime: Date.now() });
      } else if (message?.type === "input") {
        send({ type: "input-ack", seq: Number(message.seq) || 0, serverTime: Date.now(), accepted: true });
      } else {
        send({ type: "error", message: "Unsupported prototype message" });
      }
    } catch {
      send({ type: "error", message: "Malformed JSON" });
    }
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (interval !== undefined) clearInterval(interval);
    if (closeTimer !== undefined) clearTimeout(closeTimer);
    resolveClosed();
  };
  socket.onerror = cleanup;
  socket.onclose = cleanup;
  return response;
});
