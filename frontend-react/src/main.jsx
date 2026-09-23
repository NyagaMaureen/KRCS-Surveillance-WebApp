import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './main.css'
import './charts/chartSetup'

createRoot(document.getElementById('app')).render(
  <StrictMode>
    <App />
  </StrictMode>
)