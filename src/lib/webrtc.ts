import { auth, database } from './firebase'
import { child, onChildAdded, onDisconnect, onValue, push, ref, remove, runTransaction, serverTimestamp, set, type Unsubscribe } from 'firebase/database'
import { CALL_RING_TIMEOUT_MS } from './calls'
import type { NetworkSnapshot, QualityMode, QualityProfile } from '../types'

export function sanitizeCandidate(candidate: RTCIceCandidateInit): RTCIceCandidateInit {
  return {
    candidate: String(candidate.candidate ?? '').slice(0, 20000),
    sdpMid: candidate.sdpMid ? String(candidate.sdpMid).slice(0, 128) : null,
    sdpMLineIndex: typeof candidate.sdpMLineIndex === 'number' ? candidate.sdpMLineIndex : null,
    usernameFragment: candidate.usernameFragment ? String(candidate.usernameFragment).slice(0, 128) : undefined,
  }
}

export const QUALITY_PROFILES: Record<Exclude<QualityMode, 'auto'>, QualityProfile> = {
  '1080p': { mode: '1080p', label: 'Full HD', width: 1920, height: 1080, fps: 30, maxBitrate: 4_500_000 },
  '720p': { mode: '720p', label: 'HD', width: 1280, height: 720, fps: 30, maxBitrate: 2_500_000 },
  '480p': { mode: '480p', label: 'Standard', width: 854, height: 480, fps: 24, maxBitrate: 1_200_000 },
  '360p': { mode: '360p', label: 'Low', width: 640, height: 360, fps: 15, maxBitrate: 650_000 },
  '240p': { mode: '240p', label: 'Data Saver', width: 426, height: 240, fps: 15, maxBitrate: 320_000 },
  audio: { mode: 'audio', label: 'Audio only', width: 0, height: 0, fps: 0, maxBitrate: 0 },
}

export function optimizeSdpForHighQualityAudio(sdp: string): string {
  let modified = sdp
  if (modified.includes('opus/48000')) {
    modified = modified.replace(
      /(a=fmtp:\d+ .*?)(?=\r\n|$)/g,
      (match) => {
        let params = match
        // In-band Forward Error Correction (vital for 2-3 bar LTE packet loss recovery)
        if (!params.includes('useinbandfec=')) params += ';useinbandfec=1'
        else params = params.replace(/useinbandfec=\d+/, 'useinbandfec=1')

        // Discontinuous Transmission (saves cellular uplink during speech pauses)
        if (!params.includes('usedtx=')) params += ';usedtx=1'
        else params = params.replace(/usedtx=\d+/, 'usedtx=1')

        // Variable Bit Rate & optimal mobile voice bandwidth (prevents queue blowout)
        if (!params.includes('cbr=')) params += ';cbr=0'
        if (!params.includes('maxaveragebitrate=')) params += ';maxaveragebitrate=32000'
        if (!params.includes('stereo=')) params += ';stereo=0;sprop-stereo=0'
        if (!params.includes('maxplaybackrate=')) params += ';maxplaybackrate=48000'
        if (!params.includes('sprop-maxcapturerate=')) params += ';sprop-maxcapturerate=48000'
        if (!params.includes('minptime=')) params += ';minptime=10'
        if (!params.includes('ptime=')) params += ';ptime=20'

        return params
      }
    )
  }
  return modified
}

export function ensureRtcpFeedbackInSdp(sdp: string): string {
  if (!sdp || !sdp.includes('m=video')) return sdp
  const lines = sdp.split(/\r\n|\n/)
  const mVideoIndex = lines.findIndex((l) => l.startsWith('m=video '))
  if (mVideoIndex === -1) return sdp

  const mLine = lines[mVideoIndex]
  const payloads = mLine.split(' ').slice(3)
  const existingFb = new Set<string>()

  for (let i = mVideoIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('m=')) break
    if (lines[i].startsWith('a=rtcp-fb:')) {
      existingFb.add(lines[i].trim())
    }
  }

  const feedbackLines: string[] = []
  payloads.forEach((pt) => {
    const required = [
      `a=rtcp-fb:${pt} nack`,
      `a=rtcp-fb:${pt} nack pli`,
      `a=rtcp-fb:${pt} goog-remb`,
      `a=rtcp-fb:${pt} transport-cc`,
      `a=rtcp-fb:${pt} ccm fir`,
    ]
    required.forEach((fb) => {
      if (!existingFb.has(fb)) {
        feedbackLines.push(fb)
        existingFb.add(fb)
      }
    })
  })

  if (feedbackLines.length > 0) {
    lines.splice(mVideoIndex + 1, 0, ...feedbackLines)
  }

  return lines.join('\r\n')
}

