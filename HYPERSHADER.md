# ProjectStunning / hyperShader

Play locally at **http://127.0.0.1:5188/**. Restart with `npm run dev -- --host 127.0.0.1 --port 5188 --strictPort` from this directory.

The shared hyperShader switch is the last home-menu button, in the pause menu, and in Video Settings. It persists and applies to every world. The home panorama has shaded and original variants. Block textures remain unchanged. The coastal test shortcut has been removed from the menu.

Video Settings now has one global **Render Resolution** control: Native, 1080p, 1440p, 2160p, and 720p. It works with shaders ON or OFF, preserves the window shape, and never enlarges a smaller window. 1080p fits inside 1920×1080; an ultrawide window can therefore render at 1920×960. Existing Render Distance and Max Framerate controls remain shared.

## Performance audit — October 20, 2026

The principal regression was the monolithic terrain fragment shader. Every terrain pass carried water, wet reflections and dimension branches, including the End accretion ray marcher. On ANGLE/D3D11 this cost about 131 ms per coastal terrain frame and 73–168 ms in the two Nether views. The frame was GPU-bound; JavaScript render submission alone was only a few milliseconds.

Changes:

- Compile dimension-specific, separate opaque, translucent/water, and wet-coating programs. Their unused branches are removed at compile time. Shader variants are cached in a bounded map.
- Remove Nether sun-shadow rendering and its unused screen-space sun rays. Keep biome haze, heat shimmer, lava emission, bloom and reduced motes.
- Cull shadow casters against the light frustum; keep off-camera casters that can affect the shadow map.
- Schedule planar reflections only when actual sea-level water bounds are visible; capture opaque colour/depth only when water or wet reflections need it. Keep live underwater reflections.
- Reuse the main visibility list after mirrored rendering instead of sorting it again.
- Depth-test the full-resolution End sky behind opaque terrain. Keep the 110-step accretion integration, planet textures and full sky resolution.
- Replace the shader-OFF End's original tiled static cube appearance with an independent, inexpensive direction-based starfield. OFF allocates no hyperShader pipeline.

The optimization did not lower scene resolution, shadow-map resolution, water effects, volumetric sample counts, or the black-hole integration quality. The separate resolution control changes resolution only when selected by the player.

### Actual measured results

RTX 3060, Chromium/ANGLE D3D11, 2560×1280, same seed/cameras/weather, 8-chunk render distance. GPU timings use asynchronous `EXT_disjoint_timer_query_webgl2` queries; no `gl.finish()` is used in timed frames. The initial samples contain 48 frames per view.

| View | Before FPS | Optimized uncapped FPS |
| --- | ---: | ---: |
| Coast | 6.6 | 92.8 |
| Overworld facing land | 6.4 | 99.6 |
| Rain | 8.3 | 68.0 |
| Nether, two angles | 4.8–12.9 | 246.8–265.8 |
| End, wide/black hole | 34.6–36.8 | 96.4–112.3 |

Uncapped figures measure browser rendering throughput with frame pacing disabled; they are not a guarantee of displayed FPS on every monitor, browser, world or render distance. Normal paced 8-chunk tests reached about 60 FPS across these views. In a separate longer test (at least 6 seconds and 180 frames per view), **12 chunks at native 2560×1280** gave 48.8–52.6 FPS on the dry Overworld, 40.1 FPS in rain, 154.9–185.2 FPS in the Nether and 99.8–112.0 FPS in the End. Larger distances still cost geometry, shadow and reflection work. Use the shared resolution/distance controls as needed; 1080p performance was not separately benchmarked.

One historical camera named `03-underwater` was embedded inside shore terrain. It is explicitly excluded from performance conclusions in every report. The actual submerged eye position and moving underside reflections are checked separately by the final regression test.

### Verification and evidence

- `npm run build` and `git diff --check` passed.
- GPU reports: `evidence/performance/baseline/report.json`, `specialized/report.json`, `optimized-uncapped/report.json`, `final-native-rd12/report.json`.
- Native mouse clicks verified resolution selection, matching drawing buffers, persistence after reload, and use with shader OFF. End ON/OFF transitions were checked repeatedly in six viewing directions with no browser/shader/WebGL errors: `evidence/performance/regression/report.json`.
- Earlier visual matrix: coast, shore, sunlight changes, waterline/underwater angles, weather, Nether and End views/portals in `evidence/matrix/`; extended rain/reflection/roof and particle checks in `evidence/extended/`.
- New visual checks preserve the approved appearance; they do not establish pixel-identical parity with a different Minecraft renderer or the supplied reference screenshots.

