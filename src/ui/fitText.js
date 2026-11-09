// Roblox "TextScaled" for the windows: the largest font size (design px) at which the
// words, wrapped greedily, fit a w x h box. Measured with canvas once Fredoka is loaded.
const ctx = document.createElement('canvas').getContext('2d')
const cache = new Map()

function width(word) {
  let w = cache.get(word)
  if (w === undefined) {
    ctx.font = '700 100px Fredoka, system-ui, sans-serif'
    w = ctx.measureText(word).width / 100
    cache.set(word, w)
  }
  return w
}
document.fonts?.ready.then(() => cache.clear())

// -> { size, lines } with size in design px.
export function fitText(text, w, h, { max = 100, min = 14, lineHeight = 1.1, pad = 8 } = {}) {
  const words = text.split(' ')
  const space = width(' ')
  for (let size = max; size >= min; size -= 1) {
    const room = (w - pad) / size
    const lines = []
    let line = ''
    let lw = 0
    let ok = true
    for (const word of words) {
      const ww = width(word)
      if (ww > room) {
        ok = false
        break
      }
      if (line && lw + space + ww <= room) {
        line += ` ${word}`
        lw += space + ww
      } else {
        if (line) lines.push(line)
        line = word
        lw = ww
      }
    }
    if (!ok) continue
    lines.push(line)
    if (lines.length * size * lineHeight <= h) return { size, lines }
  }
  return { size: min, lines: [text] }
}

export const fontsReady = document.fonts?.ready ?? Promise.resolve()
