let activeContext: AudioContext | null = null
let activeTimer: number | undefined
let activeToken = 0

function getAudioContext() {
  if (typeof window === 'undefined') return null
  const AudioContextConstructor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor) return null
  activeContext ??= new AudioContextConstructor()
  return activeContext
}

let isAudioUnlocked = false

export function unlockAudioContext(): void {
  if (isAudioUnlocked) return
  const context = getAudioContext()
  if (!context) return
  if (context.state === 'suspended') {
    void context.resume().then(() => {
      isAudioUnlocked = true
    }).catch(() => undefined)
  } else if (context.state === 'running') {
    isAudioUnlocked = true
  }
}

if (typeof window !== 'undefined') {
  const onInteraction = () => {
    unlockAudioContext()
    if (isAudioUnlocked) {
      window.removeEventListener('pointerdown', onInteraction)
      window.removeEventListener('keydown', onInteraction)
      window.removeEventListener('touchstart', onInteraction)
    }
  }
  window.addEventListener('pointerdown', onInteraction, { passive: true })
  window.addEventListener('keydown', onInteraction, { passive: true })
  window.addEventListener('touchstart', onInteraction, { passive: true })
}


function playMarimbaNote(context: AudioContext, frequency: number, startTime: number, duration = 0.2) {
  if (context.state === 'closed') return

  // Fundamental frequency oscillator (warm body)
  const oscFundamental = context.createOscillator()
  oscFundamental.type = 'sine'
  oscFundamental.frequency.setValueAtTime(frequency, startTime)

  // Harmonic overtone oscillator (marimba mallet click & resonance)
  const oscHarmonic = context.createOscillator()
  oscHarmonic.type = 'triangle'
  oscHarmonic.frequency.setValueAtTime(frequency * 2, startTime)

  const gainFundamental = context.createGain()
  const gainHarmonic = context.createGain()
  const masterNoteGain = context.createGain()

  // Envelope for fundamental: punchy attack, natural exponential decay
  gainFundamental.gain.setValueAtTime(0.0001, startTime)
  gainFundamental.gain.exponentialRampToValueAtTime(0.07, startTime + 0.008)
  gainFundamental.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

  // Envelope for harmonic: fast attack, quick decay (wooden mallet tap)
  gainHarmonic.gain.setValueAtTime(0.0001, startTime)
  gainHarmonic.gain.exponentialRampToValueAtTime(0.025, startTime + 0.004)
  gainHarmonic.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.min(0.08, duration))

  oscFundamental.connect(gainFundamental)
  oscHarmonic.connect(gainHarmonic)

  gainFundamental.connect(masterNoteGain)
  gainHarmonic.connect(masterNoteGain)
  masterNoteGain.connect(context.destination)

  oscFundamental.start(startTime)
  oscHarmonic.start(startTime)

  oscFundamental.stop(startTime + duration + 0.05)
  oscHarmonic.stop(startTime + duration + 0.05)

  oscFundamental.addEventListener('ended', () => {
    oscFundamental.disconnect()
    oscHarmonic.disconnect()
    gainFundamental.disconnect()
    gainHarmonic.disconnect()
    masterNoteGain.disconnect()
  }, { once: true })
}

/**
 * Plays the signature WhatsApp incoming call marimba melody motif.
 */
function playWhatsAppMotif(context: AudioContext) {
  if (context.state === 'closed') return
  const now = context.currentTime + 0.02

  // Note sequence [frequency, delay offset, duration]
  const notes: [number, number, number][] = [
    // Phrase 1 (Arpeggio ascending)
    [659.25, 0.00, 0.16],  // E5
    [830.61, 0.14, 0.16],  // G#5
    [987.77, 0.28, 0.16],  // B5
    [1318.51, 0.42, 0.22], // E6

    // Phrase 2 (Descend & resolution)
    [1244.51, 0.70, 0.16], // D#6
    [987.77, 0.84, 0.16],  // B5
    [830.61, 0.98, 0.16],  // G#5
    [659.25, 1.12, 0.22],  // E5

    // Phrase 3 (Cadence finish)
    [739.99, 1.40, 0.14],  // F#5
    [830.61, 1.54, 0.14],  // G#5
    [659.25, 1.68, 0.32],  // E5
  ]

  for (const [freq, offset, dur] of notes) {
    playMarimbaNote(context, freq, now + offset, dur)
  }
}

export function startIncomingRingtone() {
  stopIncomingRingtone()
  const token = ++activeToken
  const context = getAudioContext()
  if (!context) return

  const ring = () => {
    if (token !== activeToken || !activeContext || activeContext.state === 'closed') return
    void activeContext.resume().then(() => {
      if (token === activeToken && activeContext) playWhatsAppMotif(activeContext)
    }).catch(() => {
      // Browsers may require user interaction before playing audio.
    })
  }

  ring()
  activeTimer = window.setInterval(ring, 2800)
}

export function stopIncomingRingtone() {
  activeToken += 1
  if (activeTimer !== undefined) window.clearInterval(activeTimer)
  activeTimer = undefined
  if (activeContext && activeContext.state === 'running') {
    void activeContext.suspend().catch(() => undefined)
  }
}

/**
 * Plays the signature WhatsApp message chime pop sound for incoming messages.
 */
export function playIncomingMessageSound() {
  const context = getAudioContext()
  if (!context || context.state === 'closed') return
  void context.resume().then(() => {
    if (context.state !== 'closed') {
      const now = context.currentTime + 0.01
      playMarimbaNote(context, 1046.5, now, 0.08)       // C6 note
      playMarimbaNote(context, 1318.5, now + 0.06, 0.12) // E6 note
    }
  }).catch(() => undefined)
}

