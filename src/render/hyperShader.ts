// ProjectStunning: geometry-bound water, depth refraction, scene reflections,
// sunlight shadows, procedural atmospheric clouds and a filmic output pass.
// All framebuffer attachments are owned here and resized/disposed together.
import { Shader, createTexture, type GL } from './gl';
import { mat4, invert, multiply, ortho, type Mat4 } from '../core/math';
import { PHOTON_PHASE } from './photonAdaptation';
import { CromosWater } from './cromosWater';
import { CROMOS_WATER } from './cromosWaterData';
import { END_SKY } from './endSky';
import type { World } from '../world/world';

/** Compile uniform dimension branches away, rather than carrying the End's
 * ray marcher and all material paths in every terrain fragment invocation. */
export function specializeHyperShader(source: string, dimension: number, pass = 0): string {
  const declarations = source.replace(/uniform[^;]+;/g, line => line.replace(/\bu_dimension\b/g, 'u_unusedDimension'));
  return declarations.replace('#version 300 es', `#version 300 es\n#define u_dimension ${dimension}.0\n#define HYPER_PASS ${pass}`);
}

// Stable 4x4 alpha coverage: minified blades must leave gaps for the ground,
// rather than turning one partially occupied mip texel into an opaque quad.
const GRASS_COVERAGE = `
bool grassCutout(vec4 tex,vec2 uv){
  vec2 footprint=fwidth(uv*vec2(textureSize(u_atlas,0)));
  float minified=smoothstep(1.0,2.5,max(footprint.x,footprint.y));
  ivec2 p=ivec2(gl_FragCoord.xy)&3;
  int low=(((p.x^p.y)&1)*2+(p.y&1));
  int high=((((p.x>>1)^(p.y>>1))&1)*2+((p.y>>1)&1));
  float threshold=(float(low*4+high)+0.5)/16.0;
  return mix(tex.a,pow(tex.a,2.2),minified)<mix(u_alphaCutoff,threshold,minified);
}
`;

const AQUATIC_SWAY = `
vec3 aquaticSway(vec3 position,float tag){
  if(tag==246.0){
    vec3 world=position+u_camera;
    position.xz+=vec2(sin(u_time*1.4+world.x*0.8+world.z*0.6),0.6*sin(u_time*2.3+world.x*1.7-world.z*1.1))*0.055;
  }
  return position;
}
`;

export const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=2) in vec2 a_uv;
layout(location=3) in vec4 a_color;
uniform mat4 u_lightMatrix;
uniform vec3 u_offset;
uniform vec3 u_camera;
uniform float u_time;
out vec2 v_uv;
flat out float v_grassBlade;
${AQUATIC_SWAY}
void main(){v_uv=a_uv;float tag=floor(a_color.a*255.0+0.5);v_grassBlade=tag==249.0?1.0:0.0;gl_Position=u_lightMatrix*vec4(aquaticSway(a_pos/2048.0-8.0+u_offset,tag),1.0);}`;
export const SHADOW_FS = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform float u_alphaCutoff;
in vec2 v_uv;
flat in float v_grassBlade;
${GRASS_COVERAGE}
void main(){vec4 tex=texture(u_atlas,v_uv);if(v_grassBlade>0.5?grassCutout(tex,v_uv):tex.a<u_alphaCutoff)discard;}`;

const ATMOSPHERE = `
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+1.0),f.x),f.y);}
float fbm(vec2 p){float v=0.0,a=0.52;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){v+=a*noise2(p);p=m*p+7.1;a*=0.5;}return v;}
// Broad, separated cumulus banks. Three octaves only, reused by the sky,
// reflection and cloud shadows; no extra cloud framebuffer or ray march.
float cloudShape(vec2 p){return noise2(p)*0.57+noise2(p*2.07+7.1)*0.29+noise2(p*4.13+19.3)*0.14;}
float cloudDensity(vec2 p){
  float bank=smoothstep(0.55,0.65,noise2(p*0.31+13.4));
  float shape=cloudShape(p);
  float fair=bank*smoothstep(0.60,0.72,shape);
  float storm=smoothstep(0.29,0.54,shape);
  return mix(fair,storm,u_rain);
}
${END_SKY}
vec3 skyRadiance(vec3 rd){
  if(u_dimension>1.5)return iterationEndSky(rd);
  if(u_dimension>0.5){
    float n=fbm(rd.xz/(abs(rd.y)+0.4)*3.0+vec2(u_time*0.008,0));
    return mix(u_fogTint*0.18,u_fogTint*1.3,pow(n,2.0))*(0.5+0.5*(1.0-rd.y));
  }
  float day=smoothstep(-0.12,0.22,u_sun.y);
  float dusk=(1.0-smoothstep(0.0,0.55,abs(u_sun.y)))*smoothstep(-0.22,0.0,u_sun.y);
  float h=pow(max(rd.y,0.0),0.45);
  vec3 zenith=mix(vec3(0.005,0.013,0.031),vec3(0.045,0.145,0.34),day);
  vec3 horizon=mix(vec3(0.018,0.030,0.058),vec3(0.36,0.52,0.64),day);
  float s=max(dot(rd,u_sun),0.0);
  horizon=mix(horizon,vec3(1.35,0.40,0.075),dusk*pow(s,2.0)*0.90*(1.0-u_rain*0.8));
  vec3 c=mix(horizon,zenith,h);
  c+=u_sunColor*pow(s,12.0)*(0.08+0.32*dusk);
  c+=u_sunColor*pow(s,160.0)*(0.22+dusk*0.85*(1.0-u_rain));
  // Forward scattering gives the low sun a luminous golden aureole.
  c+=u_sunColor*pow(s,48.0)*dusk*0.85*(1.0-u_rain);
  c+=u_sunColor*smoothstep(0.99985,0.99997,s)*7.0;
  // Sparse sunlit cumulus in the distance; leave the overhead sky clear in
  // fair weather. Storms still build a continuous, shaded weather front.
  if(rd.y>0.015){
    vec2 q=rd.xz/(rd.y+0.11)*3.6+u_camera.xz*0.008+vec2(u_time*0.005,u_time*0.0015);
    float dens=cloudDensity(q);
    dens*=mix(1.0-smoothstep(0.30,0.60,rd.y),1.0,u_rain);
    if(dens>0.002){
      float lit=clamp(0.65+(cloudShape(q)-cloudShape(q+u_sun.xz*0.23))*3.5,0.0,1.0);
      vec3 cc=mix(vec3(0.24,0.32,0.44),vec3(1.05,1.02,0.94),lit);
      cc=mix(cc,cc*u_sunColor,dusk*0.82*(1.0-u_rain*0.8));
      cc+=u_sunColor*pow(s,12.0)*(1.0-dens)*0.20*day;
      cc*=mix(0.035,1.0,day)*(1.0-u_rain*0.65);
      c=mix(c,cc,dens*smoothstep(0.015,0.09,rd.y)*u_clouds);
    }
  }
  if(day<0.8 && rd.y>0.0){
    vec2 starUV=rd.xz/(rd.y+1.0)*600.0;
    float star=step(0.998,hash21(floor(starUV)))*pow(max(0.0,1.0-length(fract(starUV)-0.5)*2.0),5.0);
    c+=star*(1.0-day)*0.8;
    c+=vec3(0.42,0.5,0.62)*smoothstep(0.9996,0.9999,dot(rd,-u_sun))*(1.0-day);
  }
  c=mix(c,vec3(dot(c,vec3(0.3,0.5,0.2)))*0.65,u_rain*0.65);
  return c+vec3(0.65,0.73,1.0)*u_flash;
}
`;

