import { chromium } from 'playwright';
import { mkdirSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const label=process.argv[2]??'before',output=new URL(`../../evidence/palette/${label}/`,import.meta.url);mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=d3d11']});
const page=await browser.newPage({viewport:{width:1920,height:1080}}),report={label,errors:[],scenes:[]};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
async function shot(name,time,yaw,rain=0,pitch=9){
 await page.evaluate(({time,yaw,rain,pitch})=>{const g=window.__game;g.level.dayTime=time;g.level.rain=g.level.rainO=rain;g.level.thunder=g.level.thunderO=0;g.level.raining=rain>0;g.level.rainTime=999999;g.level.clearWeatherTime=rain?0:999999;g.player.yaw=g.player.yawO=yaw;g.player.pitch=g.player.pitchO=pitch;},{time,yaw,rain,pitch});
 await page.waitForTimeout(1800);await page.waitForFunction(()=>window.__game.renderer.hyper?.ready);
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__game.gl.finish();r();}))));
 const state=await page.evaluate(()=>{const g=window.__game,h=g.renderer.hyper;return {time:g.level.dayTime,position:[g.player.x,g.player.y+g.player.eyeHeight,g.player.z],sun:h.sun,sunColor:h.sunColor,dimension:g.world.dim.id,fps:g.fps,gl:g.gl.getError()};});
 report.scenes.push({name,...state});await page.screenshot({path:new URL(name+'.png',output).pathname.replace(/^\/(\w:)/,'$1')});console.log('SHOT',name,JSON.stringify(state));
}
try{
 await page.goto('http://127.0.0.1:5188/?showcase&rd=8');await page.waitForFunction(()=>window.__game?.spawned,null,{timeout:180000});
 await page.evaluate(()=>{const g=window.__game;g.input.forceLocked=true;g.setScreen(null);g.hideGui=true;g.freezeTime=true;g.opts.bobView=false;g.opts.maxFps=260;g.opts.renderResolution=0;g.resize();g.teleport(1561.5,70-g.player.eyeHeight,551.5,270,9);g.player.flying=true;});
 await page.waitForFunction(()=>{const g=window.__game;for(let x=1520;x<1610;x+=16)for(let z=510;z<600;z+=16){const c=g.world.getChunk(x>>4,z>>4);if(!c||c.dirty||c.meshing)return false;}return true;},null,{timeout:180000});await page.waitForTimeout(5000);
 report.grass=await page.evaluate(async()=>{const {blockOf}=await import('/src/world/block.ts');const g=window.__game;let best=null,score=1e9;for(let x=1520;x<1610;x+=2)for(let z=510;z<600;z+=2){const top=g.world.heightAt(x,z);for(let y=top-1;y>=top-3;y--){if(blockOf(g.world.getState(x,y,z)).name!=='grass_block')continue;if(blockOf(g.world.getState(x,y+3,z)).name!=='air')continue;const s=Math.hypot(x-1561,z-551)+Math.max(0,y-70)*3;if(s<score){score=s;best=[x+.5,y+4,z+.5];}}}if(best){g.teleport(best[0],best[1]-g.player.eyeHeight,best[2],270,9);g.player.flying=true;}return best;});
 assert.ok(report.grass,'A real grass location must be loaded');await page.waitForTimeout(2000);
 // Clear nearby hills in every direction rather than accepting an obstructed camera.
 await page.evaluate(()=>{const g=window.__game,p=g.player;let h=0;for(let dx=-10;dx<=10;dx+=2)for(let dz=-10;dz<=10;dz+=2)h=Math.max(h,g.world.heightAt(Math.floor(p.x)+dx,Math.floor(p.z)+dz));g.teleport(p.x,h+6-p.eyeHeight,p.z,90,9);p.flying=true;});
 if(!process.argv.includes('--golden-only')){await shot('01-daylight-grass',3500,90);await shot('02-noon-grass',6000,90);}
 await shot('03-sunrise',23500,270);await shot('04-sunset',12500,90);
 if(!process.argv.includes('--golden-only')){await shot('05-rain',3500,90,1);await shot('06-night',18000,90);}
 await page.evaluate(()=>{const g=window.__game;g.teleport(690.5,65-g.player.eyeHeight,-611.5,69,0);g.player.flying=true;});
 await page.waitForFunction(()=>{const g=window.__game;for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const c=g.world.getChunk((690>>4)+dx,(-612>>4)+dz);if(!c||c.dirty||c.meshing)return false;}return true;},null,{timeout:180000});await page.waitForTimeout(3000);
 await shot('07-sunset-water',12500,69,0,0);
 assert.equal(report.errors.length,0);assert.ok(report.scenes.every(s=>s.gl===0));
}finally{writeFileSync(new URL('report.json',output),JSON.stringify(report,null,2));await browser.close();}