export function prioritizeH264InSdp(sdp: string): string {
  if (!sdp || !sdp.includes('m=video')) return sdp
  const lines = sdp.split(/\r\n|\n/)
  const mVideoIndex = lines.findIndex((l) => l.startsWith('m=video '))
  if (mVideoIndex === -1) return sdp

  const h264Payloads: string[] = []
  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+H264\/90000/i)
    if (match) {
      h264Payloads.push(match[1])
    }
  }

  if (h264Payloads.length === 0) return sdp

  const mLine = lines[mVideoIndex]
  const parts = mLine.split(' ')
  if (parts.length <= 3) return sdp

  const prefix = parts.slice(0, 3)
  const payloads = parts.slice(3)

  const h264Matches = payloads.filter((pt) => h264Payloads.includes(pt))
  const otherMatches = payloads.filter((pt) => !h264Payloads.includes(pt))
  const newPayloads = [...h264Matches, ...otherMatches]

  lines[mVideoIndex] = `${prefix.join(' ')} ${newPayloads.join(' ')}`
  return lines.join('\r\n')
}

export function injectVideoBandwidthInSdp(sdp: string, bitrateKbps = 2500): string {
  if (!sdp || !sdp.includes('m=video')) return sdp
  const lines = sdp.split(/\r\n|\n/)
  const mVideoIndex = lines.findIndex((l) => l.startsWith('m=video '))
  if (mVideoIndex === -1) return sdp

  let insertIndex = mVideoIndex + 1
  for (let i = mVideoIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('m=')) break
    if (lines[i].startsWith('c=')) {
      insertIndex = i + 1
      break
    }
  }

  let hasBandwidth = false
  for (let i = mVideoIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('m=')) break
    if (lines[i].startsWith('b=AS:')) {
      lines[i] = `b=AS:${bitrateKbps}`
      hasBandwidth = true
    } else if (lines[i].startsWith('b=TIAS:')) {
      lines[i] = `b=TIAS:${bitrateKbps * 1000}`
      hasBandwidth = true
    }
  }

  if (!hasBandwidth) {
    lines.splice(insertIndex, 0, `b=AS:${bitrateKbps}`, `b=TIAS:${bitrateKbps * 1000}`)
  }

  return lines.join('\r\n')
}

export function optimizeSdp(sdp: string, videoBitrateKbps = 2500): string {
  let modified = optimizeSdpForHighQualityAudio(sdp)
  modified = prioritizeH264InSdp(modified)
  modified = ensureRtcpFeedbackInSdp(modified)
  modified = injectVideoBandwidthInSdp(modified, videoBitrateKbps)
  return modified
}

export function setTransceiverCodecPreferences(transceiver: RTCRtpTransceiver) {
  if (typeof RTCRtpSender?.getCapabilities !== 'function' || typeof transceiver.setCodecPreferences !== 'function') return
  try {
    const capabilities = RTCRtpSender.getCapabilities('video')
    if (!capabilities?.codecs) return
    const h264Codecs = capabilities.codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264')
    const otherCodecs = capabilities.codecs.filter((c) => c.mimeType.toLowerCase() !== 'video/h264')
    if (h264Codecs.length > 0) {
      transceiver.setCodecPreferences([...h264Codecs, ...otherCodecs])
    }
  } catch {
    // Non-fatal if unsupported by browser
  }
}

export function mediaConstraints(mode: QualityMode, facingMode: 'user' | 'environment' = 'user'): MediaStreamConstraints {
  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000,
    sampleSize: 16,
  }
  if (mode === 'audio') return { audio: audioConstraints, video: false }
  const profile = QUALITY_PROFILES[mode === 'auto' ? '720p' : mode]
  return {
    audio: audioConstraints,
    video: {
      width: { ideal: profile.width },
      height: { ideal: profile.height },
      frameRate: { ideal: profile.fps, max: profile.fps },
      facingMode,
    },
  }
}

export async function applyQuality(sender: RTCRtpSender, mode: QualityMode, dynamicScale = 1.0) {
  if (sender.track?.kind !== 'video' || mode === 'audio') return
  const profile = QUALITY_PROFILES[mode === 'auto' ? '720p' : mode]
  const parameters = sender.getParameters()
  parameters.encodings ??= [{}]
  parameters.encodings[0].maxBitrate = Math.max(100_000, Math.round(profile.maxBitrate / Math.max(1, dynamicScale)))
  parameters.encodings[0].maxFramerate = profile.fps
  parameters.encodings[0].scaleResolutionDownBy = dynamicScale
  parameters.encodings[0].active = true
  parameters.degradationPreference = 'maintain-framerate'
  await sender.setParameters(parameters)
}

