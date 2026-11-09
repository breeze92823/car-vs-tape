// Procedural texture painters. Everything is drawn into canvases once at load,
// so the game ships no image files. Each painter returns tileable canvases:
// a colour map plus whatever data maps it needs (height -> bump or a derived
// tangent-space normal map, roughness). Same seed = same look every load.
import { CanvasTexture, DataTexture, NearestFilter, RedFormat, RepeatWrapping, SRGBColorSpace } from 'three'

// Deterministic PRNG.
export function mulberry32(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(size) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return c
}

// --- Tileable noise -------------------------------------------------------------
// Value noise on a periodic lattice: the last cell wraps to the first, so the
// result tiles seamlessly. fbm stacks octaves at doubling frequency.
function periodicNoise(size, cells, rand) {
  const lattice = new Float32Array(cells * cells)
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand()
  const out = new Float32Array(size * size)
  const s = (t) => t * t * (3 - 2 * t)
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells
    const y0 = Math.floor(fy)
    const ty = s(fy - y0)
    const y1 = (y0 + 1) % cells
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells
      const x0 = Math.floor(fx)
      const tx = s(fx - x0)
      const x1 = (x0 + 1) % cells
      const a = lattice[y0 * cells + x0]
      const b = lattice[y0 * cells + x1]
      const c = lattice[y1 * cells + x0]
      const d = lattice[y1 * cells + x1]
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
    }
  }
  return out
}

