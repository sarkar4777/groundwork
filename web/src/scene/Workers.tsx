import * as THREE from 'three'
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { hot, interpAlpha, workerAt } from '../live/hot'
import { MAT, rbox } from './materials'
import { heightAt } from './ground/heights'
import { useUi } from '../live/store'

const legGeo = rbox(0.16, 0.85, 0.16, 0.06)
const torsoGeo = rbox(0.46, 0.62, 0.3, 0.12)
const vestGeo = rbox(0.5, 0.48, 0.34, 0.12)
const stripeGeo = new THREE.BoxGeometry(0.52, 0.05, 0.36)
const headGeo = new THREE.SphereGeometry(0.13, 12, 10)
const hatGeo = new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)
const brimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.025, 16)
const armGeo = rbox(0.12, 0.6, 0.12, 0.05)
const ringGeo = new THREE.RingGeometry(0.55, 0.75, 28)
const stripeMat = new THREE.MeshStandardMaterial({ color: '#e8eef5', emissive: '#c9ecff', emissiveIntensity: 0.4, roughness: 0.3 })
const ringMats = {
  ok: new THREE.MeshBasicMaterial({ color: '#3ee6a8', transparent: true, opacity: 0.75, depthWrite: false }),
  warn: new THREE.MeshBasicMaterial({ color: '#ffb020', transparent: true, opacity: 0.85, depthWrite: false }),
  danger: new THREE.MeshBasicMaterial({ color: '#ff4d5e', transparent: true, opacity: 0.95, depthWrite: false }),
}

const vestFor = (role: string) => (/visitor|supervisor|engineer/.test(role) ? MAT.hivisLime : MAT.hivisOrange)
const hatFor = (role: string) => (/supervisor|engineer/.test(role) ? MAT.hatWhite : /visitor/.test(role) ? MAT.hatBlue : MAT.paint)

function WorkerFig({ id, role }: { id: string; role: string }) {
  const g = useRef<THREE.Group>(null!)
  const legL = useRef<THREE.Mesh>(null!)
  const legR = useRef<THREE.Mesh>(null!)
  const armL = useRef<THREE.Mesh>(null!)
  const armR = useRef<THREE.Mesh>(null!)
  const ring = useRef<THREE.Mesh>(null!)
  const last = useRef({ x: 0, y: 0, phase: 0 })
  useFrame(({ camera }, dt) => {
    const w = workerAt(id, interpAlpha())
    if (!w) {
      g.current.visible = false
      return
    }
    g.current.visible = true
    // limbs only matter up close
    const near = camera.position.distanceToSquared(g.current.position) < 110 * 110
    legL.current.visible = legR.current.visible = armL.current.visible = armR.current.visible = near
    g.current.position.set(w.x, heightAt(w.x, w.y), -w.y)
    g.current.rotation.y = w.heading
    const moved = Math.hypot(w.x - last.current.x, w.y - last.current.y)
    last.current.x = w.x
    last.current.y = w.y
    const speed = dt > 0 ? moved / dt : 0
    last.current.phase += speed * dt * 4.2
    const sw = Math.sin(last.current.phase) * Math.min(0.6, speed * 0.4)
    legL.current.rotation.z = sw
    legR.current.rotation.z = -sw
    armL.current.rotation.z = -sw * 0.8
    armR.current.rotation.z = sw * 0.8
    const zone = (w.zone in ringMats ? w.zone : 'ok') as keyof typeof ringMats
    ring.current.material = ringMats[zone]
    const pulse = zone === 'danger' ? 1 + Math.sin(performance.now() / 90) * 0.25 : 1
    ring.current.scale.setScalar(pulse * (useUi.getState().cam === 'drone' ? 2.2 : 1))
    ring.current.visible = !useUi.getState().heroFx
  })
  return (
    <group ref={g} visible={false}>
      <mesh ref={ring} geometry={ringGeo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} renderOrder={5} />
      <group position={[0, 0.85, 0]}>
        <mesh ref={legL} geometry={legGeo} material={MAT.trousers} position={[0, -0.42, 0.12]} />
        <mesh ref={legR} geometry={legGeo} material={MAT.trousers} position={[0, -0.42, -0.12]} />
      </group>
      <mesh geometry={torsoGeo} material={MAT.trousers} position={[0, 1.18, 0]} castShadow />
      <mesh geometry={vestGeo} material={vestFor(role)} position={[0, 1.24, 0]} />
      <mesh geometry={stripeGeo} material={stripeMat} position={[0, 1.14, 0]} />
      <mesh geometry={stripeGeo} material={stripeMat} position={[0, 1.32, 0]} />
      <group position={[0, 1.42, 0]}>
        <mesh ref={armL} geometry={armGeo} material={vestFor(role)} position={[0, -0.28, 0.3]} />
        <mesh ref={armR} geometry={armGeo} material={vestFor(role)} position={[0, -0.28, -0.3]} />
      </group>
      <mesh geometry={headGeo} material={MAT.skin} position={[0, 1.66, 0]} />
      <mesh geometry={hatGeo} material={hatFor(role)} position={[0, 1.72, 0]} />
      <mesh geometry={brimGeo} material={hatFor(role)} position={[0.03, 1.72, 0]} />
    </group>
  )
}

export function Workers() {
  const list = useUi((s) => s.state?.workers.map((w) => `${w.id}:${w.role}`).join('|') ?? '')
  void hot
  return (
    <>
      {list
        .split('|')
        .filter(Boolean)
        .map((k) => {
          const [id, role] = k.split(':')
          return <WorkerFig key={id} id={id} role={role} />
        })}
    </>
  )
}
