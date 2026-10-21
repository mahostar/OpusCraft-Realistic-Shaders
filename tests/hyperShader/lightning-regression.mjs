// Exercise the real server strike path with a deterministic probability roll.
// The bolt is made visual-only in this disposable test world, not in the game.
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const output=fileURLToPath(new URL('../../evidence/lightning/',import.meta.url));mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=d3d11']});
const page=await browser.newPage({viewport:{width:1600,height:900}}),report={errors:[],checks:[]};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
try{
 await page.goto('http://127.0.0.1:5188/?showcase&rd=8');await page.waitForFunction(()=>window.__game?.spawned,null,{timeout:180000});
 await page.evaluate(()=>{const g=window.__game;g.input.forceLocked=true;g.setScreen(null);g.hideGui=true;g.freezeTime=true;g.opts.bobView=false;g.teleport(1560.5,95-g.player.eyeHeight,550.5,180,-20);g.player.flying=true;g.level.dayTime=11000;});
 await page.waitForFunction(()=>{const g=window.__game;for(let dx=-5;dx<=5;dx++)for(let dz=-5;dz<=5;dz++){const c=g.world.getChunk(97+dx,34+dz);if(!c||c.dirty||c.meshing)return false;}return g.renderer.hyper?.ready;},null,{timeout:180000});
 report.strike=await page.evaluate(()=>{
  const g=window.__game,l=g.level;l.setWeather('thunder',6000);l.rain=l.rainO=l.thunder=l.thunderO=1;
  const original=l.random.nextInt;let bolt;
  try{
   l.random.nextInt=function(n){return n===100000?0:original.call(this,n);};
   for(let cz=29;cz<=30&&!bolt;cz++)for(let cx=95;cx<=98&&!bolt;cx++){
    const before=new Set(l.entities);l.tickThunder(cx,cz);bolt=l.entities.find(e=>!before.has(e)&&e.type==='lightning_bolt');
   }
  }finally{l.random.nextInt=original;}
  if(!bolt)throw Error('No valid rainy open-sky strike location');
  bolt.visualOnly=true;const sound=l.sound.play.bind(l.sound),sounds=[];l.sound.play=(...a)=>{sounds.push(a[0]);sound(...a);};
  bolt.tick();window.__bolt=bolt;window.__boltTick=bolt.tick.bind(bolt);bolt.tick=()=>{};
  const dx=bolt.x-g.player.x,dz=bolt.z-g.player.z,yaw=Math.atan2(-dx,dz)*180/Math.PI;
  g.player.yaw=g.player.yawO=yaw;g.player.pitch=g.player.pitchO=-20;
  const r=g.renderer,render=r.render.bind(r);window.__lightningDraws=0;
  const draw=r.entities.renderLightning.bind(r.entities);r.entities.renderLightning=(...a)=>{window.__lightningDraws++;draw(...a);};
  window.__forceFlash=true;r.render=(cam,env)=>{env.weather.flash=window.__forceFlash?2:0;window.__lastRender=[cam,env];render(cam,env);};
  return {origin:[bolt.x,bolt.y,bolt.z],horizontalDistance:Math.hypot(dx,dz),sounds,flashing:bolt.flashing,thunder:l.isThundering()};
 });
 assert.ok(report.strike.horizontalDistance>64,'Regression must cover the former 64-block cutoff');assert.equal(report.strike.thunder,true);
 assert.ok(report.strike.sounds.includes('entity.lightning_bolt.thunder'));assert.ok(report.strike.sounds.includes('entity.lightning_bolt.impact'));
 await page.waitForTimeout(400);await page.screenshot({path:output+'01-storm-flash.png'});
 report.flash=await page.evaluate(()=>({draws:window.__lightningDraws,flash:window.__game.renderer.hyper.flash,gl:window.__game.gl.getError()}));
 assert.ok(report.flash.draws>0);assert.equal(report.flash.flash,1);assert.equal(report.flash.gl,0);
 await page.evaluate(()=>{window.__forceFlash=false;window.__bolt.life=-1;window.__lightningDraws=0;});await page.waitForTimeout(200);
 await page.screenshot({path:output+'02-between-flashes.png'});assert.equal(await page.evaluate(()=>window.__lightningDraws),0);
 await page.evaluate(()=>{window.__game.opts.hyperShader=false;window.__bolt.life=1;window.__forceFlash=true;window.__lightningDraws=0;});
 await page.waitForFunction(()=>!window.__game.renderer.hyper);await page.waitForTimeout(250);
 await page.screenshot({path:output+'03-shader-off-lightning.png'});assert.ok(await page.evaluate(()=>window.__lightningDraws)>0);
 report.checks.push('Real thunderstorm spawn path','Thunder and impact sound requests','Bolt visible beyond 64 blocks','HDR sky/terrain flash','Dark gaps between flashes','Lightning renders with shader OFF');
 assert.equal(report.errors.length,0);console.log('PASS',JSON.stringify(report));
}finally{writeFileSync(output+'report.json',JSON.stringify(report,null,2));await browser.close();}
