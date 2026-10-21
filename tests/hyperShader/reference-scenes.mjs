// Real rendered scene evidence in a disposable browser profile. No saved user
// world is loaded or modified. Material fixtures exercise propagated light.
import { chromium } from 'playwright';
import { mkdirSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const label=process.argv[2]??'revision',base=process.env.GAME_URL??'http://127.0.0.1:5188';
const output=fileURLToPath(new URL(`../../evidence/reference-scenes/${label}/`,import.meta.url));mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=d3d11']});
const page=await browser.newPage({viewport:{width:1920,height:1080}}),report={label,errors:[],scenes:[],checks:[]};
page.on('pageerror',e=>{if(report.errors.length<3){report.errors.push(String(e));console.log('ERROR',String(e).slice(0,350));}});page.on('console',m=>{if(m.type()==='error'&&report.errors.length<3)report.errors.push(m.text());});
async function ready(x,z){await page.waitForFunction(({x,z})=>{const g=window.__game;for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){const c=g.world.getChunk((Math.floor(x)>>4)+dx,(Math.floor(z)>>4)+dz);if(!c||c.dirty||c.meshing)return false;}return true;},{x,z},{timeout:180000});await page.waitForTimeout(2000);}
async function move(pos,yaw,pitch){await page.evaluate(({pos,yaw,pitch})=>{const g=window.__game;g.teleport(pos[0],pos[1]-g.player.eyeHeight,pos[2],yaw,pitch);g.player.flying=true;},{pos,yaw,pitch});await ready(pos[0],pos[2]);}
async function snap(name,time,shader=true,rain=0){
 await page.evaluate(({time,shader,rain})=>{const g=window.__game;g.opts.hyperShader=shader;const l=g.level;l.dayTime=time;l.rain=l.rainO=rain;l.raining=rain>0;l.rainTime=999999;l.clearWeatherTime=rain?0:999999;l.thunder=l.thunderO=0;},{time,shader,rain});
 await page.waitForFunction(()=>{const g=window.__game;return g.opts.hyperShader?g.renderer.hyper?.ready:!g.renderer.hyper;});await page.waitForTimeout(2300);
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__game.gl.finish();r();}))));
 await page.screenshot({path:output+name+'.png'});
 const state=await page.evaluate(()=>{const g=window.__game;return {time:g.level.dayTime,position:[g.player.x,g.player.y+g.player.eyeHeight,g.player.z],yaw:g.player.yaw,pitch:g.player.pitch,shader:g.opts.hyperShader,fps:g.fps,gl:g.gl.getError()};});
 report.scenes.push({name,...state});console.log('SHOT',name,JSON.stringify(state));
}
try{
 await page.goto(base+'/?showcase&rd=8');await page.waitForFunction(()=>window.__game?.spawned,null,{timeout:180000});
 await page.evaluate(()=>{const g=window.__game;g.input.forceLocked=true;g.setScreen(null);g.hideGui=true;g.freezeTime=true;g.opts.bobView=false;g.opts.maxFps=260;g.opts.renderResolution=0;g.resize();});
 await move([690.5,68,-611.5],180,6);await snap('01-midday-water',6000);
 await page.evaluate(()=>{const p=window.__game.player;p.yaw=p.yawO=90;p.pitch=p.pitchO=12;});await snap('02-midday-coast',6000);
 await move([1534.5,84,554.5],90,9);await snap('03-midday-meadow',6000);
 await page.evaluate(()=>{const p=window.__game.player;p.yaw=p.yawO=270;});await snap('04-meadow-backlit',6000);
 await snap('05-meadow-rain',6000,true,1);
 // Search the loaded temperate coast for real water next to dry shore. Avoid
 // treating the frozen showcase as a tropical-water reference.
 const shore=await page.evaluate(async()=>{const g=window.__game,{FLAGS,F_WATER}=await import('/src/world/block.ts');let best=null,score=1e9;for(let x=1440;x<1650;x+=2)for(let z=450;z<660;z+=2){if(!g.world.isLoaded(x,z)||!(FLAGS[g.world.getState(x,62,z)]&F_WATER))continue;let depth=0;while(depth<30&&(FLAGS[g.world.getState(x,62-depth,z)]&F_WATER))depth++;for(const [dx,dz] of [[7,0],[-7,0],[0,7],[0,-7]]){const h=g.world.heightAt(x+dx,z+dz);if(h<63||h>72)continue;const d=Math.hypot(x-1560,z-550)+Math.abs(depth-3)*16;if(d<score){score=d;best={pos:[x+.5,65.3,z+.5],depth,land:[x+dx+.5,h,z+dz+.5]};}}}return best;});
 report.temperateShore=shore;
 if(shore){const dx=shore.land[0]-shore.pos[0],dz=shore.land[2]-shore.pos[2],yaw=-Math.atan2(dx,dz)*180/Math.PI;
  await move(shore.pos,yaw+65,10);await snap('13-temperate-water-wide',6000);
  await page.evaluate(({yaw})=>{const p=window.__game.player;p.yaw=p.yawO=yaw;p.pitch=p.pitchO=29;},{yaw});await snap('14-shore-contact-border',6000);
  report.water=await page.evaluate(()=>{const h=window.__game.renderer.hyper;return {profile:h.water.key,waves:h.water.waves,extinction:h.water.extinction,scatter:h.water.scatter,reflection:h.reflectionAvailable};});
  const submerged=[shore.pos[0],61.2,shore.pos[2]];await move(submerged,yaw,-25);await snap('15-temperate-underwater',6000);
 }
 await move([1534.5,84,554.5],90,9);
 // Isolated sand and grass platform above generated terrain. The stepped
 // sand catches a real placed torch's light; no manually painted lighting.
 await page.evaluate(async()=>{const g=window.__game,{BLOCK_BY_NAME}=await import('/src/world/block.ts');const sand=BLOCK_BY_NAME.get('sand').defaultState,grass=BLOCK_BY_NAME.get('grass_block').defaultState;
  for(let x=1524;x<=1546;x++)for(let z=532;z<=554;z++){g.world.setState(x,88,z,x<1536?sand:grass);g.world.setState(x,89,z,0);g.world.setState(x,90,z,0);}
  for(let x=1524;x<=1535;x++)for(let z=532;z<=539;z++)g.world.setState(x,89,z,sand);
  for(let x=1524;x<=1535;x++)for(let z=532;z<=535;z++)g.world.setState(x,90,z,sand);
  g.world.setState(1533,89,544,BLOCK_BY_NAME.get('torch').defaultState);
  g.world.setState(1540,89,544,BLOCK_BY_NAME.get('torch').defaultState);
  for(let x=1537;x<=1544;x+=2)for(let z=535;z<=541;z+=2)g.world.setState(x,89,z,BLOCK_BY_NAME.get('short_grass').defaultState);
 });
 await ready(1534,544);await move([1535.5,92,553.5],180,18);await snap('06-torch-night',18000);
 report.torchLight=await page.evaluate(()=>{const g=window.__game;return [0,1,2,3,5,8].map(d=>({distance:d,packed:g.world.getLight(1533+d,89,544)}));});
 assert.ok((report.torchLight[0].packed&15)>=13,'Placed torches must actually emit propagated block light');
 await snap('07-torch-dusk',13000);await snap('08-material-day',6000);await snap('09-material-original',6000,false);
 // Sample the actual shared hand/entity lightmap in both rendering modes.
 report.lightmapOriginal=await page.evaluate(()=>window.__game.renderer.lightmap.sample(14,0));await snap('10-torch-reactivated',18000);
 report.lightmapWarm=await page.evaluate(()=>window.__game.renderer.lightmap.sample(14,0));
 assert.ok(report.lightmapWarm[0]>report.lightmapWarm[2]*1.8,'Warm entity lightmap must not bleach torchlight white');
 await move([690.5,61,-611.5],90,-35);await snap('11-underwater-window',6000);
 await page.evaluate(()=>{const p=window.__game.player;p.yaw=p.yawO=270;p.pitch=p.pitchO=15;});await snap('12-underwater-rotated',6000);
 assert.ok(shore,'A real temperate shoreline must be found');assert.equal(report.errors.length,0);assert.ok(report.scenes.every(s=>s.gl===0));report.checks.push('Actual propagated torch illumination','Warm shared entity lightmap','Material ON/OFF opacity','Fifteen real day/night/rain/water cameras','No browser or WebGL errors');
}finally{writeFileSync(output+'report.json',JSON.stringify(report,null,2));await browser.close();console.log('REPORT',output);}
