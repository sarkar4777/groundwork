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
  // set when the site has industrial PCs: ipc machines follow their PC through Abenix telemetry
  src?: 'ipc' | 'sim'
  node?: string
  online?: boolean
}

export interface IpcHop { hop: string; ms: number | null }

export interface IpcStop { machine: string; node: string; stop_ms: number; confirm_ms: number | null; hops: IpcHop[]; hold_ack_ms?: number | null; api_ms?: number; moving?: boolean }

export interface IpcNode {
  node: string
  online: boolean
  since: number
  holding: boolean
  mode: string
  bus_load_pct: number | null
  fps: number | null
  bus_state: string | null
  error_frames: number | null
  noise: number | null
  uplink_mps: number | null
  task: string
  cycles: number | null
  lat: Record<string, number>
  tec_max: number | null
  ecus_passive: number
  mode_set?: string | null
  mode_by?: 'site' | 'outside'
  oil_c?: number | null
  pump1_bar?: number | null
}

export interface IpcView {
  stream: boolean
  status: string
  publish_to_store_p50_ms: number | null
  publish_to_store_p99_ms: number | null
  ingest_mps: number | null
  seq_gaps: number | null
  command_p50_ms: number | null
  bff_to_abenix_ms: number | null
  checks_p50_ms?: number | null
  confirm_p50_ms: number | null
  last_stop: IpcStop | null
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

export interface Latency { l1_ms: number; l2_ms: number; l3_ms: number; l4_ms: number; l5_ms: number; ipc: IpcView }

export interface Kpi { m3_moved: number; cycles: number; trucks_waiting: number; ai_cost_usd?: number; ai_billing?: 'subscription' | 'metered' | string }

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
  ai_offline?: boolean
  killed?: boolean
  vecus?: number
  plan?: { source: string; version: number }
  ipc?: Record<string, IpcNode>
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
  acronym?: string
  can_id?: string
  source?: 'ipc'
  node?: string
  bus_ms?: number
  da?: number
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

export interface CaptionFrame { type: 'caption'; t: number; text: string; until: number; loop_step?: string }

export interface LoopRecord {
  type: 'loop'
  id: string
  rule_id: string
  rule: string
  severity?: string
  node?: string
  device?: string
  asset?: string
  signal?: string
  value?: unknown
  detail?: string
  fired_at?: number | string
  state: 'running' | 'done' | string
  agent: { id?: string | null; name?: string; state: string; execution_id?: string | null; answer?: string | null; duration_ms?: number | null }
  action: {
    state: 'none' | 'waiting' | 'approved' | 'denied' | 'sent' | 'confirmed' | 'no_command' | string
    approval_id?: string
    signal?: string
    value?: unknown
    node?: string
    device?: string
    reason?: string
    decided_by?: string | null
    approved_by?: string | null
    confirmed?: boolean | null
    timings?: Record<string, number>
  }
  updated?: number
  spark?: number[]
}

export type Frame = StateFrame | BusFrame | EventFrame | AgentFrame | PlanFrame | CaptionFrame | LoopRecord

export type FaultKind = 'cut_can' | 'drop_gnss' | 'gust' | 'worker_in_swing' | 'ai_offline' | 'kill_switch' | 'clear' | 'unplug_pc' | 'noisy_harness' | 'hydraulic_wear' | 'drive_off_road'

export interface AgentInfo {
  name: string
  label: string
  level: string
  levelIndex: number
  actions: { type: string; level: string; levelIndex: number }[]
  record?: string
  url?: string
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
  // set when the twin runs the layout laid on real drone imagery
  imagery?: { site: string; kind: string } | null
}

export interface Terrain {
  rev: number
  n: number
  extent: number
  heights: Float32Array
  delta: Float32Array | null
  designZ: number | null
}
