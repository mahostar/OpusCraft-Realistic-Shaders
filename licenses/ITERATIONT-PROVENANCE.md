# IterationT End rendering provenance

This local personal adaptation uses the supplied IterationT 2.0 shader archive and the recovered 3.0 End-sky rendering model. It is not an upstream Iris/OptiFine shader-pack installation.

- Supplied archive: `../online shader/IterationT-Shaders-v2.0.0-All-Versions.zip`, SHA256 `2cb48abda299a000c269108dd26b7b885b92a95cf5403f484ff47cac0ab6c2be`.
- Planet/rings source: `shaders/world1/composite1.fsh`, `PlanetEnd2`; asset: `shaders/texture/noiseC.png` copied byte-for-byte to `public/hyperShader/iteration/noise.png`.
- Recovered 3.0 End code: https://gist.github.com/helloworld3200/d96131671e8023ca4db8937594799bda (helloworld3200, 2025-04-30). Raw recovery retained outside the game checkout at `../reference/IterationT/EndSky.glsl`.
- Source credits https://www.shadertoy.com/view/lstSRS (Sonic Ether) for the black hole.
- REA 6.5.0 archive Evidence: `evidence/iterationt-rea-inventory.json`, compact summary `evidence/iterationt-analysis-summary.json`.

Observed: the 2.0 archive contains no black-hole or planet skybox image. Its four images are noise plus three ripple animation textures. The End planet and its rings are computed in GLSL. The 3.0 source adds `WarpSpace`, volumetric accretion and light bending. This explains why browsing for an End PNG in the downloaded folder cannot find the requested scene.

Integration: `src/render/endSky.ts` adapts the source model to explicit world-space celestial directions, WebGL2 uniforms, safe sphere intersections, the original 64x64 noise layout, finer spatial ray steps, linear RGB temperature approximation and the game's HDR/bloom output. It replaces the previous orange banded disk. Stars, planet, rings, lensing and disk remain live shader rendering. This is a port of those rendering techniques, not verification of complete IterationT visual or feature parity.

No additional redistribution license was included in the supplied ZIP or recovered snippet. Preserve this provenance with the local adaptation; this file does not grant new rights to third-party material.
