# Cromos water adaptation

Source supplied by Mohamed: `ProjectStunning/Cromos_Realistic_V0_1_19_All_In_One.mcpack`, 262,162 bytes, SHA-256 `f4ce9b6e03637b0074b9aa44ec02be205d52a36f6d0cbd5f0e0d27d623a30180`.

Creator: Cromos GG / CromosGG. The pack credits Mojang bedrock-samples for colour textures and baseline lighting curves. This integration imports water configuration data, not its block textures. Existing OpusCraft texture pixels are preserved.

The requested REA 6.5 source checkout has no compiled CLI runtime. Its reverse-engineer-anything instructions were read; the already-built local REA 6.7 CLI performed `inspect-artifact` without executing the target. Full evidence: `evidence/cromos/rea-inspection.json`, evidence ID `ev_ea4566b3e16069e034776005d7ba8269a720f5c42b9673755c826587a96293f6`. Inventory covers 294 archive members. No GLSL/HLSL/native material shader is included. `tests/hyperShader/recover-cromos.py` reproducibly recovers nine water profiles, their fog settings and explicit client-biome mappings with member digests.

## Bedrock interpretation checked October 21, 2026

Primary references:

- [Microsoft: Water Effects](https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/watercustomization?view=minecraft-bedrock-stable)
- [Microsoft: Reflections Customization](https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/reflectionscustomization?view=minecraft-bedrock-stable)
- [Microsoft: Per-Biome Customization](https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/biomecustomization?view=minecraft-bedrock-stable)
- [Mojang: vanilla water settings](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/water/water.json)

| Setting | Recovered Cromos MEDIUM values | Meaning and application |
| --- | --- | --- |
| Waves enabled | true | Image-based normal/refraction effect, as in Vibrant Visuals. Mesh boundaries stay fixed. Mojang sample default has waves disabled. |
| Frequency | 0.42 ocean/warm ocean; 0.55 elsewhere | Cycles per water block, converted to angular frequency by multiplying by 2 pi. First wavelengths about 2.38 / 1.82 blocks. |
| Direction increment | 97 degrees | Rotation between octave headings, directly used in the shader rotation matrix. |
| Frequency/speed scaling | 1.22 / 1.08 | Successive octave multipliers, directly recovered. |
| Octaves | 3 | MEDIUM spectrum; LOW has 2, HIGH 6. This integration uses MEDIUM for cost control. No separate user-facing quality setting is added. |
| Depth | 0.24 swamp to 0.76 deep ocean | Scales the image-space wave amplitude. Native amplitude calibration is not published; our normal-strength calibration is explicit in GLSL. These are not vertex displacements in metres. |
| Mix / pull | 0.30 / 0.22 | Fine-octave blending and advection of smaller wave coordinates by broader crests. The native fractal equation is absent, so this is an independent interpretation. |
| Sample width | 0.16 / 0.20 | Larger values smooth the wave spectrum. Applied as frequency-domain filtering plus pixel-footprint filtering. Analytic derivatives avoid finite-difference texture sampling. |
| Shape | 1.08 / 1.12 | Sharpening of sinusoidal crests; 1 is a pure sine. |
| Speed | biome-specific 1.08 to 1.4 (see data) | Drives moving wave phase, with the recovered octave speed scaling. Native absolute speed calibration is not published. |
| Particle concentrations | actual CDOM, chlorophyll and sediment mg/L | Preserved in generated data; CDOM preferentially absorbs blue, chlorophyll red+blue, sediment green+blue. RGB basis weights are independently calibrated, not recovered engine constants. |
| Biome colour contribution | 0 | Vanilla vertex water tint is not mixed into the optical water colour. |
| Caustic power | 2 | Brightness multiplier, twice Mojang sample power 1. It does not narrow/darken the pattern. |
| Caustic scale | 0.45 | Inverse projection size: 0.45 vs vanilla 0.50 gives approximately 11% larger patterns. |
| Caustic frame length | 0.075 s generally, 0.09 s ocean/warm ocean | With the documented built-in 64-frame animation, cycles are 4.8 / 5.76 s. Our independent procedural pattern retains this cadence. The native caustic sprite is not in the pack. |
| Underwater fog | recovered per-biome colour and start/end distances | Smoothly changes across biome boundaries; RGB fog colour is calibrated into our scene buffer rather than copied as unscaled HDR radiance. |

Bedrock provides IBL and SSR; their implementation and spectral coefficients are not shipped in this pack. OpusCraft keeps live planar terrain reflections for sea-level water and bounded SSR elsewhere, Fresnel blending, depth refraction, and a filtered GGX sun highlight. The existing shallow contact meniscus is retained. The reflected draw's derivative-normal orientation is corrected before lighting.

Recovered settings and matching parameter meanings establish a documented adaptation, not pixel parity or an execution of the pack in Bedrock. The reference photograph and local game have different geometry, textures, camera, depth and lighting. Comparison evidence must retain that limitation.

## Final local adaptation

`public/hyperShader/cromos-caustics.png` is independently generated by `tests/hyperShader/bake-caustics.py`, not extracted from Bedrock. It stores 64 periodic refracted-ray density frames and surface slopes. The runtime uploads isolated 128-square texture-array layers with per-layer mipmaps and interpolates adjacent frames. This avoids Voronoi loops in terrain fragments and animation-atlas mip bleeding. The shader uses the recovered scale, power and animation cadence with restrained local illumination calibration.

Actual water-contact faces and aquatic plants receive the pattern; dry low-altitude terrain does not. Direct shadow visibility, propagated skylight, rain and depth gate the effect. Aquatic root/tip metadata uses existing vertex-alpha bytes; the main and shadow vertex shaders share the same tip displacement.

Water transport converts the legacy scene-colour convention to linear RGB for absorption/in-scatter, then returns to that convention before the existing postprocess. This is not a full conversion of every world/entity/UI pass to a uniformly linear HDR renderer. No such parity or completed architectural migration is claimed. Fine reflection normals are separate from gentle, projected depth-scaled refraction.