export function fbm(size, baseCells, octaves, seed) {
  const rand = mulberry32(seed)
  const out = new Float32Array(size * size)
  let amp = 0.5
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const layer = periodicNoise(size, baseCells << o, rand)
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp
    total += amp
    amp *= 0.5
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

// --- Height -> normal ----------------------------------------------------------
// Sobel over a wrapped height field into an OpenGL-convention tangent-space
// normal map (what three.js expects). `strength` scales the slopes.
export function heightToNormal(heights, size, strength = 2) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const h = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)) * strength
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)) * strength
      // Canvas y runs down while texture v runs up, hence +dy for the green channel.
      let nx = -dx
      let ny = dy
      let nz = 1
      const len = Math.hypot(nx, ny, nz)
      nx /= len
      ny /= len
      nz /= len
      const i = (y * size + x) * 4
      img.data[i] = (nx * 0.5 + 0.5) * 255
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// Greyscale canvas from a 0..1 field (bump / roughness maps).
function fieldCanvas(field, size, map = (v) => v) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < field.length; i++) {
    const v = Math.max(0, Math.min(255, map(field[i]) * 255))
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// Colour canvas: base hex modulated per pixel by a 0..1 field.
function tintCanvas(field, size, dark, light) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const a = hexRgb(dark)
  const b = hexRgb(light)
  for (let i = 0; i < field.length; i++) {
    const t = field[i]
    img.data[i * 4] = a[0] + (b[0] - a[0]) * t
    img.data[i * 4 + 1] = a[1] + (b[1] - a[1]) * t
    img.data[i * 4 + 2] = a[2] + (b[2] - a[2]) * t
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Wraps a canvas as a repeating texture. Colour maps are sRGB; data maps stay linear.
export function toTexture(c, { repeat = 1, srgb = false, anisotropy = 8 } = {}) {
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = anisotropy
  if (srgb) t.colorSpace = SRGBColorSpace
  return t
}

// --- Painters ----------------------------------------------------------------

// Grass: mottled base, soft blotches, then blade strokes mirrored into a height
// canvas used as a bump map.
export function paintGrass(size = 512) {
  const rand = mulberry32(1337)
  const color = canvas(size)
  const height = canvas(size)
  const c = color.getContext('2d')
  const h = height.getContext('2d')
  c.fillStyle = '#4fb33c'
  c.fillRect(0, 0, size, size)
  h.fillStyle = '#808080'
  h.fillRect(0, 0, size, size)

  // Draws at (x, y) and again at the wrapped offsets so the tile repeats seamlessly.
  const wrapped = (x, y, r, draw) => {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue
        draw(x + ox, y + oy)
      }
    }
  }
  for (let i = 0; i < 90; i++) {
    const x = rand() * size
    const y = rand() * size
    const r = 30 + rand() * 70
    const dark = rand() < 0.5
    wrapped(x, y, r, (px, py) => {
      const g = c.createRadialGradient(px, py, 0, px, py, r)
      g.addColorStop(0, dark ? 'rgba(40,90,30,0.28)' : 'rgba(160,210,90,0.2)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      c.fillStyle = g
      c.fillRect(px - r, py - r, r * 2, r * 2)
    })
  }
  const greens = ['#3a9a2e', '#4fb33c', '#74b552', '#3f7a2e', '#8cc760']
  for (let i = 0; i < 9000; i++) {
    const x = rand() * size
    const y = rand() * size
    const len = 4 + rand() * 9
    const lean = (rand() - 0.5) * 5
    const shade = greens[Math.floor(rand() * greens.length)]
    const lift = 100 + Math.floor(rand() * 140)
    wrapped(x, y, len + 6, (px, py) => {
      c.strokeStyle = shade
      c.lineWidth = 1.3
      c.beginPath()
      c.moveTo(px, py)
      c.lineTo(px + lean, py - len)
      c.stroke()
      h.strokeStyle = `rgb(${lift},${lift},${lift})`
      h.lineWidth = 1.3
      h.beginPath()
      h.moveTo(px, py)
      h.lineTo(px + lean, py - len)
      h.stroke()
    })
  }
  return { color, height }
}

// Sand: fine fbm speckle, normal map from the same field.
export function paintSand(size = 256) {
  const field = fbm(size, 8, 5, 77)
  const rand = mulberry32(78)
  for (let i = 0; i < field.length; i++) field[i] = field[i] * 0.8 + rand() * 0.2
  return { color: tintCanvas(field, size, '#c9a96e', '#f0d9a4'), normal: heightToNormal(field, size, 1.4) }
}

// Rock cliff: large ridged fbm.
export function paintRock(size = 256) {
  const field = fbm(size, 4, 5, 91)
  for (let i = 0; i < field.length; i++) field[i] = 1 - Math.abs(field[i] * 2 - 1)
  return { color: tintCanvas(field, size, '#4c4640', '#958b7e'), normal: heightToNormal(field, size, 3) }
}

// Stone plaza: a 4x4 grid of bevelled tiles with grout. Height drives a normal
// map, and the grout is rougher than the worn tile faces (roughness map).
export function paintTiles(size = 512, perSide = 4) {
  const rand = mulberry32(4242)
  const grain = fbm(size, 8, 4, 4243)
  const tile = size / perSide
  const grout = 5
  const bevel = 10
  const tints = []
  for (let i = 0; i < perSide * perSide; i++) tints.push(0.82 + rand() * 0.18)
  const heights = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  const color = canvas(size)
  const ctx = color.getContext('2d')
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const lx = x % tile
      const ly = y % tile
      const edge = Math.min(lx, ly, tile - 1 - lx, tile - 1 - ly)
      const g = grain[i]
      let hgt
      let r
      let shade
      if (edge < grout / 2) {
        hgt = 0.1
        r = 1
        shade = 0.45 + g * 0.15
      } else {
        const t = Math.min(1, (edge - grout / 2) / bevel)
        hgt = 0.35 + 0.65 * Math.sqrt(t) + (g - 0.5) * 0.12
        r = 0.62 + g * 0.25
        shade = tints[Math.floor(y / tile) * perSide + Math.floor(x / tile)] * (0.82 + g * 0.3)
      }
      heights[i] = hgt
      rough[i] = r
      img.data[i * 4] = 200 * shade
      img.data[i * 4 + 1] = 192 * shade
      img.data[i * 4 + 2] = 180 * shade
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { color, normal: heightToNormal(heights, size, 2.5), roughness: fieldCanvas(rough, size) }
}

// Wood planks running along U: per-plank tint, wavy grain, dark seams.
export function paintPlanks(size = 512, planks = 6, seed = 9) {
  const rand = mulberry32(seed)
  const warp = fbm(size, 4, 3, seed + 1)
  const plankH = size / planks
  const offsets = Array.from({ length: planks }, () => rand() * 40)
  const tints = Array.from({ length: planks }, () => 0.8 + rand() * 0.25)
  const heights = new Float32Array(size * size)
  const color = canvas(size)
  const ctx = color.getContext('2d')
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / plankH)
    const ly = y - row * plankH
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const seam = ly < 2 || ly > plankH - 2
      const grain = 0.5 + 0.5 * Math.sin((y + warp[i] * 30) * 0.9 + offsets[row] + Math.sin(x * 0.02 + row) * 2)
      const shade = seam ? 0.35 : tints[row] * (0.78 + grain * 0.22)
      heights[i] = seam ? 0 : 0.7 + grain * 0.08
      img.data[i * 4] = 168 * shade
      img.data[i * 4 + 1] = 112 * shade
      img.data[i * 4 + 2] = 66 * shade
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { color, normal: heightToNormal(heights, size, 1.5) }
}

