import '../dev/renderclock'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import './proof.css'
import { ProofApp } from './ProofApp'
import { startClient } from '../live/client'
import { installAutomation } from '../live/automation'
import { MAT } from '../scene/materials'

// a plain fleet on a real photo, without the Groundwork sky-blue trim
MAT.accent.color.set('#3a3f46')
MAT.accent.emissiveIntensity = 0

if (new URLSearchParams(location.search).get('capture') === '1') document.body.classList.add('capture')
startClient()
installAutomation()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProofApp />
  </StrictMode>,
)
