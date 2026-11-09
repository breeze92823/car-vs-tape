// Toy-brick canvas painters for the town: studded baseplates, studded checker
// walls, the treadmill belt, tape stripes and the roll-up door. All greyscale
// where a material tints them (one texture serves every house colour).
import { heightToNormal, mulberry32 } from './textures.js'

function canvas(w, h = w) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// Studs on a grid: grey colour (light from the top-left: lit rim, shaded lower
// right) + a height field for the normal map. `checker` alternates the base
// tone of blocks of `checker` x `checker` studs (the wall look).
function paintStuds({ size = 256, studs = 4, base = 0.78, light = 0.92, dark = 0.6, checker = 0, checkerAlt = 0.9, seed = 1, studR = 0.3, noise = 0.03, topK = 0.35, shadowK = 0.7, shOff = 0.07, bump = 1.6 }) {
  const rand = mulberry32(seed)
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const height = new Float32Array(size * size)
  const cell = size / studs
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(x / cell)
      const gy = Math.floor(y / cell)
      const u = (x % cell) / cell - 0.5
      const v = (y % cell) / cell - 0.5
      let tone = base
      if (checker) tone = (Math.floor(gx / checker) + Math.floor(gy / checker)) % 2 === 0 ? base : checkerAlt
      const d = Math.hypot(u, v)
      const top = 1 - smooth(studR - 0.03, studR + 0.01, d) // 1 on the stud top
      // Shadow cast to the lower right of each stud, lit rim on the upper left.
      const sd = Math.hypot(u - shOff, v - shOff)
      const shadow = (1 - smooth(studR, studR + 0.12, sd)) * (1 - top)
      const rim = top * smooth(studR - 0.1, studR - 0.02, d) * (u + v < 0 ? 1 : -0.6)
      // Thin seam between plates every cell edge (faint).
      const seam = Math.max(smooth(0.47, 0.5, Math.abs(u)), smooth(0.47, 0.5, Math.abs(v))) * 0.06
      let g = tone + top * (light - base) * topK - shadow * (tone - dark) * shadowK + rim * 0.12 - seam
      g += (rand() - 0.5) * noise
      const i = y * size + x
      height[i] = top * 0.9 + (1 - seam * 10) * 0.05
      const vv = Math.max(0, Math.min(1, g)) * 255
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = vv
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { color: c, normal: heightToNormal(height, size, bump) }
}

// Baseplate: 4 x 4 studs per tile (tile = TOWN.plateTile metres).
export const paintPlate = () => paintStuds({ size: 256, studs: 4, base: 0.78, light: 1, dark: 0.5, seed: 11, studR: 0.3, topK: 0.7, shadowK: 0.5, shOff: 0.11, bump: 1.1 })

// House wall: a 2 x 2 checker of big squares, each 4 x 4 small studs.
export const paintWall = () => paintStuds({ size: 256, studs: 8, base: 0.97, checkerAlt: 0.84, checker: 4, light: 1, dark: 0.7, seed: 12, studR: 0.26, noise: 0.02 })

// Fine bricks for trim/roofs/stone (8 x 8 studs, no checker).
export const paintFine = () => paintStuds({ size: 256, studs: 8, base: 0.86, light: 1, dark: 0.62, seed: 13, studR: 0.27 })

// Treadmill belt: dark rubber with raised cross ribs; scroll offset.y to run it.
export function paintBelt(size = 128) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#1a1c24'
  ctx.fillRect(0, 0, size, size)
  const ribs = 8
  for (let i = 0; i < ribs; i++) {
    const y = (i / ribs) * size
    const g = ctx.createLinearGradient(0, y, 0, y + size / ribs)
    g.addColorStop(0, '#3a3e4c')
    g.addColorStop(0.3, '#2a2d38')
    g.addColorStop(1, '#14151b')
    ctx.fillStyle = g
    ctx.fillRect(0, y + 2, size, size / ribs - 4)
  }
  return c
}

// Caution tape: diagonal bands of `color` and dark ink with darker edges and a printed word.
export function paintTape(color, ink = '#15151c', w = 512, h = 64) {
  const c = canvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = ink
  const band = 40
  for (let x = -h; x < w + h; x += band * 2) {
    ctx.beginPath()
    ctx.moveTo(x, h)
    ctx.lineTo(x + band, h)
    ctx.lineTo(x + band + h, 0)
    ctx.lineTo(x + h, 0)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillRect(0, 0, w, 5)
  ctx.fillRect(0, h - 5, w, 5)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillRect(0, 6, w, 3)
  return c
}

// Roll-up garage door: horizontal slats with a soft vertical sheen.
export function paintDoor(size = 256) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const slats = 12
  for (let i = 0; i < slats; i++) {
    const y = (i / slats) * size
    const g = ctx.createLinearGradient(0, y, 0, y + size / slats)
    g.addColorStop(0, '#9ea3b4')
    g.addColorStop(0.45, '#7d8295')
    g.addColorStop(0.9, '#5c6072')
    g.addColorStop(1, '#3f4250')
    ctx.fillStyle = g
    ctx.fillRect(0, y, size, size / slats)
  }
  const s = ctx.createLinearGradient(0, 0, size, 0)
  s.addColorStop(0, 'rgba(255,255,255,0)')
  s.addColorStop(0.35, 'rgba(255,255,255,0.18)')
  s.addColorStop(0.6, 'rgba(255,255,255,0)')
  ctx.fillStyle = s
  ctx.fillRect(0, 0, size, size)
  return c
}

// Wood planks for the stalls (vertical boards with grain).
export function paintWood(size = 128) {
  const rand = mulberry32(77)
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const boards = 4
  for (let b = 0; b < boards; b++) {
    const x = (b / boards) * size
    const tone = 0.85 + rand() * 0.15
    ctx.fillStyle = `rgb(${150 * tone},${92 * tone},${48 * tone})`
    ctx.fillRect(x, 0, size / boards, size)
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(60,30,10,${0.1 + rand() * 0.15})`
      ctx.fillRect(x + rand() * (size / boards), 0, 1 + rand() * 2, size)
    }
    ctx.fillStyle = 'rgba(40,20,5,0.6)'
    ctx.fillRect(x, 0, 2, size)
  }
  return c
}

// Swirling portal disc (animated in the shader; this is just the base noise).
export function paintGlowRing(size = 128) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.5)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return c
}
