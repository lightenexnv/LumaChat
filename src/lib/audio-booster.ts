export class AudioBooster {
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private gainNode: GainNode | null = null
  private stream: MediaStream | null = null
  private boostMultiplier: number = 2.0

  constructor(initialBoost = 2.0) {
    this.boostMultiplier = Math.max(1.0, Math.min(5.0, initialBoost))
  }

  get boost(): number {
    return this.boostMultiplier
  }

  setBoost(multiplier: number) {
    const clamped = Math.max(1.0, Math.min(5.0, Number(multiplier.toFixed(1))))
    this.boostMultiplier = clamped
    if (this.gainNode && this.audioContext) {
      try {
        this.gainNode.gain.setValueAtTime(this.boostMultiplier, this.audioContext.currentTime)
      } catch {
        this.gainNode.gain.value = this.boostMultiplier
      }
    }
  }

  onStateChange?: (running: boolean) => void

  get isRunning(): boolean {
    return this.audioContext?.state === 'running'
  }

  attachStream(stream: MediaStream | null) {
    if (this.stream === stream && this.sourceNode) return
    this.cleanupNodes()
    this.stream = stream
    if (!stream || typeof window === 'undefined') return
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) return

    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioCtxClass) return

      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtxClass()
        this.audioContext.onstatechange = () => {
          this.onStateChange?.(this.audioContext?.state === 'running')
        }
      }

      if (this.audioContext.state === 'suspended') {
        void this.audioContext.resume().then(() => {
          this.onStateChange?.(this.audioContext?.state === 'running')
        }).catch(() => undefined)
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(stream)
      this.gainNode = this.audioContext.createGain()
      this.gainNode.gain.value = this.boostMultiplier

      this.sourceNode.connect(this.gainNode)
      this.gainNode.connect(this.audioContext.destination)
      this.onStateChange?.(this.audioContext.state === 'running')
    } catch {
      // Non-fatal if Web Audio is restricted
    }
  }

  async resume(): Promise<boolean> {
    const ctx = this.audioContext
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume()
        const isRunning = (ctx.state as AudioContextState) === 'running'
        this.onStateChange?.(isRunning)
        return isRunning
      } catch {
        return false
      }
    }
    return (this.audioContext?.state as AudioContextState) === 'running'
  }

  private cleanupNodes() {
    try {
      this.sourceNode?.disconnect()
      this.gainNode?.disconnect()
    } catch {
      /* ignore */
    }
    this.sourceNode = null
    this.gainNode = null
  }

  destroy() {
    this.cleanupNodes()
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        void this.audioContext.close()
      } catch {
        /* ignore */
      }
    }
    this.audioContext = null
    this.stream = null
  }
}
