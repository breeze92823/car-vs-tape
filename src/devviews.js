// Dev only: renders one car from four angles (front 3/4, rear 3/4, side, front)
// into the canvas with the game loop paused. __game.views('ember'); __game.resume().
import { Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three'
import { buildCar } from './carmodel.js'
import { CARS } from './config.js'

export function makeViews(g) {
  return (id = 'pebble', dist = 8, angles = [[0.7, 0.22], [Math.PI - 0.7, 0.22], [Math.PI / 2, 0.04], [0, 0.1]]) => {
    g.pause()
    document.getElementById('hud')?.style.setProperty('display', 'none')
    const r = g.renderer
    const s = new Scene()
    s.background = new Color('#9fd8ff')
    s.environment = g.scene.environment
    s.add(new HemisphereLight('#ffffff', '#556', 1.1))
    const d = new DirectionalLight('#fff', 2.2)
    d.position.set(6, 10, 8)
    s.add(d)
    const ground = new Mesh(new PlaneGeometry(60, 60), new MeshStandardMaterial({ color: '#3a4766' }))
    ground.rotation.x = -Math.PI / 2
    s.add(ground)
    s.add(buildCar(CARS.find((c) => c.id === id) ?? CARS[0], { lights: false }).root)
    const W = window.innerWidth
    const H = window.innerHeight
    const cols = W > H ? 2 : 1
    const rows = Math.ceil(angles.length / cols)
    const vw = W / cols
    const vh = H / rows
    r.setScissorTest(true)
    angles.forEach(([yaw, pitch], i) => {
      const x = (i % cols) * vw
      const y = (rows - 1 - Math.floor(i / cols)) * vh
      r.setViewport(x, y, vw, vh)
      r.setScissor(x, y, vw, vh)
      const cam = new PerspectiveCamera(28, vw / vh, 0.1, 100)
      const k = Math.max(1, (vh / vw) * 0.9)
      cam.position.set(Math.sin(yaw) * Math.cos(pitch) * dist * k, 0.7 + Math.sin(pitch) * dist * k, Math.cos(yaw) * Math.cos(pitch) * dist * k)
      cam.lookAt(0, 0.65, 0)
      r.render(s, cam)
    })
    r.setScissorTest(false)
    r.setViewport(0, 0, W, H)
    return 'ok'
  }
}
