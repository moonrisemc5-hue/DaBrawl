const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
import { movePlayerWithObstacles, PLAYER_RADIUS } from "./world.js";
import { getBrawlerStats } from "./brawlers.js";

const CELL=48;
function pointBlocked(x,y,world){
  if(x<world.margin+PLAYER_RADIUS||y<world.margin+PLAYER_RADIUS||x>world.width-world.margin-PLAYER_RADIUS||y>world.height-world.margin-PLAYER_RADIUS)return true;
  return (world.obstacles||[]).some(o=>{
    const nx=Math.max(o.x,Math.min(x,o.x+o.width)),ny=Math.max(o.y,Math.min(y,o.y+o.height));
    return Math.hypot(x-nx,y-ny)<PLAYER_RADIUS-1e-7;
  });
}
function lineBlocked(x1,y1,x2,y2,world){
  const dx=x2-x1,dy=y2-y1,d=Math.hypot(dx,dy),steps=Math.ceil(d/12);
  for(let i=1;i<steps;i++){const u=i/steps;if(pointBlocked(x1+dx*u,y1+dy*u,world))return true;}
  return false;
}
function gridPoint(index,cols,world){
  const x=(index%cols+.5)*CELL,y=(Math.floor(index/cols)+.5)*CELL;
  return {x:clamp(x,world.margin+PLAYER_RADIUS,world.width-world.margin-PLAYER_RADIUS),y:clamp(y,world.margin+PLAYER_RADIUS,world.height-world.margin-PLAYER_RADIUS)};
}
function findRoute(bot,goalX,goalY,world,coverTarget=null){
  const cols=Math.ceil(world.width/CELL),rows=Math.ceil(world.height/CELL),total=cols*rows;
  const sx=clamp(Math.floor(bot.x/CELL),0,cols-1),sy=clamp(Math.floor(bot.y/CELL),0,rows-1),start=sy*cols+sx;
  const gx=clamp(Math.floor(goalX/CELL),0,cols-1),gy=clamp(Math.floor(goalY/CELL),0,rows-1);
  const parent=new Int32Array(total),distance=new Int32Array(total),queue=new Int32Array(total);parent.fill(-2);distance.fill(1e9);
  let head=0,tail=0;queue[tail++]=start;parent[start]=-1;distance[start]=0;
  const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  while(head<tail){
    const id=queue[head++],from=gridPoint(id,cols,world),cx=id%cols,cy=Math.floor(id/cols);
    for(const [dx,dy] of dirs){
      const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=cols||ny>=rows)continue;
      const ni=ny*cols+nx;if(parent[ni]!==-2)continue;
      const to=gridPoint(ni,cols,world);if(pointBlocked(to.x,to.y,world))continue;
      const moved=movePlayerWithObstacles(from.x,from.y,to.x-from.x,to.y-from.y,world,PLAYER_RADIUS);
      if(Math.hypot(moved.x-to.x,moved.y-to.y)>2)continue; // Do not route through a wall corner.
      parent[ni]=id;distance[ni]=distance[id]+(dx&&dy?1.4142:1);queue[tail++]=ni;
    }
  }
  let goal=gy*cols+gx;
  if(coverTarget){
    let best=-Infinity,found=-1;
    for(let i=0;i<tail;i++){
      const id=queue[i],point=gridPoint(id,cols,world);
      if(!lineBlocked(coverTarget.x,coverTarget.y,point.x,point.y,world))continue;
      const gap=Math.hypot(point.x-coverTarget.x,point.y-coverTarget.y);if(gap<80)continue;
      const score=Math.min(gap,480)*.42-distance[id]*CELL*.50;
      if(score>best){best=score;found=id;}
    }
    if(found>=0)goal=found;
  }
  if(parent[goal]===-2){
    let best=-1,score=Infinity;
    for(let i=0;i<tail;i++){const id=queue[i],p=gridPoint(id,cols,world),v=Math.hypot(p.x-goalX,p.y-goalY)+distance[id]*CELL*.18;if(v<score){score=v;best=id;}}
    if(best<0)return {x:0,y:0};goal=best;
  }
  if(goal===start){
    const dx=goalX-bot.x,dy=goalY-bot.y,length=Math.hypot(dx,dy);
    if(!coverTarget&&length>1&&!lineBlocked(bot.x,bot.y,goalX,goalY,world))return {x:dx/length,y:dy/length};
    return {x:0,y:0};
  }
  let first=goal,guard=0;while(parent[first]>=0&&parent[first]!==start&&guard++<total)first=parent[first];
  const point=gridPoint(first,cols,world),dx=point.x-bot.x,dy=point.y-bot.y,l=Math.hypot(dx,dy)||1;
  return {x:dx/l,y:dy/l};
}
function predictiveAim(bot,target,speed,maxTime=1){
  let vx=Number(target.aiVx??target.netVx)||0,vy=Number(target.aiVy??target.netVy)||0;
  const maxV=Math.max(180,(getBrawlerStats(target).speed||150)*1.55),v=Math.hypot(vx,vy);
  if(v>maxV){vx*=maxV/v;vy*=maxV/v;}
  const velocity=Math.max(1,speed||430);let time=Math.min(maxTime,Math.hypot(target.x-bot.x,target.y-bot.y)/velocity),x=target.x,y=target.y;
  for(let i=0;i<3;i++){x=target.x+vx*time;y=target.y+vy*time;time=Math.min(maxTime,Math.hypot(x-bot.x,y-bot.y)/velocity);}
  return {x,y};
}
function dodgeVector(bot,projectiles,world){
  let dx=0,dy=0,threat=0;
  for(const shot of projectiles){
    if(!shot||shot.ownerId===bot.id||shot.team===bot.team)continue;
    const angle=Number(shot.angle)||0,speed=Math.max(0,Number(shot.speed)||0);
    const vx=Number.isFinite(shot.vx)?shot.vx:Math.cos(angle)*speed,vy=Number.isFinite(shot.vy)?shot.vy:Math.sin(angle)*speed;
    const rx=bot.x-shot.x,ry=bot.y-shot.y,v2=vx*vx+vy*vy;if(v2<1)continue;
    const time=Math.max(0,Math.min(.5,(rx*vx+ry*vy)/v2));
    const gap=Math.hypot(bot.x-(shot.x+vx*time),bot.y-(shot.y+vy*time));
    const radius=PLAYER_RADIUS+(Number(shot.radius)||7)+17;
    if(gap>=radius||time>.5)continue;
    const side=(rx*vy-ry*vx)>=0?1:-1,weight=(radius-gap)/radius*(1-time*.65),length=Math.hypot(vx,vy)||1;
    const a={x:-vy/length*side,y:vx/length*side},b={x:-a.x,y:-a.y};
    const safe=dir=>{
      const n=movePlayerWithObstacles(bot.x,bot.y,dir.x*30,dir.y*30,world,PLAYER_RADIUS);
      return Math.hypot(n.x-bot.x,n.y-bot.y)>15;
    };
    const chosen=safe(a)?a:safe(b)?b:null;if(chosen){dx+=chosen.x*weight;dy+=chosen.y*weight;threat=Math.max(threat,weight);}
  }
  return {x:dx,y:dy,threat};
}
function enemiesFor(bot,players){return players.filter(p=>p&&p.id!==bot.id&&p.alive&&p.connected!==false&&p.team!==bot.team&&Number.isFinite(p.x)&&Number.isFinite(p.y));}
// Pure, deterministic combat policy. The server owns movement, cooldowns, damage and outcomes.
export function decideBotAction(bot,players,world,at=Date.now(),projectiles=[]){
  if(!bot||!Array.isArray(players)||!world||!Number.isFinite(bot.x)||!Number.isFinite(bot.y))throw new TypeError("Invalid bot decision inputs");
  // A live takeover disables every autonomous bot decision until control expires.
  if(bot.hackedById&&Number(bot.hackUntil)>at)return {input:{x:0,y:0},aim:Number.isFinite(bot.aim)?bot.aim:0,action:null,targetId:null,gadgetTargetId:null};
  const enemies=enemiesFor(bot,players),stats=getBrawlerStats(bot);
  const smokeHealReady=bot.brawler==='deges'&&bot.hp/Math.max(1,bot.maxHp)<=.38&&(bot.gadgetReadyAt||0)<=at;
  if(!bot.alive||!enemies.length){
    return {input:{x:0,y:0},aim:Number.isFinite(bot.aim)?bot.aim:0,action:smokeHealReady?"gadget":null,targetId:null,gadgetTargetId:null};
  }
  enemies.sort((a,b)=>Math.hypot(a.x-bot.x,a.y-bot.y)-Math.hypot(b.x-bot.x,b.y-bot.y));
  const health=bot.hp/Math.max(1,bot.maxHp),visibleDegeš=enemies.filter(p=>p.brawler==='deges'&&Math.hypot(p.x-bot.x,p.y-bot.y)<650&&!lineBlocked(bot.x,bot.y,p.x,p.y,world));
  visibleDegeš.sort((a,b)=>Math.hypot(a.x-bot.x,a.y-bot.y)-Math.hypot(b.x-bot.x,b.y-bot.y));
  const degesGap=visibleDegeš.length?Math.hypot(visibleDegeš[0].x-bot.x,visibleDegeš[0].y-bot.y):Infinity;
  const fearsDegeš=visibleDegeš.length>0&&health<.36&&degesGap<380,attacksDegeš=visibleDegeš.length>0&&health>=.55;
  const target=(fearsDegeš||attacksDegeš)?visibleDegeš[0]:enemies[0],dx=target.x-bot.x,dy=target.y-bot.y,distance=Math.max(1,Math.hypot(dx,dy));
  const retreats=health<.25||fearsDegeš,recentHit=Number.isFinite(bot.lastHitAt)&&at-bot.lastHitAt<850;
  const postShotCover=Boolean(bot.lastFire&&at-bot.lastFire<550&&Math.floor((bot.lastFire+(bot.slot||0)*337)/4200)%4===0);
  const cover=retreats||(recentHit&&health<.48)||(bot.aiCoverUntil||0)>at||postShotCover;
  const preferredRange=stats.range*(bot.brawler==='shachi'?.48:.58);
  let input;
  if(cover){
    const safeRoute=findRoute(bot,bot.x+(bot.x-target.x)/distance*480,bot.y+(bot.y-target.y)/distance*480,world,target);
    input=safeRoute;
    if(Math.hypot(input.x,input.y)<.01&&!visibleDegeš.length&&health>=.34){
      input=findRoute(bot,bot.x+(bot.x-target.x)/distance*320,bot.y+(bot.y-target.y)/distance*320,world);
    }
  }else{
    const squad=players.filter(p=>p.alive&&p.team===bot.team).sort((a,b)=>(a.slot||0)-(b.slot||0)),lane=squad.indexOf(bot)-(squad.length-1)/2;
    const flankX=target.x-(dy/distance)*lane*96,flankY=target.y+(dx/distance)*lane*96;
    const route=findRoute(bot,flankX,flankY,world),desired=preferredRange;
    const next=movePlayerWithObstacles(bot.x,bot.y,route.x*24,route.y*24,world,PLAYER_RADIUS);
    const nextGap=Math.hypot(target.x-next.x,target.y-next.y),forward=nextGap>desired+35?1:nextGap<desired-35?-1:0;
    const strafe=((Math.floor(at/900)+(bot.slot||0))%2===0)?1:-1;
    let sx=0,sy=0;for(const ally of squad){if(ally===bot)continue;let ax=bot.x-ally.x,ay=bot.y-ally.y,gap=Math.hypot(ax,ay);if(gap<150){if(gap<1){const a=(bot.slot||0)*2.399;ax=Math.cos(a);ay=Math.sin(a);gap=1;}const weight=(150-gap)/150;sx+=ax/gap*weight;sy+=ay/gap*weight;}}
    input={x:route.x*forward+route.y*strafe*.36+sx*.85,y:route.y*forward-route.x*strafe*.36+sy*.85};
  }
  const dodge=dodgeVector(bot,Array.isArray(projectiles)?projectiles:[],world);
  if(dodge.threat>0){input.x+=dodge.x*(1.5+dodge.threat);input.y+=dodge.y*(1.5+dodge.threat);}
  const magnitude=Math.hypot(input.x,input.y);if(magnitude>1){input.x/=magnitude;input.y/=magnitude;}
  const projectileSpeed=bot.brawler==='deges'?stats.bulletSpeed:(stats.bulletSpeed||550),lead=predictiveAim(bot,target,projectileSpeed,bot.brawler==='deges'?.85:.65);
  const aim=Math.atan2(lead.y-bot.y,lead.x-bot.x),hasShotLine=!lineBlocked(bot.x,bot.y,target.x,target.y,world);
  const readyToFire=at-(bot.lastFire||0)>=stats.cooldown;
  const action=bot.brawler==='saiyan'&&bot.form<5&&bot.meter>=50&&bot.transformUntil<=at?"transform"
    :bot.meter>=100&&at-(bot.lastSuper||0)>=1200?"super"
    :smokeHealReady?"gadget"
    :readyToFire&&hasShotLine?"fire":null;
  return {input,aim,action,targetId:target.id,gadgetTargetId:null};
}
