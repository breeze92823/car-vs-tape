// Player modes (MODES in config.js):
//   'character' - third-person: the chase camera orbits the visible avatar.
//   'player'    - first-person: the camera is the player's eyes, the avatar is
//                 hidden and the body always faces where the camera looks.
// V toggles; wheeling all the way in / back out switches too (camera.js).
import { MODES, START_MODE } from './config.js'

let mode = START_MODE
const listeners = new Set()

export const getMode = () => mode
export const isFirstPerson = () => mode === 'player'

export function setMode(next) {
  if (!MODES.includes(next) || next === mode) return
  mode = next
  for (const fn of listeners) fn(mode)
}

export function toggleMode() {
  setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length])
}

// fn(mode) on every change; also called once now.
export function onModeChanged(fn) {
  listeners.add(fn)
  fn(mode)
  return () => listeners.delete(fn)
}
