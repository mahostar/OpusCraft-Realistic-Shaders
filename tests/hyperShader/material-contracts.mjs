import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const b=await chromium.launch({headless:true}),p=await b.newPage();
await p.route('**/__material_test__',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Material contracts</title>'}));await p.goto('http://127.0.0.1:5188/__material_test__');
try{
 const r=await p.evaluate(async()=>{
  const {terrainMaterial}=await import('/src/render/materialTags.ts'),{CromosWater,cromosBiome}=await import('/src/render/cromosWater.ts'),{CROMOS_WATER}=await import('/src/render/cromosWaterData.ts');
  const w=new CromosWater();w.update('warm_ocean',0);const warm={extinction:[...w.extinction],waves:[...w.waves]};
  w.update('swamp',0.016);const transition=[...w.extinction];for(let i=1;i<=300;i++)w.update('swamp',i/60);const swamp={extinction:[...w.extinction],waves:[...w.waves]};
  return {tags:[terrainMaterial('sand',false,false),terrainMaterial('grass_block',true,false),terrainMaterial('short_grass',true,true),terrainMaterial('oak_leaves',false,true),terrainMaterial('white_wool',false,false),terrainMaterial('sand',false,false,true),terrainMaterial('seagrass',false,true,true),terrainMaterial('stone',false,false,true)],warm,transition,swamp,mappings:['cold_ocean','deep_cold_ocean','swamp','snowy_taiga','jungle','plains','warm_ocean'].map(cromosBiome),count:Object.keys(CROMOS_WATER).length};
 });
 assert.deepEqual(r.tags,[251,250,249,252,255,247,246,248]);assert.equal(r.count,9);assert.deepEqual(r.mappings,['frozen','frozen','swamp','frozen','jungle','water','warm_ocean']);
 assert.ok(Math.abs(r.transition[0]-r.warm.extinction[0])<0.02,'Biome transition must not pop');assert.ok(r.swamp.extinction[2]>r.swamp.extinction[1]*2,'Organic particles preferentially absorb blue, not red');assert.ok(r.swamp.extinction[2]>r.warm.extinction[2]*10,'Pack concentration differences remain substantial');assert.ok(Math.abs(r.swamp.waves[2]-0.24)<0.001);assert.equal(r.warm.waves[0],0.42);
 console.log('PASS',JSON.stringify(r));
}finally{await b.close();}
