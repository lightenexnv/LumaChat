/**
 * Proximity Sensor for Audio Calls
 * 
 * Implements "screen off when phone is on ear" behavior during audio calls.
 * Uses the Proximity Sensor API where available, with fallbacks:
 * 
 * 1. ProximitySensor API (Chrome Android with experimental flag)
 * 2. deviceproximity event (Firefox on Android, deprecated but still works)
 * 3. Screen Wake Lock API to keep screen alive during calls
 * 
 * When proximity is detected, a full-screen black overlay is shown
 * and touch events are disabled (simulating screen-off behavior).
 */

type ProximityCallback = (near: boolean) => void

let cleanup: (() => void) | null = null
let callWakeLock: WakeLockSentinel | null = null
let visibilityHandlerAttached = false

const handleVisibilityForWakeLock = async () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && !callWakeLock && typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
    try {
      callWakeLock = await navigator.wakeLock.request('screen')
      callWakeLock.addEventListener('release', () => { callWakeLock = null }, { once: true })
    } catch { /* optional */ }
  }
}

/**
 * Acquires a global screen wake lock for any active call (audio or video)
 * preventing mobile screens from sleeping/locking and suspending WebRTC tracks.
 */
export async function acquireCallWakeLock(): Promise<void> {
  if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
    try {
      if (!callWakeLock) {
        callWakeLock = await navigator.wakeLock.request('screen')
        callWakeLock.addEventListener('release', () => { callWakeLock = null }, { once: true })
      }
    } catch {
      // Wake lock not available or denied — non-critical
    }
  }
  if (!visibilityHandlerAttached && typeof document !== 'undefined') {
    visibilityHandlerAttached = true
    document.addEventListener('visibilitychange', handleVisibilityForWakeLock)
  }
}

/**
 * Releases the global screen wake lock when a call ends.
 */
export function releaseCallWakeLock(): void {
  if (callWakeLock) {
    callWakeLock.release().catch(() => undefined)
    callWakeLock = null
  }
  if (visibilityHandlerAttached && typeof document !== 'undefined') {
    visibilityHandlerAttached = false
    document.removeEventListener('visibilitychange', handleVisibilityForWakeLock)
  }
}

/**
 * Starts proximity detection for audio calls.
 * Shows a black overlay when the phone is near the ear.
 */
export async function startProximitySensor(onProximityChange?: ProximityCallback): Promise<void> {
  stopProximitySensor()

  if (typeof document === 'undefined') return

  // Create the true AMOLED black overlay element
  const overlay = document.createElement('div')
  overlay.id = 'luma-proximity-overlay'
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    background: #000000; opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none; display: none;
    touch-action: none;
  `
  document.body.appendChild(overlay)

  let isOverlayVisible = false

  function showOverlay() {
    if (isOverlayVisible) return
    isOverlayVisible = true
    overlay.style.display = 'block'
    void overlay.offsetHeight
    overlay.style.opacity = '1'
    overlay.style.pointerEvents = 'auto'
    overlay.addEventListener('touchstart', preventTouch, { passive: false })
    overlay.addEventListener('touchmove', preventTouch, { passive: false })
    overlay.addEventListener('touchend', preventTouch, { passive: false })
    overlay.addEventListener('pointerdown', preventTouch, { passive: false })
    onProximityChange?.(true)
  }

  function hideOverlay() {
    if (!isOverlayVisible) return
    isOverlayVisible = false
    overlay.style.opacity = '0'
    overlay.style.pointerEvents = 'none'
    overlay.style.display = 'none'
    overlay.removeEventListener('touchstart', preventTouch)
    overlay.removeEventListener('touchmove', preventTouch)
    overlay.removeEventListener('touchend', preventTouch)
    overlay.removeEventListener('pointerdown', preventTouch)
    onProximityChange?.(false)
  }

  function preventTouch(e: Event) {
    e.preventDefault()
    e.stopPropagation()
  }

  const cleanups: Array<() => void> = []

  if (typeof window !== 'undefined') {
    // Strategy 1: ProximitySensor API (Chrome Android experimental)
    if ('ProximitySensor' in window) {
      try {
        const SensorClass = (window as unknown as Record<string, new (opts?: { frequency: number }) => { near: boolean; start: () => void; stop: () => void; addEventListener: (event: string, handler: () => void) => void; removeEventListener: (event: string, handler: () => void) => void }>).ProximitySensor
        const sensor = new SensorClass({ frequency: 5 })
        const handleReading = () => {
          if (sensor.near) showOverlay()
          else hideOverlay()
        }
        sensor.addEventListener('reading', handleReading)
        sensor.start()
        cleanups.push(() => {
          sensor.stop()
          sensor.removeEventListener('reading', handleReading)
        })
      } catch {
        // Sensor not available, fallback
      }
    }

    // Strategy 2: deviceproximity event (Firefox on Android)
    if ('ondeviceproximity' in window) {
      const handleProximity = (e: Event) => {
        const event = e as Event & { near?: boolean; min?: number; value?: number }
        const isNear = event.near ?? (typeof event.value === 'number' && typeof event.min === 'number' && event.value <= event.min + 1)
        if (isNear) showOverlay()
        else hideOverlay()
      }
      window.addEventListener('deviceproximity', handleProximity)
      cleanups.push(() => window.removeEventListener('deviceproximity', handleProximity))
    }

    // Strategy 3: userproximity event
    if ('onuserproximity' in window) {
      const handleUserProximity = (e: Event) => {
        const event = e as Event & { near?: boolean }
        if (event.near) showOverlay()
        else hideOverlay()
      }
      window.addEventListener('userproximity', handleUserProximity)
      cleanups.push(() => window.removeEventListener('userproximity', handleUserProximity))
    }
  }

  cleanup = () => {
    cleanups.forEach((fn) => {
      try { fn() } catch { /* ignore */ }
    })
    hideOverlay()
    overlay.remove()
  }
}

/**
 * Stops proximity detection and removes all overlays synchronously.
 * Call this when the audio call ends.
 */
export function stopProximitySensor(): void {
  try { cleanup?.() } catch { /* ignore */ }
  cleanup = null
  if (typeof document !== 'undefined') {
    const existing = document.getElementById('luma-proximity-overlay')
    existing?.remove()
  }
}

/**
 * Checks if the proximity sensor is available on this device.
 */
export function isProximitySensorAvailable(): boolean {
  if (typeof window === 'undefined') return false
  return (
    'ProximitySensor' in window ||
    'ondeviceproximity' in window ||
    'onuserproximity' in window
  )
}

