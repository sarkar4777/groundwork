export type Mode = 'auto' | 'hold' | 'fallback' | 'manual' | 'offline'
export type Health = 'ok' | 'warn' | 'fault'

export interface Machine {
  id: string
  kind: string
  x: number
  y: number
  z: number
  heading: number
  joints: Record<string, number>
  speed: number
  mode: Mode | string
  load_t: number
  fuel_pct: number
  health: Health | string
  task: string
}

export interface Worker {
  id: string
  role: string
  x: number
  y: number
  heading: number
  zone: 'ok' | 'warn' | 'danger' | string
  predicted?: [number, number][]
}

export interface Crane {
  id: string
  slew: number
  luff: number
  hook: [number, number, number]
  load_t: number
  lmi_pct: number
  wind_ms: number
}

export interface SafetyStop { machine: string; rule: string; since: number }

export interface Latency { l1_ms: number; l2_ms: number; l3_ms: number; l4_ms: number; l5_ms: number }

export interface Kpi { m3_moved: number; cycles: number; trucks_waiting: number; ai_cost_usd?: number }

export interface StateFrame {
  type: 'state'
  t: number
  seq: number
  machines: Machine[]
  workers: Worker[]
  cranes: Crane[]
  terrain: { rev: number }
  sensors: { wind_ms: number; gust_ms: number; dust_ugm3: number; noise_db: number; wall_tilt_mm: number }
  safety: { envelope: 'ok' | 'warn' | 'stop' | string; active_stops: SafetyStop[] }
  latency: Partial<Latency>
  kpi: Kpi
  ai_available?: boolean
  vecus?: number
  plan?: { source: string; version: number }
}

export interface BusFrame {
  type: 'bus'
  t: number
  machine: string
  ecu: string
  pgn: number
  sa: number
  data: string
  name: string
  decoded: Record<string, unknown>
  proto?: string
  topic?: string
}

export type EventKind = 'safety_stop' | 'near_miss' | 'fault' | 'gust' | 'plan_change' | 'approval' | 'autonomy' | 'story'

export interface EventFrame {
  type: 'event'
  t: number
  kind: EventKind | string
  machine?: string
  title: string
  detail?: string
  ms?: number
  [k: string]: unknown
}

export interface AgentFrame {
  type: 'agent'
  t: number
  agent: string
  phase: 'thinking' | 'tool' | 'answer' | 'waiting_approval' | string
  text: string
  execution_id?: string
  cost_usd?: number
  [k: string]: unknown
}

export interface PlanNode {
  id: string
  label: string
  status: 'running' | 'success' | 'failure' | 'idle' | 'pending' | string
  children?: PlanNode[]
  [k: string]: unknown
}

export interface PlanFrame { type: 'plan'; t: number; tree: PlanNode }

export interface CaptionFrame { type: 'caption'; t: number; text: string; until: number }

export type Frame = StateFrame | BusFrame | EventFrame | AgentFrame | PlanFrame | CaptionFrame

export type FaultKind = 'cut_can' | 'drop_gnss' | 'gust' | 'worker_in_swing' | 'ai_offline' | 'kill_switch' | 'clear'

export interface AgentInfo {
  name: string
  label: string
  level: string
  levelIndex: number
  actions: { type: string; level: string; levelIndex: number }[]
  record?: string
}

export type Vec2 = [number, number]

export interface SiteLayout {
  size: number
  zones: { id: string; kind: string; label: string; polygon: Vec2[] }[]
  haulRoads: { id: string; label: string; points: Vec2[] }[]
  spoil: Vec2[] | null
  pit: Vec2[] | null
  building: Vec2[] | null
  craneBases: { id: string; kind: 'tower' | 'mobile'; x: number; y: number; radius: number }[]
  gate: Vec2 | null
  designDepth: number
  piles: Vec2[]
  swingRadius: number
}

export interface Terrain {
  rev: number
  n: number
  extent: number
  heights: Float32Array
  delta: Float32Array | null
  designZ: number | null
}
