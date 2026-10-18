const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
import { movePlayerWithObstacles, PLAYER_RADIUS } from "./world.js";

// Pure, deterministic combat policy. The server owns movement, cooldowns, damage and outcomes.
export function decideBotAction(bot, players, world, at=Date.now()) {
  if (!bot || !Array.isArray(players) || !world || !Number.isFinite(bot.x) || !Number.isFinite(bot.y)) {
    throw new TypeError("Invalid bot decision inputs");
  }
  const enemies=players.filter(p=>p && p.id!==bot.id && p.alive && p.connected!==false && p.team!==bot.team && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!bot.alive || !enemies.length) return {input:{x:0,y:0},aim:Number.isFinite(bot.aim)?bot.aim:0,action:null,targetId:null};
  enemies.sort((a,b)=>Math.hypot(a.x-bot.x,a.y-bot.y)-Math.hypot(b.x-bot.x,b.y-bot.y));
  const target=enemies[0], dx=target.x-bot.x, dy=target.y-bot.y, distance=Math.max(1,Math.hypot(dx,dy));
  const aim=Math.atan2(dy,dx), stats=bot.brawler==="saiyan" && bot.form>0 ? ({1:65,2:420,3:440,4:140,5:180}[bot.form]||180) : ({kuku:230,shachi:160,saiyan:65}[bot.brawler]||230);
  // Keep a brawler-specific preferred range, but evaluate actual collision-safe
  // steps so bots can route around walls instead of repeatedly walking into them.
  const preferredRange=stats*(bot.brawler==="shachi"?.48:.58);
  const strafe=((Math.floor(at/900)+(bot.slot||0))%2===0)?1:-1;
  const candidates=[];
  for(let i=0;i<16;i++){
    const angle=i*Math.PI/8, vx=Math.cos(angle), vy=Math.sin(angle);
    const next=movePlayerWithObstacles(bot.x,bot.y,vx*24,vy*24,world,PLAYER_RADIUS);
    const moved=Math.hypot(next.x-bot.x,next.y-bot.y);
    const nextDistance=Math.hypot(target.x-next.x,target.y-next.y);
    const progress=Math.abs(nextDistance-preferredRange);
    const strafeDot=(vx*(-dy/distance)+vy*(dx/distance))*strafe;
    candidates.push({vx,vy,moved,score:progress+(moved<1?22:0)-strafeDot*4});
  }
  candidates.sort((a,b)=>a.score-b.score);
  let vx=0,vy=0;
  if(candidates[0]?.moved>1){vx=candidates[0].vx;vy=candidates[0].vy;}
  const action=bot.brawler==="saiyan" && bot.form<5 && bot.meter>=50 && bot.transformUntil<=at ? "transform"
    : bot.meter>=100 && at-(bot.lastSuper||0)>=1200 ? "super"
    : at-(bot.lastFire||0)>=(bot.brawler==="shachi"?1200:1600) ? "fire"
    : (bot.gadgetReadyAt||0)<=at && distance>stats*.8 && distance<stats*1.8 ? "gadget" : null;
  return {input:{x:clamp(vx,-1,1),y:clamp(vy,-1,1)},aim,action,targetId:target.id};
}
