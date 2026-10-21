// Matched camera/quality benchmark. GPU queries are read asynchronously, never gl.finish in timed frames.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const label=process.argv[2]??'baseline';
const base=process.env.GAME_URL??'http://127.0.0.1:5188';
const uncapped=process.argv.includes('--uncapped'),resolution=process.argv.includes('--1080p')?1080:0;
const distance=Number(process.argv.find(a=>a.startsWith('--rd='))?.split('=')[1]??8);
const sustained=process.argv.includes('--sustained');
const output=new URL(`../../evidence/performance/${label}/`,import.meta.url);mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=d3d11',...(uncapped?['--disable-frame-rate-limit','--disable-gpu-vsync']:[])]});
const page=await browser.newPage({viewport:{width:2560,height:1280}});
const report={label,viewport:[2560,1280],resolutionCap:resolution,distance,uncapped,sustained,errors:[],scenes:[]};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
async function change(dimension,pos,yaw,pitch){
 await page.evaluate(async({dimension,pos,yaw,pitch})=>{const g=window.__game,d=await import('/src/world/dimension.ts');
  if(g.world.dim.id!==d[dimension].id)g.changeDimension(d[dimension],pos[0],pos[1]-g.player.eyeHeight,pos[2],null,false);
  else g.teleport(pos[0],pos[1]-g.player.eyeHeight,pos[2],yaw,pitch);
  g.player.flying=true;g.player.yaw=g.player.yawO=yaw;g.player.pitch=g.player.pitchO=pitch;g.setScreen(null);
 },{dimension,pos,yaw,pitch});
 await page.waitForFunction(()=>window.__game.spawned,null,{timeout:180000});
 await page.waitForFunction(({pos})=>{const g=window.__game;for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){const c=g.world.getChunk((Math.floor(pos[0])>>4)+dx,(Math.floor(pos[2])>>4)+dz);if(!c||c.dirty||c.meshing)return false;}return true;},{pos},{timeout:180000});
 await page.waitForTimeout(4500);
}
async function sample(name,{rain=0,shader=true}={}){
 await page.evaluate(({rain,shader})=>{const g=window.__game;g.opts.hyperShader=shader;const l=g.level;l.rain=l.rainO=rain;l.thunder=l.thunderO=0;l.raining=rain>0;l.rainTime=999999;l.clearWeatherTime=rain?0:999999;g.setScreen(null);},{rain,shader});
 await page.waitForFunction(()=>{const g=window.__game;return g.opts.hyperShader?(g.renderer.hyper?.ready??g.renderer.hyper?.assetsLoaded===4):!g.renderer.hyper;});
 await page.waitForTimeout(3500);
 await page.evaluate(()=>window.__audit.start());
 await page.waitForFunction(()=>window.__audit.done(),null,{timeout:90000});
 const result=await page.evaluate(()=>window.__audit.result());report.scenes.push({name,...result});console.log('SCENE',name,JSON.stringify(result));
 await page.screenshot({path:new URL(name+'.png',output).pathname.replace(/^\/(\w:)/,'$1')});
}
try{
 await page.goto(`${base}/?showcase&rd=${distance}`);
 await page.waitForFunction(()=>window.__game?.spawned,null,{timeout:180000});
 await page.evaluate(({resolution,sustained})=>{const g=window.__game;g.opts.renderResolution=resolution;g.resize();g.input.forceLocked=true;g.setScreen(null);g.hideGui=true;g.freezeTime=true;g.level.dayTime=3500;g.opts.maxFps=260;g.opts.bobView=false;
  const r=g.renderer,gl=g.gl,ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');let active=false,inside=false,current=null,pending=[],gpu={},frames=[],last=0,count=0,draws={},calls={};
  const use=gl.useProgram.bind(gl),draw=gl.drawElements.bind(gl),arrays=gl.drawArrays.bind(gl),render=r.render.bind(r);let stage='other';
  function stop(){if(current){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push({query:current,stage});current=null;}}
  function name(p){const h=r.hyper,w=r.world;for(const [n,s] of Object.entries({sky:h?.skyShader,bloom:h?.bloomShader,output:h?.outputShader,volume:h?.volumeShader,shadow:w.shadowShader,'shadow-solid':w.solidShadowShader,terrain:w.hyperShader,original:w.shader,...Object.fromEntries([...(w.hyperShaders?.entries?.()??[])].map(([n,s])=>['terrain-'+n,s]))})){if(s?.program===p)return n+(n.startsWith('terrain')?(h?.reflectionPass?'-reflection':''):'');}return 'entities/other';}
  gl.useProgram=p=>{if(inside&&ext){stop();stage=name(p);current=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,current);calls[stage]=(calls[stage]??0)+1;}use(p);};
  gl.drawElements=(...a)=>{if(inside)draws[stage]=(draws[stage]??0)+1;draw(...a);};gl.drawArrays=(...a)=>{if(inside)draws[stage]=(draws[stage]??0)+1;arrays(...a);};
  function collect(){if(!ext)return;const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);pending=pending.filter(q=>{if(!gl.getQueryParameter(q.query,gl.QUERY_RESULT_AVAILABLE))return true;if(!disjoint)(gpu[q.stage]??=[]).push(gl.getQueryParameter(q.query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q.query);return false;});}
  let started=0,finished=false;
  r.render=(...a)=>{collect();if(!active||finished){render(...a);return;}const t=performance.now();inside=true;render(...a);stop();inside=false;frames.push({cpu:performance.now()-t,interval:last?t-last:null});last=t;count++;finished=count>=(sustained?180:48)&&t-started>=(sustained?6000:0);};
  const percentile=(a,p)=>{a=[...a].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor(a.length*p))];};
  window.__audit={start(){active=true;finished=false;started=performance.now();count=0;frames=[];gpu={};draws={};calls={};last=0;},done(){return finished&&pending.length===0;},result(){active=false;const intervals=frames.map(f=>f.interval).filter(v=>v!==null),mean=a=>a.reduce((s,x)=>s+x,0)/a.length;const de=gl.getExtension('WEBGL_debug_renderer_info');return {gpu:de?gl.getParameter(de.UNMASKED_RENDERER_WEBGL):null,timerSupported:!!ext,frames:count,buffer:[g.canvas.width,g.canvas.height],frameMs:mean(intervals),medianMs:percentile(intervals,.5),p95Ms:percentile(intervals,.95),fps:1000/mean(intervals),cpuMs:mean(frames.map(f=>f.cpu)),gpuMs:Object.fromEntries(Object.entries(gpu).map(([n,a])=>[n,a.reduce((s,v)=>s+v,0)/count])),drawsPerFrame:Object.fromEntries(Object.entries(draws).map(([n,v])=>[n,v/count])),programsPerFrame:Object.fromEntries(Object.entries(calls).map(([n,v])=>[n,v/count])),gl:gl.getError(),meshes:r.world.meshes.size,position:[g.player.x,g.player.y+g.player.eyeHeight,g.player.z],yaw:g.player.yaw,pitch:g.player.pitch,shader:g.opts.hyperShader};}};
 },{resolution,sustained});
 if(process.argv.includes('--rain-only')){
  await change('OVERWORLD',[1561.5,67,551.5],180,8);await sample('04-rain',{rain:1});
  await change('OVERWORLD',[1561.5,67,551.5],120,25);await sample('10-rain-ground',{rain:1});
 }else{
 await change('OVERWORLD',[696.5,71.62,-600.5],90,13);await sample('01-coast');
 await change('OVERWORLD',[696.5,71.62,-600.5],270,3);await sample('02-overworld-land');
 await change('OVERWORLD',[690.5,61,-611.5],90,-35);await sample('03-underwater');
 await change('OVERWORLD',[1561.5,67,551.5],180,8);await sample('04-rain',{rain:1});
 if(process.argv.includes('--overworld-only')){
 await change('OVERWORLD',[1561.5,67,551.5],120,25);await sample('10-rain-ground',{rain:1});
 }else{
 await change('THE_NETHER',[-47.5,55,-47.5],240,-10);await sample('05-nether');
 await change('THE_NETHER',[-47.5,55,-47.5],60,10);await sample('06-nether-lava');
 await change('THE_END',[80.5,86,-95.5],0,-10);await sample('07-end-wide');
 await change('THE_END',[80.5,86,-95.5],19.25,-13.8);await sample('08-end-black-hole');
 await sample('09-end-off',{shader:false});
 }
 }
}finally{writeFileSync(new URL('report.json',output),JSON.stringify(report,null,2));await browser.close();console.log('REPORT',output.href);}