// Crate face: planks inside a frame with a diagonal brace (one face, not tiled).
export function paintCrate(size = 256) {
  const { color: planks } = paintPlanks(size, 4, 21)
  const c = canvas(size)
  const ctx = c.getContext('2d')
  ctx.drawImage(planks, 0, 0)
  const frame = size * 0.12
  ctx.fillStyle = '#7a4e26'
  ctx.fillRect(0, 0, size, frame)
  ctx.fillRect(0, size - frame, size, frame)
  ctx.fillRect(0, 0, frame, size)
  ctx.fillRect(size - frame, 0, frame, size)
  ctx.save()
  ctx.translate(size / 2, size / 2)
  ctx.rotate(-Math.PI / 4)
  ctx.fillRect(-size * 0.7, -frame / 2, size * 1.4, frame)
  ctx.restore()
  ctx.strokeStyle = 'rgba(40,20,5,0.6)'
  ctx.lineWidth = 3
  ctx.strokeRect(frame, frame, size - frame * 2, size - frame * 2)
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3)
  // Nail heads in the frame corners.
  ctx.fillStyle = '#3a3a3a'
  for (const x of [frame / 2, size - frame / 2]) {
    for (const y of [frame / 2, size - frame / 2]) {
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  return { color: c }
}

// Water ripple normal map: a sum of sines on integer frequencies (so it tiles).
export function paintWaterNormal(size = 256) {
  const rand = mulberry32(31)
  const waves = Array.from({ length: 10 }, () => ({
    fx: Math.floor(rand() * 6) + 1,
    fy: Math.floor(rand() * 6) - 3,
    phase: rand() * Math.PI * 2,
    amp: 0.3 + rand() * 0.7,
  }))
  const heights = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let h = 0
      for (const w of waves) h += Math.sin(((x * w.fx + y * w.fy) / size) * Math.PI * 2 + w.phase) * w.amp
      heights[y * size + x] = h * 0.1
    }
  }
  return heightToNormal(heights, size, 2)
}

// 3-step gradient for MeshToonMaterial (hard cel bands).
export function toonGradient() {
  const t = new DataTexture(new Uint8Array([70, 160, 255]), 3, 1, RedFormat)
  t.minFilter = t.magFilter = NearestFilter
  t.needsUpdate = true
  return t
}

// Brushed metal: horizontal streaks as a roughness map.
export function paintBrushed(size = 256) {
  const rand = mulberry32(55)
  const field = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    let v = rand()
    for (let x = 0; x < size; x++) {
      v += (rand() - 0.5) * 0.08
      v = Math.max(0, Math.min(1, v))
      field[y * size + x] = 0.25 + v * 0.35
    }
  }
  return fieldCanvas(field, size)
}

