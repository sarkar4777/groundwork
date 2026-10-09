const params = new URLSearchParams(location.search)

export const REPLAY = params.get('replay') === '1'
export const CAPTURE = params.get('capture') === '1'

const simParam = params.get('sim')
const envSim = import.meta.env.VITE_SIM_URL as string | undefined

// Same-origin /sim goes through the Vite proxy, which avoids CORS in dev and preview.
export const SIM_HTTP = (simParam || envSim || '/sim').replace(/\/$/, '')

export function wsUrl(): string {
  if (SIM_HTTP.startsWith('http')) return SIM_HTTP.replace(/^http/, 'ws') + '/ws'
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${SIM_HTTP}/ws`
}
