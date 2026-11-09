// Shared lego window shell (styles in window.css), measured off the reference
// screenshots (1920 x 992): a full-width studded header bar in the window's colour
// (icon + outlined title on the left, square X on the right) over a dark,
// see-through body; the 3D scene behind is blurred while a window is open.
// The HUD stays usable (its tiles toggle the windows). One window at a time;
// Esc closes it (main.js asks closeTopWindow before the portal menu).
// Sizes are design px times --wu (set in window.css from the screen size).
import './window.css'

let current = null
let toolbar = null // Boxity's toolbar rectangle (setWindowReserved)

export const anyWindowOpen = () => !!current
export function closeTopWindow() {
  if (!current) return false
  current.close()
  return true
}

// Restarts a one-shot animation class ('gw-shake', 'gw-bump', 'gw-pop').
export function replay(el, cls) {
  el.classList.remove(cls)
  void el.offsetWidth
  el.classList.add(cls)
}

// '#45e03c' -> a dark shade of it (outlines of coloured names).
export function darken(hex, k = 0.72) {
  const n = parseInt(hex.slice(1), 16)
  const f = (v) => Math.round(v * (1 - k))
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`
}

// Outlined text span.
export function olText(text, cls = '') {
  const s = document.createElement('span')
  s.className = `gw-ol ${cls}`.trim()
  s.textContent = text
  return s
}

// A studded lego button (--c = colour). Fires on click (a drag that scrolls a list does not).
export function legoButton(cls, html, onPress) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `gw-btn gw-lego ${cls}`.trim()
  b.innerHTML = html
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    onPress?.(b, e)
  })
  return b
}

// Boxity's toolbar sits over the top-left corner (the whole top edge on narrow phones):
// a window that would reach under it moves down below it.
export function setWindowReserved(areas) {
  toolbar = areas.find((a) => a.id === 'toolbar') ?? areas[0] ?? null
  if (current) fit(current)
}
window.addEventListener('resize', () => {
  if (current) {
    orient(current)
    fit(current)
    current.onResize?.()
  }
})

const portrait = () => window.innerHeight > window.innerWidth
function orient(win) {
  win.overlay.classList.toggle('portrait', portrait())
}
function fit(win) {
  const o = win.overlay
  o.style.setProperty('--top', '0px')
  if (!toolbar || !toolbar.width) return
  const r = win.dialog.getBoundingClientRect()
  const bottom = toolbar.top + toolbar.height + 8
  if (r.left < toolbar.left + toolbar.width && toolbar.left < r.right && r.top < bottom) o.style.setProperty('--top', `${bottom}px`)
}

const CLOSE = '<span class="gw-ol gw-x">X</span>'

// opts: { title, icon (svg markup), color (header), closeColor, className (sets --W / --H /
// --Wp / --Hp design sizes), onOpen, onClose, onResize }.
export function createWindow({ title, icon = '', color = '#d21fd8', closeColor = '#ff1638', className = '', onOpen, onClose, onResize } = {}) {
  const overlay = document.createElement('div')
  overlay.className = `gw-overlay ${className}`.trim()
  overlay.hidden = true
  const dialog = document.createElement('div')
  dialog.className = 'gw-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-label', title)
  dialog.style.setProperty('--hc', color)

  const head = document.createElement('div')
  head.className = 'gw-head gw-lego'
  head.innerHTML = `<span class="gw-icon">${icon}</span>`
  head.append(olText(title, 'gw-title'))
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'gw-close'
  close.style.setProperty('--xc', closeColor)
  close.setAttribute('aria-label', 'Close')
  close.innerHTML = CLOSE
  head.append(close)

  const body = document.createElement('div')
  body.className = 'gw-body'
  const toastEl = document.createElement('div')
  toastEl.className = 'gw-toast gw-ol'
  dialog.append(head, body)
  overlay.append(dialog, toastEl)
  document.body.append(overlay)

  let shown = false
  let toastTimer = 0
  const win = {
    overlay,
    dialog,
    head,
    body,
    onResize,
    isOpen: () => shown,
    open() {
      if (shown) return
      if (current && current !== win) current.close()
      current = win
      shown = true
      document.body.classList.add('gw-open')
      orient(win)
      onOpen?.()
      overlay.hidden = false
      fit(win)
      replay(dialog, 'gw-pop')
      document.exitPointerLock?.() // the cursor has to be free for the buttons
    },
    close() {
      if (!shown) return
      shown = false
      overlay.hidden = true
      if (current === win) current = null
      if (!current) document.body.classList.remove('gw-open')
      onClose?.()
    },
    toggle: () => (shown ? win.close() : win.open()),
    // Short message over the bottom of the window ("Not enough Wins!").
    toast(msg) {
      toastEl.textContent = msg
      replay(toastEl, 'show')
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1700)
    },
  }
  close.addEventListener('click', (e) => {
    e.stopPropagation()
    win.close()
  })
  return win
}