// Cracked beach sand: pale cells (tileable Voronoi, wrapped distances) split by
// thin darker cracks, each cell a slightly different shade, plus fine speckle.
// Height is low in the cracks, so the derived normal map reads them as grooves.
export function paintCrackedSand(size = 512, cells = 9, seed = 404) {
  const rand = mulberry32(seed)
  const pts = []
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) pts.push({ x: (gx + 0.15 + rand() * 0.7) / cells, y: (gy + 0.15 + rand() * 0.7) / cells, shade: rand() })
  }
  const speckle = fbm(size, 16, 3, seed + 1)
  const height = new Float32Array(size * size)
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const base = hexRgb('#eed39c')
  const alt = hexRgb('#e6c88b')
  const crack = hexRgb('#c9a263')
  const crackWidth = 0.0045
  for (let y = 0; y < size; y++) {
    const v = y / size
    const cy = Math.floor(v * cells)
    for (let x = 0; x < size; x++) {
      const u = x / size
      const cx = Math.floor(u * cells)
      let d1 = 9
      let d2 = 9
      let owner = null
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox
          const gy = cy + oy
          const p = pts[((gy + cells) % cells) * cells + ((gx + cells) % cells)]
          const px = p.x + Math.floor(gx / cells)
          const py = p.y + Math.floor(gy / cells)
          const d = Math.hypot(u - px, v - py)
          if (d < d1) {
            d2 = d1
            d1 = d
            owner = p
          } else if (d < d2) d2 = d
        }
      }
      const edge = Math.min(1, Math.max(0, (d2 - d1) / crackWidth)) // 0 in the crack, 1 inside a cell
      const s = speckle[y * size + x]
      const i = y * size + x
      height[i] = edge * 0.6 + s * 0.15
      const t = owner.shade * 0.6 + s * 0.4
      const k = 1 - edge
      for (let ch = 0; ch < 3; ch++) {
        const cell = base[ch] + (alt[ch] - base[ch]) * t
        img.data[i * 4 + ch] = cell + (crack[ch] - cell) * k
      }
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { color: c, normal: heightToNormal(height, size, 1.2) }
}

// Barrier wall face: white chevrons on red, pointing along +U (repeat along the wall).
export function paintChevrons(bg = '#e0262b', fg = '#ffffff', w = 256, h = 128) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = fg
  for (const x0 of [w * 0.12, w * 0.58]) {
    ctx.beginPath()
    ctx.moveTo(x0, h * 0.14)
    ctx.lineTo(x0 + w * 0.16, h * 0.14)
    ctx.lineTo(x0 + w * 0.34, h * 0.5)
    ctx.lineTo(x0 + w * 0.16, h * 0.86)
    ctx.lineTo(x0, h * 0.86)
    ctx.lineTo(x0 + w * 0.18, h * 0.5)
    ctx.closePath()
    ctx.fill()
  }
  return c
}

// Vertical 0..1 alpha ramp (glow curtains, light beams): opaque at the bottom.
export function paintFade(color = '#ffffff', h = 128) {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = h
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, h, 0, 0)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, h)
  return c
}

// Outlined game-sign text on a transparent canvas, sized to fit. `draw` can be
// called again once the web font has loaded (the canvas is repainted in place).
// '\n' splits lines; `colors` gives each line its own colour (else `color`).
export function paintText(text, { color = '#ffffff', colors = null, outline = '#0b1a3a', font = '700 96px Fredoka, "Arial Black", sans-serif', pad = 24, bg = null, outlineWidth = 14 } = {}) {
  const c = document.createElement('canvas')
  const lines = String(text).split('\n')
  const draw = () => {
    const ctx = c.getContext('2d')
    ctx.font = font
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width))
    const px = parseInt(font.match(/(\d+)px/)[1], 10)
    const lineH = px * 1.2
    c.width = Math.ceil(width + pad * 2)
    c.height = Math.ceil(lineH * lines.length + px * 0.1 + pad * 2)
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (bg) {
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, c.width, c.height)
    }
    ctx.lineJoin = 'round'
    lines.forEach((line, i) => {
      const y = pad + lineH * (i + 0.5) + px * 0.05
      if (outline) {
        ctx.lineWidth = outlineWidth
        ctx.strokeStyle = outline
        ctx.strokeText(line, c.width / 2, y)
      }
      ctx.fillStyle = colors?.[i] ?? color
      ctx.fillText(line, c.width / 2, y)
    })
  }
  draw()
  return { canvas: c, draw }
}

