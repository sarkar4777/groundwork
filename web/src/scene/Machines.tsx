import { useUi } from '../live/store'
import { Excavator } from './machines/Excavator'
import { Dozer, Drone, HaulTruck, PilingRig, Roller, Telehandler } from './machines/Vehicles'
import { MobileCrane, TowerCrane } from './machines/Cranes'
import { isKind } from './machines/common'
import type { ThreeEvent } from '@react-three/fiber'
import { HdDozer, HdExcavator, HdPilingRig, HdRoller, HdTelehandler, HdTruck } from './hd/HdMachines'
import { useRealLook } from './hd/realLook'

function pick(id: string) {
  return (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    useUi.setState({ selected: id })
  }
}

export function Machines({ only }: { only?: (id: string) => boolean } = {}) {
  const list = useUi((s) => {
    const ms = s.state?.machines.map((m) => `${m.id}:${m.kind}`) ?? []
    const cranes = s.state?.cranes?.map((c) => c.id).filter((id) => !s.state!.machines.some((m) => m.id === id)) ?? []
    return [...ms, ...cranes.map((id) => `${id}:${/^MC/i.test(id) ? 'mobile_crane' : 'tower_crane'}`)].join('|')
  })
  // real ground gets the photographic machines, the rendered site keeps its own
  const hd = useUi((s) => !!s.realGround)
  useRealLook(hd)
  return (
    <>
      {list
        .split('|')
        .filter(Boolean)
        .filter((k) => !only || only(k.split(':')[0]))
        .map((k) => {
          const [id, kind] = k.split(':')
          const t = isKind(kind)
          const C = hd
            ? t === 'excavator' ? HdExcavator : t === 'truck' ? HdTruck : t === 'dozer' ? HdDozer : t === 'roller' ? HdRoller : t === 'telehandler' ? HdTelehandler : t === 'piling' ? HdPilingRig : t === 'drone' ? Drone : t === 'tower' ? TowerCrane : t === 'mobile' ? MobileCrane : HdTruck
            : t === 'excavator' ? Excavator : t === 'truck' ? HaulTruck : t === 'dozer' ? Dozer : t === 'roller' ? Roller : t === 'telehandler' ? Telehandler : t === 'piling' ? PilingRig : t === 'drone' ? Drone : t === 'tower' ? TowerCrane : t === 'mobile' ? MobileCrane : HaulTruck
          return (
            <group key={`${id}-${hd ? 'hd' : 'sd'}`} name={'m:' + id} onClick={pick(id)} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
              <C id={id} />
            </group>
          )
        })}
    </>
  )
}
