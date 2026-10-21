import { CROMOS_WATER, CROMOS_BIOME_WATER } from './cromosWaterData';

type WaterKey = keyof typeof CROMOS_WATER;
export function cromosBiome(name: string): WaterKey {
  const aliases:Record<string,string>={swamp:'swampland',snowy_taiga:'cold_taiga',snowy_plains:'ice_plains',old_growth_pine_taiga:'mega_taiga',old_growth_spruce_taiga:'redwood_taiga_mutated',dark_forest:'roofed_forest',sparse_jungle:'jungle_edge',windswept_hills:'extreme_hills',windswept_forest:'extreme_hills_plus_trees',snowy_beach:'cold_beach',stony_shore:'stone_beach',badlands:'mesa',wooded_badlands:'mesa_plateau_stone',eroded_badlands:'mesa_bryce',mushroom_fields:'mushroom_island',ice_spikes:'ice_plains_spikes'};
  const actual=aliases[name]??name;
  if(actual in CROMOS_BIOME_WATER)return CROMOS_BIOME_WATER[actual as keyof typeof CROMOS_BIOME_WATER];
  if (/swamp|mangrove/.test(name)) return 'swamp';
  if (/frozen|cold|snow|ice/.test(name)) return 'frozen';
  if (/warm_ocean|lukewarm/.test(name)) return 'warm_ocean';
  if (/deep.*ocean/.test(name)) return 'deep_ocean';
  if (/ocean/.test(name)) return 'ocean';
  if (/jungle/.test(name)) return 'jungle';
  if (/river/.test(name)) return 'river';
  if (/dappled/.test(name)) return 'dappled_forest';
  return 'water';
}

/** Pack values are observations. The RGB calibration below is an explicit
 * adaptation: Bedrock's spectral media coefficients and renderer are absent.
 * Keep biomeContribution=0: murky vanilla vertex tints must not bleach the sea.
 */
export class CromosWater {
  key: WaterKey = 'water';
  waves = [0.55, 1.4, 0.5, 1.12];
  extinction = [0.22, 0.052, 0.032];
  scatter = [0.009, 0.19, 0.22];
  fog = [0.37,0.76,0.76];
  caustics = [0.45,2];
  causticFrame = 0.075;
  sampleWidth = 0.16;
  fogRange = [8,150];
  /** Wrapped phase, integrated rather than recomputed as elapsedTime*speed.
   * Rebasing around the camera also avoids worldPosition*changingFrequency
   * racing at distant coordinates while the biome spectrum settles. */
  readonly waveOrigin: [number,number] = [0,0];
  readonly wavePhases = [0,0,0];
  causticPhase = 0;
  private initialized = false;
  private previousTime = 0;
  update(biome: string, time: number, x=0, z=0): void {
    this.key = cromosBiome(biome);
    const profile = CROMOS_WATER[this.key], p = profile.particles;
    const turbidity = Math.min(1, (p.cdom + p.chlorophyll + p.suspended_sediment) * 22);
    const dt=this.initialized?Math.max(0,time-this.previousTime):0;
    const blend = this.initialized ? 1-Math.exp(-Math.min(0.1,dt)*2) : 1;
    const previousFrequency=this.waves[0],previousSpeed=this.waves[1],previousFrame=this.causticFrame;
    const smooth = (current:number[], target:number[]) => {for(let i=0;i<target.length;i++)current[i]+=(target[i]-current[i])*blend;};
    smooth(this.waves,[profile.waves.frequency,profile.waves.speed,profile.waves.depth,profile.waves.shape]);
    // Preserve documented spectral meaning and linear concentration magnitude:
    // CDOM absorbs blue, chlorophyll red+blue, sediment green+blue. The spectral
    // basis weights are our RGB calibration, not recovered Bedrock constants.
    smooth(this.extinction,[0.22+p.chlorophyll*5+p.suspended_sediment*0.5,0.036+p.cdom*0.3+p.suspended_sediment*2,0.024+p.cdom*7+p.chlorophyll*6+p.suspended_sediment*4]);
    smooth(this.scatter,[0.045+turbidity*0.025,0.47-turbidity*0.18,0.52-turbidity*0.25]);
    const hex=parseInt(profile.fog.fog_color.slice(1),16);
    smooth(this.fog,[(hex>>16&255)/255,(hex>>8&255)/255,(hex&255)/255]);
    smooth(this.caustics,[profile.caustics.scale,profile.caustics.power]);
    smooth(this.fogRange,[profile.fog.fog_start,profile.fog.fog_end]);
    this.causticFrame+=(profile.caustics.frame_length-this.causticFrame)*blend;
    this.sampleWidth+=(profile.waves.sampleWidth-this.sampleWidth)*blend;
    const tau=Math.PI*2,wrap=(phase:number,period:number)=>((phase%period)+period)%period;
    let dx= Math.cos(Math.PI/6),dz=Math.sin(Math.PI/6),frequencyScale=1,speedScale=1;
    const turn=CROMOS_WATER.water.waves.direction_increment*Math.PI/180,cs=Math.cos(turn),sn=Math.sin(turn);
    for(let i=0;i<this.wavePhases.length;i++){
      const frequency=this.waves[0]*tau*frequencyScale;
      if(!this.initialized){
        this.wavePhases[i]=wrap((x*dx+z*dz)*frequency-time*this.waves[1]*speedScale*frequency,tau);
      }else{
        const oldFrequency=previousFrequency*tau*frequencyScale;
        const meanFrequency=(frequency+oldFrequency)*0.5;
        const travelRate=(previousSpeed*oldFrequency+this.waves[1]*frequency)*0.5*speedScale;
        this.wavePhases[i]=wrap(this.wavePhases[i]+((x-this.waveOrigin[0])*dx+(z-this.waveOrigin[1])*dz)*meanFrequency-dt*travelRate,tau);
      }
      [dx,dz]=[dx*cs-dz*sn,dx*sn+dz*cs];
      frequencyScale*=CROMOS_WATER.water.waves.frequency_scaling;
      speedScale*=CROMOS_WATER.water.waves.speed_scaling;
    }
    this.causticPhase=wrap(this.initialized?this.causticPhase+dt*0.5*(1/previousFrame+1/this.causticFrame):time/this.causticFrame,64);
    this.waveOrigin[0]=x;this.waveOrigin[1]=z;
    this.previousTime=Math.max(this.previousTime,time);this.initialized=true;
  }
}
