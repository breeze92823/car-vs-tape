import './shopview.css'
import { Color, DirectionalLight, Group, HemisphereLight, PerspectiveCamera, Scene, Vector3, Vector4 } from 'three'
import { CARS } from './config.js'
import { addHoverDiscs, buildCar, foldWheels } from './carmodel.js'
import { createFx } from './fx.js'

// Live car shop pictures for the performance-kit cars (config CARS `kit`): each one becomes a
// little turntable seen from the rear three-quarter, jets revving with afterburner flames, fire
// and sparks, a full rocket burst every few seconds and glitter in the car's accent colour.
// The cards also get a glowing border, floating sparks and a tier ribbon (shopview.css).
//
// All the cars stand in one hidden scene, 40 m apart, with their own particle pool. While the
// Car Shop is open, main.js calls render() before the main frame is drawn: up to two visible
// cards per frame are rendered into the corner of the game's canvas and copied into the card's
// own 2D canvas (the same trick the static thumbnails use), so there is no second WebGL context.
export function createShopView({ renderer, envScene, driver, quality = 1 }) {
  let built = null
  let pending = null
  let queue = []
  let visible = []
  let visCount = 0
  let scene = null
  let fx = null
  let rr = 0
  const cam = new PerspectiveCamera(30, 16 / 10, 0.1, 60)
  const tmp = new Vector3()
  const savedViewport = new Vector4()
  const SPACING = 40

  function build() {
    scene = new Scene()
    scene.background = new Color('#3b5fd8')
    scene.environment = envScene.environment
    scene.add(new HemisphereLight('#ffffff', '#4a5a8a', 1.2))
    const key = new DirectionalLight('#ffffff', 2.4)
    key.position.set(-5, 8, -6)
    scene.add(key)
    fx = createFx(scene, quality)
    fx.setBloom?.(false)
    built = []
    queue = []
    CARS.forEach((def, i) => {
      if (def.kit || def.thrusters) queue.push([def, i])
    })
  }

  // One car per frame, so opening the shop never stalls on building them all at once.
  function buildNext() {
    const [def, i] = queue.shift()
    {
      const cards = document.querySelectorAll('.cs-card')
      const card = cards[i]
      const pic = card?.querySelector('.cs-pic')
      if (!pic) return
      const parts = buildCar(def)
      driver.seatPreview(parts)
      const holder = new Group()
      holder.position.x = built.length * SPACING
      holder.add(parts.root)
      scene.add(holder)
      const canvas = document.createElement('canvas')
      canvas.className = 'sv-canvas'
      pic.appendChild(canvas)
      card.classList.add('sv-kit', `sv-kit${def.kit ?? 1}`)
      card.style.setProperty('--sv-accent', def.legend ? '#ff9a00' : def.accent ?? (def.thrusters ? '#2ad8ff' : def.color))
      const badge = document.createElement('div')
      badge.className = 'sv-badge gw-ol'
      badge.textContent = def.legend ? (def.fly || def.thrusters ? 'LEGENDARY · FLYING' : 'LEGENDARY') : def.thrusters && !def.kit ? 'ROCKET · FLY' : ['', 'JET', 'JET+', 'HYPER JET'][def.kit] ?? 'JET'
      // Flying cars hover over the turntable, wheels folded into thruster discs.
      if (def.fly) {
        foldWheels(parts, 1)
        for (const d of addHoverDiscs(parts)) d.scale.setScalar(1)
      }
      card.appendChild(badge)
      const sparks = document.createElement('div')
      sparks.className = 'sv-sparks'
      sparks.innerHTML = '<i></i>'.repeat(8)
      card.appendChild(sparks)
      built.push({ def, parts, holder, canvas, ctx: canvas.getContext('2d'), phase: Math.random() * 6, burstT: 1 + Math.random() * 3, burst: 0, emitT: 0, glitterT: 0 })
    }
  }

  const isOpen = () => {
    const strip = document.querySelector('.cs-strip')
    return !!strip && strip.getClientRects().length > 0
  }

  // Turntable, revving jets, a rocket burst now and then, particles.
  function animate(b, dt, elapsed) {
    const { parts, holder } = b
    const yaw = 0.45 + Math.sin(elapsed * 0.45 + b.phase) * 0.6
    parts.root.rotation.y = yaw
    if (b.def.fly) {
      parts.root.position.y = 0.7 + Math.sin(elapsed * 2.1) * 0.12
      parts.body.rotation.z = Math.sin(elapsed * 1.3) * 0.08
      for (const w of parts.wheels) w.spin.rotation.x += dt * 25
    }
    if (b.def.thrusters) thrusterShow(b, dt, elapsed)
    holder.updateMatrixWorld(true)
    b.burstT -= dt
    if (b.burstT <= 0) {
      b.burst = 1.5
      b.burstT = 4 + Math.random() * 2.5
      for (const j of parts.jets) {
        parts.body.localToWorld(tmp.set(j.x, j.y, j.z - 0.3))
        fx.ring(tmp.x, tmp.y, tmp.z, '#ffb31a', 2.2, 0.45, false)
      }
    }
    b.burst = Math.max(0, b.burst - dt)
    const rev = 0.3 + 0.3 * Math.max(0, Math.sin(elapsed * 2.2 + b.phase)) ** 2
    const heat = b.burst > 0 ? Math.min(1, b.burst * 3) : rev
    const flick = 0.9 + Math.random() * 0.2
    for (const j of parts.jets) j.flame?.userData.set(elapsed, 0.7 + heat * 0.9, (0.5 + heat * 3) * flick, 0.95 + heat * 0.4)

    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    b.emitT -= dt
    if (b.emitT <= 0) {
      b.emitT = b.burst > 0 ? 0.02 : 0.05
      for (const j of parts.jets) {
        parts.body.localToWorld(tmp.set(j.x, j.y, j.z - 0.25 - Math.random() * heat))
        const out = 4 + heat * 12
        const jit = () => (Math.random() - 0.5) * 1.6
        fx.glow({ x: tmp.x, y: tmp.y, z: tmp.z, vx: -sin * out + jit(), vy: jit() * 0.4, vz: -cos * out + jit(), life: 0.25 + Math.random() * 0.2, size: j.r * (3 + heat * 5), sizeEnd: 0.05, color: Math.random() < 0.4 ? '#fff3c0' : parts.flameColor, drag: 2.5 })
        if (b.burst > 0 || Math.random() < 0.3) fx.glow({ x: tmp.x, y: tmp.y, z: tmp.z, vx: -sin * out * 0.5 + jit() * 2, vy: 1 + Math.random() * 3, vz: -cos * out * 0.5 + jit() * 2, life: 0.6, size: 0.18, sizeEnd: 0.02, color: Math.random() < 0.5 ? '#ffffff' : parts.accent, drag: 1.2, gravity: -8 })
        if (b.burst > 0 && Math.random() < 0.4) fx.smoke({ x: tmp.x, y: tmp.y, z: tmp.z, vx: -sin * 3 + jit(), vy: 0.6, vz: -cos * 3 + jit(), life: 1, size: 0.4, sizeEnd: 1.8, color: '#9aa0b0', alpha: 0.14, drag: 1.3 })
      }
    }
    // Flying cars: thruster plumes down from the folded wheels.
    if (b.def.fly && Math.random() < 0.7) {
      for (const w of parts.wheels) {
        w.pivot.localToWorld(tmp.set(-w.side * 0.2, 0, 0))
        fx.glow({ x: tmp.x, y: tmp.y, z: tmp.z, vx: (Math.random() - 0.5) * 0.5, vy: -3 - Math.random() * 2, vz: (Math.random() - 0.5) * 0.5, life: 0.28, size: 0.5, sizeEnd: 0.06, color: Math.random() < 0.55 ? parts.accent : '#ffffff', drag: 3 })
      }
    }
    // Showroom glitter drifting up round the car.
    b.glitterT -= dt
    if (b.glitterT <= 0) {
      b.glitterT = 0.09
      const a = Math.random() * Math.PI * 2
      const r = 1.6 + Math.random() * 1.4
      fx.glow({ x: holder.position.x + Math.cos(a) * r, y: Math.random() * 0.6, z: Math.sin(a) * r, vx: 0, vy: 0.8 + Math.random() * 1.2, vz: 0, life: 1.4, size: 0.22, sizeEnd: 0.02, color: Math.random() < 0.6 ? parts.accent : '#ffffff', drag: 0.4, gravity: 0 })
    }
  }

  // Thruster cars (CARS `thrusters`, the Tesla Roadster) show what they do in the game on a 6 s
  // loop: lift off on the four hover plumes over a billowing smoke cloud, fire the rear thrusters
  // (white smoke, red light streaks off the tail lamps), then settle back down.
  function thrusterShow(b, dt, elapsed) {
    const { parts, holder } = b
    const th = parts.thrusters
    const t = (elapsed + b.phase) % 6
    const liftK = t < 0.6 ? t / 0.6 : t < 4.2 ? 1 : t < 5 ? 1 - (t - 4.2) / 0.8 : 0
    const boostK = t > 1.6 && t < 3.6 ? Math.min(1, (t - 1.6) * 4, (3.6 - t) * 4) : 0
    parts.root.position.y = liftK * liftK * (3 - 2 * liftK) * 1.1 + Math.sin(elapsed * 3) * 0.04 * liftK
    const flick = 0.88 + Math.random() * 0.24
    for (const n of th.down) {
      if (!n.flame) continue
      n.flame.visible = liftK > 0.02
      n.flame.userData.set(elapsed, 0.8 + liftK * 0.7, (0.5 + liftK * 1.3) * flick, 1.2 + liftK * 0.4)
    }
    for (const n of th.rear) {
      if (!n.flame) continue
      n.flame.visible = boostK > 0.02
      n.flame.userData.set(elapsed, 0.8 + boostK, (0.4 + boostK * 2) * flick, 0.9 + boostK * 0.4)
    }
    holder.updateMatrixWorld(true)
    b.thrT = (b.thrT ?? 0) - dt
    if (b.thrT > 0) return
    b.thrT = 0.035
    const yaw = parts.root.rotation.y
    const bx = -Math.sin(yaw)
    const bz = -Math.cos(yaw)
    const rnd = (k) => (Math.random() - 0.5) * 2 * k
    if (liftK > 0.05) {
      for (const n of th.down) {
        parts.body.localToWorld(tmp.set(n.x, n.y - 0.1, n.z))
        fx.glow({ x: tmp.x, y: tmp.y, z: tmp.z, vx: rnd(0.4), vy: -5 - Math.random() * 3, vz: rnd(0.4), life: 0.2, size: 0.4 * liftK, sizeEnd: 0.05, color: Math.random() < 0.5 ? '#ffffff' : '#7fd8ff', drag: 2 })
      }
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2
        const out = 1.5 + Math.random() * 2
        fx.smoke({ x: holder.position.x + Math.cos(a) * 0.8, y: 0.15, z: Math.sin(a) * 0.8, vx: Math.cos(a) * out, vy: 0.2 + Math.random() * 0.4, vz: Math.sin(a) * out, life: 1.5, size: 0.7, sizeEnd: 2.8, color: '#f2f4f8', alpha: 0.42 * liftK, drag: 1.4 })
      }
    }
    if (boostK > 0.05) {
      for (const n of th.rear) {
        parts.body.localToWorld(tmp.set(n.x, n.y, n.z - 0.4))
        fx.smoke({ x: tmp.x, y: tmp.y, z: tmp.z, vx: bx * 3 + rnd(0.5), vy: 0.3, vz: bz * 3 + rnd(0.5), life: 1.4, size: 0.4, sizeEnd: 2.2, color: '#f4f6fa', alpha: 0.4 * boostK, drag: 1.2 })
      }
      for (const tp of parts.trailPoints) {
        parts.body.localToWorld(tmp.set(tp[0], tp[1], tp[2]))
        fx.glow({ x: tmp.x, y: tmp.y, z: tmp.z, vx: bx * 7, vy: 0, vz: bz * 7, life: 0.35, size: 0.32, sizeEnd: 0.08, color: '#ff2a3a', drag: 0.5 })
      }
    }
  }

  function draw(b) {
    const W = b.canvas.clientWidth
    const H = b.canvas.clientHeight
    if (!W || !H) return
    const dpr = renderer.getPixelRatio()
    const cw = Math.round(W * dpr)
    const ch = Math.round(H * dpr)
    if (b.canvas.width !== cw || b.canvas.height !== ch) {
      b.canvas.width = cw
      b.canvas.height = ch
    }
    const hx = b.holder.position.x
    cam.aspect = W / H
    cam.fov = W / H < 1.2 ? 38 : 30
    cam.updateProjectionMatrix()
    cam.position.set(hx + 4.2, 2.1, -5.6)
    cam.lookAt(hx, 0.55, -0.4)
    renderer.getViewport(savedViewport)
    renderer.setRenderTarget(null)
    renderer.setScissorTest(true)
    renderer.setViewport(0, 0, W, H)
    renderer.setScissor(0, 0, W, H)
    renderer.render(scene, cam)
    renderer.setScissorTest(false)
    renderer.setViewport(savedViewport)
    const full = renderer.domElement
    b.ctx.drawImage(full, 0, full.height - ch, cw, ch, 0, 0, cw, ch)
  }

  // compile() only builds the shaders: each car's geometry and textures reach the GPU on its first
  // draw, which used to land on the first time the Car Shop opened (a few seconds of stutter). Draw
  // every car once into a 2 px corner, one per tick, so that upload happens in the background.
  function warmUploads() {
    let i = 0
    const step = () => {
      const b = built[i++]
      if (!b) return
      try {
        const hx = b.holder.position.x
        cam.aspect = 16 / 10
        cam.updateProjectionMatrix()
        cam.position.set(hx + 4.2, 2.1, -5.6)
        cam.lookAt(hx, 0.55, -0.4)
        renderer.getViewport(savedViewport)
        renderer.setRenderTarget(null)
        renderer.setScissorTest(true)
        renderer.setViewport(0, 0, 2, 2)
        renderer.setScissor(0, 0, 2, 2)
        renderer.render(scene, cam)
        renderer.setScissorTest(false)
        renderer.setViewport(savedViewport)
      } catch {}
      setTimeout(step, 200)
    }
    step()
  }

  return {
    // Called a few seconds after the game starts: builds the live cars one by one and compiles
    // their shaders in the background, so opening the Car Shop doesn't stall.
    prewarm() {
      if (pending) return
      pending = Promise.race([driver.whenLoaded, new Promise((r) => setTimeout(r, 2500))]).then(() => {
        build()
        const next = () => {
          if (queue.length) {
            buildNext()
            setTimeout(next, 150)
          } else if (built.length) {
            try {
              renderer.compile(scene, cam)
            } catch {}
            warmUploads()
          }
        }
        next()
      })
    },
    // Every frame, before the main render.
    render(dt, elapsed) {
      if (!isOpen()) return
      if (!built) {
        pending ??= Promise.race([driver.whenLoaded, new Promise((r) => setTimeout(r, 2500))]).then(build)
        return
      }
      if (queue.length) buildNext()
      if (!built.length) return
      // Layout reads are costly, so refresh which cards are on screen only every few frames.
      if (visCount-- <= 0 || !visible.length) {
        visCount = 8
        const strip = document.querySelector('.cs-strip').getBoundingClientRect()
        visible = built.filter((b) => {
          const r = b.canvas.getBoundingClientRect()
          return r.width > 0 && r.right > strip.left && r.left < strip.right
        })
      }
      if (!visible.length) return
      for (const b of visible) animate(b, dt, elapsed)
      fx.update(dt, cam, (visible[0].canvas.clientHeight || 150) * renderer.getPixelRatio())
      // One picture per frame: each GPU -> 2D canvas copy stalls the pipeline.
      draw(visible[rr++ % visible.length])
    },
  }
}
