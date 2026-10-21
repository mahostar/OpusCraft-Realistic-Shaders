/** Selected Photon GLSL adapted for WebGL 2, not a full Iris shaderpack port.
 * Copyright (c) 2021-2025 Benjamin Stott / SixthSurge.
 * Source: user-provided Photon shaders/include/utility/phase_functions.glsl.
 * See licenses/PHOTON-LICENSE.txt and public/hyperShader/photon/LICENSE.txt.
 */
export const PHOTON_PHASE = `
float photonHG(float nu,float g){
  float gg=g*g;
  return (0.0795774715-0.0795774715*gg)/pow(max(0.001,1.0+gg-2.0*g*nu),1.5);
}
float photonCornetteShanks(float nu,float g){
  float gg=g*g;
  float p1=1.5*(1.0-gg)/(2.0+gg);
  float p2=(1.0+nu*nu)/pow(max(0.001,1.0+gg-2.0*g*nu),1.5);
  return p1*p2*0.0795774715;
}`;
