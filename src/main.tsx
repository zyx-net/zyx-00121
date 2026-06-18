import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { ToastContainer } from '@/components/ToastContainer'
import { useAppStore } from '@/store/useAppStore'

function AppRoot() {
  const initStore = useAppStore((s) => s.initStore)

  useEffect(() => {
    initStore()
  }, [initStore])

  return (
    <>
      <App />
      <ToastContainer />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
)
