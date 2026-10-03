import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

function installNoZoomProtection() {
  const nonPassive = { passive: false } as const
  const preventGestureZoom = (event: Event) => event.preventDefault()
  const preventPinchZoom = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault()
  }
  const preventDesktopZoom = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault()
  }
  const preventKeyboardZoom = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) event.preventDefault()
  }
  let lastTouchEnd = 0
  const preventDoubleTapZoom = (event: TouchEvent) => {
    const now = performance.now()
    const target = event.target instanceof Element ? event.target : null
    const isInteractive = target?.closest('button, a, input, textarea, select, [contenteditable="true"], video')
    if (!isInteractive && now - lastTouchEnd <= 300) event.preventDefault()
    lastTouchEnd = now
  }

  document.addEventListener('gesturestart', preventGestureZoom, nonPassive)
  document.addEventListener('gesturechange', preventGestureZoom, nonPassive)
  document.addEventListener('gestureend', preventGestureZoom, nonPassive)
  document.addEventListener('touchstart', preventPinchZoom, nonPassive)
  document.addEventListener('touchmove', preventPinchZoom, nonPassive)
  document.addEventListener('touchend', preventDoubleTapZoom, nonPassive)
  document.addEventListener('wheel', preventDesktopZoom, nonPassive)
  document.addEventListener('keydown', preventKeyboardZoom)
}

function installGlobalCopyProtection() {
  function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    return target.closest('input, textarea, [contenteditable="true"]') !== null
  }

  // Prevent ordinary copying on non-editable UI
  document.addEventListener('copy', (event) => {
    if (!isEditable(event.target)) {
      event.preventDefault()
    }
  })

  // Prevent Ctrl/Cmd+A (select all) and Ctrl/Cmd+C (copy) outside text inputs
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase()
      if ((key === 'a' || key === 'c' || key === 'x') && !isEditable(event.target)) {
        event.preventDefault()
      }
    }
  })

  // Disable browser context menu for non-interactive content (messages handle custom menu)
  document.addEventListener('contextmenu', (event) => {
    if (!isEditable(event.target) && !(event.target instanceof Element && event.target.closest('.stitch-message-row, .stitch-message'))) {
      event.preventDefault()
    }
  })

  // Prevent dragging of UI elements and images
  document.addEventListener('dragstart', (event) => {
    if (!isEditable(event.target)) {
      event.preventDefault()
    }
  })

  // Prevent text drag selection on general UI
  document.addEventListener('selectstart', (event) => {
    if (!isEditable(event.target)) {
      event.preventDefault()
    }
  })
}

installNoZoomProtection()
installGlobalCopyProtection()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'))
}
