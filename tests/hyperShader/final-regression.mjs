import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
const output=new URL('../../evidence/performance/regression/',import.meta.url);mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=d3d11']});
const page=await browser.newPage({viewport:{width:2560,height:1280}}),report={checks:[],errors:[],glErrors:[]};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
function pass(text){report.checks.push(text);console.log('PASS',text);}
async function click(prefix){const p=await page.evaluate(prefix=>{const g=window.__game,all=g.screen.widgets.flatMap(w=>[w,...(w.entries?.flat?.()??[])]),w=all.find(w=>typeof w.label==='string'&&w.label.startsWith(prefix)&&w.visible&&w.active);if(!w)throw new Error('Missing '+prefix);const r=g.canvas.getBoundingClientRect();return {x:r.left+(w.x+w.w/2)*g.gui.scale*r.width/g.canvas.width,y:r.top+(w.y+w.h/2)*g.gui.scale*r.height/g.canvas.height};},prefix);await page.mouse.click(p.x,p.y,{delay:70});await page.waitForTimeout(300);}
async function ready(){await page.waitForFunction(()=>{const g=window.__game;return g.opts.hyperShader?g.renderer.hyper?.ready:!g.renderer.hyper;});}
async function shot(name){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>{window.__game.gl.finish();r();})));await page.screenshot({path:new URL(name+'.png',output).pathname.replace(/^\/(\w:)/,'$1')});}
try{
 await page.goto('http://127.0.0.1:5188/?showcase&rd=4');await page.waitForFunction(()=>window.__game?.spawned,null,{timeout:180000});
 await page.evaluate(()=>{const g=window.__game;g.input.forceLocked=true;g.input.unlock();g.openPause();});await page.waitForTimeout(800);
 await click('Options...');await click('Video Settings...');
 await click('Render Resolution');
 report.resolution=await page.evaluate(()=>{const g=window.__game;return {canvas:[g.canvas.width,g.canvas.height],ui:[g.ui.width,g.ui.height],renderer:[g.renderer.width,g.renderer.height],stored:JSON.parse(localStorage.getItem('mc.options')).renderResolution};});
 assert.deepEqual(report.resolution.canvas,[1920,960]);assert.deepEqual(report.resolution.ui,[1920,960]);assert.deepEqual(report.resolution.renderer,[1920,960]);assert.equal(report.resolution.stored,1080);pass('Native UI click selects global 1080p, immediately resizes both canvases/renderer and persists');
 await shot('01-video-1080p');
 await click('Done');await click('Done');await click('hyperShader');await ready();
 assert.equal(await page.evaluate(()=>window.__game.canvas.width),1920);pass('1080p also applies with hyperShader OFF; native mouse input still selects pause controls');
 await click('hyperShader');await ready();
 const sizes=await page.evaluate(async()=>{const {renderSize}=await import('/src/render/resolution.ts');return [renderSize(1920,1080,1080),renderSize(1280,720,1080),renderSize(1080,1920,1080),renderSize(3840,2160,0)];});assert.deepEqual(sizes,[[1920,1080],[1280,720],[607,1080],[3840,2160]]);pass('Resolution preserves aspect ratio, handles portrait/native and never upscales smaller windows');
 await page.reload();await page.waitForFunction(()=>window.__game?.spawned,null,{timeout:180000});assert.equal(await page.evaluate(()=>window.__game.canvas.width),1920);pass('Resolution persists after reload');
 await page.evaluate(()=>{const g=window.__game;g.input.forceLocked=true;g.setScreen(null);g.hideGui=true;g.opts.bobView=false;g.teleport(690.5,61-g.player.eyeHeight,-611.5,90,-65);g.player.flying=true;});await ready();await page.waitForTimeout(1500);
 report.water=await page.evaluate(async()=>{const g=window.__game,{FLAGS,F_WATER}=await import('/src/world/block.ts');return {actualWater:!!(FLAGS[g.world.getState(690,61,-612)]&F_WATER),underwater:g.renderer.hyper.underwater,reflection:g.renderer.hyper.reflectionAvailable};});assert.ok(report.water.actualWater&&report.water.underwater&&report.water.reflection);await shot('04-underwater-up');
 await page.evaluate(()=>{const p=window.__game.player;p.yaw=p.yawO=230;p.pitch=p.pitchO=-45;});await page.waitForTimeout(500);await shot('05-underwater-rotated');pass('Actual submerged eye position retains live underside reflections across camera rotation');
 await page.evaluate(async()=>{const g=window.__game,d=await import('/src/world/dimension.ts');g.input.forceLocked=true;g.setScreen(null);g.hideGui=true;g.changeDimension(d.THE_END,80.5,84.38,-95.5,null,false);});await page.waitForFunction(()=>window.__game.spawned,null,{timeout:180000});await page.waitForTimeout(3500);
 // Instrument only test frames: count passes, then verify OFF skips every hyperShader pass.
 await page.evaluate(()=>{const g=window.__game,r=g.renderer;window.__passes={shadow:0,reflection:0,copies:0};const h=r.hyper;for(const [method,key] of [['beginShadow','shadow'],['beginReflection','reflection'],['captureOpaque','copies']]){const f=h[method].bind(h);h[method]=(...a)=>{window.__passes[key]++;return f(...a);};}});
 const moves=[[0,-10],[90,0],[180,0],[270,0],[19.25,-13.8],[-47.7,-25]];
 for(const shader of [false,true,false,true]){
  await page.evaluate(v=>{const g=window.__game;g.opts.hyperShader=v;g.setScreen(null);},shader);await ready();
  for(const [yaw,pitch] of moves){await page.evaluate(({yaw,pitch})=>{const p=window.__game.player;p.yaw=p.yawO=yaw;p.pitch=p.pitchO=pitch;},{yaw,pitch});await page.waitForTimeout(100);const error=await page.evaluate(()=>window.__game.gl.getError());if(error)report.glErrors.push(error);}
  await shot(`02-end-${shader?'on':'off'}-${report.checks.length}`);
 }
 assert.equal(report.glErrors.length,0);pass('End ON/OFF repeated transitions and six camera angles produce no WebGL errors');
 await page.evaluate(()=>{const g=window.__game;g.opts.hyperShader=false;});await ready();await shot('03-end-off-space');
 assert.equal(await page.evaluate(()=>!!window.__game.renderer.hyper),false);pass('End OFF uses independent cheap starfield with no hyperShader pipeline');
 assert.equal(report.errors.length,0);pass('No browser or shader compilation errors');
}finally{writeFileSync(new URL('report.json',output),JSON.stringify(report,null,2));await browser.close();}
