const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));

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
  let toward=distance>stats*.68?1:distance<stats*.30 && bot.brawler==="shachi"?-1:0;
  // Deterministic strafing breaks stationary duels without random test flakiness.
  const strafe=((Math.floor(at/900)+(bot.slot||0))%2===0)?1:-1;
  let vx=dx/distance*toward + (-dy/distance)*strafe*.62;
  let vy=dy/distance*toward + (dx/distance)*strafe*.62;
  const magnitude=Math.hypot(vx,vy); if(magnitude>1){vx/=magnitude;vy/=magnitude;}
  const action=bot.brawler==="saiyan" && bot.form<5 && bot.meter>=50 && bot.transformUntil<=at ? "transform"
    : bot.meter>=100 && at-(bot.lastSuper||0)>=1200 ? "super"
    : at-(bot.lastFire||0)>=(bot.brawler==="shachi"?1200:1600) ? "fire"
    : (bot.gadgetReadyAt||0)<=at && distance>stats*.8 && distance<stats*1.8 ? "gadget" : null;
  return {input:{x:clamp(vx,-1,1),y:clamp(vy,-1,1)},aim,action,targetId:target.id};
}
