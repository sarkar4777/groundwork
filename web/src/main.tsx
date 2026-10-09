import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { startClient } from './live/client'
import { installAutomation } from './live/automation'

if (location.search.includes('noblur')) document.body.classList.add('noblur')
startClient()
installAutomation()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