export function classifyNetwork(rtt: number, packetLoss: number, bitrate: number, isVideo = true): NetworkSnapshot['label'] {
  if (isVideo) {
    if (rtt > 900 || packetLoss > 0.2 || bitrate < 120_000) return 'Reconnecting'
    if (rtt > 450 || packetLoss > 0.1 || bitrate < 350_000) return 'Weak'
    if (rtt > 250 || packetLoss > 0.04 || bitrate < 800_000) return 'Fair'
    if (rtt > 130 || packetLoss > 0.015) return 'Good'
    return 'Excellent'
  } else {
    if (rtt > 900 || packetLoss > 0.25 || bitrate < 10_000) return 'Reconnecting'
    if (rtt > 450 || packetLoss > 0.12 || bitrate < 18_000) return 'Weak'
    if (rtt > 250 || packetLoss > 0.05 || bitrate < 28_000) return 'Fair'
    if (rtt > 130 || packetLoss > 0.02) return 'Good'
    return 'Excellent'
  }
}

type Role = 'caller' | 'callee'
export type CallState = 'ringing' | 'accepted' | 'declined' | 'ended'

export function canTransitionCallState(from: CallState, to: CallState) {
  return from === to
    || (from === 'ringing' && (to === 'accepted' || to === 'declined' || to === 'ended'))
    || (from === 'accepted' && to === 'ended')
}

const CALL_RECORD_RETENTION_MS = 15_000

export class WebRTCCall {
  readonly pc: RTCPeerConnection
  readonly remoteStream = new MediaStream()
  localStream?: MediaStream
  private cameraTrack?: MediaStreamTrack
  private screenTrack?: MediaStreamTrack
  private readonly role: Role
  private readonly disposers: Unsubscribe[] = []
  private callRefPath?: string
  private calleeId?: string
  private statsTimer?: number
  private ringTimer?: number
  private disconnectTimer?: number
  private connectionTimer?: number
  private cleanupTimer?: number
  private closed = false
  private endedNotified = false
  private remoteDescriptionReady = false
  private pendingRemoteCandidates: RTCIceCandidateInit[] = []
  private lastBytes = 0
  private lastStatsAt = 0
  private controlChannel?: RTCDataChannel
  onStats?: (snapshot: NetworkSnapshot) => void
  onRemoteStream?: (stream: MediaStream) => void
  onCallEnded?: () => void
  onScreenShareEnded?: () => void
  onConnected?: () => void
  onPeerMirrorChange?: (enabled: boolean) => void

  get isClosed() { return this.closed }
  get callId() { return this.callRefPath?.split('/')[1] }
  get isCaller() { return this.role === 'caller' }

  setCameraTrack(track: MediaStreamTrack) {
    this.cameraTrack = track
    if (this.cameraTrack) this.cameraTrack.contentHint = 'motion'
  }

