import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const output=fileURLToPath(new URL('../../evidence/water-phase/',import.meta.url));mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=d3d11']});
const page=await browser.newPage({viewport:{width:1280,height:720}}),report={errors:[],checks:[]};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
try{
 await page.route('**/__water_clock__',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Water phase contracts</title>'}));await page.goto('http://127.0.0.1:5188/__water_clock__');
 report.math=await page.evaluate(async()=>{
  const {CromosWater}=await import('/src/render/cromosWater.ts');const tau=Math.PI*2;
  const delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  function simulate(start,x,z,hz){
   const w=new CromosWater();w.update('plains',start,x,z);let t=start,steps=[],causticSteps=[],legacyWorst=0;
   for(let i=1;i<=hz*5;i++){
    const old=[...w.wavePhases],oldCaustic=w.causticPhase,legacy=(x*Math.cos(Math.PI/6)+z*.5-t*w.waves[1])*w.waves[0]*tau;
    t=start+i/hz;w.update('warm_ocean',t,x,z);
    steps.push(delta(w.wavePhases[0],old[0]));causticSteps.push((w.causticPhase-oldCaustic+64)%64);
    legacyWorst=Math.max(legacyWorst,Math.abs((x*Math.cos(Math.PI/6)+z*.5-t*w.waves[1])*w.waves[0]*tau-legacy));
   }
   return {steps,causticSteps,legacyWorst,phase:[...w.wavePhases]};
  }
  const young=simulate(5,1534,-611,60),old=simulate(60000,1534,-611,60),remote=simulate(60000,1000000,-1000000,60);
  let ageError=0,positionError=0;for(let i=0;i<young.steps.length;i++){ageError=Math.max(ageError,Math.abs(young.steps[i]-old.steps[i]));positionError=Math.max(positionError,Math.abs(old.steps[i]-remote.steps[i]));}
  // Camera motion must cancel in the world-space phase at constant spectrum.
  const w=new CromosWater(),start=10000,origin=[1500,-600],point=[1503,-598];w.update('warm_ocean',start,...origin);
  const at=(water)=>((point[0]-water.waveOrigin[0])*Math.cos(Math.PI/6)+(point[1]-water.waveOrigin[1])*.5)*water.waves[0]*tau+water.wavePhases[0];
  let previous=at(w),cameraError=0;
  for(let i=1;i<=360;i++){
   const moved=i<=120?i*.025:3;w.update('warm_ocean',start+i/60,origin[0]+moved,origin[1]+moved*.4);
   const expected=-w.waves[0]*tau*w.waves[1]/60,current=at(w);
   cameraError=Math.max(cameraError,Math.abs(delta(current,previous)-expected));previous=current;
  }
  const paused=[...w.wavePhases],pausedCa=w.causticPhase;for(let i=0;i<20;i++)w.update('warm_ocean',start+6,...w.waveOrigin);
  const pauseError=Math.max(...paused.map((v,i)=>Math.abs(v-w.wavePhases[i])),Math.abs(pausedCa-w.causticPhase));
  const f30=simulate(5,1534,-611,30),f120=simulate(5,1534,-611,120);
  const fpsError=Math.max(...f30.phase.map((v,i)=>Math.abs(delta(v,f120.phase[i]))));
  const reverse=new CromosWater();reverse.update('warm_ocean',1000);reverse.update('warm_ocean',1000.03);const p=[...reverse.wavePhases];reverse.update('warm_ocean',1000.01);reverse.update('warm_ocean',1000.02);
  const backwardError=Math.max(...p.map((v,i)=>Math.abs(v-reverse.wavePhases[i])));
  return {ageError,positionError,cameraError,pauseError,fpsError,backwardError,maxWaveStep:Math.max(...old.steps.map(Math.abs)),minCausticStep:Math.min(...old.causticSteps),maxCausticStep:Math.max(...old.causticSteps),legacyWorstStep:old.legacyWorst};
 });
 for(const key of ['ageError','positionError','cameraError','pauseError','backwardError'])assert.ok(report.math[key]<1e-7,key+' must stay stable: '+report.math[key]);
 assert.ok(report.math.fpsError<0.005,'Phase integration must agree across 30/120 FPS');
 assert.ok(report.math.maxWaveStep<0.10,'No biome-transition wave speed burst');assert.ok(report.math.minCausticStep>.18&&report.math.maxCausticStep<.23,'Caustics keep their configured cadence');
 assert.ok(report.math.legacyWorstStep>100,'The old formula reproduces the burst in the same transition');
 report.checks.push('Wave/caustic speed independent of world age and coordinates','Camera motion cancels without dragging waves','Stopping and pausing do not accelerate the phase','30/120 FPS integration agreement','Backward partial-tick timestamps do not replay time');
 console.log('MATH',JSON.stringify(report.math));
 await page.goto('http://127.0.0.1:5188/?showcase&rd=6');await page.waitForFunction(()=>window.__game?.spawned,null,{timeout:180000});
 await page.evaluate(()=>{const g=window.__game;g.input.forceLocked=true;g.setScreen(null);g.hideGui=true;g.freezeTime=true;g.opts.bobView=false;g.level.dayTime=3500;g.teleport(696.5,71.62-g.player.eyeHeight,-600.5,90,13);g.player.flying=true;});
 await page.waitForFunction(()=>window.__game.renderer.hyper?.ready,null,{timeout:120000});await page.waitForTimeout(4000);
 report.boundary=await page.evaluate(async()=>{
  const g=window.__game,{BIOMES}=await import('/src/world/gen/biomes.ts'),{cromosBiome}=await import('/src/render/cromosWater.ts'),{CROMOS_WATER}=await import('/src/render/cromosWaterData.ts');let best=null,distance=Infinity;
  for(let x=580;x<=810;x+=2)for(let z=-710;z<=-490;z+=2){if(!g.world.isLoaded(x,z)||!g.world.isLoaded(x+2,z))continue;const a=BIOMES[g.world.getBiome(x,z)].name,b=BIOMES[g.world.getBiome(x+2,z)].name;
   const ka=cromosBiome(a),kb=cromosBiome(b),pa=CROMOS_WATER[ka],pb=CROMOS_WATER[kb];
   if(pa.waves.frequency===pb.waves.frequency&&pa.waves.speed===pb.waves.speed&&pa.caustics.frame_length===pb.caustics.frame_length)continue;
   const d=Math.hypot(x-696,z+600);if(d<distance){best={x,z,a,b,profiles:[ka,kb]};distance=d;}
  }return best;
 });assert.ok(report.boundary,'A real biome boundary must be found');
 await page.evaluate(({x,z})=>{const g=window.__game;g.teleport(x-1,85-g.player.eyeHeight,z+.5,90,30);g.player.flying=true;},{...report.boundary});await page.waitForTimeout(1000);
 const movie=await page.evaluate(async({x,z})=>{
  const g=window.__game,stream=g.canvas.captureStream(30),chunks=[],samples=[];
  const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:6000000});
  const result=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const r=new FileReader();r.onload=()=>resolve({video:r.result.split(',')[1],samples});r.readAsDataURL(new Blob(chunks,{type:'video/webm'}));};});
  recorder.start();const started=performance.now();
  await new Promise(resolve=>{function frame(now){const t=Math.max(0,(now-started)/1000),m=Math.min(t/2,1);g.teleport(x-1+4*m,85-g.player.eyeHeight,z+.5,90+Math.sin(Math.min(t,2)*Math.PI)*12,30);g.player.flying=true;const w=g.renderer.hyper.water;samples.push({t,time:g.renderer.hyper.time,profile:w.key,phase:[...w.wavePhases],caustic:w.causticPhase});if(t<6)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
  recorder.stop();return result;
 },report.boundary);writeFileSync(output+'move-stop.webm',Buffer.from(movie.video,'base64'));report.samples=movie.samples;
 let maxWaveRate=0,minCausticRate=Infinity,maxCausticRate=0;
 for(let i=1;i<movie.samples.length;i++){
  const a=movie.samples[i-1],b=movie.samples[i],dt=b.time-a.time;if(a.t<2.3||dt<=0)continue;
  const d=b.phase[0]-a.phase[0];maxWaveRate=Math.max(maxWaveRate,Math.abs(Math.atan2(Math.sin(d),Math.cos(d))/dt));
  const rate=((b.caustic-a.caustic+64)%64)/dt;minCausticRate=Math.min(minCausticRate,rate);maxCausticRate=Math.max(maxCausticRate,rate);
 }
 report.stoppedRates={maxWaveRadiansPerSecond:maxWaveRate,causticFramesPerSecond:[minCausticRate,maxCausticRate]};
 assert.ok(maxWaveRate<6,'Live phase must not accelerate after the camera stops');assert.ok(minCausticRate>10&&maxCausticRate<14,'Live caustic animation must retain the configured cadence');
 report.runtime=await page.evaluate(()=>{const g=window.__game;return {gl:g.gl.getError(),fps:g.fps,profile:g.renderer.hyper.water.key};});
 assert.equal(report.runtime.gl,0);assert.ok(new Set(movie.samples.map(s=>s.profile)).size>=2,'Live movement must cross the actual boundary');assert.equal(report.errors.length,0);
 await page.screenshot({path:output+'after-stop.png'});report.checks.push('Live shader compiles and camera crosses a real biome boundary then stops for four seconds','Moving clip and zero browser/WebGL errors');console.log('PASS',JSON.stringify({checks:report.checks,runtime:report.runtime,boundary:report.boundary}));
}finally{writeFileSync(output+'report.json',JSON.stringify(report,null,2));await browser.close();}
