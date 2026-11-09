import * as bloxity from './bloxity.js'

// Loading + GPU warm-up. The Bloxity portal's loading overlay covers the game for the whole boot:
// main.js reports each phase with step() and calls reveal() (bloxity loadingEnd) only once warm()
// has compiled every shader and pushed every mesh and texture to the GPU. Without that the first
// seconds of play froze while the GPU caught up (a 5 s first frame, then a hitch each time
// something new came into view or the Car Shop's cars were built).
// The game's developer page needs "LoadingEnd Support" on, or the portal lifts its overlay 1.5 s
// after the first frame instead of waiting for loadingEnd.

// A loading phase: the status line under the portal's overlay.
export function step(label) {
  bloxity.loadingStep(label)
}

// Gameplay is ready: the portal lifts its overlay.
export function reveal() {
  bloxity.notifyFirstFrame()
}

// Resolves with p, or after ms if p takes longer (the work carries on in the background).
export const atMost = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))])
// Yields to the browser between heavy steps (status messages get through, the page stays alive).
export const breathe = () => new Promise((r) => setTimeout(r, 0))

// Compile every material in the scene (in parallel where the driver allows), then draw the whole
// scene once with nothing culled or hidden so every geometry, texture and shadow caster reaches
// the GPU. Each render is one output path the game uses (bloom target and plain canvas), since
// each needs its own shader variants.
export async function warm(renderer, scene, camera, renders) {
  try {
    await atMost(renderer.compileAsync(scene, camera), 15000)
  } catch {
    // Older drivers: the warm draw below compiles them instead.
  }
  const saved = []
  scene.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
      saved.push(o, o.visible, o.frustumCulled)
      o.visible = true
      o.frustumCulled = false
    } else if (!o.visible) {
      saved.push(o, o.visible, o.frustumCulled)
      o.visible = true
    }
  })
  try {
    for (const render of renders) render()
  } catch {
    // A failed warm draw only costs the stutter it was meant to save.
  } finally {
    for (let i = 0; i < saved.length; i += 3) {
      saved[i].visible = saved[i + 1]
      saved[i].frustumCulled = saved[i + 2]
    }
  }
}
