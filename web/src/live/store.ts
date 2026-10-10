import { create } from 'zustand'
import type { AgentFrame, AgentInfo, BusFrame, CaptionFrame, EventFrame, PlanNode, StateFrame } from '../proto/types'

export type Conn = 'connecting' | 'live' | 'offline' | 'replay'
export type CamMode = 'drone' | 'orbit' | 'follow' | 'cab' | 'seat' | 'nervous'

export interface Overlays {
  geofence: boolean
  swing: boolean
  crane: boolean
  roads: boolean
  cutfill: boolean
  workers: boolean
  labels: boolean
}

export interface Approval {
  key: string
  execution_id?: string
  agent: string
  text: string
  t: number
  status: 'pending' | 'sending' | 'approved' | 'rejected' | 'error'
  error?: string
}

export interface CaptionLog { t: number; until: number; text: string }

export interface UiState {
  conn: Conn
  connError: string | null
  state: StateFrame | null
  bus: BusFrame[]
  events: EventFrame[]
  agentLines: AgentFrame[]
  plan: PlanNode | null
  planT: number
  caption: CaptionFrame | null
  captionLog: CaptionLog[]
  agents: AgentInfo[] | null
  agentsError: string | null
  approvals: Approval[]
  aiOffline: boolean
  killed: boolean
  cam: CamMode
  prevCam: CamMode
  selected: string | null
  overlays: Overlays
  panelsHidden: boolean
  help: boolean
  story: { running: boolean; t0: number; startedAt: number; error: string | null; recorded: boolean }
  hover: { x: number; y: number; z: number } | null
  tracePaused: boolean
  fps: number
  toast: { text: string; tone: 'ok' | 'warn' | 'err'; at: number } | null
  abenix: { url: string; reachable: boolean } | null
  siteError: string | null
  siteVersion: number
  terrainShown: number
  heroFx: boolean
  storyBeat: string
}

export const useUi = create<UiState>(() => ({
  conn: 'connecting',
  connError: null,
  state: null,
  bus: [],
  events: [],
  agentLines: [],
  plan: null,
  planT: 0,
  caption: null,
  captionLog: [],
  agents: null,
  agentsError: null,
  approvals: [],
  aiOffline: false,
  killed: false,
  cam: 'drone',
  prevCam: 'drone',
  selected: null,
  overlays: { geofence: true, swing: true, crane: true, roads: true, cutfill: false, workers: true, labels: true },
  panelsHidden: false,
  help: false,
  story: { running: false, t0: 0, startedAt: 0, error: null, recorded: false },
  hover: null,
  tracePaused: false,
  fps: 0,
  toast: null,
  abenix: null,
  siteError: null,
  siteVersion: 0,
  terrainShown: 0,
  heroFx: false,
  storyBeat: '',
}))

export const setCam = (cam: CamMode) =>
  useUi.setState((s) => (s.cam === cam ? s : { cam, prevCam: s.cam === 'nervous' ? s.prevCam : s.cam }))

export const toast = (text: string, tone: 'ok' | 'warn' | 'err' = 'ok') => useUi.setState({ toast: { text, tone, at: Date.now() } })
