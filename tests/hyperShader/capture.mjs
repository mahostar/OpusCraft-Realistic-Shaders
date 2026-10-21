import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = new URL('../../evidence/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl','--ignore-gpu-blocklist','--use-angle=d3d11'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
if(process.env.GL_TRACE)await page.addInitScript(()=>{
 const proto=WebGL2RenderingContext.prototype, getError=proto.getError;
 let count=0;
 for(const name of ['drawElements','drawArrays','blitFramebuffer','texImage2D','uniformMatrix4fv','uniform1i','bindFramebuffer','bindTexture']){
   const original=proto[name];proto[name]=function(...args){const result=original.apply(this,args);const e=getError.call(this);if(e && count++<12)console.error('GL_TRACE',name,e,new Error().stack);return result;};
 }
});
const errors=[];
page.on('pageerror', e=>{errors.push(String(e));console.log('PAGEERROR',String(e));});
page.on('console', m=>{if(m.type()==='error'){errors.push(m.text());console.log('CONSOLE',m.text().slice(0,1600));}});
await page.goto('http://127.0.0.1:5188/?showcase&rd=8',{waitUntil:'domcontentloaded'});
console.log('Loaded page');
await page.waitForFunction(()=>window.__game?.inWorld,{timeout:120000});
console.log('World initialized');
for(let i=0;i<60;i++){
  await page.waitForTimeout(2000);
  const s=await page.evaluate(()=>{const g=window.__game;return {spawned:g.spawned,meshes:g.renderer.world.meshes.size,p:[g.player.x,g.player.y,g.player.z],screen:g.screen?.constructor.name,gl:g.gl.getError(),stats:g.chunks.stats};});
  if(i%5===0)console.log('STATE',JSON.stringify(s));
  if(s.spawned && s.meshes>200)break;
}
await page.evaluate(()=>{const g=window.__game;g.hideGui=true;g.freezeTime=true;g.level.dayTime=3500;g.setScreen(null);});
await page.waitForTimeout(4000);
await page.screenshot({path:out+'/coast-first.png'});
console.log('CAPTURED',out+'/coast-first.png');
console.log('GPU',await page.evaluate(()=>{const gl=window.__game.gl,e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown';}));
writeFileSync(out+'/first-errors.json',JSON.stringify(errors,null,2));
await browser.close();
if(errors.length)process.exitCode=1;
