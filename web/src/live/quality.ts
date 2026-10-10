import { CAPTURE } from './config'

// Capture and ?quality=high turn on the costly passes: soft 4k shadows, full resolution, finer tilt-shift.
export const HIGH = CAPTURE || new URLSearchParams(location.search).get('quality') === 'high'
