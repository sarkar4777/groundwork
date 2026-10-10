import * as THREE from 'three'
import { useEffect } from 'react'
import { MAT } from '../materials'
import { weather } from './hdMaterials'

// On real ground the cranes and drones keep their models but take the same wear as the photographic fleet,
// and the Groundwork sky-blue trim turns to plain dark grey. Off real ground every factor is zero.
const on = { value: 0 }
let weathered = false
const accent = { color: MAT.accent.color.clone(), ei: MAT.accent.emissiveIntensity }
const GREY = new THREE.Color('#3a3d42')

export function useRealLook(active: boolean) {
  useEffect(() => {
    if (active && !weathered) {
      weather(MAT.paint, { mud: 1.2, dust: 0.5, grime: 0.4, chips: 0.3 }, on)
      weather(MAT.paintDirty, { mud: 1.0, dust: 0.45, grime: 0.5, chips: 0.4 }, on)
      weather(MAT.dark, { mud: 1.4, dust: 0.5, grime: 0.3, chips: 0.1 }, on)
      weather(MAT.darkMatte, { mud: 1.2, dust: 0.5, grime: 0.2, chips: 0 }, on)
      weather(MAT.rubber, { mud: 1.6, dust: 0.5, grime: 0.1, chips: 0 }, on)
      weathered = true
    }
    on.value = active ? 1 : 0
    if (active) {
      MAT.accent.color.copy(GREY)
      MAT.accent.emissiveIntensity = 0
    } else {
      MAT.accent.color.copy(accent.color)
      MAT.accent.emissiveIntensity = accent.ei
    }
  }, [active])
}