  private setupControlChannel(channel: RTCDataChannel) {
    channel.onopen = () => {
      try {
        const saved = localStorage.getItem('luma_call_mirror_camera')
        const enabled = saved !== null ? saved === 'true' : true
        this.sendPeerMirrorPreference(enabled)
      } catch {
        /* ignore */
      }
    }
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as { type?: string; enabled?: boolean }
        if (data.type === 'mirror_preference' && typeof data.enabled === 'boolean') {
          this.onPeerMirrorChange?.(data.enabled)
        }
      } catch {
        /* ignore */
      }
    }
  }

  sendPeerMirrorPreference(enabled: boolean) {
    if (this.controlChannel && this.controlChannel.readyState === 'open') {
      try {
        this.controlChannel.send(JSON.stringify({ type: 'mirror_preference', enabled }))
      } catch {
        /* ignore */
      }
    }
  }

  constructor(role: Role, iceServers: RTCIceServer[] = []) {
    this.role = role
    this.pc = new RTCPeerConnection({
      iceServers: iceServers.length ? iceServers : [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 2,
    })
    if (this.role === 'caller') {
      try {
        this.controlChannel = this.pc.createDataChannel('luma-control', { ordered: true })
        this.setupControlChannel(this.controlChannel)
      } catch {
        /* ignore */
      }
    }
    this.pc.ondatachannel = (event) => {
      if (event.channel.label === 'luma-control') {
        this.controlChannel = event.channel
        this.setupControlChannel(this.controlChannel)
      }
    }
    this.pc.ontrack = (event) => {
      if (this.closed) return
      const tracks = event.streams[0]?.getTracks() ?? [event.track]
      tracks.forEach((track) => {
        if (!this.remoteStream.getTracks().some((existingTrack) => existingTrack.id === track.id)) this.remoteStream.addTrack(track)
      })
      event.track.onended = () => {
        if (this.remoteStream.getTracks().some((track) => track.id === event.track.id)) this.remoteStream.removeTrack(event.track)
        if (!this.closed) this.onRemoteStream?.(new MediaStream(this.remoteStream.getTracks()))
      }
      this.onRemoteStream?.(new MediaStream(this.remoteStream.getTracks()))
    }
    this.pc.onconnectionstatechange = () => {
      if (this.closed) return
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
        this.notifyCallEnded()
        return
      }
      if (this.pc.connectionState === 'connected') {
        this.clearConnectionTimer()
        this.onConnected?.()
      }
      if (this.pc.connectionState === 'disconnected') {
        this.scheduleDisconnectCheck()
      } else {
        this.clearDisconnectTimer()
      }
    }
    this.pc.oniceconnectionstatechange = () => {
      if (this.closed) return
      if (this.pc.iceConnectionState === 'failed') {
        void this.restartIceSession()
        this.scheduleDisconnectCheck()
      } else if (this.pc.iceConnectionState === 'disconnected') {
        this.scheduleDisconnectCheck()
      } else if (this.pc.iceConnectionState === 'connected' || this.pc.iceConnectionState === 'completed') {
        this.clearConnectionTimer()
        this.clearDisconnectTimer()
        this.onConnected?.()
      }
    }
  }

  async restartIceSession() {
    if (this.closed || this.pc.signalingState === 'closed') return
    try {
      const offer = await this.pc.createOffer({ iceRestart: true })
      const optimized: RTCSessionDescriptionInit = {
        type: offer.type,
        sdp: offer.sdp ? optimizeSdp(offer.sdp) : offer.sdp,
      }
      await this.pc.setLocalDescription(optimized)
      if (this.callRefPath && database && !this.closed && this.role === 'caller') {
        const callRef = ref(database, this.callRefPath)
        await set(child(callRef, 'offer'), optimized)
      }
    } catch {
      // Non-fatal ice restart attempt
    }
  }

  async prepare(mode: QualityMode, facingMode: 'user' | 'environment' = 'user') {
    if (this.closed) throw new Error('Call has already ended.')
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone access requires a secure HTTPS connection.')
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints(mode, facingMode))
    } catch (error) {
      const domError = error as DOMException
      if (mode !== 'audio' && domError.name === 'OverconstrainedError') {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 }, facingMode },
        })
      } else if (mode !== 'audio' && (domError.name === 'NotReadableError' || domError.name === 'AbortError')) {
        // Camera hardware locked, gracefully fall back to crystal clear voice
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        })
      } else {
        throw error
      }
    }
    if (this.closed) {
      this.localStream.getTracks().forEach((track) => track.stop())
      throw new Error('Call has already ended.')
    }
    this.cameraTrack = this.localStream.getVideoTracks()[0]
    if (this.cameraTrack) this.cameraTrack.contentHint = 'motion'
    this.localStream.getTracks().forEach((track) => {
      const sender = this.pc.addTrack(track, this.localStream!)
      if (track.kind === 'video') {
        const transceiver = this.pc.getTransceivers?.().find((t) => t.sender === sender)
        if (transceiver) setTransceiverCodecPreferences(transceiver)
        void applyQuality(sender, mode)
      }
    })
    return this.localStream
  }

  async startScreenShare() {
    if (this.closed) throw new Error('Call has already ended.')
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not supported by this browser.')
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false })
    const screenTrack = screenStream.getVideoTracks()[0]
    if (!screenTrack) throw new Error('No screen source was selected.')
    const sender = this.pc.getSenders().find((item) => item.track?.kind === 'video')
    if (!sender) {
      screenTrack.stop()
      throw new Error('The video sender is not ready for screen sharing.')
    }
    await sender.replaceTrack(screenTrack)
    screenTrack.contentHint = 'motion'
    this.screenTrack = screenTrack
    screenTrack.addEventListener('ended', () => { void this.stopScreenShare().finally(() => this.onScreenShareEnded?.()) }, { once: true })
    this.localStream = new MediaStream([...(this.localStream?.getAudioTracks() ?? []), screenTrack])
    return this.localStream
  }

  async stopScreenShare() {
    if (this.closed) return this.localStream
    if (!this.screenTrack) return this.localStream
    const sender = this.pc.getSenders().find((item) => item.track?.kind === 'video')
    if (sender && this.cameraTrack) await sender.replaceTrack(this.cameraTrack)
    this.screenTrack.stop()
    this.screenTrack = undefined
    this.localStream = new MediaStream([...(this.localStream?.getAudioTracks() ?? []), ...(this.cameraTrack ? [this.cameraTrack] : [])])
    return this.localStream
  }

  async changeQuality(mode: QualityMode) {
    if (this.closed) return
    const videoTrack = this.localStream?.getVideoTracks()[0]
    if (videoTrack) {
      if (mode === 'audio') {
        videoTrack.enabled = false
      } else {
        const profile = QUALITY_PROFILES[mode === 'auto' ? '720p' : mode]
        videoTrack.enabled = true
        try {
          await videoTrack.applyConstraints({ width: { ideal: profile.width }, height: { ideal: profile.height }, frameRate: { ideal: profile.fps, max: profile.fps } })
        } catch {
          // Keep the call alive when a device cannot apply a requested quality.
          // The browser retains the last supported camera constraints.
        }
      }
    }
    const videoSender = this.pc.getSenders().find((sender) => sender.track?.kind === 'video')
    if (videoSender) {
      try { await applyQuality(videoSender, mode) } catch { /* Some browsers do not expose setParameters. */ }
    }
  }

  async adaptEncoding(network: NetworkSnapshot, baseQuality: QualityMode = 'auto'): Promise<QualityMode | undefined> {
    if (this.closed || baseQuality === 'audio') return undefined
    const videoSender = this.pc.getSenders().find((s) => s.track?.kind === 'video')
    if (!videoSender) return undefined

    let dynamicScale = 1.0
    let effectiveTarget: Exclude<QualityMode, 'auto'> = '720p'

    if (baseQuality === '1080p') {
      if (network.label === 'Reconnecting' || network.packetLoss > 0.15 || network.rtt > 500) {
        dynamicScale = 4.0
        effectiveTarget = '360p'
      } else if (network.label === 'Weak' || network.packetLoss > 0.06 || network.rtt > 280) {
        dynamicScale = 2.0
        effectiveTarget = '480p'
      } else if (network.label === 'Fair' || network.packetLoss > 0.025 || network.rtt > 160) {
        dynamicScale = 1.5
        effectiveTarget = '720p'
      } else {
        dynamicScale = 1.0
        effectiveTarget = '1080p'
      }
    } else {
      // 720p, 480p, 360p, or auto
      if (network.label === 'Reconnecting' || network.packetLoss > 0.15 || network.rtt > 500) {
        dynamicScale = 3.0
        effectiveTarget = '240p'
      } else if (network.label === 'Weak' || network.packetLoss > 0.06 || network.rtt > 280) {
        dynamicScale = 2.0
        effectiveTarget = '360p'
      } else if (network.label === 'Fair' || network.packetLoss > 0.025 || network.rtt > 160) {
        dynamicScale = 1.5
        effectiveTarget = '480p'
      } else {
        dynamicScale = 1.0
        effectiveTarget = '720p'
      }
    }

    try {
      await applyQuality(videoSender, effectiveTarget, dynamicScale)
    } catch {
      /* ignore */
    }

    return effectiveTarget
  }

  async applyCameraZoom(zoomLevel: number): Promise<boolean> {
    if (this.closed) return false
    const videoTrack = this.cameraTrack || this.localStream?.getVideoTracks()[0]
    if (!videoTrack) return false
    try {
      const getCaps = (videoTrack as unknown as { getCapabilities?: () => { zoom?: { min: number; max: number; step?: number } } }).getCapabilities
      const capabilities = typeof getCaps === 'function' ? getCaps.call(videoTrack) : undefined
      if (capabilities && capabilities.zoom) {
        const min = capabilities.zoom.min ?? 1
        const max = capabilities.zoom.max ?? 5
        const clamped = Math.min(Math.max(zoomLevel, min), max)
        await videoTrack.applyConstraints({
          // @ts-expect-error zoom is supported in modern browsers on mobile MediaStreamTrack
          advanced: [{ zoom: clamped }],
        })
        return true
      }
    } catch {
      // Zoom constraint unsupported or failed
    }
    return false
  }

  async startCaller(calleeId: string, kind: 'video' | 'voice', callerProfile: { name: string; initials: string; color: string }) {
    if (!database) throw new Error('Realtime Database is not configured for calling.')
    if (this.closed) return null
    const callRef = push(ref(database, 'calls'))
    this.callRefPath = callRef.key ? `calls/${callRef.key}` : undefined
    if (!this.callRefPath) return null
    const callerId = auth?.currentUser?.uid
    if (!callerId) throw new Error('Authentication is not ready.')
    this.calleeId = calleeId
    await set(callRef, { callerId, calleeId, kind, callerProfile, createdAt: Date.now(), state: 'ringing' satisfies CallState })
    if (this.closed) return callRef.key
    await onDisconnect(child(callRef, 'state')).set('ended')
    await onDisconnect(child(callRef, 'endedAt')).set(serverTimestamp())
    this.watchCallState(callRef)
    this.ringTimer = window.setTimeout(() => this.terminate(true), CALL_RING_TIMEOUT_MS)
    if (this.closed) return callRef.key
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        const sanitized = sanitizeCandidate(event.candidate.toJSON())
        void set(push(child(callRef, 'callerCandidates')), sanitized).catch(() => undefined)
      }
    }
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: kind === 'video',
    })
    const optimizedOffer: RTCSessionDescriptionInit = {
      type: offer.type,
      sdp: offer.sdp ? optimizeSdp(offer.sdp) : offer.sdp,
    }
    await this.pc.setLocalDescription(optimizedOffer)
    if (this.closed) return callRef.key
    await set(child(callRef, 'offer'), optimizedOffer)
    this.disposers.push(onValue(child(callRef, 'answer'), async (snapshot) => {
      if (this.closed) return
      const value = snapshot.val()
      if (value && (!this.pc.currentRemoteDescription || this.pc.signalingState === 'have-local-offer')) {
        try { await this.setRemoteDescription(value) } catch { this.notifyCallEnded() }
      }
    }))
    this.disposers.push(onChildAdded(child(callRef, 'calleeCandidates'), async (snapshot) => {
      if (snapshot.val()) await this.addRemoteCandidate(snapshot.val() as RTCIceCandidateInit)
    }))
    this.startConnectionWatchdog()
    this.startStats()
    const incomingRef = ref(database, `incomingCalls/${calleeId}/${callRef.key}`)
    await set(incomingRef, { callId: callRef.key, callerId, calleeId, kind, callerProfile, createdAt: Date.now(), state: 'ringing' })
    await onDisconnect(incomingRef).remove()
    return callRef.key
  }

  async acceptCallee(callId: string) {
    if (!database) throw new Error('Realtime Database is not configured for calling.')
    if (this.closed) return
    const callRef = ref(database, `calls/${callId}`)
    this.callRefPath = `calls/${callId}`
    await onDisconnect(child(callRef, 'state')).set('ended')
    await onDisconnect(child(callRef, 'endedAt')).set(serverTimestamp())
    this.watchCallState(callRef)
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        const sanitized = sanitizeCandidate(event.candidate.toJSON())
        void set(push(child(callRef, 'calleeCandidates')), sanitized).catch(() => undefined)
      }
    }
    const offer = await this.waitForOffer(callRef)
    if (this.closed) return
    await this.setRemoteDescription(offer)
    const answer = await this.pc.createAnswer()
    const optimizedAnswer: RTCSessionDescriptionInit = {
      type: answer.type,
      sdp: answer.sdp ? optimizeSdp(answer.sdp) : answer.sdp,
    }
    await this.pc.setLocalDescription(optimizedAnswer)
    if (this.closed) return
    await set(child(callRef, 'answer'), optimizedAnswer)
    if (this.closed) return
    // Transition only the authorized state child. A transaction on the whole
    // call record is rejected by the RTDB rules because the callee must not be
    // able to rewrite caller identity, SDP, or candidate data while accepting.
    const accepted = await runTransaction(child(callRef, 'state'), (current) => {
      const state = current as CallState | null
      if (state === 'accepted') return state
      if (!state || !canTransitionCallState(state, 'accepted')) return
      return 'accepted'
    })
    if (this.closed) return
    const acceptedState = accepted.snapshot.val() as CallState | null
    if (!accepted.committed || acceptedState !== 'accepted') {
      this.notifyCallEnded()
      return
    }
    this.calleeId = auth?.currentUser?.uid
    if (this.calleeId) await remove(ref(database, `incomingCalls/${this.calleeId}/${callId}`))
    this.disposers.push(onChildAdded(child(callRef, 'callerCandidates'), async (snapshot) => {
      if (snapshot.val()) await this.addRemoteCandidate(snapshot.val() as RTCIceCandidateInit)
    }))
    this.disposers.push(onValue(child(callRef, 'offer'), async (snapshot) => {
      if (this.closed) return
      const updatedOffer = snapshot.val() as RTCSessionDescriptionInit | null
      if (updatedOffer && this.pc.signalingState === 'stable' && updatedOffer.sdp && updatedOffer.sdp !== this.pc.remoteDescription?.sdp) {
        try {
          await this.setRemoteDescription(updatedOffer)
          const newAnswer = await this.pc.createAnswer()
          const opt: RTCSessionDescriptionInit = {
            type: newAnswer.type,
            sdp: newAnswer.sdp ? optimizeSdp(newAnswer.sdp) : newAnswer.sdp,
          }
          await this.pc.setLocalDescription(opt)
          if (!this.closed && database) {
            await set(child(callRef, 'answer'), opt)
          }
        } catch {
          // ignore non-fatal renegotiation error
        }
      }
    }))
    this.startConnectionWatchdog()
    this.startStats()
  }

  private async waitForOffer(callRef: ReturnType<typeof ref>) {
    return new Promise<RTCSessionDescriptionInit>((resolve, reject) => {
      let settled = false
      const subscriptions: { offer?: Unsubscribe; state?: Unsubscribe } = {}
      const timeout = window.setTimeout(() => finishReject(new Error('The call offer was not received in time.')), CALL_RING_TIMEOUT_MS)
      const cleanup = () => {
        window.clearTimeout(timeout)
        subscriptions.offer?.()
        subscriptions.state?.()
      }
      const finishResolve = (offer: RTCSessionDescriptionInit) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(offer)
      }
      const finishReject = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      subscriptions.offer = onValue(child(callRef, 'offer'), (snapshot) => {
        if (this.closed) return finishReject(new Error('Call has already ended.'))
        const offer = snapshot.val()
        if (offer && typeof offer === 'object') finishResolve(offer as RTCSessionDescriptionInit)
      })
      subscriptions.state = onValue(child(callRef, 'state'), (snapshot) => {
        const state = snapshot.val() as CallState | null
        if (!snapshot.exists() || state === 'ended' || state === 'declined') finishReject(new Error('The caller ended the call.'))
      })
    })
  }

  private async setRemoteDescription(description: RTCSessionDescriptionInit) {
    const optimized: RTCSessionDescriptionInit = {
      type: description.type,
      sdp: description.sdp ? optimizeSdp(description.sdp) : description.sdp,
    }
    await this.pc.setRemoteDescription(optimized)
    this.remoteDescriptionReady = true
    const candidates = this.pendingRemoteCandidates.splice(0)
    for (const candidate of candidates) {
      try { await this.pc.addIceCandidate(candidate) } catch { /* ignore non-fatal */ }
    }
  }

  private async addRemoteCandidate(candidate: RTCIceCandidateInit) {
    if (this.closed || !candidate?.candidate) return
    const sanitized = sanitizeCandidate(candidate)
    if (!this.remoteDescriptionReady) {
      this.pendingRemoteCandidates.push(sanitized)
      return
    }
    try {
      await this.pc.addIceCandidate(sanitized)
    } catch {
      // Non-fatal: individual candidate mismatches or late arrivals shouldn't end the call
    }
  }

  private watchCallState(callRef: ReturnType<typeof ref>) {
    this.disposers.push(onValue(child(callRef, 'state'), (snapshot) => {
      if (this.closed) return
      const state = snapshot.val() as CallState | null
      if (!snapshot.exists() || state === 'declined' || state === 'ended') {
        this.notifyCallEnded()
      } else if (state === 'accepted') {
        if (this.ringTimer) {
          window.clearTimeout(this.ringTimer)
          this.ringTimer = undefined
        }
        this.onConnected?.()
      }
    }))
  }

  private notifyCallEnded() {
    if (this.closed || this.endedNotified) return
    this.endedNotified = true
    this.onCallEnded?.()
  }

  private scheduleDisconnectCheck() {
    if (this.disconnectTimer) window.clearTimeout(this.disconnectTimer)
    this.disconnectTimer = window.setTimeout(() => {
      if (!this.closed && (this.pc.connectionState === 'disconnected' || this.pc.iceConnectionState === 'disconnected')) {
        this.notifyCallEnded()
      }
    }, 25_000)
  }

  private clearDisconnectTimer() {
    if (!this.disconnectTimer) return
    window.clearTimeout(this.disconnectTimer)
    this.disconnectTimer = undefined
  }

  private startConnectionWatchdog() {
    if (this.connectionTimer) window.clearTimeout(this.connectionTimer)
    this.connectionTimer = window.setTimeout(() => {
      if (!this.closed && this.pc.connectionState !== 'connected' && this.pc.iceConnectionState !== 'connected' && this.pc.iceConnectionState !== 'completed') this.notifyCallEnded()
    }, 30_000)
  }

  private clearConnectionTimer() {
    if (!this.connectionTimer) return
    window.clearTimeout(this.connectionTimer)
    this.connectionTimer = undefined
  }

  private startStats() {
    this.statsTimer = window.setInterval(async () => {
      if (this.closed) return
      let reports: RTCStatsReport
      try { reports = await this.pc.getStats() } catch { return }
      let timestamp = Date.now()
      let packetsLost = 0
      let packetsReceived = 0
      let rtt = 0
      let hasVideo = false
      let videoBytes = 0
      let audioBytes = 0

      reports.forEach((report) => {
        if (report.type === 'outbound-rtp') {
          if (report.kind === 'video') {
            hasVideo = true
            videoBytes = report.bytesSent ?? videoBytes
            timestamp = report.timestamp ?? timestamp
          } else if (report.kind === 'audio') {
            audioBytes = report.bytesSent ?? audioBytes
            timestamp = report.timestamp ?? timestamp
          }
        }
        if (report.type === 'remote-inbound-rtp') {
          packetsLost += report.packetsLost ?? 0
          rtt = Math.max(rtt, (report.roundTripTime ?? 0) * 1000)
        }
        if (report.type === 'inbound-rtp') {
          packetsReceived += report.packetsReceived ?? 0
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          rtt = Math.max(rtt, (report.currentRoundTripTime ?? 0) * 1000)
        }
      })

      const bytes = hasVideo ? videoBytes : audioBytes
      const elapsed = Math.max(1, timestamp - this.lastStatsAt)
      const bitrate = this.lastStatsAt ? Math.max(0, ((bytes - this.lastBytes) * 8 * 1000) / elapsed) : 0
      this.lastBytes = bytes
      this.lastStatsAt = timestamp
      const packetLoss = packetsLost / Math.max(1, packetsLost + packetsReceived)
      this.onStats?.({ label: classifyNetwork(rtt, packetLoss, bitrate, hasVideo), rtt, packetLoss, bitrate, mode: 'auto' })
    }, 2500)
  }

  terminate(notifyPeer = true) {
    if (this.closed) return
    const callRefPath = this.callRefPath
    if (notifyPeer && database && callRefPath) {
      const callRef = ref(database, callRefPath)
      void set(child(callRef, 'state'), 'ended')
        .then(() => set(child(callRef, 'endedAt'), serverTimestamp()))
        .catch(() => undefined)
    }
    this.cleanup(callRefPath)
  }

  stop() { this.terminate(false) }

  private cleanup(callRefPath?: string) {
    if (this.closed) return
    this.closed = true
    if (this.ringTimer) window.clearTimeout(this.ringTimer)
    if (this.disconnectTimer) window.clearTimeout(this.disconnectTimer)
    if (this.connectionTimer) window.clearTimeout(this.connectionTimer)
    if (this.statsTimer) window.clearInterval(this.statsTimer)
    if (this.cleanupTimer) window.clearTimeout(this.cleanupTimer)
    this.disposers.forEach((dispose) => dispose())
    this.disposers.length = 0
    this.pc.onconnectionstatechange = null
    this.pc.onicecandidate = null
    this.pc.oniceconnectionstatechange = null
    this.pc.ontrack = null
    if (this.controlChannel) {
      try { this.controlChannel.close() } catch { /* ignore */ }
      this.controlChannel = undefined
    }
    this.pendingRemoteCandidates = []
    this.localStream?.getTracks().forEach((track) => track.stop())
    if (this.screenTrack && !this.localStream?.getTracks().includes(this.screenTrack)) this.screenTrack.stop()
    this.remoteStream.getTracks().forEach((track) => {
      track.stop()
      this.remoteStream.removeTrack(track)
    })
    if (this.pc.signalingState !== 'closed') this.pc.close()
    if (database && callRefPath) {
      const callId = callRefPath.split('/')[1]
      const callRef = ref(database, callRefPath)
      void onDisconnect(child(callRef, 'state')).cancel().catch(() => undefined)
      void onDisconnect(child(callRef, 'endedAt')).cancel().catch(() => undefined)
      if (this.calleeId) {
        const incomingRef = ref(database, `incomingCalls/${this.calleeId}/${callId}`)
        void onDisconnect(incomingRef).cancel().catch(() => undefined)
        void remove(incomingRef).catch(() => undefined)
      }
      this.cleanupTimer = window.setTimeout(() => {
        if (database) void remove(ref(database, callRefPath)).catch(() => undefined)
      }, CALL_RECORD_RETENTION_MS)
    }
  }
}
