// Material metadata occupies unused opaque vertex-alpha values, with no larger
// meshes or additional texture fetches. Both rendering paths restore opacity.
export const MATERIAL = { aquaticRoot: 245, aquaticPlant: 246, submergedSand: 247, submergedSolid: 248, grassPlant: 249, grass: 250, sand: 251, foliage: 252, lava: 253, water: 254 } as const;
export function terrainMaterial(name: string, grassTint: boolean, thin: boolean, waterContact=false): number {
  if (name === 'sand') return waterContact ? MATERIAL.submergedSand : MATERIAL.sand;
  if (waterContact) return thin ? MATERIAL.aquaticPlant : MATERIAL.submergedSolid;
  if (grassTint) return thin ? MATERIAL.grassPlant : MATERIAL.grass;
  return thin ? MATERIAL.foliage : 255;
}
