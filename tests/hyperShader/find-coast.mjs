import { loadModules } from '../../scripts/load.mjs';
const {mods,close}=await loadModules(['/src/world/blocks.ts','/src/world/gen/generator.ts','/src/world/gen/biomes.ts']);
const {ChunkGenerator}=mods[1],{BIOMES}=mods[2];
const gen=new ChunkGenerator('20261020');
const hits=[];
for(let z=-1800;z<=1800;z+=48)for(let x=-1800;x<=1800;x+=48){
 const b=BIOMES[gen.biomeAt(x,z)].name;
 if(b==='beach'||b==='desert'){
   let ocean=null;
   for(const [dx,dz] of [[64,0],[-64,0],[0,64],[0,-64]])if(BIOMES[gen.biomeAt(x+dx,z+dz)].name.includes('ocean')){ocean=[dx,dz];break;}
   if(ocean)hits.push({x,z,b,ocean,dist:Math.hypot(x,z)});
 }
}
hits.sort((a,b)=>a.dist-b.dist);console.log(JSON.stringify(hits.slice(0,12),null,2));await close();