// Feather flag: red with one white diagonal band (UVs span the flag 0..1).
export function paintFlag(red = '#e3262e', white = '#ffffff', w = 64, h = 256) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = red
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = white
  ctx.beginPath()
  ctx.moveTo(0, h * 0.62)
  ctx.lineTo(w, h * 0.36)
  ctx.lineTo(w, h * 0.5)
  ctx.lineTo(0, h * 0.78)
  ctx.closePath()
  ctx.fill()
  return c
}

// Waterfall sheet: vertical white streaks of varying width over blue (scroll offset.y).
export function paintWaterfall(size = 256) {
  const rand = mulberry32(808)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, size, 0)
  g.addColorStop(0, '#1690ff')
  g.addColorStop(0.5, '#4cc8ff')
  g.addColorStop(1, '#1690ff')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 70; i++) {
    const x = rand() * size
    const w = 1 + rand() * 5
    const y = rand() * size
    const len = size * (0.2 + rand() * 0.6)
    ctx.fillStyle = `rgba(255,255,255,${0.25 + rand() * 0.5})`
    ctx.fillRect(x, y, w, len)
    ctx.fillRect(x, y - size, w, len) // wrap vertically so it tiles
  }
  return c
}

// Particle sprites (white, tinted in the shader). Soft dot: a radial falloff.
export function paintSoftDot(size = 64) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return c
}

