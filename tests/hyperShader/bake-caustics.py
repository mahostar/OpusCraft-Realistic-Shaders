"""Offline refracted-ray density atlas. This is numerical texture baking, not
an edit of a reference photograph. Runtime uses two array-texture samples.
64 periodic frames, bilinear photon splats, fixed seed and no dependencies on
Bedrock's unavailable internal caustic texture.
"""
from pathlib import Path
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[2]
size=128;rays=512;frames=64;rng=np.random.default_rng(20261021)
axis=np.arange(rays,dtype=np.float64)/rays
x,y=np.meshgrid(axis,axis);gx=np.zeros_like(x);gy=np.zeros_like(y)
waves=[]
for i in range(26):
 kx,ky=rng.integers(-7,8,2)
 if kx==ky==0:kx=1
 k=float(np.hypot(kx,ky));amplitude=0.012/(1+k*k*0.10)
 waves.append((kx,ky,amplitude,rng.uniform(0,2*np.pi),int(rng.choice([-2,-1,1,2]))))
atlas=np.zeros((size*8,size*8,3),np.uint8)
for frame in range(frames):
 gx.fill(0);gy.fill(0);t=frame/frames*2*np.pi
 for kx,ky,amplitude,phase,speed in waves:
  derivative=amplitude*np.cos(2*np.pi*(kx*x+ky*y)+phase+t*speed)
  gx+=derivative*(2*np.pi*kx);gy+=derivative*(2*np.pi*ky)
 # Small-angle Snell refraction (air/water eta=1/1.333), 3m focal plane.
 # Normalize tile-space displacement; splat photon energy, not ridge lines.
 hitx=np.mod(x-gx*0.28,1.0)*size
 hity=np.mod(y-gy*0.28,1.0)*size
 ix=np.floor(hitx).astype(int)%size;iy=np.floor(hity).astype(int)%size
 fx=hitx-np.floor(hitx);fy=hity-np.floor(hity)
 density=np.zeros((size,size),np.float64)
 for dx,dy,weight in [(0,0,(1-fx)*(1-fy)),(1,0,fx*(1-fy)),(0,1,(1-fx)*fy),(1,1,fx*fy)]:
  np.add.at(density,((iy+dy)%size,(ix+dx)%size),weight)
 density/=rays*rays/(size*size)
 # R encodes density [0,8] with sqrt companding; GB carry periodic wave slopes.
 image=np.stack([np.sqrt(np.clip(density/8,0,1)),np.clip(gx[::4,::4]*1.5+.5,0,1),np.clip(gy[::4,::4]*1.5+.5,0,1)],axis=-1)
 atlas[(frame//8)*size:(frame//8+1)*size,(frame%8)*size:(frame%8+1)*size]=np.round(image*255).astype(np.uint8)
 if frame==0:print('First-frame density percentiles',np.percentile(density,[0,25,50,90,95,99,100]).round(3).tolist())
target=root/'public/hyperShader/cromos-caustics.png';Image.fromarray(atlas).save(target,optimize=True)
preview=(np.clip(density/3,0,1)*255).astype(np.uint8);Image.fromarray(preview).resize((512,512)).save(root/'evidence/cromos/caustic-density-preview.png')
print(target, target.stat().st_size)
