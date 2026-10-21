/** Global display resolution cap. Preserve aspect ratio and never upscale a smaller window. */
export function renderSize(nativeWidth:number,nativeHeight:number,cap:number):[number,number]{
  const scale=cap>0?Math.min(1,cap/nativeHeight,(cap*16/9)/nativeWidth):1;
  return [Math.max(1,Math.floor(nativeWidth*scale)),Math.max(1,Math.floor(nativeHeight*scale))];
}