export const HYPER_TERRAIN_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_light;
layout(location=2) in vec2 a_uv;
layout(location=3) in vec4 a_color;
uniform mat4 u_proj,u_view;
uniform vec3 u_offset,u_camera;
uniform float u_fogShape,u_time;
out vec2 v_uv,v_lm;
out vec4 v_color;
out vec3 v_pos;
out float v_dist;
flat out float v_water,v_lava,v_foliage,v_grass,v_sand,v_submergedSand,v_submerged;
${AQUATIC_SWAY}
void main(){
  v_pos=a_pos/2048.0-8.0+u_offset;
  v_uv=a_uv;v_color=a_color;
  v_water=(a_color.a>0.995 && a_color.a<0.998)?1.0:0.0;
  v_lava=(a_color.a>0.990 && a_color.a<0.995)?1.0:0.0;
  float tag=floor(a_color.a*255.0+0.5);
  v_foliage=(tag==252.0 || tag==249.0 || tag==246.0 || tag==245.0)?1.0:0.0;
  v_grass=(tag==249.0 || tag==250.0)?1.0:0.0;
  v_sand=(tag==251.0 || tag==247.0)?1.0:0.0;
  v_submergedSand=tag==247.0?1.0:0.0;
  v_submerged=(tag>=245.0 && tag<=248.0)?1.0:0.0;
  // Root vertices carry tag 245, tips 246. Shadows use this same displacement.
  v_pos=aquaticSway(v_pos,tag);
  if(tag>=245.0 && tag<=254.0)v_color.a=1.0;
  gl_Position=u_proj*u_view*vec4(v_pos,1);
  v_lm=clamp(a_light/256.0,vec2(0.5/16.0),vec2(15.5/16.0));
  v_dist=u_fogShape>0.5?max(length(v_pos.xz),abs(v_pos.y)):length(v_pos);
}`;

export const HYPER_TERRAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_caustics;
uniform sampler2D u_atlas,u_lightmap,u_shadow,u_scene,u_depth,u_reflection,u_noise,u_galaxy,u_endNoise,u_planet,u_rainHeight;
uniform mat4 u_lightMatrix,u_invVP,u_vp,u_reflectVP;
uniform vec3 u_camera,u_sun,u_sunColor,u_fogTint;
uniform vec3 u_waterExtinction,u_waterScatter;
uniform vec4 u_waterWaves;
uniform vec2 u_waterCaustics;
uniform vec3 u_wavePhases;
uniform float u_causticPhase,u_waveSampleWidth;
uniform float u_brightness,u_nightVision,u_flash,u_debug;
uniform vec4 u_fogColor;
uniform vec2 u_fog,u_resolution,u_rainOrigin,u_depthLinear;
uniform float u_alphaCutoff,u_time,u_rain,u_clouds,u_underwater,u_reflectY,u_reflectionPass,u_dimension,u_wetness,u_reflectionAvailable;
in vec2 v_uv,v_lm;
in vec4 v_color;
in vec3 v_pos;
in float v_dist;
flat in float v_water,v_lava,v_foliage,v_grass,v_sand,v_submergedSand,v_submerged;
out vec4 o;
${ATMOSPHERE}
${GRASS_COVERAGE}
vec3 unproject(vec2 uv,float d){vec4 p=u_invVP*vec4(uv*2.0-1.0,d*2.0-1.0,1);return p.xyz/p.w;}
float visibility(vec3 p,vec3 n){
  vec4 lp=u_lightMatrix*vec4(p,1.0);vec3 q=lp.xyz/lp.w*0.5+0.5;
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,vec3(1.0))))return 1.0;
  float bias=max(0.00016,0.0007*(1.0-max(dot(n,u_sun),0.0)));
  float blockers=0.0,average=0.0;
  for(int i=0;i<8;i++){
    float a=float(i)*2.399963;vec2 offset=vec2(cos(a),sin(a))*sqrt((float(i)+0.5)/8.0)*0.0024;
    float z=texture(u_shadow,q.xy+offset).r;
    if(z<q.z-bias){blockers+=1.0;average+=z;}
  }
  if(blockers<0.5)return 1.0;
  float radius=clamp((q.z-average/blockers)*80.0,0.8,5.0)/2048.0;
  float vis=0.0;
  for(int i=0;i<16;i++){
    float a=float(i)*2.399963;vec2 offset=vec2(cos(a),sin(a))*sqrt((float(i)+0.5)/16.0)*radius;
    vis+=step(q.z-bias,texture(u_shadow,q.xy+offset).r);
  }
  return mix(vis/16.0,1.0,smoothstep(0.82,1.0,max(abs(q.x*2.0-1.0),abs(q.y*2.0-1.0))));
}
vec3 causticFrame(vec2 p){
  float frame=mod(u_causticPhase,64.0),a=floor(frame);
  return mix(texture(u_caustics,vec3(p*u_waterCaustics.x,a)).rgb,texture(u_caustics,vec3(p*u_waterCaustics.x,mod(a+1.0,64.0))).rgb,fract(frame));
}
vec3 waveNormal(vec2 p){
  // Recovered Cromos MEDIUM spectrum: 3 octaves, 97-degree direction change,
  // frequency x1.22 and speed x1.08. Analytic derivatives replace the previous
  // 15 noise texture reads / finite differences. This is our interpretation
  // of Bedrock's settings, whose native wave implementation is not shipped.
  vec2 d=vec2(0);
  // p is camera-relative; the CPU phase compensates the moving origin.
  // Avoid adding and subtracting large world coordinates in the main waves.
  vec2 direction=vec2(0.8660254,0.5),coordinate=p,worldP=p+u_camera.xz;
  const mat2 turn=mat2(${Math.cos(CROMOS_WATER.water.waves.direction_increment*Math.PI/180).toFixed(8)},${Math.sin(CROMOS_WATER.water.waves.direction_increment*Math.PI/180).toFixed(8)},${(-Math.sin(CROMOS_WATER.water.waves.direction_increment*Math.PI/180)).toFixed(8)},${Math.cos(CROMOS_WATER.water.waves.direction_increment*Math.PI/180).toFixed(8)});
  float frequency=u_waterWaves.x*6.2831853,amplitude=u_waterWaves.z*0.10;
  float footprint=length(fwidth(p));
  for(int i=0;i<${CROMOS_WATER.water.waves.octaves};i++){
    float phase=dot(coordinate,direction)*frequency+u_wavePhases[i]+float(i)*2.41;
    float crest=max(0.001,sin(phase)*0.5+0.5);
    float derivative=pow(crest,u_waterWaves.w-1.0)*u_waterWaves.w*cos(phase)*0.5;
    float waveFilter=(1.0-smoothstep(0.65,2.2,frequency*footprint))*exp(-0.5*pow(frequency*u_waveSampleWidth,2.0));
    float octaveBlend=i==0?1.0:${CROMOS_WATER.water.waves.mix.toFixed(8)};
    d+=direction*derivative*amplitude*frequency*waveFilter*octaveBlend;
    coordinate+=direction*crest*${CROMOS_WATER.water.waves.pull.toFixed(8)}*amplitude;
    direction=turn*direction;frequency*=${CROMOS_WATER.water.waves.frequency_scaling.toFixed(8)};amplitude*=0.50;
  }
  d+=vec2(cos(dot(worldP,vec2(11.3,7.1))-u_time*2.1),sin(dot(worldP,vec2(-8.7,13.2))+u_time*1.7))*0.009*(1.0-smoothstep(0.03,0.14,footprint));
  d+=(causticFrame(worldP*1.8).gb-0.5)*0.40*(1.0-smoothstep(0.03,0.15,footprint));
  vec2 cell=floor(worldP*1.4),f=fract(worldP*1.4)-0.5;
  float radius=length(f),phase=fract(u_time*0.8+hash21(cell));
  float ripple=sin(radius*70.0-phase*18.0)*exp(-radius*6.0)*sin(phase*3.14159);
  d+=normalize(f+0.001)*ripple*u_rain*0.08;
  d*=1.0+u_rain*0.75;
  return normalize(vec3(-d.x,1.0,-d.y));
}
float caustic(vec2 p){
  // Decode offline refracted-ray density, not a sine-line approximation.
  // Array layers keep per-frame mipmaps isolated and interpolate in time.
  float encoded=causticFrame(p).r;
  return max(0.0,encoded*encoded*8.0-0.75)*u_waterCaustics.y;
}
float rainExposure(vec3 worldPosition){
  vec2 uv=(floor(worldPosition.xz)+0.5-u_rainOrigin)/256.0;
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return 0.0;
  return step(texture(u_rainHeight,uv).r-0.04,worldPosition.y);
}
float eyeDepth(float depth){return u_depthLinear.x/(depth*2.0-1.0+u_depthLinear.y);}
vec3 wetReflection(vec3 position,vec3 N,vec3 V,float strength){
  vec3 R=reflect(-V,N),result=skyRadiance(R);
  // Rough thin films have no sharp scene image. Trace only the puddles and
  // grazing reflections where it contributes, with a continuous transition.
  float sceneWeight=smoothstep(0.025,0.07,strength);
  if(sceneWeight<0.001)return result;
  vec3 ray=position+N*0.045;float stride=0.22;
  for(int i=0;i<28;i++){
    vec3 previous=ray;ray+=R*stride;stride*=1.16;
    vec4 clip=u_vp*vec4(ray,1);vec2 uv=clip.xy/clip.w*0.5+0.5;
    if(clip.w<=0.0||any(lessThan(uv,vec2(0.005)))||any(greaterThan(uv,vec2(0.995))))break;
    float depth=texture(u_depth,uv).r;if(depth>=0.999999)continue;
    // Reconstruct a 3D hit only at a possible linear-depth crossing.
    float gap=clip.w-eyeDepth(depth);
    if(gap>0.0 && gap<0.35+stride*0.6){
      vec3 hit=unproject(uv,depth);
      if(dot(hit-position,N)<=0.035 || dot(hit-position,hit-position)<=0.09)continue;
      // Refine the depth crossing to keep reflected block edges stable.
      for(int j=0;j<4;j++){
        vec3 middle=(previous+ray)*0.5;vec4 q=u_vp*vec4(middle,1);vec2 st=q.xy/q.w*0.5+0.5;
        if(q.w>eyeDepth(texture(u_depth,st).r))ray=middle;else previous=middle;
      }
      clip=u_vp*vec4(ray,1);uv=clip.xy/clip.w*0.5+0.5;
      float edge=smoothstep(0.0,0.08,min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y)));
      result=mix(result,texture(u_scene,uv).rgb,edge*0.92*sceneWeight);break;
    }
  }
  return result;
}
void main(){
  vec3 wp=v_pos+u_camera;
  if(u_reflectionPass>0.5 && (u_underwater>0.5?wp.y>u_reflectY-0.015:wp.y<u_reflectY+0.015))discard;
  vec3 geom=normalize(cross(dFdx(v_pos),dFdy(v_pos)));
  if(!gl_FrontFacing)geom=-geom;
  // Mirrored screen derivatives reverse orientation even though reflected
  // draws use CW winding. Restore world-space normals before lighting: the
  // old path lit reflected sand/foliage as back faces, especially under water.
  if(u_reflectionPass>0.5)geom=-geom;
  vec3 V=normalize(-v_pos);
  float day=smoothstep(-0.10,0.18,u_sun.y)*(1.0-u_rain*0.65);
#if HYPER_PASS == 2
  {
    if(v_water>0.5||v_lava>0.5||v_foliage>0.5||geom.y<0.9||v_lm.y<0.8)discard;
    vec4 surface=texture(u_atlas,v_uv);if(surface.a<u_alphaCutoff)discard;
    float exposure=rainExposure(wp)*u_wetness;
    if(exposure<0.001)discard;
    float puddleMask=smoothstep(0.40,0.68,fbm(wp.xz*0.32));
    vec3 rippleNormal=waveNormal(v_pos.xz);
    vec3 N=normalize(geom+vec3(rippleNormal.x,0,rippleNormal.z)*0.18);
    float F=0.035+0.965*pow(1.0-max(dot(N,V),0.0),5.0);
    float strength=exposure*(0.18+puddleMask*0.82)*F*(1.0-smoothstep(u_fog.x,u_fog.y,v_dist));
    if(strength<0.002)discard;
    vec3 base=texture(u_scene,gl_FragCoord.xy/u_resolution).rgb;
    vec3 coat=wetReflection(v_pos,N,V,strength);
    vec3 color=mix(base,coat,clamp(strength,0.0,0.94));
    o=vec4(color,1);return;
  }
#else
  // Grass casts into the ground's shadow map but never receives shadows.
  // In particular, dense crossed blades do not self-shadow into black clumps.
  float shadow=(u_dimension==1.0 || (v_grass>0.5 && v_foliage>0.5))?1.0:visibility(v_pos,geom);
  vec4 tex=texture(u_atlas,v_uv);
  if(u_dimension<0.5 && v_grass>0.5 && v_foliage>0.5){if(grassCutout(tex,v_uv))discard;}
  else if(tex.a<u_alphaCutoff)discard;
  vec4 c=tex*v_color*texture(u_lightmap,v_lm);
  if(u_dimension<0.5){
    float luminance=dot(c.rgb,vec3(0.2126,0.7152,0.0722));
    c.rgb=max(vec3(0.0),mix(vec3(luminance),c.rgb,1.15));
  }
#if HYPER_PASS == 0
  if(true){
#else
  if(v_water<0.5){
#endif
    float outdoor=smoothstep(0.35,0.92,v_lm.y);
    float ndl=max(dot(geom,u_sun),0.0);
    // Retain the original AO and texture pixels; replace fixed face lighting
    // with cool skylight and warm, shadowed direct illumination.
    vec3 ambient=vec3(0.52,0.60,0.70)*(0.73+max(geom.y,0.0)*0.18);
    vec3 lit=ambient+u_sunColor*ndl*shadow*day*0.96;
    float golden=0.0;
    if(u_dimension<0.5){
      golden=(1.0-smoothstep(0.04,0.55,u_sun.y))*smoothstep(-0.12,0.08,u_sun.y)*(1.0-u_rain);
      ambient=mix(vec3(0.39,0.47,0.59),vec3(0.48,0.43,0.38),golden*0.7)*(0.78+max(geom.y,0.0)*0.16);
    }
    float cloudShadow=u_dimension<0.5?1.0-cloudDensity(wp.xz*0.008-u_sun.xz*1.9+vec2(u_time*0.005,u_time*0.0015))*u_clouds*0.14:mix(1.0,0.88,smoothstep(0.56,0.7,fbm(wp.xz*0.009+u_time*0.006))*u_clouds);
    if(u_dimension<0.5){
      // Separate actual propagated block light from skylight: the vanilla
      // gamma-lifted, clamped lightmap was bleaching torches and midtones.
      vec3 albedo=tex.rgb*v_color.rgb;
      // Remove only vanilla's fixed face multiplier; keep vertex AO. Applying
      // it and the directional shader together made side faces doubly dark.
      float axis=max(abs(geom.x),max(abs(geom.y),abs(geom.z)));
      float bakedFace=geom.y>0.5?1.0:(geom.y< -0.5?0.5:(abs(geom.x)>0.5?0.6:0.8));
      if(axis>0.999 && v_foliage<0.5)albedo/=bakedFace;
      albedo*=mix(vec3(1),vec3(1.0,0.96,mix(0.83,1.0,v_submergedSand)),v_sand);
      albedo*=mix(vec3(1),vec3(0.69,0.83,0.78),v_grass);
      if(v_submergedSand>0.5)albedo*=vec3(0.94,1.0,0.95);
      if(v_submerged>0.5 && v_foliage>0.5){
        float leafLuma=dot(albedo,vec3(0.2126,0.7152,0.0722));
        albedo=mix(vec3(leafLuma),albedo,0.82)*vec3(1.04,0.91,0.81);
      }
      float diffuse=ndl,occlusion=shadow;
      float skyAccess=smoothstep(0.02,0.95,v_lm.y);
      // Actual water-contact faces are tagged by the mesher. Do not classify
      // every low-altitude sand block as submerged. Water transport supplies
      // the optical attenuation; avoid vanilla's steep second skylight loss.
      if(v_submerged>0.5)outdoor=max(outdoor,skyAccess);
      vec3 skyLight=mix(vec3(0.023,0.040,0.074),vec3(0.24,0.30,0.39),day);
      skyLight=mix(skyLight,vec3(0.24,0.18,0.12),golden*0.65)*skyAccess;
      skyLight+=vec3(0.075,0.052,0.025)*day*skyAccess*(1.0-max(geom.y,0.0));
      skyLight*=mix(0.82,1.18,clamp(u_brightness,0.0,1.0));
      if(v_foliage>0.5){
        // Thin-leaf transmission: independent of which crossed quad faces
        // the sun. A bounded shadow floor models diffuse light within blades,
        // avoiding black, self-shadowed clumps at distance. No extra samples.
        float forward=pow(max(dot(-u_sun,V),0.0),4.0);
        diffuse=0.42+abs(dot(geom,u_sun))*0.30+forward*0.28;
        occlusion=mix(0.55,1.0,shadow);
        skyLight*=1.12;
      }
      vec3 direct=u_sunColor*diffuse*occlusion*day*(0.95+golden*1.60)*outdoor;
      if(v_submerged>0.5){
        // Only faces touching actual fluid receive the focused sunlight.
        // Surface height alone would also paint dry caves and low land.
        float waterDepth=max(0.0,u_reflectY-wp.y);
        vec3 lightRay=refract(-u_sun,vec3(0,1,0),1.0/1.333);
        float run=waterDepth/max(0.25,-lightRay.y);
        vec2 entry=wp.xz-lightRay.xz*run;
        float focus=min(3.0,caustic(entry));
        float fade=(1.0-smoothstep(7.0,12.0,waterDepth))*skyAccess*(1.0-u_rain*0.8);
        // Preserve direct-light occlusion of the web beneath trees/roofs.
        float web=mix(1.0,0.94+focus*0.065,fade*shadow);
        direct=u_sunColor*diffuse*max(0.42,occlusion)*day*(0.95+golden*1.60)*outdoor;
        direct*=exp(-u_waterExtinction*run*0.28)*web;
        skyLight*=vec3(0.74,1.04,1.10);
      }
      float level=clamp((v_lm.x*16.0-0.5)/15.0,0.0,1.0);
      float fire=pow(level,4.0)*4.4;
      vec3 blockRadiance=vec3(1.0,0.62,0.22)*fire;
      c.rgb=albedo*(skyLight*cloudShadow+direct*cloudShadow+blockRadiance+vec3(0.008,0.010,0.016));
      c.rgb=mix(c.rgb,max(c.rgb,albedo*0.75),u_nightVision);
      c.rgb+=albedo*vec3(0.60,0.68,0.90)*u_flash*skyAccess;
    }else c.rgb*=mix(vec3(1),lit*cloudShadow,outdoor);
    float blockLight=pow(v_lm.x,3.0);
    if(u_dimension>0.5)c.rgb+=tex.rgb*v_color.rgb*vec3(1.0,0.46,0.12)*blockLight*0.28;
    if(u_dimension<0.5){
      float wet=u_wetness*rainExposure(wp)*max(geom.y,0.0);
      c.rgb*=1.0-wet*0.20;
    }else if(u_dimension<1.5){
      c.rgb*=vec3(1.06,0.76,0.69);
      c.rgb+=tex.rgb*vec3(0.32,0.06,0.015)*pow(v_lm.x,2.0);
    }else{
      float directional=max(dot(geom,normalize(vec3(0.3,0.6,0.7))),0.0);
      c.rgb*=vec3(0.80,0.55,1.32)+vec3(0.36,0.17,0.50)*directional*shadow;
      c.rgb+=tex.rgb*vec3(0.32,0.11,0.48)*blockLight;
      float rim=pow(1.0-max(dot(geom,V),0.0),4.0);
      c.rgb+=vec3(0.025,0.008,0.045)*rim;
    }
    c.rgb+=tex.rgb*v_lava*(1.6+0.14*sin(wp.x*2.0+wp.z*1.5-u_time*1.2));
  }else{
    if(u_debug==7.0)discard;
    vec2 screen=gl_FragCoord.xy/u_resolution;
    float d0=texture(u_depth,screen).r;
    vec3 ground=unproject(screen,d0);
    float thickness=d0>=0.999999?48.0:max(0.0,length(ground-v_pos));
    float contactFade=smoothstep(0.025,0.32,thickness);
    vec3 N=waveNormal(v_pos.xz);
    if(u_debug==6.0)N=vec3(0,1,0);
    if(abs(geom.y)<0.6)N=normalize(geom+vec3(N.x,0,N.z)*0.4);
    N=normalize(mix(geom,N,contactFade));
    if(dot(N,V)<0.0)N=-N;
    // Fine capillary normals belong to reflections/specular, not to the
    // transmitted image. Project a separate, broad displacement, scaled by
    // optical depth. This preserves leaf pixels and straight shelf edges.
    vec2 broadSlope=vec2(sin(dot(wp.xz,vec2(0.75,0.28))-u_time*0.72),sin(dot(wp.xz,vec2(-0.32,0.91))+u_time*0.61))*0.040;
    vec3 displaced=v_pos+vec3(broadSlope.x,0,broadSlope.y)*min(thickness,6.0)*0.12*contactFade;
    vec4 bentClip=u_vp*vec4(displaced,1);
    vec2 bend=bentClip.xy/bentClip.w*0.5+0.5-screen;
    if(u_debug==6.0)bend=vec2(0);
    vec2 uv=clamp(screen+bend,vec2(0.002),vec2(0.998));
    float dr=texture(u_depth,uv).r;
    vec3 gp=unproject(uv,dr);
    // Reject refraction onto a dry foreground block in front of the surface.
    if(length(gp)<length(v_pos)+0.03){uv=screen;gp=ground;dr=d0;}
    vec3 bed=texture(u_scene,uv).rgb;
    float depth=dr>=0.999999?48.0:clamp(length(gp-v_pos),0.0,64.0);
    // Cromos particle profiles calibrate our RGB extinction and turquoise
    // in-scattering. Real path length preserves pale shallows and deep water.
    vec3 transmission=exp(-u_waterExtinction*depth);
    vec3 scatter=u_waterScatter*mix(0.15,1.0,day)*(0.85+0.15*max(u_sun.y,0.0));
    // Transport in linear light, then return to the scene buffer's colour
    // convention. Attenuating encoded RGB was stripping the sand's red too
    // aggressively, producing a green wash unrelated to the reference.
    vec3 bedLinear=pow(max(bed,vec3(0)),vec3(2.2));
    vec3 transmitted=pow(max(vec3(0),bedLinear*transmission+pow(scatter,vec3(2.2))*(1.0-transmission)),vec3(1.0/2.2));
    vec3 R=reflect(-V,N);
    vec3 reflected=u_underwater>0.5?vec3(0.015,0.15,0.17):skyRadiance(R);
    // Half-resolution planar terrain reflection for sea-level water. The
    // depth snapshot also permits local SSR for rivers and elevated pools.
    vec4 rp=u_reflectVP*vec4(v_pos,1.0);
    vec2 ruv=rp.xy/rp.w*0.5+0.5+N.xz*0.040;
    float edge=smoothstep(0.0,0.06,ruv.x)*smoothstep(0.0,0.06,ruv.y)*smoothstep(0.0,0.06,1.0-ruv.x)*smoothstep(0.0,0.06,1.0-ruv.y);
    float sea=(1.0-smoothstep(0.03,0.20,abs(wp.y-u_reflectY)))*u_reflectionAvailable;
    if(rp.w>0.0)reflected=mix(reflected,texture(u_reflection,clamp(ruv,0.001,0.999)).rgb,edge*sea);
    // SSR has an explicit depth intersection and fades at screen borders.
    vec3 ray=v_pos+N*0.09;float stepSize=0.5;
    if(sea<0.5){for(int i=0;i<22;i++){
      ray+=R*stepSize;stepSize*=1.13;
      vec4 clip=u_vp*vec4(ray,1);vec2 st=clip.xy/clip.w*0.5+0.5;
      if(clip.w<0.0||any(lessThan(st,vec2(0.01)))||any(greaterThan(st,vec2(0.99))))break;
      float dd=texture(u_depth,st).r;vec3 hit=unproject(st,dd);
      float gap=length(ray)-length(hit);
      if(dd<0.99999 && gap>0.0 && gap<stepSize*1.6){reflected=mix(reflected,texture(u_scene,st).rgb,0.8);break;}
    }}
    float fresnel=0.0204+0.9796*pow(1.0-max(dot(N,V),0.0),5.0);
    // Filtered GGX sun glints: finite roughness broadens the sun across small
    // wavelets, while derivatives suppress distant sparkling aliasing.
    vec3 H=normalize(u_sun+V);
    float nv=max(dot(N,V),0.001),nl=max(dot(N,u_sun),0.0),nh=max(dot(N,H),0.0);
    float alpha2=0.001225+min(0.04,dot(fwidth(N),fwidth(N))*0.3);
    float denom=nh*nh*(alpha2-1.0)+1.0;
    float distribution=alpha2/(3.14159265*denom*denom);
    float sunF=0.0204+0.9796*pow(1.0-max(dot(V,H),0.0),5.0);
    float masking=(nv*0.96+0.04)*(nl*0.96+0.04);
    vec3 spec=u_sunColor*min(30.0,distribution*sunF*nl/max(0.001,4.0*masking))*day*shadow*0.62*contactFade;
    c=vec4(mix(transmitted,reflected,fresnel)+spec,1.0);
    if(u_debug>0.0 && u_debug<6.0){
      vec3 diagnostic=N*0.5+0.5;
      if(u_debug==2.0)diagnostic=vec3(depth/12.0);
      if(u_debug==3.0)diagnostic=transmission;
      if(u_debug==4.0)diagnostic=vec3(fresnel);
      if(u_debug==5.0)diagnostic=spec;
      o=vec4(diagnostic,1);return;
    }
    if(u_underwater>0.5){
      // Water-to-air refraction and total internal reflection (Snell's
      // window). No above-water planar texture is read in this branch.
      float cosI=clamp(dot(N,V),0.0,1.0);
      float sinT2=1.333*1.333*(1.0-cosI*cosI);
      float totalInternal=step(1.0,sinT2);
      float cosT=sqrt(max(0.0,1.0-sinT2));
      float rs=(1.333*cosI-cosT)/max(0.0001,1.333*cosI+cosT);
      float rpF=(cosI-1.333*cosT)/max(0.0001,cosI+1.333*cosT);
      float waterFresnel=mix(0.5*(rs*rs+rpF*rpF),1.0,totalInternal);
      vec3 airRay=refract(-V,N,1.333);
      vec3 air=length(airRay)>0.01?skyRadiance(normalize(airRay)):vec3(0);
      // Where the live opaque view contains terrain above the water, keep
      // it visible through the window instead of replacing it with sky.
      vec3 airView=dr<0.99999?bed:air;
      float path=length(v_pos);
      vec3 through=airView*exp(-vec3(0.035,0.015,0.010)*path)+vec3(0.01,0.10,0.12)*(1.0-exp(-path*0.03));
      c.rgb=mix(through,reflected,waterFresnel)+spec*0.2;
    }
    // A fine contact meniscus confined to very shallow actual water.
    c.rgb+=vec3(0.055,0.075,0.060)*exp(-thickness*9.0)*smoothstep(0.0,0.035,thickness)*day;
  }
  float distanceFog=smoothstep(u_fog.x,u_fog.y,v_dist);
  c.rgb=mix(c.rgb,u_fogColor.rgb,distanceFog);
  o=c;
#endif
}`;

