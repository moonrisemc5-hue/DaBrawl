import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
Deno.serve(async (req: Request) => {
  if ((req.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
    return new Response(JSON.stringify({ok:true,prototype:"dabrawl-match-prototype",stage:"authoritative-movement",note:"Isolated two-player server-authoritative movement test. Not connected to live combat or matchmaking."}),{headers:{...cors,"Content-Type":"application/json"}});
  }
  const protocols=(req.headers.get("sec-websocket-protocol")||"").split(",").map(p=>p.trim());
  const tokenProtocol=protocols.find(p=>p.startsWith("jwt-"));
  const token=tokenProtocol?.slice(4);
  const room=(new URL(req.url).searchParams.get("room")||"").trim().slice(0,80);
  if(!token||token.length>8192||!room||!protocols.includes("dabrawl-prototype"))return new Response("Missing auth protocol or room",{status:400});
  const url=Deno.env.get("SUPABASE_URL"),pub=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!pub||!secret)return new Response("Supabase auth or service environment is not configured",{status:500});
  const auth=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await auth.auth.getUser(token);
  if(error||!user)return new Response("Unauthorized",{status:401});
  const server=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const joined=await server.rpc("dabrawl_prototype_join",{p_room:room,p_user_id:user.id});
  if(joined.error)return new Response(joined.error.message,{status:409});
  const {socket,response}=Deno.upgradeWebSocket(req,{protocol:"dabrawl-prototype",idleTimeout:0});
  const startedAt=Date.now();let closed=false,tick=0,seq=0,interval:number|undefined,closeTimer:number|undefined,resolveClosed!:()=>void;
  const closedPromise=new Promise<void>(resolve=>{resolveClosed=resolve});
  // @ts-ignore Supabase Edge Runtime provides EdgeRuntime.waitUntil.
  EdgeRuntime.waitUntil(closedPromise);
  const send=(data:unknown)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(data))};
  socket.onopen=()=>{
    send({type:"connected",room,userId:user.id,serverTime:Date.now(),maxSessionMs:110000,stage:"authoritative-movement"});
    send({type:"match-state",state:joined.data,serverTime:Date.now()});
    interval=setInterval(async()=>{
      if(closed||socket.readyState!==WebSocket.OPEN)return;
      try{const result=await server.rpc("dabrawl_prototype_step",{p_room:room});if(result.error){send({type:"error",message:"Server simulation step failed"});return}
        tick++;send({type:"match-state",state:result.data,serverTime:Date.now()});send({type:"server-tick",tick,serverTime:Date.now(),elapsedMs:Date.now()-startedAt});
      }catch{send({type:"error",message:"Temporary server simulation error"})}
    },50) as unknown as number;
    closeTimer=setTimeout(()=>{send({type:"reconnect-required",reason:"prototype-session-limit",elapsedMs:Date.now()-startedAt});socket.close(1012,"Prototype session restart")},110000) as unknown as number;
  };
  socket.onmessage=async event=>{
    if(typeof event.data!=="string"||event.data.length>4096){send({type:"error",message:"Invalid message"});return}
    try{
      const message=JSON.parse(event.data);
      if(message?.type==="ping")send({type:"pong",clientSentAt:Number(message.clientSentAt)||0,serverTime:Date.now()});
      else if(message?.type==="input"){
        const x=Number(message.x)||0,y=Number(message.y)||0,requestedSeq=Number(message.seq)||(++seq);
        if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>1||Math.abs(y)>1){send({type:"error",message:"Invalid movement input"});return}
        const result=await server.rpc("dabrawl_prototype_input",{p_room:room,p_user_id:user.id,p_seq:requestedSeq,p_x:x,p_y:y});
        if(result.error){send({type:"error",message:"Input rejected by server"});return}
        send({type:"input-ack",seq:requestedSeq,serverTime:Date.now(),accepted:true});send({type:"match-state",state:result.data,serverTime:Date.now()});
      }else send({type:"error",message:"Unsupported prototype message"});
    }catch{send({type:"error",message:"Malformed JSON or server request failed"})}
  };
  const cleanup=()=>{if(closed)return;closed=true;if(interval!==undefined)clearInterval(interval);if(closeTimer!==undefined)clearTimeout(closeTimer);void server.rpc("dabrawl_prototype_leave",{p_room:room,p_user_id:user.id});resolveClosed()};
  socket.onerror=cleanup;socket.onclose=cleanup;
  return response;
});