Repeat performance measurements with:

```powershell
node tests/hyperShader/performance-audit.mjs local --uncapped --sustained --rd=8
node tests/hyperShader/performance-audit.mjs local-1080p --uncapped --sustained --rd=12 --1080p
node tests/hyperShader/final-regression.mjs
```

Source and asset credits are in `licenses/`. This is a WebGL2 renderer using raster shadows, planar/screen-space reflections and volumetric integration; it does not use hardware RTX ray tracing. Screen-space reflections depend on geometry present in the current view and have environment fallbacks.

## Overworld colour, foliage and golden sunlight refinement

The Overworld now has restrained daytime exposure, richer grass/block colours, warmer directional light and stronger golden sunrise/sunset illumination. Direct sunlight is separated from the vanilla ambient sky lightmap, so a low sun no longer gets dimmed twice. The low-sun glow, depth-occluded rays and participating air become stronger near the horizon; the jittered rays share the existing half-resolution volume and depth-guided upsample to avoid hard radial bands; midday does not inherit that golden-hour boost. Rain suppresses direct sunshine. The Nether and End retain their dimension-specific lighting.

The distant black grass had a separate filtering defect: transparent black texels were diluting RGB during mipmap generation. Mipmaps now keep colour separate from alpha coverage. Thin vegetation has its own material tag and wrapped/transmitted lighting, instead of being lit like an opaque wall. Procedural source textures remain unchanged; the shared filtering fix also improves cutout edges with shaders OFF.

Rain optimizations keep the sparse 3D droplets. Wet surfaces use cached indices of upward solid faces, avoiding walls, lava and vegetation; planar reflections skip sections entirely behind the clip plane. Linear-depth screening avoids unnecessary inverse transforms during wet SSR, faint rough films use their environment reflection, and fog hides reflections at the correct distance. Opaque shadow casters use a depth-only fragment program; cutouts retain their alpha-tested shadows.

Matched sustained rain samples on the RTX 3060, **2560×1280, 8 chunks, uncapped**, changed from **69.3 to 75.0 FPS** in the first view and **67.3 to 70.5 FPS** looking down toward the ground. Wet-coating GPU time decreased from **1.99 to 1.36 ms** and **2.61 to 1.75 ms** (about 32–33%). These are measurements in two scenes, not a universal FPS promise. The experiment reports are retained; the accepted result is `evidence/performance/rain-accepted-palette/report.json`. Its legacy `entities/other` GPU group also contains the newly separated solid-shadow program; frame totals and the explicitly named wet/reflection groups include all their work.

Validation: fixed-camera daylight, noon, sunrise, sunset, rain and night captures are in `evidence/palette/`; final filtered low-sun captures are in `evidence/palette/delivery-soft/`. A cutout-mipmap regression checks repeated filtering and unchanged coverage. The extended rain fixture compares the filtered wet geometry against the original full geometry: **zero changed channels out of 5,760,000**, with roof coverage, animated droplets and dimension captures also passing. This comparison validates the geometry optimization, not identical output to the old colour treatment.

## October 21 water and thunder handoff

The final water pass keeps actual voxel water, the contact meniscus and live planar reflections. Biome water settings recovered from the supplied Cromos archive drive an independent RGB optical adaptation; the pack does not contain Bedrock's native water shader. Brighter turquoise in-scatter softens the shallow/deep transition. Specular roughness is filtered and bloom remains Gaussian. The bright floor web was reduced substantially in response to the final feedback, and is applied to submerged geometry rather than overlaid on the whole refracted image.

Refraction now projects a separate broad, slowly moving displacement proportional to optical depth. Fine capillary normals affect reflections/glints without melting seagrass or making shelf edges ripple like ribbons. Foreground depth rejection remains, scene-colour copies use LINEAR filtering, and the original block atlas retains crisp filtering. Near-zero-depth contacts fade out ripple and specular energy to reduce white dashes/blue edge streaks. Submerged sand and aquatic plants receive targeted colour balancing; aquatic roots stay fixed while tips and their shadows sway together. Grass still casts onto the ground without receiving shadows on its blades.