const FULLSCREEN_VS = `#version 300 es
out vec2 v_uv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);v_uv=p;gl_Position=vec4(p*2.0-1.0,0,1);}`;
const SKY_VS = FULLSCREEN_VS.replace('vec4(p*2.0-1.0,0,1)','vec4(p*2.0-1.0,1,1)');
const SKY_FS = `#version 300 es
precision highp float;
uniform mat4 u_invVP;
uniform sampler2D u_noise,u_galaxy,u_endNoise,u_planet,u_rainHeight;
uniform vec3 u_camera,u_sun,u_sunColor,u_fogTint;
uniform float u_time,u_rain,u_clouds,u_dimension,u_underwater,u_reflectionPass,u_flash;
in vec2 v_uv;out vec4 o;
${ATMOSPHERE}
void main(){vec4 p=u_invVP*vec4(v_uv*2.0-1.0,1,1);vec4 n=u_invVP*vec4(v_uv*2.0-1.0,-1,1);vec3 c=u_reflectionPass>0.5 && u_underwater>0.5?vec3(0.015,0.15,0.17):skyRadiance(normalize(p.xyz/p.w-n.xyz/n.w));o=vec4(c,1);}`;
const BLOOM_FS = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_step;
uniform float u_extract;
in vec2 v_uv;out vec4 o;
vec3 sampleBright(vec2 uv){vec3 c=texture(u_image,uv).rgb;return u_extract>0.5?c*smoothstep(0.72,1.6,max(c.r,max(c.g,c.b))):c;}
void main(){vec3 c=sampleBright(v_uv)*0.227027;c+=(sampleBright(v_uv+u_step*1.384615)+sampleBright(v_uv-u_step*1.384615))*0.316216;c+=(sampleBright(v_uv+u_step*3.230769)+sampleBright(v_uv-u_step*3.230769))*0.070270;o=vec4(c,1);}`;
const VOLUME_FS = `#version 300 es
precision highp float;
uniform sampler2D u_depth,u_shadow,u_noise;
uniform mat4 u_invVP,u_lightMatrix;
uniform vec3 u_camera,u_sun,u_sunColor,u_fogTint;
uniform vec2 u_sunScreen,u_resolution;
uniform float u_time,u_rain,u_dimension,u_underwater,u_cameraSky,u_sunVisible;
in vec2 v_uv;out vec4 o;
${PHOTON_PHASE}
float litAt(vec3 p){
  vec4 s=u_lightMatrix*vec4(p,1);vec3 q=s.xyz/s.w*0.5+0.5;
  if(any(lessThan(q,vec3(0)))||any(greaterThan(q,vec3(1))))return 1.0;
  return step(q.z-0.0006,texture(u_shadow,q.xy).r);
}
void main(){
  float z=texture(u_depth,v_uv).r;
  vec4 p=u_invVP*vec4(v_uv*2.0-1.0,z*2.0-1.0,1);vec3 end=p.xyz/p.w;
  float dist=min(length(end),u_dimension>0.5?150.0:180.0);vec3 ray=normalize(end);
  float jitter=texture(u_noise,gl_FragCoord.xy/512.0).b;
  vec3 scattering=vec3(0);float trans=1.0;float ds=dist/16.0;
  float mu=dot(ray,u_sun);
  float phase=photonCornetteShanks(mu,0.55);
  float day=smoothstep(-0.10,0.20,u_sun.y);
  float golden=u_dimension<0.5?(1.0-smoothstep(0.04,0.55,u_sun.y))*smoothstep(-0.12,0.08,u_sun.y)*(1.0-u_rain):0.0;
  for(int i=0;i<16;i++){
    vec3 pos=ray*(float(i)+jitter)*ds,world=pos+u_camera;
    float height=exp(-max(world.y-62.0,0.0)*0.055);
    float density=(0.00065+height*0.0009)*(1.0+u_rain*2.2)*u_cameraSky;
    vec3 source=vec3(0.42,0.52,0.65)*(0.15+day*0.26)+u_sunColor*litAt(pos)*phase*day*(1.35+golden*3.0);
    if(u_dimension>0.5 && u_dimension<1.5){
      float n=texture(u_noise,world.xz*0.012+vec2(u_time*0.003,world.y*0.008)).r;
      density=0.0045*(0.7+n*0.6)+0.003*exp(-max(world.y-32.0,0.0)*0.06);
      // Biome-coloured haze: red wastes, cyan soul valleys, crimson/warped forests.
      source=u_fogTint*(0.8+0.25*n);
    }else if(u_dimension>1.5){
      float heightFalloff=exp2(min(-(world.y-64.0)/7.0,0.0));
      density=0.0027*heightFalloff*smoothstep(0.0,64.0,world.y);
      source=mix(vec3(0.22,0.08,0.34),vec3(0.065,0.035,0.16),texture(u_noise,world.xz*0.012+u_time*0.001).g)+vec3(0.30,0.18,0.40)*litAt(pos)*phase*1.3;
    }
    if(u_underwater>0.5){density=0.003;source=vec3(0.025,0.23,0.25)*(0.4+litAt(pos)*phase*day*2.0);}
    float stepTrans=exp(-density*ds);
    scattering+=source*(1.0-stepTrans)*trans;trans*=stepTrans;
  }
  if(u_dimension<0.5 && u_underwater<0.5 && u_sunVisible>0.0){
    // Integrate soft crepuscular rays here, then use the existing bilateral
    // volume upsample. Per-pixel phase jitter removes radial sample bands.
    vec2 delta=(u_sunScreen-v_uv)/24.0;
    vec2 uv=v_uv+delta*jitter;
    float rays=0.0,weight=1.0;
    for(int i=0;i<24;i++){
      uv+=delta;
      float openSky=step(0.999998,texture(u_depth,clamp(uv,0.0,1.0)).r);
      vec2 fromSun=(uv-u_sunScreen)*vec2(u_resolution.x/u_resolution.y,1.0);
      float aperture=exp(-dot(fromSun,fromSun)*12.0);
      rays+=openSky*weight*aperture;weight*=0.94;
    }
    scattering+=vec3(1.0,0.76,0.32)*rays*(0.004+golden*0.045)*u_sunVisible;
  }
  o=vec4(scattering,trans);
}`;
const OUTPUT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_image,u_bloom,u_depth,u_volume;
uniform vec2 u_sunScreen,u_resolution;
uniform float u_sunVisible,u_day,u_time,u_dimension,u_underwater,u_bloomStrength,u_debug;
in vec2 v_uv;out vec4 o;
vec3 film(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
void main(){
  vec2 imageUV=v_uv;
  if(u_dimension>0.5 && u_dimension<1.5){
    // Only luminous, distant pixels drive the subtle lava heat shimmer.
    vec3 original=texture(u_image,v_uv).rgb;
    float heat=smoothstep(0.55,1.4,max(original.r-original.b,0.0))*smoothstep(0.98,1.0,texture(u_depth,v_uv).r);
    imageUV+=vec2(sin(v_uv.y*170.0+u_time*2.5),cos(v_uv.x*140.0-u_time*2.0))*heat*0.0013;
  }
  vec3 c=texture(u_image,imageUV).rgb;
  // Depth-guided upsampling prevents low-resolution air scattering leaking
  // across nearby block silhouettes. The volume remains deliberately light.
  vec4 volume=vec4(0);float weights=0.0;
  float centerDepth=texture(u_depth,v_uv).r;
  for(int x=0;x<2;x++)for(int y=0;y<2;y++){
    vec2 uv=v_uv+(vec2(x,y)-0.5)*2.0/u_resolution;
    float sampleDepth=texture(u_depth,uv).r;
    float w=exp(-abs(centerDepth-sampleDepth)*1200.0)+0.0001;
    volume+=texture(u_volume,uv)*w;weights+=w;
  }
  volume/=weights;c=c*volume.a+volume.rgb;
  vec3 bloom=texture(u_bloom,v_uv).rgb;
  // Occluded screen-space crepuscular scattering, strongest at low sun.
  float rays=0.0;
  if(u_dimension>1.5 && u_sunVisible>0.0){
    vec2 stepUV=(u_sunScreen-v_uv)/24.0;vec2 q=v_uv;float w=1.0;
    for(int i=0;i<24;i++){q+=stepUV;float openSky=step(0.999998,texture(u_depth,clamp(q,0.0,1.0)).r);rays+=openSky*w;w*=0.94;}
  }
  c+=bloom*u_bloomStrength+vec3(1.0,0.64,0.29)*rays*0.004*u_sunVisible;
  if(u_dimension<0.5 && u_underwater<0.5){
    float daylight=smoothstep(-0.10,0.25,u_day);
    c=film(c*mix(1.08,0.91,daylight));
    c=pow(c,vec3(mix(0.92,1.0,daylight)));
    float luminance=dot(c,vec3(0.2126,0.7152,0.0722));
    c=max(vec3(0.0),mix(vec3(luminance),c,1.08+daylight*0.08));
    // Protect highlight colour and give midtones separation after filmic
    // compression, instead of lifting the entire world towards pastel white.
    c=mix(c,c*c*(3.0-2.0*c),daylight*0.14);
  }else{
    c=film(c*1.13);
    c=pow(c,vec3(0.92));
  }
  float vignette=1.0-0.12*pow(length((v_uv-0.5)*vec2(1.0,0.8)),1.5);
  if(u_debug>0.0 && u_debug<5.0)c=texture(u_image,imageUV).rgb;
  o=vec4(c*vignette,1.0);gl_FragDepth=texture(u_depth,v_uv).r;
}`;

