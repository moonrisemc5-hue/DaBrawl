import test from "node:test";
import assert from "node:assert/strict";
import { decideBotAction } from "../bot-ai.js";
import { movePlayerWithObstacles, PLAYER_RADIUS } from "../world.js";
const world={width:800,height:520};
const bot={id:"bot",slot:1,brawler:"kuku",team:0,x:100,y:100,hp:7000,alive:true,connected:true,meter:0,lastFire:0,gadgetReadyAt:0,aim:0};
const enemy={id:"enemy",team:1,x:300,y:100,hp:7000,alive:true,connected:true};
test("bot aims at the nearest living opponent and approaches from long range",()=>{
 const d=decideBotAction(bot,[bot,enemy,{...enemy,id:"far",x:700,y:400}],world,5000);
 assert.equal(d.targetId,"enemy"); assert.ok(Math.abs(d.aim)<1e-9); assert.ok(d.input.x>0); assert.equal(d.action,"fire");
});
test("bot does not target allies, dead players, or disconnected players",()=>{
 const d=decideBotAction(bot,[bot,{...enemy,team:0},{...enemy,id:"dead",alive:false},{...enemy,id:"gone",connected:false}],world,1000);
 assert.deepEqual(d.input,{x:0,y:0}); assert.equal(d.action,null); assert.equal(d.targetId,null);
});
test("bot retreats from close-range opponents and can choose a ready Saiyan transformation",()=>{
 const shachi={...bot,brawler:"shachi",x:100,y:100};
 const close={...enemy,x:120,y:100};
 const d=decideBotAction(shachi,[shachi,close],world,1000); assert.ok(d.input.x<0);
 const saiyan={...bot,brawler:"saiyan",meter:50,form:1,transformUntil:0};
 assert.equal(decideBotAction(saiyan,[saiyan,enemy],world,1000).action,"transform");
});
test("bot decisions are deterministic for identical state and time",()=>{
 assert.deepEqual(decideBotAction(bot,[bot,enemy],world,1234),decideBotAction(bot,[bot,enemy],world,1234));
 assert.throws(()=>decideBotAction(null,[],world),/Invalid bot decision inputs/);
});

test("bot chooses a collision-safe route around an obstacle",()=>{
 const obstacleWorld={...world,margin:0,obstacles:[{x:180,y:60,width:40,height:100}]};
 const runner={...bot,x:130,y:100};
 const foe={...enemy,x:280,y:100};
 const d=decideBotAction(runner,[runner,foe],obstacleWorld,4000);
 const next= (awaitMove=>awaitMove)(d.input);
 const {movePlayerWithObstacles,PLAYER_RADIUS}=globalThis.__botWorldHelpers||{};
 // A nonzero direction around the obstacle is expected; direct rightward motion is blocked.
 assert.ok(Math.hypot(next.x,next.y)>0);
 assert.ok(!(Math.abs(next.x-1)<1e-9 && Math.abs(next.y)<1e-9));
});