Lightning already existed in the world simulation and audio system. The renderer now displays it beyond the former 64-block cutoff, honours dark gaps between repeat flashes, and draws a white-hot core with a blue envelope. hyperShader now consumes the existing lightning flash signal for sky and terrain lighting. Ordinary rain stays rain; use `/weather thunder` to test a storm. No duplicate storm simulator or extra damaging strike loop was added.

### Verified evidence

- `npm run build`, TypeScript and `git diff --check` passed after the final refraction change.
- `evidence/cromos/delivery/`: 1920×1080 shelf, horizon, sun-in-frame, shoreline, underwater and night screenshots; seven diagnostic captures plus bloom OFF; a roughly three-second live moving-camera clip (`water-motion.mp4`). The fixed sun is about 50° high; the requested pair uses an azimuth 35° right of the view. Eye height is 1.7 blocks over water.
- `stats.json` implements the supplied mean-based metric and records exact crop boxes. The selected game sand patch changed from saturation **0.15 to 0.18**, RGB **153/180/166 to 148/181/162**, luma **0.680 to 0.678**; reference patch is RGB **115/171/150**, saturation **0.33**, luma **0.619**. These are different surfaces/plant coverage, not pixel parity. The broad numerical target table is not fully met; do not infer a score from these measurements.
- `evidence/lightning/report.json`: real storm strike path with a deterministic test roll, sound requests, a bolt at 71.8 blocks, flash lighting, dark gaps, shader OFF; no browser/WebGL errors. The test bolt is visual-only in a disposable browser profile. Audible playback and stochastic time until a natural strike were not measured.
- `evidence/performance/oct21-final-1080p/report.json`: final uncapped RTX 3060 run, 8 chunks, 1080p resolution cap at the tested 2:1 window aspect ratio (**1920×960 drawing buffer**), at least six seconds and 180 frames per scene. Coast **86 FPS**, land **94**, underwater **77**, rain **62**, Nether **241–260**, End **139–178**. All WebGL errors zero. Water GPU time **0.29–1.39 ms**. Reflection time **0.67–3.60 ms**, so the proposed 1 ms reflection budget is not met in every scene. These are scene throughput measurements, not universal displayed FPS.
- Earlier native-size results in `evidence/performance/oct21-delivery-native/` were taken before the final broad-refraction correction and must be distinguished from the final capped run.
- Final `tests/hyperShader/final-regression.mjs`: eight checks passed, covering native resolution controls/persistence, actual underwater camera rotation and repeated End ON/OFF transitions; no browser/shader/WebGL errors (`evidence/performance/regression/report.json`).

The visual and diagnostic captures establish current behaviour, not perfect matching of the reference. Quantitative maximum glint diameter, shimmer-free motion on every display, exact refraction displacement per pixel and every cave/roof configuration remain unproven. The approved End/Nether shader appearance was not redesigned in this pass.

## Water movement speed fix

The previous main waves used `(worldPosition - elapsedTime * blendedSpeed) * blendedFrequency`; caustics used `elapsedTime / blendedFrameDuration`. When a biome transition changed these parameters, it rescaled the full animation history and large world coordinates, producing a speed burst that diminished as interpolation settled. The wave clock now integrates wrapped phase increments. Camera-relative coordinates preserve world anchoring while the spatial spectrum changes, and caustics integrate their own frame phase. Wet-surface reflections share the corrected wave path. Backward partial-tick timestamps do not advance the same interval twice.

`tests/hyperShader/water-phase-regression.mjs` checks old/young world clocks, distant coordinates, movement then stopping, pauses, backward timestamps and agreement at 30/120 FPS. In the synthetic transition the legacy equation changes by as much as 4,380 radians in one step; the corrected first-octave increment stays below 0.081 radians at 60 Hz. A live water/river boundary with differing animation settings was crossed and the camera held still for four seconds (`evidence/water-phase/move-stop.mp4`). Captured caustic cadence after stopping was 13.333 frames/second, with no phase burst or browser/WebGL errors. Build and material/biome regressions passed. This establishes the corrected biome-transition timing path; it does not establish the cause of every possible frame-pacing artifact.
