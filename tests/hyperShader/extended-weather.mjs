import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const output=fileURLToPath(new URL('../../evidence/extended/',import.meta.url));mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=d3d11']});
const page=await browser.newPage({viewport:{width:1600,height:900}});
const report={errors:[],scenes:[],glErrors:[],checks:[]};
page.on('pageerror',e=>{report.errors.push(String(e));console.log('ERROR',String(e).slice(0,1800));});
page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
await page.goto('http://127.0.0.1:5188/?showcase&rd=5');
await page.waitForFunction(()=>window.__game?.spawned,null,{timeout:120000});
await page.evaluate(()=>{const g=window.__game;g.input.forceLocked=true;g.setScreen(null);g.hideGui=true;g.freezeTime=true;g.level.dayTime=3500;
 window.__glErrors=[];const draw=g.renderer.render.bind(g.renderer);g.renderer.render=(...a)=>{window.__lastRender=a;draw(...a);const e=g.gl.getError();if(e)window.__glErrors.push(e);};});
async function move(pos,yaw,pitch){await page.evaluate(({pos,yaw,pitch})=>{const g=window.__game;g.teleport(pos[0],pos[1]-g.player.eyeHeight,pos[2],yaw,pitch);g.player.flying=true;g.setScreen(null);},{pos,yaw,pitch});}
async function loaded(x,z){await page.waitForFunction(({x,z})=>{const g=window.__game;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const c=g.world.getChunk((Math.floor(x)>>4)+dx,(Math.floor(z)>>4)+dz);if(!c||c.dirty||c.meshing)return false;}return true;},{x,z},{timeout:120000});await page.waitForTimeout(2500);}
async function snap(name,wait=2000){
 await page.waitForTimeout(wait);await page.waitForFunction(()=>{const g=window.__game;return !g.opts.hyperShader||g.renderer.hyper?.ready;});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__game.gl.finish();resolve();}))));
 const state=await page.evaluate(()=>{const g=window.__game;return {dim:g.world.dim.id,pos:[g.player.x,g.player.y+g.player.eyeHeight,g.player.z],yaw:g.player.yaw,pitch:g.player.pitch,shader:g.opts.hyperShader,wetness:g.renderer.hyper?.wetness,rainDrops:g.renderer.weather.depthRain.visibleDrops,rainColumns:g.renderer.weather.visibleColumns,tick:g.level.gameTime,screen:g.screen?.constructor.name??null,gl:g.gl.getError(),fps:g.fps};});
 report.scenes.push({name,...state});await page.screenshot({path:output+name+'.png'});console.log('SHOT',name,JSON.stringify(state));
}
async function change(name,pos){await page.evaluate(async({name,pos})=>{const d=await import('/src/world/dimension.ts');const g=window.__game;g.changeDimension(d[name],pos[0],pos[1]-g.player.eyeHeight,pos[2],null,false);g.player.flying=true;},{name,pos});await page.waitForFunction(()=>window.__game.spawned,null,{timeout:120000});await page.evaluate(()=>window.__game.setScreen(null));await loaded(pos[0],pos[2]);}
async function counts(){return page.evaluate(()=>{const p=window.__game.renderer.particles;return p.sprites.filter(s=>['white_ash','ash','warped_spore','crimson_spore'].includes(s.kind)).length;});}
try{
 await move([1560.5,70,550.5],180,5);await loaded(1560,550);
 const warm=await page.evaluate(async()=>{const g=window.__game,{BIOMES}=await import('/src/world/gen/biomes.ts');let best=null,score=1e9;for(let z=500;z<610;z+=3)for(let x=1510;x<1610;x+=3){if(!g.world.isLoaded(x,z))continue;const b=BIOMES[g.world.getBiome(x,z)];if(!b.precipitation||b.temperature<0.3)continue;const d=Math.hypot(x-1560,z-550);if(d<score){score=d;best=[x+0.5,z+0.5,b.name];}}return best;});
 assert.ok(warm,'A temperate rain biome must be loaded');report.rainBiome=warm[2];const [x,z]=warm;
 await page.evaluate(()=>{const g=window.__game,l=g.level;l.rain=l.rainO=1;l.thunder=l.thunderO=0;l.raining=true;l.rainTime=999999;l.clearWeatherTime=0;});
 await move([x,67,z],180,8);await snap('25-rain-natural');
 assert.ok(report.scenes.at(-1).rainDrops>0,'Rain droplets must exist in world space');
 const startTick=report.scenes.at(-1).tick;
 // An isolated, temporary fixture in this fresh browser context verifies
 // wet reflection and roof exposure through real block meshes and depth.
 await page.evaluate(async({x,z})=>{const g=window.__game,{BLOCK_BY_NAME}=await import('/src/world/block.ts');const stone=BLOCK_BY_NAME.get('stone').defaultState,roof=BLOCK_BY_NAME.get('stone_bricks').defaultState;const X=Math.floor(x),Z=Math.floor(z);
  for(let dx=-10;dx<=10;dx++)for(let dz=-12;dz<=10;dz++)g.world.setState(X+dx,64,Z+dz,stone);
  for(let dx=-8;dx<=-3;dx++)for(let dz=-7;dz<=5;dz++)g.world.setState(X+dx,69,Z+dz,roof);
  for(const [dx,dz,name] of [[1,-5,'red_concrete'],[5,-3,'blue_concrete'],[-2,-8,'obsidian']])for(let y=65;y<=68;y++)g.world.setState(X+dx,y,Z+dz,BLOCK_BY_NAME.get(name).defaultState);
 },{x,z});
 await loaded(x,z);await move([x,66.35,z+7],180,13);await snap('26-rain-wet-reflections',5000);
 assert.ok(report.scenes.at(-1).wetness>0.9,'Wet-surface pass must be active');assert.ok(report.scenes.at(-1).tick>startTick+40,'World and rain animation must advance during captures');
 await move([x,65.9,z+7],180,5);await snap('27-rain-ground-angle');
 await move([x-6,66.4,z+2],180,-10);await snap('28-rain-under-roof');
 report.rainExposure=await page.evaluate(({x,z})=>{const g=window.__game;return {coveredHeight:g.world.heightAt(Math.floor(x)-6,Math.floor(z)+2),exposedHeight:g.world.heightAt(Math.floor(x)+2,Math.floor(z)+2)};},{x,z});
 assert.equal(report.rainExposure.coveredHeight,70);assert.equal(report.rainExposure.exposedHeight,65);
 report.checks.push('3D rain exists and animates','Wet reflection pass active','Roof exposure uses actual world heights');
 await move([x,66.35,z+7],180,13);await page.waitForTimeout(700);
 report.wetIndices=await page.evaluate(()=>{
  const g=window.__game,r=g.renderer,gl=g.gl,args=window.__lastRender;
  const saved=[...r.world.meshes.values()].map(m=>({m,vao:m.wetVao.slice(),quads:m.wetQuads.slice()}));
  const pixels=()=>{r.render(...args);gl.finish();const a=new Uint8Array(r.width*r.height*4);gl.readPixels(0,0,r.width,r.height,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;};
  const optimized=pixels();let different=0,maximum=0;
  try{
   for(const {m}of saved)for(let l=0;l<3;l++){m.wetVao[l]=m.vao[l];m.wetQuads[l]=m.quads[l];}
   const unfiltered=pixels();
   for(let i=0;i<optimized.length;i++){const d=Math.abs(optimized[i]-unfiltered[i]);if(d>1)different++;maximum=Math.max(maximum,d);}
  }finally{
   for(const {m,vao,quads}of saved)for(let l=0;l<3;l++){m.wetVao[l]=vao[l];m.wetQuads[l]=quads[l];}
   r.render(...args);
  }
  return {differentChannels:different,totalChannels:optimized.length,maximumDelta:maximum,retainedQuads:saved.reduce((s,v)=>s+v.quads.reduce((a,b)=>a+b,0),0)};
 });
 assert.ok(report.wetIndices.retainedQuads>0);assert.ok(report.wetIndices.differentChannels/report.wetIndices.totalChannels<0.001,'Indexed wet geometry must preserve the unfiltered wet-pass image');report.checks.push('Filtered wet geometry preserves the original wet-pass pixels');
 await change('THE_NETHER',[-47.5,55,-47.5]);
 await page.evaluate(()=>{const g=window.__game;g.opts.hyperShader=false;g.renderer.particles.clear();});
 await page.waitForTimeout(7500);const original=[];for(let i=0;i<3;i++){original.push(await counts());await page.waitForTimeout(1500);}
 await page.evaluate(()=>{const g=window.__game;g.opts.hyperShader=true;g.renderer.particles.clear();});
 await page.waitForTimeout(7500);const subtle=[];for(let i=0;i<3;i++){subtle.push(await counts());await page.waitForTimeout(1500);}
 const mean=a=>a.reduce((v,n)=>v+n,0)/a.length;report.netherMotes={original,subtle,ratio:mean(subtle)/mean(original)};
 assert.ok(report.netherMotes.ratio<0.35,'Nether motes must be substantially reduced');report.checks.push('Nether ambient mote population reduced in actual ticking world');
 await move([-47.5,55,-47.5],240,-10);await snap('29-nether-subtle-particles');await move([-47.5,55,-47.5],60,10);await snap('30-nether-lava');
 await page.evaluate(()=>{const l=window.__game.level;l.raining=false;l.rain=l.rainO=0;});
 await change('THE_END',[80.5,86,-95.5]);await move([80.5,86,-95.5],0,-10);await snap('31-end-space-wide');
 await move([80.5,86,-95.5],19.25,-13.8);await snap('32-end-black-hole-detail');
 await move([80.5,86,-95.5],-47.7,-25);await snap('33-end-planet-detail');
 await move([42.5,66,22.5],145,8);await snap('34-end-violet-atmosphere');
 report.glErrors=await page.evaluate(()=>window.__glErrors);assert.equal(report.errors.length,0);assert.equal(report.glErrors.length,0);
 report.checks.push('No browser, shader compilation or WebGL errors');
}finally{writeFileSync(output+'report.json',JSON.stringify(report,null,2));console.log('REPORT',output+'report.json');await browser.close();}
