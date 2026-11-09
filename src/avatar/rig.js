// Pose buffer + rig binding, ported (via Clean Leaves for Loot) from +1 Cut Grass Adventure's PlayerRig /
// PoseBuffer. Poses are authored in CHARACTER space (+X pitch swings a limb
// BACKWARD, +Y yaws, +Z rolls about the forward axis, character faces +Z) and
// resolved per bone into parent space at bind time, so player.glb's twisted limb
// frames and the procedural fallback's identity frames pose identically. Every
// write is rotation * restQuaternion, rebuilt each frame: nothing accumulates.
import { Quaternion, Vector3 } from 'three'

export const BONE_NAMES = ['Rig1', 'Spine1', 'Spine2', 'Neck1', 'ArmL1', 'ArmL2', 'ArmR1', 'ArmR2', 'LegL1', 'LegL2', 'LegR1', 'LegR2']
export const BONE_INDEX = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]))

const EPSILON = 1e-5
const RIGHT = new Vector3(1, 0, 0)
const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, 1)

// A complete pose in a flat buffer: [x, y, z] radians per bone, plus a vertical
// bob for the visual node. Blends are plain lerps over the array.
export class PoseBuffer {
  constructor() {
    this.rotations = new Float32Array(BONE_NAMES.length * 3)
    this.bobY = 0
  }

  reset() {
    this.rotations.fill(0)
    this.bobY = 0
  }

  set(bone, x, y = 0, z = 0) {
    const at = BONE_INDEX[bone] * 3
    this.rotations[at] = x
    this.rotations[at + 1] = y
    this.rotations[at + 2] = z
  }

  add(bone, x, y = 0, z = 0) {
    const at = BONE_INDEX[bone] * 3
    this.rotations[at] += x
    this.rotations[at + 1] += y
    this.rotations[at + 2] += z
  }

  copyFrom(other) {
    this.rotations.set(other.rotations)
    this.bobY = other.bobY
  }

  // this = lerp(from, to, t), in place.
  lerpBetween(from, to, t) {
    const a = from.rotations
    const b = to.rotations
    const out = this.rotations
    for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t
    this.bobY = from.bobY + (to.bobY - from.bobY) * t
  }

  // Clear, then write a static { Bone: {x, y, z} } definition scaled by weight.
  applyDefinition(definition, weight = 1) {
    this.reset()
    for (const bone in definition) {
      const r = definition[bone]
      this.add(bone, (r.x ?? 0) * weight, (r.y ?? 0) * weight, (r.z ?? 0) * weight)
    }
  }
}

// Binds the named bones of one character (`root.nodes`) and applies poses to them.
// Bones the rig lacks (the procedural fallback has no elbows or knees) just don't
// animate. Must be created while the rig is still in its bind pose.
export class PlayerRig {
  constructor(root) {
    this.bindings = []
    root.updateMatrixWorld(true)
    const referenceInverse = root.getWorldQuaternion(new Quaternion()).invert()
    for (const name of BONE_NAMES) {
      const bone = root.nodes?.[name]
      if (!bone) continue
      const parentWorld = bone.parent ? bone.parent.getWorldQuaternion(new Quaternion()) : new Quaternion()
      // Character space -> this bone's parent space.
      const toParent = referenceInverse.clone().multiply(parentWorld).invert()
      this.bindings.push({
        bone,
        index: BONE_INDEX[name] * 3,
        rest: bone.quaternion.clone(),
        axisX: RIGHT.clone().applyQuaternion(toParent).normalize(),
        axisY: UP.clone().applyQuaternion(toParent).normalize(),
        axisZ: FORWARD.clone().applyQuaternion(toParent).normalize(),
      })
    }
    this.q = new Quaternion()
    this.qa = new Quaternion()
  }

  applyPose(pose) {
    const v = pose.rotations
    for (const b of this.bindings) {
      const x = v[b.index]
      const y = v[b.index + 1]
      const z = v[b.index + 2]
      if (Math.abs(x) < EPSILON && Math.abs(y) < EPSILON && Math.abs(z) < EPSILON) {
        b.bone.quaternion.copy(b.rest)
        continue
      }
      this.q.setFromAxisAngle(b.axisX, x)
      if (Math.abs(y) >= EPSILON) this.q.premultiply(this.qa.setFromAxisAngle(b.axisY, y))
      if (Math.abs(z) >= EPSILON) this.q.premultiply(this.qa.setFromAxisAngle(b.axisZ, z))
      b.bone.quaternion.copy(this.q).multiply(b.rest)
    }
  }

  resetToBindPose() {
    for (const b of this.bindings) b.bone.quaternion.copy(b.rest)
  }
}
