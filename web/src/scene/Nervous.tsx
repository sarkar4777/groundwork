import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { hot } from '../live/hot'
import { heightAt } from './ground/heights'
import { nervous } from './nervousState'

export const SAFETY_Y = 26
export const CORE = new THREE.Vector3(0, 88, 0)
const CAP = 3200

const C = {
  sky: new THREE.Color('#5cc8ff').multiplyScalar(1.6),
  ice: new THREE.Color('#c9ecff').multiplyScalar(1.8),
  mint: new THREE.Color('#3ee6a8').multiplyScalar(1.7),
  amber: new THREE.Color('#ffb020').multiplyScalar(1.9),
  red: new THREE.Color('#ff4d5e').multiplyScalar(2.6),
}

interface P {
  alive: boolean
  t: number
  speed: number
  a: THREE.Vector3
  b: THREE.Vector3
  c: THREE.Vector3
  col: THREE.Color
  size: number
}

const vtx = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (900.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`

const frag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  float a = smoothstep(0.5, 0.0, r);
  a *= a;
  gl_FragColor = vec4(vColor * a * vAlpha, a * vAlpha);
}`

const bez = (out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number) => {
  const u = 1 - t
  return out.set(u * u * a.x + 2 * u * t * b.x + t * t * c.x, u * u * a.y + 2 * u * t * b.y + t * t * c.y, u * u * a.z + 2 * u * t * b.z + t * t * c.z)
}

const ID_RE = /\b(EX|HT|TC|MC|DZ|RC|PR|TH|DR)\d+\b/

function machinePos(id: string | undefined, out: THREE.Vector3): boolean {
  const m = id ? hot.curr?.machines.find((x) => x.id === id) : undefined
  if (!m) return false
  out.set(m.x, heightAt(m.x, m.y) + (m.kind.includes('drone') ? m.z : 2), -m.y)
  return true
}

function hashPos(s: string, out: THREE.Vector3) {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0
  const a = (h % 360) * (Math.PI / 180)
  return out.set(Math.cos(a) * 45, SAFETY_Y, Math.sin(a) * 45)
}

export function Nervous() {
  const pts = useRef<THREE.Points>(null!)
  const group = useRef<THREE.Group>(null!)
  const core = useRef<THREE.Group>(null!)
  const grid = useRef<THREE.Mesh>(null!)
  const flashes = useRef<{ pos: THREE.Vector3; col: THREE.Color; t0: number; big: boolean }[]>([])
  const flashMeshes = useRef<THREE.Group>(null!)
  const lastSeq = useRef(0)

  const pool = useMemo<P[]>(() => Array.from({ length: CAP }, () => ({ alive: false, t: 0, speed: 1, a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), col: new THREE.Color(), size: 1 })), [])
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(CAP), 1))
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(CAP), 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 40, 0), 400)
    return g
  }, [])
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: vtx, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), [])
  const gridMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uK: { value: 0 }, uT: { value: 0 } },
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vP; uniform float uK; uniform float uT;
          float hex(vec2 p){ p.x *= 1.1547; p.y += mod(floor(p.x), 2.0) * 0.5; p = abs(fract(p) - 0.5); return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0); }
          void main(){
            float r = length(vP) / 120.0;
            float h = 1.0 - smoothstep(0.0, 0.06, hex(vP / 7.0));
            float f = fract(r * 4.0 - uT * 0.15); float ring = 1.0 - smoothstep(0.0, 0.012, min(f, 1.0 - f));
            float fade = smoothstep(1.0, 0.55, r);
            vec3 c = vec3(0.36, 0.78, 1.0) * (h * 0.16 + ring * 0.3);
            gl_FragColor = vec4(c * fade * uK, 1.0);
          }`,
      }),
    [],
  )
  const flashGeo = useMemo(() => new THREE.RingGeometry(0.86, 1, 64), [])
  const beamGeo = useMemo(() => new THREE.CylinderGeometry(0.12, 0.12, 1, 6, 1, true), [])
  const pillarMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#5cc8ff').multiplyScalar(1.4), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }), [])
  const pillars = useRef<THREE.InstancedMesh>(null!)

  const spawn = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col: THREE.Color, speed: number, size: number, t0 = 0) => {
    for (const p of pool) {
      if (p.alive) continue
      p.alive = true
      p.t = t0
      p.speed = speed
      p.a.copy(a)
      p.b.copy(b)
      p.c.copy(c)
      p.col.copy(col)
      p.size = size
      return
    }
  }

  const tmpA = useMemo(() => new THREE.Vector3(), [])
  const tmpB = useMemo(() => new THREE.Vector3(), [])
  const tmpC = useMemo(() => new THREE.Vector3(), [])
  const m4 = useMemo(() => new THREE.Matrix4(), [])

  useFrame((state, dt) => {
    const k = nervous.k
    group.current.visible = k > 0.01
    gridMat.uniforms.uK.value = k
    gridMat.uniforms.uT.value = state.clock.elapsedTime
    if (k < 0.01) {
      hot.busParticles.length = 0
      hot.flashes.length = 0
      hot.arcs.length = 0
      return
    }
    core.current.rotation.y += dt * 0.4
    core.current.children[1].rotation.x += dt * 0.7
    core.current.children[2].rotation.z += dt * 0.5
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.4) * 0.06
    core.current.scale.setScalar(pulse)

    // bus frames ride from the controller up the machine's nerve into the safety layer
    let budget = 40
    while (hot.busParticles.length && budget-- > 0) {
      const f = hot.busParticles.shift()!
      if (f.machine === 'SITE' || f.proto === 'sparkplug') {
        hashPos(f.ecu, tmpC)
        tmpA.set(tmpC.x * 1.4, 1, tmpC.z * 1.4)
        tmpB.set(tmpC.x * 1.2, SAFETY_Y * 0.5, tmpC.z * 1.2)
        spawn(tmpA, tmpB, tmpC, C.mint, 0.8, 3.2)
        continue
      }
      if (!machinePos(f.machine, tmpA)) continue
      tmpA.x += (Math.random() - 0.5) * 3
      tmpA.z += (Math.random() - 0.5) * 3
      tmpC.set(tmpA.x + (Math.random() - 0.5) * 4, SAFETY_Y, tmpA.z + (Math.random() - 0.5) * 4)
      tmpB.set(tmpA.x, (tmpA.y + SAFETY_Y) * 0.5 + 4, tmpA.z)
      const dm1 = f.pgn === 65226
      spawn(tmpA, tmpB, tmpC, dm1 ? C.amber : C.sky, 0.9 + Math.random() * 0.5, dm1 ? 4.5 : 3)
    }
    hot.busParticles.length = 0

    // each twin step is a pass through the safety rules
    const seq = hot.curr?.seq ?? 0
    if (seq !== lastSeq.current && hot.curr) {
      lastSeq.current = seq
      for (let i = 0; i < 2; i++) {
        const m = hot.curr.machines[Math.floor(Math.random() * hot.curr.machines.length)]
        if (m) flashes.current.push({ pos: new THREE.Vector3(m.x, SAFETY_Y, -m.y), col: C.mint, t0: state.clock.elapsedTime, big: false })
      }
    }
    for (const e of hot.flashes) {
      const big = e.kind === 'safety_stop' || e.kind === 'near_miss' || e.kind === 'fault'
      const pos = new THREE.Vector3()
      if (!machinePos(e.machine, pos)) pos.set(0, 0, 0)
      pos.y = SAFETY_Y
      flashes.current.push({ pos, col: e.kind === 'safety_stop' ? C.red : big ? C.amber : C.ice, t0: state.clock.elapsedTime, big: true })
      if (big && machinePos(e.machine, tmpA)) {
        for (let i = 0; i < 24; i++) spawn(tmpA, tmpB.set(tmpA.x, SAFETY_Y * 0.6, tmpA.z), tmpC.set(tmpA.x, SAFETY_Y, tmpA.z), e.kind === 'safety_stop' ? C.red : C.amber, 2.2, 3.5, -i * 0.04)
      }
    }
    hot.flashes.length = 0

    // agent calls arc from the safety layer up to the Abenix core
    for (const a of hot.arcs) {
      const id = a.text.match(ID_RE)?.[0]
      if (!machinePos(id, tmpA)) hashPos(a.agent, tmpA)
      tmpA.y = SAFETY_Y
      tmpB.set(tmpA.x * 0.5, CORE.y + 30, tmpA.z * 0.5)
      const col = a.phase === 'waiting_approval' ? C.amber : a.phase === 'answer' ? C.mint : C.ice
      const down = a.phase === 'answer'
      for (let i = 0; i < 30; i++) spawn(down ? CORE : tmpA, tmpB, down ? tmpA : CORE, col, 0.5, 5 - i * 0.12, -i * 0.016)
    }
    hot.arcs.length = 0

    const pos = geo.attributes.position.array as Float32Array
    const colA = geo.attributes.aColor.array as Float32Array
    const size = geo.attributes.aSize.array as Float32Array
    const alpha = geo.attributes.aAlpha.array as Float32Array
    let n = 0
    for (const p of pool) {
      if (!p.alive) continue
      p.t += dt * p.speed
      if (p.t >= 1) {
        p.alive = false
        continue
      }
      if (p.t < 0) continue
      bez(tmpA, p.a, p.b, p.c, p.t)
      pos[n * 3] = tmpA.x
      pos[n * 3 + 1] = tmpA.y
      pos[n * 3 + 2] = tmpA.z
      colA[n * 3] = p.col.r
      colA[n * 3 + 1] = p.col.g
      colA[n * 3 + 2] = p.col.b
      size[n] = p.size
      alpha[n] = Math.sin(p.t * Math.PI) * k
      n++
    }
    geo.setDrawRange(0, n)
    geo.attributes.position.needsUpdate = true
    geo.attributes.aColor.needsUpdate = true
    geo.attributes.aSize.needsUpdate = true
    geo.attributes.aAlpha.needsUpdate = true

    const now = state.clock.elapsedTime
    flashes.current = flashes.current.filter((f) => now - f.t0 < (f.big ? 2.2 : 0.7)).slice(-40)
    const kids = flashMeshes.current.children as THREE.Mesh[]
    kids.forEach((mesh, i) => {
      const f = flashes.current[i]
      mesh.visible = !!f
      if (!f) return
      const age = (now - f.t0) / (f.big ? 2.2 : 0.7)
      mesh.position.copy(f.pos)
      mesh.scale.setScalar((f.big ? 4 + age * 22 : 1.5 + age * 4))
      const mm = mesh.material as THREE.MeshBasicMaterial
      mm.color.copy(f.col)
      mm.opacity = (1 - age) * k
    })

    if (hot.curr && pillars.current) {
      const ms = hot.curr.machines
      pillars.current.count = Math.min(ms.length, 40)
      for (let i = 0; i < pillars.current.count; i++) {
        const m = ms[i]
        const y0 = heightAt(m.x, m.y) + (m.kind.includes('drone') ? m.z : 1)
        const h = Math.max(1, SAFETY_Y - y0)
        m4.compose(tmpA.set(m.x, y0 + h / 2, -m.y), new THREE.Quaternion(), tmpB.set(1, h, 1))
        pillars.current.setMatrixAt(i, m4)
      }
      pillars.current.instanceMatrix.needsUpdate = true
      pillarMat.opacity = 0.32 * k
    }
  })

  return (
    <group ref={group} visible={false}>
      <points ref={pts} geometry={geo} material={mat} frustumCulled={false} renderOrder={20} />
      <mesh ref={grid} position={[0, SAFETY_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} material={gridMat} renderOrder={10}>
        <circleGeometry args={[120, 96]} />
      </mesh>
      <group ref={flashMeshes}>
        {Array.from({ length: 40 }, (_, i) => (
          <mesh key={i} geometry={flashGeo} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={12}>
            <meshBasicMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
      <instancedMesh ref={pillars} args={[beamGeo, pillarMat, 40]} frustumCulled={false} />
      <group ref={core} position={CORE}>
        <mesh>
          <icosahedronGeometry args={[7, 1]} />
          <meshBasicMaterial color={new THREE.Color('#5cc8ff').multiplyScalar(2.2)} wireframe toneMapped={false} />
        </mesh>
        <mesh>
          <torusGeometry args={[12, 0.18, 8, 96]} />
          <meshBasicMaterial color={new THREE.Color('#c9ecff').multiplyScalar(2)} toneMapped={false} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[15, 0.12, 8, 96]} />
          <meshBasicMaterial color={new THREE.Color('#5cc8ff').multiplyScalar(1.6)} toneMapped={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[3.2, 24, 16]} />
          <meshBasicMaterial color={new THREE.Color('#e8f7ff').multiplyScalar(3)} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}
