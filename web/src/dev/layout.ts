import type { SiteLayout, Vec2 } from '../proto/types'

const circle = (cx: number, cy: number, r: number, n = 40): Vec2[] =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r])

// Northgate Yard as the replay source describes it. The live sim's /site replaces this.
export const REPLAY_SITE: SiteLayout = {
  size: 200,
  pit: [[-55, -18], [22, -18], [22, 42], [-55, 42]],
  building: [[-45, -8], [12, -8], [12, 34], [-45, 34]],
  spoil: [[48, 30], [92, 30], [92, 88], [48, 88]],
  designDepth: -7,
  gate: [0, -98],
  zones: [
    { id: 'Z-PIT', kind: 'geofence', label: 'Basement dig', polygon: [[-58, -21], [25, -21], [25, 45], [-58, 45]] },
    { id: 'Z-PILE', kind: 'exclusion', label: 'Piling exclusion', polygon: circle(66, -24, 13) },
    { id: 'Z-SPOIL', kind: 'geofence', label: 'Spoil area', polygon: [[46, 28], [94, 28], [94, 90], [46, 90]] },
    { id: 'Z-LAY', kind: 'exclusion', label: 'Lift laydown', polygon: [[-62, -66], [-30, -66], [-30, -44], [-62, -44]] },
    { id: 'Z-CABIN', kind: 'walkway', label: 'Welfare cabins', polygon: [[-94, -94], [-66, -94], [-66, -72], [-94, -72]] },
  ],
  haulRoads: [
    { id: 'R-SPOIL', label: 'Pit to spoil', points: [[8, 6], [30, 6], [40, 14], [50, 26], [60, 42], [70, 58]] },
    { id: 'R-GATE', label: 'Pit to gate', points: [[30, 6], [34, -10], [30, -40], [16, -70], [4, -90], [0, -98]] },
  ],
  craneBases: [
    { id: 'TC1', kind: 'tower', x: -14, y: -28, radius: 55 },
    { id: 'MC1', kind: 'mobile', x: 42, y: -50, radius: 30 },
  ],
}
