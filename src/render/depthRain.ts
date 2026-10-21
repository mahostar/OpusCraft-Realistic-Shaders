import { createTexture, type GL } from './gl';
import type { EntityBatch } from './entityRenderer';
import type { World } from '../world/world';
import type { Camera } from './renderer';
import { BIOMES } from '../world/gen/biomes';

const fract=(x:number)=>x-Math.floor(x);
const hash=(x:number,z:number,n:number)=>fract(Math.sin(x*127.1+z*311.7+n*74.7)*43758.5453);

/** Sparse world-space rain: short, falling segments, never a screen overlay. */
export class DepthRain {
  private readonly texture: WebGLTexture;
  visibleDrops=0;
  constructor(gl:GL){
    const width=16,height=64,data=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const across=(x+0.5)/width*2-1,along=(y+0.5)/height;
      const taper=Math.pow(Math.sin(along*Math.PI),0.65);
      const alpha=Math.exp(-across*across*18)*taper;
      const i=(y*width+x)*4;
      data[i]=185;data[i+1]=210;data[i+2]=235;data[i+3]=Math.round(alpha*210);
    }
    this.texture=createTexture(gl,width,height,data,{nearest:false,clamp:true});
  }
  render(batch:EntityBatch,world:World,cam:Camera,rain:number,ticks:number,partial:number,tempAt:((biome:number,x:number,y:number,z:number)=>number)|null):void{
    this.visibleDrops=0;
    const seconds=(ticks+partial)/20;
    const radius=28,cell=5,cx=Math.floor(cam.x/cell),cz=Math.floor(cam.z/cell);
    // Slabs are anchored to world coordinates. Crossing a cell boundary
    // reveals existing droplets rather than moving a camera-attached sheet.
    const base=Math.floor(cam.y/48)*48-48;
    const windX=0.8+Math.sin(seconds*0.06)*0.2,windZ=0.28;
    batch.begin({texture:this.texture,cutoff:0.005,blend:true,cull:false,lit:false,useLightmap:true,depthWrite:false});
    for(let iz=cz-6;iz<=cz+6;iz++)for(let ix=cx-6;ix<=cx+6;ix++)for(let n=0;n<4;n++){
      const seed=hash(ix,iz,n);
      if(seed>rain)continue;
      const speed=12+hash(ix,iz,n+20)*5;
      const phase=hash(ix,iz,n+40)*48-seconds*speed;
      const wrapped=fract(phase/48)*48,age=(48-wrapped)/speed;
      const x=ix*cell+hash(ix,iz,n+10)*cell+windX*age;
      const z=iz*cell+hash(ix,iz,n+30)*cell+windZ*age;
      if(!world.isLoaded(Math.floor(x),Math.floor(z)))continue;
      const biome=world.getBiome(Math.floor(x),Math.floor(z)),b=BIOMES[biome];
      if(!b?.precipitation)continue;
      const top=world.heightAt(Math.floor(x),Math.floor(z));
      for(let slab=0;slab<3;slab++){
        const y=base+slab*48+wrapped;
        if(y<top+0.15)continue;
        if((tempAt?tempAt(biome,x,y,z):b.temperature)<0.15)continue;
        const px=x-cam.x,py=y-cam.y,pz=z-cam.z,distance=Math.hypot(px,py,pz);
        if(distance<1.0||distance>radius)continue;
        const length=Math.min(0.26+speed*0.013,(y-top)*1.7);
        const width=0.004+hash(ix,iz,n+50)*0.003;
        const vl=Math.hypot(windX,speed,windZ),vx=windX/vl,vy=-speed/vl,vz=windZ/vl;
        let sx=vy*pz-vz*py,sy=vz*px-vx*pz,sz=vx*py-vy*px;
        const sl=Math.hypot(sx,sy,sz)||1;sx*=width/sl;sy*=width/sl;sz*=width/sl;
        const hx=vx*length*0.5,hy=vy*length*0.5,hz=vz*length*0.5;
        const alpha=Math.min(1,distance-1)*Math.min(1,(radius-distance)/7)*0.5*rain;
        const light=world.getLight(Math.floor(x),Math.floor(y),Math.floor(z));
        batch.lightB=(light&15)*16;batch.lightS=(light>>4)*16;
        const quad=[
          [px-hx-sx,py-hy-sy,pz-hz-sz,0,0],
          [px-hx+sx,py-hy+sy,pz-hz+sz,1,0],
          [px+hx+sx,py+hy+sy,pz+hz+sz,1,1],
          [px+hx-sx,py+hy-sy,pz+hz-sz,0,1],
        ];
        for(const k of [0,1,2,0,2,3]){const v=quad[k];batch.vertexRaw(v[0],v[1],v[2],v[3],v[4],1,1,1,alpha,0,1,0);}
        this.visibleDrops++;
      }
    }
    batch.flush();
  }
}