// Sparkle: a four-point star with a bright core.
export function paintSparkle(size = 64) {
  const c = paintSoftDot(size)
  const ctx = c.getContext('2d')
  const m = size / 2
  ctx.globalCompositeOperation = 'lighter'
  for (const [w, h] of [[size * 0.07, size * 0.5], [size * 0.5, size * 0.07]]) {
    const g = ctx.createRadialGradient(m, m, 0, m, m, Math.max(w, h))
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(m, m, w, h, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  return c
}

// Treadmill water: bright blue with wavy white ripple lines across it, tiling
// vertically (scroll offset.y to run the belt).
export function paintLaneWater(base = '#0b63f0', size = 128) {
  const rand = mulberry32(512)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, size, 0)
  g.addColorStop(0, base)
  g.addColorStop(0.5, '#2fa4ff')
  g.addColorStop(1, base)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  ctx.lineWidth = 2
  for (let i = 0; i < 9; i++) {
    const y0 = (i / 9) * size
    const amp = 2 + rand() * 4
    const f = 1 + Math.floor(rand() * 3)
    const ph = rand() * Math.PI * 2
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + rand() * 0.4})`
    ctx.beginPath()
    for (let x = 0; x <= size; x += 4) {
      const y = y0 + Math.sin((x / size) * Math.PI * 2 * f + ph) * amp
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  return c
}

// Quilted shop floor: a pink base with a softly shaded diamond grid (one
// diamond per tile; repeat it per ~2 m).
export function paintQuilt(base = '#ff5fa8', size = 128) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.55)
  g.addColorStop(0, 'rgba(255,255,255,0.16)')
  g.addColorStop(1, 'rgba(120,0,40,0.12)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = 'rgba(150,10,60,0.35)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(size / 2, 0)
  ctx.lineTo(size, size / 2)
  ctx.lineTo(size / 2, size)
  ctx.lineTo(0, size / 2)
  ctx.closePath()
  ctx.stroke()
  return c
}

// City pavement: `slabs` x `slabs` square paving slabs, each its own shade, with
// sunken joints and a fine speckle -> colour + derived normal map (City ground).
export function paintPavement({ base, alt, joint }, size = 512, slabs = 4, seed = 505) {
  const rand = mulberry32(seed)
  const shades = Array.from({ length: slabs * slabs }, () => rand())
  const speckle = fbm(size, 32, 3, seed + 1)
  const stain = fbm(size, 4, 3, seed + 2)
  const height = new Float32Array(size * size)
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const a = hexRgb(base)
  const b = hexRgb(alt)
  const j = hexRgb(joint)
  const cell = size / slabs
  const half = 2.2 // px: half a joint's width
  for (let y = 0; y < size; y++) {
    const gy = Math.floor(y / cell)
    const dy = Math.min(y % cell, cell - (y % cell))
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(x / cell)
      const dx = Math.min(x % cell, cell - (x % cell))
      const edge = Math.min(1, Math.max(0, (Math.min(dx, dy) - half) / 1.5)) // 0 in a joint
      const i = y * size + x
      const s = speckle[i]
      height[i] = edge * 0.5 + s * 0.12
      const t = shades[gy * slabs + gx] * 0.7 + s * 0.3
      const dirt = 1 - Math.max(0, stain[i] - 0.55) * 0.35
      for (let ch = 0; ch < 3; ch++) {
        const v = (a[ch] + (b[ch] - a[ch]) * t) * dirt
        img.data[i * 4 + ch] = v + (j[ch] - v) * (1 - edge)
      }
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { color: c, normal: heightToNormal(height, size, 1.4) }
}

// Building facade: `cols` window columns x `rows` storeys per tile on a white wall
// (the material's colour tints it), plus a black canvas with only the lit windows
// (the emissive map). The top-left pixel is plain wall: roofs and floors sample it.
export function paintFacade(glass = '#2b4f7e', size = 512, cols = 8, rows = 4, seed = 606) {
  const rand = mulberry32(seed)
  const color = canvas(size)
  const lit = canvas(size)
  const c = color.getContext('2d')
  const l = lit.getContext('2d')
  c.fillStyle = '#ffffff'
  c.fillRect(0, 0, size, size)
  l.fillStyle = '#000000'
  l.fillRect(0, 0, size, size)
  const cw = size / cols
  const ch = size / rows
  for (let r = 0; r < rows; r++) {
    // A darker band where each floor slab meets the wall.
    c.fillStyle = 'rgba(0, 0, 0, 0.08)'
    c.fillRect(0, (r + 1) * ch - ch * 0.08, size, ch * 0.08)
    for (let k = 0; k < cols; k++) {
      const x = k * cw + cw * 0.2
      const y = r * ch + ch * 0.16
      const w = cw * 0.6
      const h = ch * 0.62
      c.fillStyle = 'rgba(0, 0, 0, 0.35)' // frame
      c.fillRect(x - 2, y - 2, w + 4, h + 4)
      const g = c.createLinearGradient(0, y, 0, y + h)
      g.addColorStop(0, '#c9e4ff')
      g.addColorStop(0.35, glass)
      g.addColorStop(1, glass)
      c.fillStyle = g
      c.fillRect(x, y, w, h)
      if (rand() < 0.38) {
        const warm = 0.75 + rand() * 0.25
        l.fillStyle = `rgb(${255 * warm}, ${236 * warm}, ${190 * warm})`
        l.fillRect(x, y, w, h)
        c.fillStyle = 'rgba(255, 222, 150, 0.55)'
        c.fillRect(x, y, w, h)
      }
    }
  }
  return { color, lit }
}

// Two-tone checkerboard (2x2 squares per tile), e.g. the pink statue walkway.
export function paintChecker(a = '#ff5fa8', b = '#ff7fbc', size = 64) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  ctx.fillStyle = a
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = b
  ctx.fillRect(0, 0, size / 2, size / 2)
  ctx.fillRect(size / 2, size / 2, size / 2, size / 2)
  return c
}