interface Target { fbo: WebGLFramebuffer; color: WebGLTexture | null; depth: WebGLTexture | null; w: number; h: number }

export class HyperFrame {
  readonly lightMatrix=mat4();
  readonly invVP=mat4();
  private depthLinear:[number,number]=[0,0];
  readonly vp=mat4();
  readonly reflectVP=mat4();
  readonly reflectView=mat4();
  sun: [number,number,number]=[0,1,0];
  sunColor: [number,number,number]=[1,1,1];
  camera: [number,number,number]=[0,64,0];
  time=0;rain=0;wetness=0;clouds=1;dimension=0;underwater=false;reflectionPass=false;reflectionAvailable=false;
  readonly reflectY=62+8/9-0.001;
  private scene: Target | null=null;
  private skyTarget: Target | null=null;
  private opaque: Target | null=null;
  private reflection: Target | null=null;
  private bloom: Target[]=[];
  private volume: Target | null=null;
  private shadow: Target;
  private skyShader: Shader;
  private readonly skyShaders = new Map<number, Shader>();
  private readonly bloomShader: Shader;
  private readonly outputShader: Shader;
  private readonly volumeShader: Shader;
  private readonly noise: WebGLTexture;
  private readonly galaxy: WebGLTexture;
  private readonly endNoise: WebGLTexture;
  private readonly planet: WebGLTexture;
  private readonly caustics: WebGLTexture;
  private readonly rainHeight:WebGLTexture;
  private readonly rainHeights=new Float32Array(256*256);
  private rainOrigin:[number,number]=[0,0];
  private rainUploaded=-Infinity;
  readonly assetsReady: Promise<void[]>;
  private disposed=false;
  assetsLoaded=0;
  get ready():boolean{return this.assetsLoaded===5;}
  fogTint: [number,number,number]=[0.18,0.027,0.012];
  cameraSky=1;
  readonly water = new CromosWater();
  brightness=0.5;nightVision=0;
  flash=0;
  /** Diagnostic hooks used by the visual harness; absent from player menus. */
  debug=0;bloomEnabled=true;
  private readonly vao: WebGLVertexArrayObject;
  private readonly hdr: boolean;
  width=0;height=0;

