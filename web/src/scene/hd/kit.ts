import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

type V3 = [number, number, number]

// Collects parts of one rigid piece and merges them into one mesh per material, so a detailed machine
// still costs a handful of draw calls.
export class Kit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>()
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private e = new THREE.Euler()

  add(geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], uv?: [number, number]) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()) as THREE.BufferGeometry
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
    if (uv) {
      const a = g.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * uv[0], a.getY(i) * uv[1])
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k)
    this.e.set(rot[0], rot[1], rot[2])
    this.q.setFromEuler(this.e)
    this.m.compose(new THREE.Vector3(...pos), this.q, new THREE.Vector3(...scale))
    g.applyMatrix4(this.m)
    const list = this.parts.get(mat) ?? []
    list.push(g)
    this.parts.set(mat, list)
    return this
  }

  box(mat: THREE.Material, s: V3, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], r = 0.04, uv?: [number, number]) {
    const g = r > 0 ? new RoundedBoxGeometry(s[0], s[1], s[2], 2, Math.min(r, Math.min(...s) / 2 - 0.001)) : new THREE.BoxGeometry(...s)
    return this.add(g, mat, pos, rot, [1, 1, 1], uv)
  }

  // A box whose far end (+x) is a different section: booms, sticks, hoods.
  taper(mat: THREE.Material, len: number, h0: number, w0: number, h1: number, w1: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], dy1 = 0) {
    const g = new THREE.BoxGeometry(len, 1, 1, 1, 1, 1)
    const p = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const far = x > 0
      p.setXYZ(i, x + len / 2, p.getY(i) * (far ? h1 : h0) + (far ? dy1 : 0), p.getZ(i) * (far ? w1 : w0))
    }
    g.computeVertexNormals()
    return this.add(g, mat, pos, rot)
  }

  cyl(mat: THREE.Material, r: number, h: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], seg = 16, r2?: number, open = false, uv?: [number, number]) {
    return this.add(new THREE.CylinderGeometry(r2 ?? r, r, h, seg, 1, open), mat, pos, rot, [1, 1, 1], uv)
  }

  // A curved sheet around the z axis: bucket shells, fenders, blades.
  shell(mat: THREE.Material, r: number, width: number, a0: number, a1: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], seg = 14) {
    const g = new THREE.CylinderGeometry(r, r, width, seg, 1, true, a0, a1 - a0)
    g.rotateX(Math.PI / 2)
    return this.add(g, mat, pos, rot)
  }

  // A cylinder along the line from a to b.
  rod(mat: THREE.Material, r: number, a: V3, b: V3, seg = 10) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b)
    const len = va.distanceTo(vb)
    const g = new THREE.CylinderGeometry(r, r, len, seg)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize())
    const mid = va.add(vb).multiplyScalar(0.5)
    g.applyQuaternion(q)
    return this.add(g, mat, [mid.x, mid.y, mid.z])
  }

  // A tube through points, for hoses and rails.
  tube(mat: THREE.Material, r: number, pts: V3[], seg = 24) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)))
    return this.add(new THREE.TubeGeometry(curve, seg, r, 6, false), mat)
  }

  // An arc band extruded upward: counterweights and buckets.
  arc(mat: THREE.Material, r0: number, r1: number, a0: number, a1: number, h: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]) {
    const sh = new THREE.Shape()
    const n = 20
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      if (i === 0) sh.moveTo(Math.cos(a) * r1, Math.sin(a) * r1)
      else sh.lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
    }
    for (let i = n; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / n
      sh.lineTo(Math.cos(a) * r0, Math.sin(a) * r0)
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 4 })
    g.rotateX(-Math.PI / 2)
    return this.add(g, mat, pos, rot)
  }

  // A flat decal quad facing +y, or rotated.
  quad(mat: THREE.Material, w: number, h: number, pos: V3, rot: V3 = [-Math.PI / 2, 0, 0]) {
    return this.add(new THREE.PlaneGeometry(w, h), mat, pos, rot)
  }

  build(name = 'hd'): THREE.Group {
    const grp = new THREE.Group()
    grp.name = name
    for (const [mat, list] of this.parts) {
      const g = mergeGeometries(list, false)
      if (!g) continue
      g.computeBoundingSphere()
      const mesh = new THREE.Mesh(g, mat)
      const decal = (mat as THREE.MeshStandardMaterial).transparent
      mesh.castShadow = !decal
      mesh.receiveShadow = true
      grp.add(mesh)
    }
    return grp
  }
}

// One built group per kind and part, shared across every machine of that kind.
const cache = new Map<string, THREE.Group>()
export function shared(key: string, make: () => THREE.Group): THREE.Group {
  let g = cache.get(key)
  if (!g) {
    g = make()
    cache.set(key, g)
  }
  return g.clone()
}
