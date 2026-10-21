import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const output=fileURLToPath(new URL('../../evidence/matrix/',import.meta.url));
mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=d3d11']});
const context=await browser.newContext({viewport:{width:1600,height:900}});
const page=await context.newPage();
const report={errors:[],scenes:[],gpu:null};
page.on('pageerror',e=>{report.errors.push(String(e));console.log('PAGEERROR',String(e).slice(0,1800));});
page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());console.log('ERROR',m.text().slice(0,1800));}});
await page.addInitScript(()=>{window.__glErrors=[];});
await page.goto('http://127.0.0.1:5188/?showcase&rd=8');
await page.waitForFunction(()=>window.__game?.spawned,null,{timeout:120000});
await page.evaluate(()=>{const g=window.__game;const render=g.renderer.render.bind(g.renderer);g.renderer.render=(...args)=>{render(...args);const e=g.gl.getError();if(e&&window.__glErrors.length<30)window.__glErrors.push(e);};g.hideGui=true;g.freezeTime=true;g.setScreen(null);g.opts.maxFps=120;g.opts.bobView=false;});
await page.waitForTimeout(8000);
report.gpu=await page.evaluate(()=>{const gl=window.__game.gl,e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null;});
async function shot(name,settings={}){
 await page.evaluate(s=>{
  const g=window.__game;
  if(s.pos)g.teleport(s.pos[0],s.pos[1]-g.player.eyeHeight,s.pos[2],s.yaw??0,s.pitch??0);
  else{g.player.yaw=s.yaw??g.player.yaw;g.player.pitch=s.pitch??g.player.pitch;}
  g.player.flying=true;
  if(s.time!==undefined)g.level.dayTime=s.time;
  if(s.hyper!==undefined)g.opts.hyperShader=s.hyper;
  if(s.rain!==undefined){g.level.rain=g.level.rainO=s.rain;g.level.thunder=g.level.thunderO=s.rain*0.65;g.level.raining=s.rain>0;g.level.thundering=false;g.level.rainTime=999999;g.level.clearWeatherTime=s.rain?0:999999;}
 },settings);
 await page.waitForTimeout(settings.wait??2500);
 await page.waitForFunction(()=>{const g=window.__game;return g.opts.hyperShader?g.renderer.hyper?.ready:!g.renderer.hyper;},null,{timeout:20000});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__game.gl.finish();resolve();}))));
 const state=await page.evaluate(()=>{const g=window.__game;return {dimension:g.world.dim.id,position:[g.player.x,g.player.y+g.player.eyeHeight,g.player.z],yaw:g.player.yaw,pitch:g.player.pitch,dayTime:g.level.dayTime,rain:g.level.rain,hyper:g.opts.hyperShader,meshes:g.renderer.world.meshes.size,assets:g.renderer.hyper?.assetsLoaded,gl:g.gl.getError(),fps:g.fps};});
 await page.screenshot({path:output+name+'.png'});
 report.scenes.push({name,...state});console.log('SHOT',name,JSON.stringify(state));
 writeFileSync(output+'report.json',JSON.stringify(report,null,2));
}
async function dimension(name,pos){
 await page.evaluate(async({name,pos})=>{const dims=await import('/src/world/dimension.ts');const g=window.__game;g.changeDimension(dims[name],pos[0],pos[1]-g.player.eyeHeight,pos[2],null,false);g.player.flying=true;},{name,pos});
 await page.waitForFunction(()=>window.__game?.spawned,null,{timeout:120000});
 await page.evaluate(()=>window.__game.setScreen(null));
 await page.waitForTimeout(6500);
}
try{
 if(!process.env.END_ONLY){
  await shot('01-coast-day',{pos:[696.5,71.6,-600.5],yaw:90,pitch:13,time:3500,rain:0});
  await shot('02-coast-original',{hyper:false});
  await shot('03-coast-shader-restored',{hyper:true});
  const water=await page.evaluate(async()=>{
   const {blockOf}=await import('/src/world/block.ts');const g=window.__game;let best=null,score=1e9;
   for(let x=660;x<730;x+=2)for(let z=-638;z<-570;z+=2){
    if(!g.world.isLoaded(x,z))continue;
    if(blockOf(g.world.getState(x,62,z)).name!=='water'||blockOf(g.world.getState(x,58,z)).name!=='water')continue;
    const s=Math.hypot(x-696,z+600);if(s<score){best=[x+0.5,61.0,z+0.5];score=s;}
   }return best;
  });
  if(!water)throw new Error('No deep water column found in coast scene');
  console.log('WATER',water);
  await shot('04-underwater-up',{pos:water,yaw:90,pitch:-65});
  await shot('05-underwater-up-rotated',{yaw:230,pitch:-45});
  await shot('06-underwater-bed',{yaw:65,pitch:35});
  await shot('07-waterline-below',{pos:[water[0],62.70,water[2]],yaw:90,pitch:-8});
  await shot('08-waterline-above',{pos:[water[0],63.08,water[2]],yaw:90,pitch:9});
  await shot('09-shore-low',{pos:[water[0],64.1,water[2]],yaw:80,pitch:8});
  await shot('10-coast-sunset',{pos:[696.5,71.6,-600.5],yaw:90,pitch:6,time:12500});
  await shot('11-coast-night',{time:18000});
  await shot('12-coast-snowstorm',{time:3500,rain:1,wait:6000});
  await dimension('THE_NETHER',[0.5,64,0.5]);
  const view=await page.evaluate(async()=>{
   const {blockOf}=await import('/src/world/block.ts');const g=window.__game;
   for(let y=54;y>33;y--)for(let x=-48;x<48;x+=4)for(let z=-48;z<48;z+=4){
    if(g.world.isLoaded(x,z)&&blockOf(g.world.getState(x,y,z)).name==='air'&&blockOf(g.world.getState(x,y+2,z)).name==='air')return [x+0.5,y+1,z+0.5];
   }return [0.5,64,0.5];
  });
  await shot('13-nether-wide',{pos:view,yaw:60,pitch:10,rain:0,time:3500});
  await shot('14-nether-reverse',{yaw:240,pitch:-10});
 }
 await dimension('THE_END',[18.5,78,8.5]);
 await shot('15-end-wide',{pos:[58.5,72,-35.5],yaw:0,pitch:-13,time:3500,rain:0,wait:4500});
 await shot('16-end-black-hole',{pos:[58.5,72,-35.5],yaw:19.25,pitch:-13.8});
 await shot('17-end-planet',{yaw:-47.7,pitch:-25});
 await shot('18-end-ground',{pos:[22.5,66,22.5],yaw:135,pitch:8});
 await shot('19-end-rear-sky',{pos:[18.5,78,8.5],yaw:180,pitch:-20});
 await page.setViewportSize({width:1200,height:800});
 await shot('20-end-resized',{yaw:0,pitch:-13});
 await page.setViewportSize({width:1600,height:900});
 await shot('21-end-original',{hyper:false});
 await shot('22-end-restored',{hyper:true});
 await page.evaluate(async()=>{
  const {BLOCK_BY_NAME}=await import('/src/world/block.ts');const g=window.__game;
  for(let x=18;x<21;x++)for(let z=18;z<21;z++){
   g.world.setState(x,78,z,BLOCK_BY_NAME.get('end_portal').defaultState);
   g.world.setState(x,77,z,BLOCK_BY_NAME.get('end_stone').defaultState);
  }
 });
 await shot('23-end-portal-vivid',{pos:[19.5,82,23.5],yaw:180,pitch:47,hyper:true,wait:4000});
 await shot('24-end-portal-original',{hyper:false});
 report.glErrors=await page.evaluate(()=>window.__glErrors);
 if(report.glErrors.length||report.errors.length)process.exitCode=1;
}finally{
 writeFileSync(output+'report.json',JSON.stringify(report,null,2));
 console.log('REPORT',output+'report.json');
 await browser.close();
}
