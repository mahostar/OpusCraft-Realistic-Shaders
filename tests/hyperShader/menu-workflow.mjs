import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const output=fileURLToPath(new URL('../../evidence/menu/',import.meta.url));
mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=d3d11']});
const context=await browser.newContext({viewport:{width:1600,height:900}});
const page=await context.newPage();
const report={errors:[],checks:[]};
page.on('pageerror',e=>{report.errors.push(String(e));console.log('ERROR',String(e).slice(0,1500));});
page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());console.log('ERROR',m.text().slice(0,1500));}});
async function check(name,value){assert.ok(value,name);report.checks.push(name);console.log('PASS',name);}
async function click(prefix){
 const point=await page.evaluate(prefix=>{
  const g=window.__game,w=g.screen.widgets.find(w=>w.label?.startsWith(prefix)&&w.visible&&w.active);
  if(!w)throw new Error('Missing button '+prefix+'; '+g.screen.widgets.map(w=>w.label).join(','));
  const r=g.canvas.getBoundingClientRect();return {x:r.left+(w.x+w.w/2)*g.gui.scale*r.width/g.canvas.width,y:r.top+(w.y+w.h/2)*g.gui.scale*r.height/g.canvas.height};
 },prefix);
 await page.bringToFront();
 await page.mouse.move(point.x,point.y);
 await page.mouse.click(point.x,point.y,{delay:100});await page.mouse.move(20,20);await page.waitForTimeout(500);
}
async function snapshot(name){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__game.gl.finish();resolve();}))));await page.screenshot({path:output+name+'.png'});}
async function titleReady(){await page.waitForFunction(()=>window.__game?.panorama?.state==='ready',null,{timeout:180000});await page.waitForTimeout(2500);}
try{
 await page.goto('http://127.0.0.1:5188/');await titleReady();
 await page.evaluate(()=>{const g=window.__game;g.opts.panoramaSpeed=0;g.panorama.spin=35;g.opts.renderDistance=4;g.saveOptions();});
 await check('No Coast shortcut in title menu',await page.evaluate(()=>!window.__game.screen.widgets.some(w=>w.label?.includes('ProjectStunning Coast'))));
 await snapshot('01-title-off');
 await click('hyperShader');
 await check('Title control persists ON',await page.evaluate(()=>window.__game.opts.hyperShader&&JSON.parse(localStorage.getItem('mc.options')).hyperShader));
 await snapshot('02-title-on');
 report.panorama=await page.evaluate(()=>{
  const g=window.__game,p=g.panorama,gl=g.gl,fb=gl.createFramebuffer();
  function stats(texture){gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);const pixels=new Uint8Array(64*64*4);gl.readPixels(480,480,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]+pixels[i+1]+pixels[i+2];return sum/(4096*3);}
  const result={original:p.faces.map(stats),shaded:p.shadedFaces.map(stats)};gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(fb);result.gl=gl.getError();return result;
 });
 await check('Both panorama variants contain six rendered faces',report.panorama.original.length===6&&report.panorama.shaded.length===6&&report.panorama.shaded.every(v=>v>1));
 await check('Shaded panorama changes world rendering',report.panorama.shaded.some((v,i)=>Math.abs(v-report.panorama.original[i])>4));
 await check('Panorama capture has no WebGL errors',report.panorama.gl===0);
 await page.reload();await titleReady();
 await check('Title setting survives reload',await page.evaluate(()=>window.__game.opts.hyperShader&&window.__game.screen.widgets.some(w=>w.label==='hyperShader: ON')));
 await click('Singleplayer');
 if(await page.evaluate(()=>window.__game.screen?.constructor.name!=='CreateWorldScreen'))await click('Create New World');
 await page.waitForFunction(()=>window.__game.screen?.constructor.name==='CreateWorldScreen');
 await click('Game Mode');await click('Game Mode');
 await click('World');
 // The actual world-creation form's seed field; fill via keyboard events.
 const seedPoint=await page.evaluate(()=>{const g=window.__game,w=g.screen.widgets.find(w=>w.constructor.name==='EditBox');if(!w)throw new Error('Seed field missing');const r=g.canvas.getBoundingClientRect();return {x:r.left+(w.x+w.w/2)*g.gui.scale,y:r.top+(w.y+w.h/2)*g.gui.scale};});
 await page.mouse.click(seedPoint.x,seedPoint.y);await page.keyboard.type('20261020');
 await snapshot('03-normal-world-creation');
 await click('Create New World');
 await page.waitForFunction(()=>window.__game?.spawned,null,{timeout:180000});
 await page.waitForFunction(()=>window.__game.renderer.hyper?.ready,null,{timeout:30000});
 await page.waitForTimeout(5000);
 report.world=await page.evaluate(()=>{const g=window.__game;return {id:g.meta.id,name:g.meta.name,shader:g.opts.hyperShader,dimension:g.world.dim.id,gl:g.gl.getError()};});
 await check('An ordinary UI-created world inherits hyperShader',report.world.shader&&report.world.id!=='projectstunning-coast-v1'&&report.world.name==='New World');
 // Use the repository's intended automation hook to avoid headless Chrome's
 // delayed pointer-lock callbacks reopening menus during native mouse clicks.
 await page.evaluate(()=>{const g=window.__game;g.input.forceLocked=true;g.input.unlock();g.openPause();});
 await page.waitForFunction(()=>!document.pointerLockElement);
 await snapshot('04-pause-on');
 await click('hyperShader');
 await page.waitForFunction(()=>!window.__game.renderer.hyper);
 await check('Pause control deactivates shader immediately',await page.evaluate(()=>!window.__game.opts.hyperShader&&!JSON.parse(localStorage.getItem('mc.options')).hyperShader));
 await snapshot('05-pause-off');
 await click('hyperShader');
 await page.waitForFunction(()=>window.__game.renderer.hyper?.ready);
 await check('Pause control reactivates shader',await page.evaluate(()=>window.__game.opts.hyperShader));
 await click('Save and Quit to Title');await titleReady();
 await check('Returning to title keeps the shared setting',await page.evaluate(()=>window.__game.screen.widgets.some(w=>w.label==='hyperShader: ON')));
 await snapshot('06-title-after-world');
 await click('hyperShader');await page.reload();await titleReady();
 await check('OFF also persists across reload',await page.evaluate(()=>!window.__game.opts.hyperShader&&window.__game.screen.widgets.some(w=>w.label==='hyperShader: OFF')));
 await check('No runtime or console errors',report.errors.length===0);
}finally{
 writeFileSync(output+'report.json',JSON.stringify(report,null,2));
 await browser.close();console.log('REPORT',output+'report.json');
}