  constructor(private readonly gl: GL){
    this.hdr=!!gl.getExtension('EXT_color_buffer_float');
    this.vao=gl.createVertexArray()!;
    this.skyShader=new Shader(gl,SKY_VS,specializeHyperShader(SKY_FS,0),'hyperShader.sky.0');
    this.skyShaders.set(0,this.skyShader);
    this.bloomShader=new Shader(gl,FULLSCREEN_VS,BLOOM_FS,'hyperShader.bloom');
    this.outputShader=new Shader(gl,FULLSCREEN_VS,OUTPUT_FS,'hyperShader.output');
    this.volumeShader=new Shader(gl,FULLSCREEN_VS,VOLUME_FS,'hyperShader.volume');
    this.noise=createTexture(gl,1,1,new Uint8Array([128,128,128,255]),{nearest:false,clamp:false});
    this.galaxy=createTexture(gl,1,1,new Uint8Array([0,0,0,255]),{nearest:false,clamp:false});
    this.endNoise=createTexture(gl,1,1,new Uint8Array([128,128,128,255]),{nearest:false,clamp:false});
    this.planet=createTexture(gl,1,1,new Uint8Array([160,120,70,255]),{nearest:false,clamp:false});
    this.caustics=gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY,this.caustics);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY,8,gl.RGBA8,128,128,64);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_T,gl.REPEAT);
    this.assetsReady=Promise.all([this.loadImage(this.noise,'photon/noise.png'),this.loadImage(this.galaxy,'photon/galaxy.png'),this.loadImage(this.endNoise,'iteration/noise.png'),this.loadImage(this.planet,'space/saturn.jpg'),this.loadCaustics()]);
    this.rainHeight=gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D,this.rainHeight);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,256,256,0,gl.RED,gl.FLOAT,this.rainHeights);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.shadow=this.target(2048,2048,false,true);
  }
  private loadImage(texture:WebGLTexture,name:string):Promise<void>{
    return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      if(this.disposed){resolve();return;}
      const gl=this.gl;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
      gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.bindTexture(gl.TEXTURE_2D,null);this.assetsLoaded++;resolve();
    };
    img.onerror=()=>{console.warn(`hyperShader: texture unavailable: ${name}`);resolve();};
    img.src=import.meta.env.BASE_URL+'hyperShader/'+name;
    });
  }
  private loadCaustics():Promise<void>{
    return new Promise(resolve=>{
      const image=new Image();
      image.onload=()=>{
        if(this.disposed){resolve();return;}
        const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
        const context=canvas.getContext('2d',{willReadFrequently:true})!;
        const gl=this.gl;gl.activeTexture(gl.TEXTURE11);gl.bindTexture(gl.TEXTURE_2D_ARRAY,this.caustics);
        for(let layer=0;layer<64;layer++){
          context.drawImage(image,(layer%8)*128,Math.floor(layer/8)*128,128,128,0,0,128,128);
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY,0,0,0,layer,128,128,1,gl.RGBA,gl.UNSIGNED_BYTE,context.getImageData(0,0,128,128).data);
        }
        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY,null);gl.activeTexture(gl.TEXTURE0);this.assetsLoaded++;resolve();
      };
      image.onerror=()=>{console.warn('hyperShader: caustic texture unavailable');resolve();};
      image.src=import.meta.env.BASE_URL+'hyperShader/cromos-caustics.png';
    });
  }

  updateRainExposure(world:World):void{
    const now=performance.now(),x=Math.floor(this.camera[0])-128,z=Math.floor(this.camera[2])-128;
    if(now-this.rainUploaded<250 && Math.abs(x-this.rainOrigin[0])<8 && Math.abs(z-this.rainOrigin[1])<8)return;
    this.rainOrigin=[x,z];this.rainUploaded=now;
    for(let dz=0;dz<256;dz++)for(let dx=0;dx<256;dx++)this.rainHeights[dz*256+dx]=world.isLoaded(x+dx,z+dz)?world.heightAt(x+dx,z+dz):1e6;
    const gl=this.gl;gl.activeTexture(gl.TEXTURE10);gl.bindTexture(gl.TEXTURE_2D,this.rainHeight);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,256,gl.RED,gl.FLOAT,this.rainHeights);
  }
  private target(w:number,h:number,color:boolean,depth:boolean):Target{
    const gl=this.gl,fbo=gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    const texture=(isDepth:boolean)=>{
      const t=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,t);
      const internal=isDepth?gl.DEPTH_COMPONENT24:this.hdr?gl.RGBA16F:gl.RGBA8;
      gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,isDepth?gl.DEPTH_COMPONENT:gl.RGBA,isDepth?gl.UNSIGNED_INT:this.hdr?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,isDepth?gl.NEAREST:gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,isDepth?gl.NEAREST:gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,isDepth?gl.DEPTH_ATTACHMENT:gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);return t;
    };
    const c=color?texture(false):null,d=depth?texture(true):null;
    if(!color){gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);}
    const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if(status!==gl.FRAMEBUFFER_COMPLETE)throw new Error(`hyperShader framebuffer ${status}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);return {fbo,color:c,depth:d,w,h};
  }
  private destroy(t:Target):void{this.gl.deleteFramebuffer(t.fbo);if(t.color)this.gl.deleteTexture(t.color);if(t.depth)this.gl.deleteTexture(t.depth);}
  resize(w:number,h:number):void{
    if(w===this.width&&h===this.height)return;
    for(const t of [this.scene,this.opaque,this.reflection,this.volume,this.skyTarget,...this.bloom])if(t)this.destroy(t);
    this.width=w;this.height=h;
    this.skyTarget=this.target(Math.max(1,w>>1),Math.max(1,h>>1),true,false);
    this.scene=this.target(w,h,true,true);this.opaque=this.target(w,h,true,true);
    this.reflection=this.target(Math.max(1,w>>1),Math.max(1,h>>1),true,true);
    this.volume=this.target(Math.max(1,w>>1),Math.max(1,h>>1),true,false);
    this.bloom=[this.target(Math.max(1,w>>2),Math.max(1,h>>2),true,false),this.target(Math.max(1,w>>2),Math.max(1,h>>2),true,false)];
  }
  prepare(proj:Mat4,view:Mat4,camera:[number,number,number],angle:number,time:number,rain:number,clouds:boolean,underwater:boolean,dimension=0):void{
    this.camera=camera;this.time=time;this.rain=rain;this.clouds=clouds?1:0;this.underwater=underwater;this.dimension=dimension;
    let sky=this.skyShaders.get(dimension);
    if(!sky){sky=new Shader(this.gl,SKY_VS,specializeHyperShader(SKY_FS,dimension),`hyperShader.sky.${dimension}`);this.skyShaders.set(dimension,sky);}
    this.skyShader=sky;
    multiply(this.vp,proj,view);invert(this.invVP,this.vp);
    this.depthLinear=[proj[14],proj[10]];
    const a=angle*Math.PI*2;
    let sx=-Math.sin(a),sy=Math.cos(a),sz=0.38;const len=Math.hypot(sx,sy,sz);
    this.sun=[sx/len,sy/len,sz/len];
    if(dimension===2)this.sun=[-0.32,0.24,0.9165];
    const warm=1-Math.min(1,Math.max(0,this.sun[1])*2.6);
    this.sunColor=[1.18,1.12-warm*0.48,0.98-warm*0.69];
    if(dimension===0){
      const t=Math.max(0,Math.min(1,(this.sun[1]-0.04)/0.51));
      const golden=(1-t*t*(3-2*t))*(1-rain*0.9);
      this.sunColor=[1.30+golden*0.40,1.19-golden*0.46,1.02-golden*0.79];
    }
    // Stable light basis, snapped in world space to shadow texels.
    const light=mat4();const eye=this.sun.map(v=>v*180);
    const z=this.sun;const xl=Math.hypot(z[2],z[0]);const x=[z[2]/xl,0,-z[0]/xl];
    const y=[z[1]*x[2],z[2]*x[0]-z[0]*x[2],-z[1]*x[0]];
    light[0]=x[0];light[4]=x[1];light[8]=x[2];
    light[1]=y[0];light[5]=y[1];light[9]=y[2];
    light[2]=z[0];light[6]=z[1];light[10]=z[2];
    const snap=220/2048;
    const dot=(v:number[])=>v[0]*camera[0]+v[1]*camera[1]+v[2]*camera[2];
    light[12]=dot(x)-Math.round(dot(x)/snap)*snap;
    light[13]=dot(y)-Math.round(dot(y)/snap)*snap;
    light[14]=-180;
    multiply(this.lightMatrix,ortho(mat4(),-110,110,-110,110,1,400),light);
    // Mirroring relative positions preserves camera-relative mesh precision.
    const mirror=mat4();mirror[5]=-1;mirror[13]=2*(this.reflectY-camera[1]);
    multiply(this.reflectView,view,mirror);multiply(this.reflectVP,proj,this.reflectView);
  }
  private bindTarget(t:Target):void{this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,t.fbo);this.gl.viewport(0,0,t.w,t.h);}
  beginShadow():void{this.bindTarget(this.shadow);this.gl.depthMask(true);this.gl.clearDepth(1);this.gl.clear(this.gl.DEPTH_BUFFER_BIT);}
  beginReflection():void{this.reflectionPass=true;this.bindTarget(this.reflection!);this.gl.depthMask(true);this.gl.clear(this.gl.COLOR_BUFFER_BIT|this.gl.DEPTH_BUFFER_BIT);this.gl.frontFace(this.gl.CW);}
  endReflection():void{this.reflectionPass=false;this.gl.frontFace(this.gl.CCW);}
  beginScene():void{this.bindTarget(this.scene!);}
  drawSky(reflected=false,occluded=false):void{
    const gl=this.gl,s=this.skyShader.use();
    const reduced=!reflected && this.dimension!==2;
    if(reduced)this.bindTarget(this.skyTarget!);
    const inv=reflected?mat4():this.invVP;if(reflected)invert(inv,this.reflectVP);
    s.mat4('u_invVP',inv);this.bindEnvironment(s);
    if(occluded){gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);}else gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.depthMask(false);gl.bindVertexArray(this.vao);gl.drawArrays(gl.TRIANGLES,0,3);gl.bindVertexArray(null);gl.depthMask(true);
    if(reduced){
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.skyTarget!.fbo);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.scene!.fbo);
      gl.blitFramebuffer(0,0,this.skyTarget!.w,this.skyTarget!.h,0,0,this.width,this.height,gl.COLOR_BUFFER_BIT,gl.LINEAR);
      this.beginScene();
    }
  }
  captureOpaque():void{
    const gl=this.gl;gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.scene!.fbo);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.opaque!.fbo);
    gl.blitFramebuffer(0,0,this.width,this.height,0,0,this.width,this.height,gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT,gl.NEAREST);
    this.beginScene();
  }
  private bindTexture(s:Shader,name:string,unit:number,t:WebGLTexture|null):void{const gl=this.gl;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);s.i(name,unit);}
  private bindEnvironment(s:Shader):void{
    s.vec3('u_camera',...this.camera);s.vec3('u_sun',...this.sun);s.vec3('u_sunColor',...this.sunColor);
    s.vec3('u_fogTint',...this.fogTint);
    s.f('u_underwater',this.underwater?1:0);s.f('u_reflectionPass',this.reflectionPass?1:0);
    s.f('u_time',this.time);s.f('u_rain',this.rain);s.f('u_clouds',this.clouds);s.f('u_dimension',this.dimension);
    s.f('u_flash',this.flash);
    this.bindTexture(s,'u_noise',6,this.noise);this.bindTexture(s,'u_galaxy',7,this.galaxy);this.bindTexture(s,'u_endNoise',8,this.endNoise);this.bindTexture(s,'u_planet',9,this.planet);
  }
  bindTerrain(s:Shader):void{
    s.vec2('u_depthLinear',...this.depthLinear);
    s.vec3('u_waterExtinction',this.water.extinction[0],this.water.extinction[1],this.water.extinction[2]);
    s.vec3('u_waterScatter',this.water.scatter[0],this.water.scatter[1],this.water.scatter[2]);
    s.vec4('u_waterWaves',this.water.waves[0],this.water.waves[1],this.water.waves[2],this.water.waves[3]);
    s.vec2('u_waterCaustics',this.water.caustics[0],this.water.caustics[1]);
    s.f('u_causticPhase',this.water.causticPhase);s.f('u_waveSampleWidth',this.water.sampleWidth);
    s.vec3('u_wavePhases',this.water.wavePhases[0],this.water.wavePhases[1],this.water.wavePhases[2]);
    s.f('u_brightness',this.brightness);s.f('u_nightVision',this.nightVision);
    s.f('u_debug',this.debug);
    this.gl.activeTexture(this.gl.TEXTURE11);this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY,this.caustics);s.i('u_caustics',11);
    this.bindEnvironment(s);this.bindTexture(s,'u_rainHeight',10,this.rainHeight);s.vec2('u_rainOrigin',...this.rainOrigin);s.f('u_wetness',this.wetness);s.f('u_wetPass',0);s.mat4('u_lightMatrix',this.lightMatrix);s.mat4('u_invVP',this.invVP);s.mat4('u_vp',this.vp);s.mat4('u_reflectVP',this.reflectVP);
    s.vec2('u_resolution',this.width,this.height);s.f('u_underwater',this.underwater?1:0);s.f('u_reflectY',this.reflectY);s.f('u_reflectionPass',this.reflectionPass?1:0);s.f('u_reflectionAvailable',this.reflectionAvailable?1:0);
    this.bindTexture(s,'u_shadow',2,this.shadow.depth);
    this.bindTexture(s,'u_scene',3,this.opaque!.color);this.bindTexture(s,'u_depth',4,this.opaque!.depth);
    // Never bind the current render target as an input attachment.
    this.bindTexture(s,'u_reflection',5,this.reflectionPass?this.opaque!.color:this.reflection!.color);
  }
  finish(outputFramebuffer:WebGLFramebuffer|null=null):void{
    const gl=this.gl;gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.depthMask(false);gl.bindVertexArray(this.vao);
    const p=this.vp,v=this.sun;const cx=p[0]*v[0]+p[4]*v[1]+p[8]*v[2],cy=p[1]*v[0]+p[5]*v[1]+p[9]*v[2],cw=p[3]*v[0]+p[7]*v[1]+p[11]*v[2];
    const sunX=cw>0?cx/cw*0.5+0.5:-2,sunY=cw>0?cy/cw*0.5+0.5:-2;
    const sunVisible=this.dimension!==1&&cw>0&&this.sun[1]>-0.08?(1-Math.min(1,Math.abs(this.sun[1])*1.8))*(1-this.rain):0;
    this.bindTarget(this.volume!);
    const vol=this.volumeShader.use();this.bindEnvironment(vol);vol.mat4('u_invVP',this.invVP);vol.mat4('u_lightMatrix',this.lightMatrix);vol.f('u_underwater',this.underwater?1:0);vol.f('u_cameraSky',this.cameraSky);vol.vec3('u_fogTint',...this.fogTint);
    vol.vec2('u_sunScreen',sunX,sunY);vol.vec2('u_resolution',this.width,this.height);vol.f('u_sunVisible',sunVisible);
    this.bindTexture(vol,'u_depth',0,this.scene!.depth);this.bindTexture(vol,'u_shadow',1,this.shadow.depth);gl.drawArrays(gl.TRIANGLES,0,3);
    const s=this.bloomShader.use();this.bindTarget(this.bloom[0]);this.bindTexture(s,'u_image',0,this.scene!.color);s.vec2('u_step',1/this.width*3,0);s.f('u_extract',1);gl.drawArrays(gl.TRIANGLES,0,3);
    this.bindTarget(this.bloom[1]);this.bindTexture(s,'u_image',0,this.bloom[0].color);s.vec2('u_step',0,1/this.bloom[0].h);s.f('u_extract',0);gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindFramebuffer(gl.FRAMEBUFFER,outputFramebuffer);gl.viewport(0,0,this.width,this.height);
    const out=this.outputShader.use();this.bindTexture(out,'u_image',0,this.scene!.color);this.bindTexture(out,'u_bloom',1,this.bloom[1].color);this.bindTexture(out,'u_depth',2,this.scene!.depth);
    this.bindTexture(out,'u_volume',3,this.volume!.color);out.vec2('u_resolution',this.width,this.height);
    out.vec2('u_sunScreen',sunX,sunY);out.f('u_sunVisible',sunVisible);
    out.f('u_bloomStrength',this.bloomEnabled?(this.dimension===0?0.10:0.18):0);out.f('u_debug',this.debug);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.ALWAYS);gl.depthMask(true);
    out.f('u_day',this.sun[1]);out.f('u_dimension',this.dimension);out.f('u_time',this.time);out.f('u_underwater',this.underwater?1:0);gl.drawArrays(gl.TRIANGLES,0,3);gl.bindVertexArray(null);gl.depthMask(true);gl.enable(gl.DEPTH_TEST);
    // A fragment depth write transfers scene depth across framebuffer formats.
    // Blitting DEPTH_COMPONENT24 to ANGLE's default D24S8 is invalid.
    gl.depthFunc(gl.LEQUAL);gl.activeTexture(gl.TEXTURE0);
  }
  dispose():void{
    this.disposed=true;
    for(const t of [this.scene,this.opaque,this.reflection,this.shadow,this.volume,this.skyTarget,...this.bloom])if(t)this.destroy(t);
    for(const s of [...this.skyShaders.values(),this.bloomShader,this.outputShader,this.volumeShader])this.gl.deleteProgram(s.program);
    this.gl.deleteTexture(this.noise);this.gl.deleteTexture(this.galaxy);this.gl.deleteTexture(this.endNoise);this.gl.deleteTexture(this.planet);this.gl.deleteTexture(this.rainHeight);this.gl.deleteTexture(this.caustics);
    this.gl.deleteVertexArray(this.vao);
  }
}
