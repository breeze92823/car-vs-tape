import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  Mesh,
  PMREMGenerator,
  PointLight,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { FOG, LIGHT, TIME_OF_DAY } from './config.js'
import { mulberry32 } from './textures.js'

// All scene lighting, blended between two moods (TIME_OF_DAY.day / .night):
//  - a gradient sky shader with a sun/moon disc and glow
//  - image-based lighting: the sky is baked into a PMREM environment map, so
//    every PBR material picks up matching ambient light and reflections
//    (re-baked as the mood changes)
//  - a hemisphere fill + one shadow-casting directional sun whose shadow box
//    follows the player (full shadow resolution over a small area)
//  - warm point-light lamps that switch on at night, with emissive bulbs
//  - distance fog in the horizon colour, stars at night, and tone-mapping
//    exposure, all following the same blend.
const SKY_RADIUS = 500

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
const skyFragment = /* glsl */ `
  uniform vec3 top;
  uniform vec3 bottom;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 col = mix(bottom, top, smoothstep(-0.05, 0.55, h));
    float d = max(dot(normalize(vDir), sunDir), 0.0);
    col += sunColor * (pow(d, 900.0) * 6.0 + pow(d, 24.0) * 0.25); // disc + halo
    col = mix(col, bottom * 0.85, smoothstep(0.0, -0.25, h));      // darker below the horizon
    gl_FragColor = vec4(col, 1.0);
  }`

function sunDirection(elevationDeg, azimuthDeg, out) {
  const el = (elevationDeg * Math.PI) / 180
  const az = (azimuthDeg * Math.PI) / 180
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize()
}

function makeStars(count = 1400) {
  const rand = mulberry32(7)
  const pos = []
  for (let i = 0; i < count; i++) {
    const u = rand() * Math.PI * 2
    const v = Math.acos(rand() * 0.95) // upper hemisphere only
    const r = SKY_RADIUS * 0.9
    pos.push(Math.sin(v) * Math.cos(u) * r, Math.cos(v) * r, Math.sin(v) * Math.sin(u) * r)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  const mat = new PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false, blending: AdditiveBlending })
  const stars = new Points(geo, mat)
  stars.renderOrder = -1
  return stars
}

export function createLighting(scene, renderer, preset) {
  // The two moods in use: TIME_OF_DAY, or a world's own sky (setMoods).
  let D = TIME_OF_DAY.day
  let N = TIME_OF_DAY.night

  // --- Sky + stars ---
  const skyMaterial = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new Color(D.zenith) },
      bottom: { value: new Color(D.horizon) },
      sunDir: { value: new Vector3(0, 1, 0) },
      sunColor: { value: new Color(D.sunColor) },
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
  })
  const sky = new Mesh(new SphereGeometry(SKY_RADIUS, 48, 24), skyMaterial)
  sky.renderOrder = -2
  sky.frustumCulled = false
  const stars = makeStars()
  scene.add(sky, stars)

  scene.fog = new Fog(D.horizon, FOG.near, FOG.far)

  // --- Lights ---
  const hemi = new HemisphereLight(D.hemiSky, D.hemiGround, D.hemiIntensity)
  const sun = new DirectionalLight(D.sunColor, D.sunIntensity)
  sun.castShadow = preset.shadows
  sun.shadow.mapSize.set(preset.shadowMap, preset.shadowMap)
  const r = LIGHT.shadowRange
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 220 })
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  scene.add(hemi, sun, sun.target)

  // --- Image-based lighting: bake the sky into an environment map ---
  const pmrem = new PMREMGenerator(renderer)
  const envScene = new Scene()
  envScene.add(new Mesh(sky.geometry, skyMaterial))
  let envTarget = null
  let bakedAt = -1
  function bakeEnvironment(night) {
    const next = pmrem.fromScene(envScene, 0, 1, SKY_RADIUS * 2)
    envTarget?.dispose()
    envTarget = next
    scene.environment = next.texture
    bakedAt = night
  }

  // --- Lamps (none placed right now) ---
  const lamps = [] // { light, bulb }
  function addLamp(x, y, z, bulbMaterial) {
    const light = new PointLight(LIGHT.lampColor, 0, LIGHT.lampDistance, 2)
    light.position.set(x, y, z)
    scene.add(light)
    lamps.push({ light, bulb: bulbMaterial })
    apply()
    return light
  }

  // --- Day/night blend ---
  let night = 0 // 0 = day, 1 = night
  let target = 0
  const dir = new Vector3()
  const tmpA = new Vector3()
  const tmpB = new Vector3()
  const c = new Color()
  const lerp = (a, b, t) => a + (b - a) * t
  const mix = (key, out) => out.set(D[key]).lerp(c.set(N[key]), night)

  function apply() {
    const t = night
    mix('zenith', skyMaterial.uniforms.top.value)
    mix('horizon', skyMaterial.uniforms.bottom.value)
    mix('sunColor', skyMaterial.uniforms.sunColor.value)
    mix('horizon', scene.fog.color)
    mix('sunColor', sun.color)
    mix('hemiSky', hemi.color)
    mix('hemiGround', hemi.groundColor)
    sun.intensity = lerp(D.sunIntensity, N.sunIntensity, t)
    hemi.intensity = lerp(D.hemiIntensity, N.hemiIntensity, t)
    scene.environmentIntensity = lerp(D.envIntensity, N.envIntensity, t)
    renderer.toneMappingExposure = lerp(D.exposure, N.exposure, t)
    stars.material.opacity = lerp(D.stars, N.stars, t)
    // Sun and moon are different directions: slerp-ish via normalised lerp of the two.
    sunDirection(D.sunElevation, D.sunAzimuth, tmpA)
    sunDirection(N.sunElevation, N.sunAzimuth, tmpB)
    dir.lerpVectors(tmpA, tmpB, t).normalize()
    skyMaterial.uniforms.sunDir.value.copy(dir)
    const lampLevel = lerp(D.lampIntensity, N.lampIntensity, t)
    for (const lamp of lamps) {
      lamp.light.intensity = lampLevel
      lamp.bulb.emissiveIntensity = 0.3 + (lampLevel / N.lampIntensity) * 3
    }
  }

  apply()
  bakeEnvironment(0)

  return {
    sun,
    addLamp,
    isNight: () => target === 1,
    // A world's sky { day, night } (WORLDS): swapped at once, keeping day or night as it is.
    setMoods(sky) {
      if (sky.day === D && sky.night === N) return
      D = sky.day
      N = sky.night
      apply()
      bakeEnvironment(night)
    },
    toggleDayNight() {
      target = target === 1 ? 0 : 1
    },
    setShadows(next) {
      sun.castShadow = next.shadows
      if (sun.shadow.mapSize.x !== next.shadowMap) {
        sun.shadow.mapSize.set(next.shadowMap, next.shadowMap)
        sun.shadow.map?.dispose()
        sun.shadow.map = null
      }
    },
    // Called every frame with the player's position so the sun's shadow box and the sky follow them.
    update(dt, focus) {
      if (night !== target) {
        const stepAmount = dt / TIME_OF_DAY.transition
        night = target > night ? Math.min(target, night + stepAmount) : Math.max(target, night - stepAmount)
        apply()
        if (Math.abs(night - bakedAt) > 0.08 || night === target) bakeEnvironment(night)
      }
      sky.position.set(focus.x, 0, focus.z)
      stars.position.copy(sky.position)
      sun.position.set(focus.x + dir.x * 90, focus.y + dir.y * 90, focus.z + dir.z * 90)
      sun.target.position.set(focus.x, focus.y, focus.z)
      sun.target.updateMatrixWorld()
    },
  }
}
