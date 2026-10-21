import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
await page.route('**/__mip_test__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Mipmap regression</title>'}));
await page.goto('http://127.0.0.1:5188/__mip_test__');
try{
const result=await page.evaluate(async()=>{
const {downsample}=await import('/src/render/atlas.ts');

// Transparent padding may contain black or arbitrary RGB. Neither may tint
// visible leaves; fractional coverage must remain separate from their colour.
const leaf=[34,150,52];
const sprite=new Uint8ClampedArray(4*4*4);
for(let y=0;y<4;y++)for(let x=0;x<4;x++){
 const i=(y*4+x)*4,visible=x%2===0&&y%2===0;
 sprite.set(visible?[...leaf,255]:[255,0,255,0],i);
}
const mip=downsample(sprite,4,true),smallest=downsample(mip,2,true);
return {leaf,mip:[...mip],smallest:[...smallest],empty:[...downsample(new Uint8ClampedArray(16),2,true)],opaque:[...downsample(new Uint8ClampedArray(16).fill(255),2,false)]};
});
const {leaf,mip,smallest}=result;
for(const pixels of [mip,smallest])for(let i=0;i<pixels.length;i+=4){
 for(let channel=0;channel<3;channel++)assert.ok(Math.abs(pixels[i+channel]-leaf[channel])<=2,'Repeated mip levels preserve the leaf colour');
 assert.ok(pixels[i+3]>=127&&pixels[i+3]<255,'Coverage remains partial and survives the existing cutout threshold');
}
assert.deepEqual(result.empty,[0,0,0,0]);
assert.deepEqual(result.opaque,[255,255,255,255]);
console.log('PASS transparent RGB cannot blacken or tint foliage; repeated mip levels preserve colour and coverage; empty/opaque cases remain valid');
}finally{await browser.close();}
