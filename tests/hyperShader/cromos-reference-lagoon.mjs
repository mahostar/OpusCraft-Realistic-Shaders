// Controlled reference study in the real voxel renderer. This purpose-built
// lagoon establishes known depths and sand/plant placement; it is not claimed
// to be the Bedrock reference world. It exists only in a disposable profile.
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const output=fileURLToPath(new URL('../../evidence/cromos/lagoon/',import.meta.url));mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=d3d11']});
const page=await browser.newPage({viewport:{width:974,height:647}}),report={fixture:'Purpose-built sand/vegetation lagoon rendered by OpusCraft',viewport:[974,647],errors:[],scenes:[]};
page.on('pageerror',e=>{if(report.errors.length<3)report.errors.push(String(e));});
async function settled(){await page.waitForFunction(()=>{const g=window.__game;for(let x=-32;x<=32;x+=16)for(let z=1888;z<=1968;z+=16){const c=g.world.getChunk(x>>4,z>>4);if(!c||c.dirty||c.meshing)return false;}return g.renderer.hyper?.ready;},null,{timeout:180000});await page.waitForTimeout(1800);}
async function capture(name,yaw,pitch,time=8500,under=false){
 await page.evaluate(({yaw,pitch,time,under})=>{const g=window.__game;g.teleport(1.5,(under?61.5:65)-g.player.eyeHeight,1908.5,yaw,pitch);g.player.flying=true;g.level.dayTime=time;},{yaw,pitch,time,under});await settled();
 const state=await page.evaluate(async()=>{const g=window.__game,{FLAGS,F_OPAQUE}=await import('/src/world/block.ts'),p=g.player;return {pos:[p.x,p.y+p.eyeHeight,p.z],solid:!!(FLAGS[g.world.getState(Math.floor(p.x),Math.floor(p.y+p.eyeHeight),Math.floor(p.z))]&F_OPAQUE),underwater:g.renderer.hyper.underwater,profile:g.renderer.hyper.water.key,fps:g.fps,gl:g.gl.getError(),tick:g.level.gameTime};});
 assert.ok(!state.solid,'Camera must never be embedded in terrain');assert.equal(state.underwater,under);assert.equal(state.gl,0);
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__game.gl.finish();r();}))));await page.screenshot({path:output+name+'.png'});report.scenes.push({name,...state});console.log('SHOT',name,JSON.stringify(state));
}
try{
 await page.goto('http://127.0.0.1:5188/?showcase&rd=8');await page.waitForFunction(()=>window.__game?.spawned,null,{timeout:180000});
 await page.evaluate(()=>{const g=window.__game;g.input.forceLocked=true;g.setScreen(null);g.freezeTime=true;g.hideGui=true;g.opts.bobView=false;g.opts.maxFps=260;g.teleport(1.5,68-g.player.eyeHeight,1908.5,0,8);g.player.flying=true;});await settled();
 report.construction=await page.evaluate(async()=>{const g=window.__game,{BLOCK_BY_NAME,FLAGS,F_WATER}=await import('/src/world/block.ts');const st=n=>BLOCK_BY_NAME.get(n).defaultState,sand=st('sand'),water=st('water'),stone=st('sandstone');let edits=0;
  const put=(x,y,z,s)=>{if(g.world.getState(x,y,z)!==s){g.world.setState(x,y,z,s);edits++;}};
  for(let x=-25;x<=24;x++)for(let z=1886;z<=1962;z++){
   const bank=x>=9,top=bank?63+Math.min(3,Math.floor((x-9)/4)):61-Math.min(5,Math.floor((9-x)/4));
   put(x,top-1,z,stone);put(x,top,z,sand);
   for(let y=top+1;y<=76;y++)put(x,y,z,y<=62?water:0);
  }
  // Low curved island in the middle distance, and native jungle trees on the
  // bank. Shadows, reflections, plants and caustics all use actual block meshes.
  for(let x=-19;x<=7;x++)for(let z=1944;z<=1962;z++)if(Math.hypot((x+6)/1.6,z-1954)<10){put(x,62,z,stone);put(x,63,z,sand);}
  function tree(x,z,h){const y=g.world.heightAt(x,z);for(let dy=0;dy<h;dy++)put(x,y+dy,z,st('jungle_log'));for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++)for(let dy=-1;dy<=1;dy++)if(Math.abs(dx)+Math.abs(dz)+Math.abs(dy)<6)put(x+dx,y+h+dy,z+dz,st('jungle_leaves'));}
  tree(16,1898,7);tree(19,1918,8);tree(17,1936,7);tree(-7,1954,6);tree(2,1956,7);
  for(let x=-12;x<=7;x+=3)for(let z=1895;z<=1938;z+=4){const y=61-Math.min(5,Math.floor((9-x)/4))+1;if(y<62)put(x,y,z,st('seagrass'));}
  let depth=0;while(depth<20&&(FLAGS[g.world.getState(1,62-depth,1908)]&F_WATER))depth++;
  return {edits,verticalWaterBlocksAtCamera:depth};
 });await settled();assert.equal(report.construction.verticalWaterBlocksAtCamera,3);
 await capture('01-reference-angle',0,9);await capture('02-floor-closeup',-12,31);
 await capture('03-reflection-oblique',-48,10);await capture('04-underwater',0,-25,8500,true);
 await capture('05-night',0,9,18000);await capture('06-animation-later',0,9);
 assert.ok(report.scenes.at(-1).tick>report.scenes[0].tick+60,'Animation and live world must advance');assert.equal(report.errors.length,0);
}finally{writeFileSync(output+'report.json',JSON.stringify(report,null,2));await browser.close();console.log('REPORT',output);}
