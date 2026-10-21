// IterationT End sky adaptation for OpusCraft's camera-relative WebGL2 renderer.
// Planet/ring model: user-supplied IterationT 2.0 world1/composite1.fsh.
// Volumetric accretion/light bending: IterationT 3.0 EndSky.glsl recovered at
// https://gist.github.com/helloworld3200/d96131671e8023ca4db8937594799bda
// That source credits https://www.shadertoy.com/view/lstSRS (Sonic Ether).
// See licenses/ITERATIONT-PROVENANCE.md for source paths, hashes and changes.
export const END_SKY = `
const vec3 END_LIGHT = vec3(-0.32,0.24,0.9165);
float endNoise3(vec3 p){
  vec3 a=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  vec2 uv=a.xy+17.0*a.z+f.xy;
  vec2 n=texture(u_endNoise,(uv+0.5)/64.0).zy;
  return mix(n.x,n.y,f.z);
}
float endCloud(vec3 p){
  float value=0.0,weight=0.5;
  for(int j=0;j<4;j++){value+=endNoise3(p)*weight;p=(p+u_time*vec3(0.10,0.07,0.0))*2.5;weight*=0.87;}
  return value+0.087;
}
vec3 endThermal(float t){
  // Linear RGB approximation of the source's Planckian chromaticity.
  float x=clamp((t-2700.0)/9300.0,0.0,1.0);
  return mix(vec3(1.0,0.40,0.075),vec3(0.78,0.88,1.0),smoothstep(0.0,0.8,x));
}
vec3 endStarfield(vec3 d){
  // 3D cells avoid the seams and pole stretching of latitude/longitude stars.
  vec3 p=d*384.0,i=floor(p),f=fract(p)-0.5;
  vec3 h=fract(i*vec3(443.897,441.423,437.195));h+=dot(h,h.yzx+19.19);
  vec2 seed=fract((h.xx+h.yz)*h.zy);
  float star=smoothstep(0.992,1.0,seed.x)*exp(-dot(f,f)*16.0);
  vec3 c=vec3(0.0014,0.002,0.0032)+endThermal(4000.0+seed.y*8000.0)*star*2.0;
  // A very faint dusty band, leaving the planet and hole in control of the sky.
  float band=pow(max(0.0,1.0-abs(d.y*1.9+d.x*0.45)),5.0);
  c+=vec3(0.005,0.006,0.009)*band*endNoise3(d*18.0);
  return c;
}
float endRingDensity(float radius){
  float v=0.0,a=0.5,p=radius*0.5+0.69;
  for(int j=0;j<5;j++){v+=a*texture(u_endNoise,vec2(p,0.0)).z;p*=4.0;a*=0.5;}
  return pow(clamp((v-0.075)*1.5,0.0,1.0),3.0);
}
vec3 endPlanet(vec3 d,vec3 background){
  // Same 20-million-metre planet / 35-million-metre observer ratio as the
  // supplied pack. Unit rescaling keeps intersection precision stable.
  vec3 center=normalize(vec3(0.67,0.43,0.61))*3.5;
  vec3 normal=normalize(vec3(0.13,0.98,0.12));
  float b=dot(-center,d),delta=b*b-12.25+4.0;
  float planetT=1e8;
  vec3 result=background;
  if(delta>0.0 && -b-sqrt(delta)>0.0){
    planetT=-b-sqrt(delta);
    vec3 n=normalize(d*planetT-center);
    vec3 sunlight=normalize(vec3(-0.55,0.65,-0.65));
    float ndl=max(dot(n,sunlight),0.0);
    vec3 east=normalize(cross(normal,vec3(0,0,1))),north=cross(east,normal);
    vec2 uv=vec2(atan(dot(n,east),dot(n,north))/6.2831853+0.5+u_time*0.00015,acos(clamp(dot(n,normal),-1.0,1.0))/3.14159265);
    vec3 albedo=pow(texture(u_planet,uv).rgb,vec3(2.2));
    float luminance=dot(albedo,vec3(0.2126,0.7152,0.0722));
    albedo=max(vec3(0.0),mix(vec3(luminance),albedo,1.22));
    float light=0.026+1.55*pow(ndl,0.85);
    result=albedo*light;
    // A lit atmospheric rim and a cool, dark night side give the sphere
    // shape and scale without flattening its surface into a pale disk.
    float limb=pow(1.0-max(dot(n,-d),0.0),4.0);
    result+=vec3(0.12,0.13,0.16)*limb*pow(ndl,0.45);
    result+=albedo*vec3(0.018,0.012,0.035)*(1.0-smoothstep(0.0,0.2,ndl));
    result=mix(background,result,smoothstep(0.0,max(0.00001,fwidth(delta))*1.5,delta));
  }
  float denom=dot(d,normal);
  if(abs(denom)>0.00001){
    float t=dot(center,normal)/denom;
    if(t>0.0 && t<planetT){
      vec3 pos=d*t-center;float radius=length(pos)/2.0;
      if(radius>1.6 && radius<2.6){
        float density=endRingDensity(radius)*smoothstep(1.6,1.7,radius)*(1.0-smoothstep(2.55,2.6,radius));
        float shadow=length(cross(normalize(END_LIGHT),pos))<2.0 && dot(pos,END_LIGHT)<0.0?0.05:1.0;
        float opacity=1.0-exp(-density*5.0);
        result=mix(result,vec3(0.65,0.56,0.39)*shadow,opacity);
      }
    }
  }
  return result;
}
vec3 traceIterationEndSky(vec3 worldRay){
  vec3 axis=normalize(END_LIGHT);
  vec3 right=normalize(cross(vec3(0,1,0),axis)),up=cross(axis,right);
  vec3 ray=vec3(dot(worldRay,right),dot(worldRay,up),dot(worldRay,axis));
  // Perspective cone includes the entire disk and lensing field. The sky
  // outside it still renders the same world-anchored planet and stars.
  if(ray.z<0.76)return endPlanet(worldRay,endStarfield(worldRay));
  vec3 pos=vec3(0.0,0.55,-8.0)+ray*3.0;
  vec3 radiance=vec3(0.0);float trans=1.0;
  // Two substeps per original 0.2 step. Warp is rescaled by step length,
  // preserving the original trajectory while removing coarse ray banding.
  const float ds=0.10;
  float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))));
  pos+=ray*ds*jitter;
  bool captured=false;
  for(int i=0;i<110;i++){
    float rr=dot(pos,pos);
    if(rr<0.12){captured=true;break;}
    if(trans<0.0005)break;
    ray=normalize(ray-normalize(pos)*(0.030/(rr+0.000001)));
    pos+=ray*ds;
    // The source's edge-on disk is a luminous participating medium, not
    // concentric opaque strips. This retains the white lensed upper arc.
    vec3 disk=pos;
    float r=length(disk),height=disk.y;
    float gradient=clamp(1.0-(r-0.5)/7.0,0.0,1.0);
    float thick=max(0.008,0.1*gradient);
    float radial=pow(gradient,4.0)*pow(max(1.0-gradient,0.0),0.9)*12.0;
    float fade=pow(abs(r-0.5)+0.4,4.0)*0.04;
    float glowProfile=1.0/(height*height*40.0+fade+0.00002);
    glowProfile*=clamp(2.0-abs(height)/thick,0.0,1.0);
    float density=clamp(radial*clamp(1.0-abs(height)/thick,0.0,1.0)*0.7+glowProfile*glowProfile*0.1,0.0,1.0);
    if(density>0.0001){
      float angle=atan(-disk.z,-disk.x);
      float turbulence=endCloud(vec3(r,angle*(1.0-gradient*0.5),height*0.1)*3.5);
      density*=pow(turbulence,5.0)*radial;
      float g=1.0-gradient,strength=1.0/(g*g*g*g*400.0+0.002);
      float orbital=clamp(1.0+disk.x/max(r,0.01)*0.35,0.6,1.5);
      vec3 glow=endThermal((2700.0+strength*50.0)*orbital)*(0.12+pow(strength,0.72)*0.10)*orbital;
      float a=1.0-exp(-density*5.0*(ds/0.2));
      radiance+=glow*a*trans;trans*=1.0-a;
    }
    float torus=length(vec2(length(disk-vec3(0,0.05,0)))-vec2(1.0,0.01));
    float corona=1.0/(pow(torus,3.5)+0.001)*step(0.5,r);
    radiance+=endThermal(12000.0)*corona*0.002*(ds/0.2)*trans;
  }
  vec3 bent=normalize(right*ray.x+up*ray.y+axis*ray.z);
  vec3 background=captured?vec3(0.0):endPlanet(worldRay,endStarfield(bent));
  return background*trans+radiance;
}
vec3 iterationEndSky(vec3 ray){
  vec3 c=traceIterationEndSky(ray);
  float air=0.25*exp(-max(ray.y,0.0)*5.0);
  vec3 haze=vec3(0.055,0.028,0.10)+vec3(0.07,0.055,0.028)*pow(max(dot(ray,normalize(END_LIGHT)),0.0),8.0);
  return c*exp(-air)+haze*(1.0-exp(-air));
}
`;
