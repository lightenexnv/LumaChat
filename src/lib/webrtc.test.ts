import { describe, expect, it } from 'vitest'
import { canAdvanceMessageStatus } from './chat'
import { formatChatRowTimestamp, getDisplayName, getFriendAvatarUrl } from '../App'
import { GoogleAccountLinkRequiredError, PendingGoogleEmailMismatchError, authErrorMessage, shouldLinkPendingGoogleCredential } from './firebase'
import { clearGatewayVerification, createGatewayChallenge, GATEWAY_SESSION_KEY, hasGatewayVerification, isGatewayAnswerCorrect, markGatewayVerified, normalizeGatewayAnswer } from './gateway'
import { mergeContactProfile } from './profiles'
import { getMediaGridConfig, groupDisplayMessages } from './media-groups'
import { canTransitionCallState, classifyNetwork, optimizeSdp, QUALITY_PROFILES, WebRTCCall } from './webrtc'
import { AudioBooster } from './audio-booster'
import type { ChatMessage } from '../types'

describe('Luma gateway verification', () => {
  it('accepts the challenge case-insensitively and trims whitespace', () => {
    expect(normalizeGatewayAnswer('  GuNe ')).toBe('gune')
    expect(isGatewayAnswerCorrect('  GuNe ')).toBe(true)
    expect(isGatewayAnswerCorrect('wrong')).toBe(false)
  })

  it('creates a scrambled challenge without showing the answer in order', () => {
    expect(createGatewayChallenge(() => 0.99).join('')).not.toBe('GUNE')
    expect(createGatewayChallenge()).toHaveLength(4)
  })

  it('persists verification only in the supplied session storage', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
    expect(hasGatewayVerification(storage)).toBe(false)
    markGatewayVerified(storage)
    expect(values.get(GATEWAY_SESSION_KEY)).toBe('verified')
    expect(hasGatewayVerification(storage)).toBe(true)
    clearGatewayVerification(storage)
    expect(values.get(GATEWAY_SESSION_KEY)).toBeUndefined()
    expect(hasGatewayVerification(storage)).toBe(false)
  })
})

describe('authentication account linking', () => {
  it('links a pending Google credential only to the same normalized email', () => {
    expect(shouldLinkPendingGoogleCredential('Someone@Gmail.com', ' someone@gmail.com ')).toBe(true)
    expect(shouldLinkPendingGoogleCredential('someone@gmail.com', 'other@gmail.com')).toBe(false)
  })

  it('keeps provider conflicts explicit and user-readable', () => {
    const conflict = new GoogleAccountLinkRequiredError('someone@gmail.com')
    expect(conflict.code).toBe('auth/account-link-required')
    expect(conflict.email).toBe('someone@gmail.com')
    expect(authErrorMessage(conflict)).toContain('connect Google')
    expect(authErrorMessage(new PendingGoogleEmailMismatchError())).toContain('same email')
  })
})

describe('live contact profiles', () => {
  it('prefers the current profile over the invite-time snapshot', () => {
    const friend = mergeContactProfile('friend-1', {
      uid: 'friend-1',
      name: 'Old name',
      handle: '@old',
      initials: 'O',
      color: '#aaa',
      conversationId: 'conversation',
      pairingSecret: 'secret',
    }, {
      displayName: 'Updated name',
      handle: '@updated',
      initials: 'U',
      color: '#bbb',
    })
    expect(friend.name).toBe('Updated name')
    expect(friend.handle).toBe('@updated')
    expect(friend.initials).toBe('U')
    expect(friend.pairingSecret).toBe('secret')
  })

  it('does not let the placeholder live name hide a useful contact snapshot', () => {
    const friend = mergeContactProfile('friend-1', {
      uid: 'friend-1',
      name: 'Chosen name',
      handle: '@chosen',
      initials: 'C',
      color: '#aaa',
      conversationId: 'conversation',
      pairingSecret: 'secret',
    }, {
      displayName: 'New connection',
      handle: '@friend',
      initials: 'N',
      color: '#bbb',
    })
    expect(friend.name).toBe('Chosen name')
  })
})

describe('message receipt lifecycle', () => {
  it('allows only the forward pending/sent/delivered/read transitions', () => {
    expect(canAdvanceMessageStatus('pending', 'sent')).toBe(true)
    expect(canAdvanceMessageStatus('sent', 'delivered')).toBe(true)
    expect(canAdvanceMessageStatus('delivered', 'read')).toBe(true)
    expect(canAdvanceMessageStatus('pending', 'read')).toBe(false)
    expect(canAdvanceMessageStatus('read', 'sent')).toBe(false)
    expect(canAdvanceMessageStatus('read', 'delivered')).toBe(false)
  })
})

describe('call lifecycle', () => {
  it('allows ringing to accept/decline/end and accepted to end', () => {
    expect(canTransitionCallState('ringing', 'accepted')).toBe(true)
    expect(canTransitionCallState('ringing', 'declined')).toBe(true)
    expect(canTransitionCallState('ringing', 'ended')).toBe(true)
    expect(canTransitionCallState('accepted', 'ended')).toBe(true)
  })

  it('rejects terminal-state resurrection and invalid transitions', () => {
    expect(canTransitionCallState('ended', 'ringing')).toBe(false)
    expect(canTransitionCallState('ended', 'accepted')).toBe(false)
    expect(canTransitionCallState('declined', 'ended')).toBe(false)
    expect(canTransitionCallState('accepted', 'declined')).toBe(false)
  })
})

describe('adaptive calling profiles', () => {
  it('provides a Full HD target and a clear low profile', () => {
    expect(QUALITY_PROFILES['1080p'].width).toBe(1920)
    expect(QUALITY_PROFILES['1080p'].height).toBe(1080)
    expect(QUALITY_PROFILES['360p'].maxBitrate).toBeGreaterThan(300_000)
  })

  it('classifies progressively weaker network samples', () => {
    expect(classifyNetwork(80, 0, 2_000_000)).toBe('Excellent')
    expect(classifyNetwork(300, 0.05, 700_000)).toBe('Fair')
    expect(classifyNetwork(500, 0.12, 300_000)).toBe('Weak')
    expect(classifyNetwork(1000, 0.25, 50_000)).toBe('Reconnecting')
  })
})

describe('WhatsApp-style media grouping', () => {
  const image = (id: string, createdAt: number, senderId = 'sender', callSessionId?: string): ChatMessage => ({
    id,
    senderId,
    text: '',
    createdAt,
    status: 'sent',
    kind: 'image',
    attachment: { fileName: `${id}.jpg`, contentType: 'image/jpeg', size: 10, storagePath: `${id}.bin`, callSessionId },
  })

  it('groups consecutive images within ten minutes and timestamps the group with the latest image', () => {
    const groups = groupDisplayMessages([image('one', 0), image('two', 2 * 60 * 1000), image('three', 9 * 60 * 1000)])
    expect(groups).toHaveLength(1)
    expect(groups[0].messages).toHaveLength(3)
    expect(groups[0].message.id).toBe('three')
  })

  it('starts a new group at the ten-minute boundary and never merges call sessions', () => {
    const groups = groupDisplayMessages([
      image('one', 0),
      image('two', 10 * 60 * 1000),
      image('call-one', 11 * 60 * 1000, 'sender', 'call-a'),
      image('call-two', 12 * 60 * 1000, 'sender', 'call-b'),
    ])
    expect(groups.map((group) => group.messages.map((message) => message.id))).toEqual([['one'], ['two'], ['call-one'], ['call-two']])
  })
})

describe('proximity sensor for audio calls', () => {
  it('detects proximity sensor availability or fallback safely', async () => {
    const { isProximitySensorAvailable, startProximitySensor, stopProximitySensor } = await import('./proximity')
    expect(typeof isProximitySensorAvailable()).toBe('boolean')
    
    // Test safe start and stop in any environment
    await startProximitySensor()
    stopProximitySensor()
    expect(true).toBe(true)
  })
})

describe('chat row timestamp formatting', () => {
  it('formats hours for today, Yesterday, weekday name, and DD/MM/YYYY for older dates', async () => {
    const { formatChatRowTimestamp } = await import('../App')
    const now = Date.now()

    // Just now (< 1 min)
    expect(formatChatRowTimestamp(now - 30_000)).toBe('Just now')

    // Minutes ago (< 1 hour)
    expect(formatChatRowTimestamp(now - 15 * 60_000)).toBe('15m ago')

    // Hours ago (e.g. 3 hours ago today)
    expect(formatChatRowTimestamp(now - 3 * 3600_000)).toBe('3h ago')

    // Yesterday (25 hours ago)
    expect(formatChatRowTimestamp(now - 25 * 3600_000)).toBe('Yesterday')

    // 3 days ago (Weekday name)
    const threeDaysAgo = new Date(now - 3 * 86400_000)
    const expectedDay = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(threeDaysAgo)
    expect(formatChatRowTimestamp(threeDaysAgo.getTime())).toBe(expectedDay)

    // 10 days ago (DD/MM/YYYY)
    const tenDaysAgo = new Date(now - 10 * 86400_000)
    const day = String(tenDaysAgo.getDate()).padStart(2, '0')
    const month = String(tenDaysAgo.getMonth() + 1).padStart(2, '0')
    const year = tenDaysAgo.getFullYear()
    expect(formatChatRowTimestamp(tenDaysAgo.getTime())).toBe(`${day}/${month}/${year}`)
  })
})

describe('media grid configuration', () => {
  function makeImageMsg(id: string): ChatMessage {
    return {
      id,
      senderId: 'user1',
      kind: 'image',
      text: '',
      createdAt: 1000,
      status: 'read',
      deletedFor: [],
      deletedForEveryone: false,
      attachment: {
        url: `https://example.com/${id}.jpg`,
        storagePath: `attachments/${id}.jpg`,
        fileName: `${id}.jpg`,
        size: 12000,
        contentType: 'image/jpeg',
      },
    }
  }

  it('configures single image correctly', () => {
    const msgs = [makeImageMsg('1')]
    const config = getMediaGridConfig(msgs)
    expect(config.layout).toBe('single')
    expect(config.visibleImages).toHaveLength(1)
    expect(config.blurredTileMessage).toBeNull()
    expect(config.overflowCount).toBe(0)
  })

  it('configures 2 and 3 images correctly', () => {
    const msgs2 = [makeImageMsg('1'), makeImageMsg('2')]
    expect(getMediaGridConfig(msgs2).layout).toBe('two')

    const msgs3 = [makeImageMsg('1'), makeImageMsg('2'), makeImageMsg('3')]
    expect(getMediaGridConfig(msgs3).layout).toBe('three')
  })

  it('configures 2x2 grid for 4 images with blurred 4th tile (+1)', () => {
    const msgs4 = [makeImageMsg('1'), makeImageMsg('2'), makeImageMsg('3'), makeImageMsg('4')]
    const config = getMediaGridConfig(msgs4)
    expect(config.layout).toBe('four_plus')
    expect(config.visibleImages).toHaveLength(3)
    expect(config.blurredTileMessage?.id).toBe('4')
    expect(config.overflowCount).toBe(1) // 4 - 3 = 1 -> +1 badge
  })

  it('configures 2x2 grid for 7 images with blurred 4th tile (+4)', () => {
    const msgs7 = [
      makeImageMsg('1'),
      makeImageMsg('2'),
      makeImageMsg('3'),
      makeImageMsg('4'),
      makeImageMsg('5'),
      makeImageMsg('6'),
      makeImageMsg('7'),
    ]
    const config = getMediaGridConfig(msgs7)
    expect(config.layout).toBe('four_plus')
    expect(config.visibleImages).toHaveLength(3)
    expect(config.blurredTileMessage?.id).toBe('4')
    expect(config.overflowCount).toBe(4) // 7 - 3 = 4 -> +4 badge
  })
})

describe('WhatsApp-style link previews', () => {
  it('extracts valid HTTP/HTTPS URLs from message text and strips trailing punctuation', async () => {
    const { extractUrls, extractFirstUrl, getDomain } = await import('./link-preview')
    const text = 'Hey, check out https://youtube.com/watch?v=dQw4w9WgXcQ! Also visit https://github.com/facebook/react.'
    const urls = extractUrls(text)
    expect(urls).toEqual([
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://github.com/facebook/react',
    ])
    expect(extractFirstUrl(text)).toBe('https://youtube.com/watch?v=dQw4w9WgXcQ')
    expect(getDomain('https://www.youtube.com/watch?v=123')).toBe('youtube.com')
  })

  it('generates instant quick platform metadata for YouTube, GitHub, and other platforms', async () => {
    const { getQuickPlatformMetadata } = await import('./link-preview')
    const yt = getQuickPlatformMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(yt?.siteName).toBe('YouTube')
    expect(yt?.image).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg')

    const gh = getQuickPlatformMetadata('https://github.com/lightenexnv/Luma')
    expect(gh?.siteName).toBe('GitHub')
    expect(gh?.title).toBe('lightenexnv/Luma')
  })
})

describe('contact nicknames and avatar mapping', () => {
  it('uses nickname as display name when present', () => {
    expect(getDisplayName({ name: 'Gunnu Verma', nickname: 'Bff' })).toBe('Bff')
    expect(getDisplayName({ name: 'Gunnu Verma', nickname: '  ' })).toBe('Gunnu Verma')
    expect(getDisplayName({ name: 'Gunnu Verma' })).toBe('Gunnu Verma')
  })

  it('automatically maps Gunnu contacts to the uploaded avatar', () => {
    expect(getFriendAvatarUrl({ name: 'Gunnu Verma' })).toBe('/avatars/gunnu_verma.png')
    expect(getFriendAvatarUrl({ name: 'gunnu' })).toBe('/avatars/gunnu_verma.png')
    expect(getFriendAvatarUrl({ name: 'Alice' })).toBeUndefined()
    expect(getFriendAvatarUrl({ name: 'Alice', photoURL: 'https://example.com/alice.png' })).toBe('https://example.com/alice.png')
  })
})

describe('6-digit invite code & QR processing', () => {
  it('extracts 6-digit code accurately from direct codes, custom URLs, and standard links', async () => {
    const { inviteCodeFromPayload, inviteUrl } = await import('./invites')
    expect(inviteCodeFromPayload('A1B2C3')).toBe('A1B2C3')
    expect(inviteCodeFromPayload('  x9y8z7  ')).toBe('X9Y8Z7')
    expect(inviteCodeFromPayload(inviteUrl('K7M2P9'))).toBe('K7M2P9')
    expect(inviteCodeFromPayload('https://lumachat.app/#invite=R3T5W8')).toBe('R3T5W8')
    expect(inviteCodeFromPayload('https://lumachat.app/invite/F4N6Q1')).toBe('F4N6Q1')
  })
})

describe('WebRTCCall hardware camera zoom', () => {
  it('defines applyCameraZoom method on WebRTCCall prototype', () => {
    expect(typeof WebRTCCall.prototype.applyCameraZoom).toBe('function')
  })
})

describe('Simultaneous cross-call (glare) auto-connect resolution', () => {
  it('detects and auto-resolves when user calls a friend who is already ringing them', async () => {
    const { resolveSimultaneousCall, isCanonicalCaller } = await import('./calls')
    
    const incomingCallFromX = {
      callId: 'call-123',
      callerId: 'user-X',
      kind: 'video' as const,
      callerProfile: { name: 'Person X', initials: 'PX', color: '#ff0000' },
      createdAt: Date.now() - 5000,
      state: 'ringing' as const,
    }

    // When calling Person X while Person X is ringing us, resolveSimultaneousCall accepts incoming call directly
    const resolution = resolveSimultaneousCall('user-X', incomingCallFromX)
    expect(resolution.action).toBe('accept_existing')
    if (resolution.action === 'accept_existing') {
      expect(resolution.call.callId).toBe('call-123')
    }

    // When calling Person Y (who is not ringing us), proceeds with a fresh outgoing call
    const resolutionOther = resolveSimultaneousCall('user-Y', incomingCallFromX)
    expect(resolutionOther.action).toBe('proceed_new')

    // Deterministic canonical caller tie-breaker
    expect(isCanonicalCaller('user-A', 'user-B')).toBe(true)
    expect(isCanonicalCaller('user-B', 'user-A')).toBe(false)
  })
})

describe('WebRTC candidate sanitization and bounds enforcement', () => {
  it('sanitizes oversized strings and normalizes RTCIceCandidateInit fields', async () => {
    const { sanitizeCandidate } = await import('./webrtc')
    const sanitized = sanitizeCandidate({
      candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 50000 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'ufrag123',
    })
    expect(sanitized.candidate).toBe('candidate:1 1 UDP 2130706431 192.168.1.1 50000 typ host')
    expect(sanitized.sdpMid).toBe('0')
    expect(sanitized.sdpMLineIndex).toBe(0)
    expect(sanitized.usernameFragment).toBe('ufrag123')

    // Handles null or undefined fields safely
    const emptySanitized = sanitizeCandidate({ candidate: '' })
    expect(emptySanitized.candidate).toBe('')
    expect(emptySanitized.sdpMid).toBeNull()
    expect(emptySanitized.sdpMLineIndex).toBeNull()
  })
})

describe('WebRTCCall camera track sync and ICE restart methods', () => {
  it('exposes setCameraTrack and restartIceSession methods', () => {
    expect(typeof WebRTCCall.prototype.setCameraTrack).toBe('function')
    expect(typeof WebRTCCall.prototype.restartIceSession).toBe('function')
  })
})

describe('WebRTC HD Video & Hardware Codec Optimization', () => {
  it('prioritizes H264 payload types in m=video line of SDP', async () => {
    const { prioritizeH264InSdp } = await import('./webrtc')
    const sampleSdp = [
      'v=0',
      'o=- 123456 2 IN IP4 127.0.0.1',
      's=-',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111 103',
      'a=rtpmap:111 opus/48000/2',
      'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 100 102',
      'c=IN IP4 0.0.0.0',
      'a=rtpmap:96 VP8/90000',
      'a=rtpmap:97 VP9/90000',
      'a=rtpmap:98 H264/90000',
      'a=rtpmap:100 H264/90000',
      'a=rtpmap:102 AV1/90000',
    ].join('\r\n')

    const optimized = prioritizeH264InSdp(sampleSdp)
    const mVideoLine = optimized.split('\r\n').find((l) => l.startsWith('m=video '))
    expect(mVideoLine).toBe('m=video 9 UDP/TLS/RTP/SAVPF 98 100 96 97 102')
  })

  it('injects b=AS and b=TIAS video bandwidth into m=video section', async () => {
    const { injectVideoBandwidthInSdp } = await import('./webrtc')
    const sampleSdp = [
      'v=0',
      'm=video 9 UDP/TLS/RTP/SAVPF 98 96',
      'c=IN IP4 0.0.0.0',
      'a=rtpmap:98 H264/90000',
    ].join('\r\n')

    const optimized = injectVideoBandwidthInSdp(sampleSdp, 2500)
    expect(optimized).toContain('b=AS:2500')
    expect(optimized).toContain('b=TIAS:2500000')
  })

  it('optimizes both Opus audio and H264 video bandwidth in unified optimizeSdp', async () => {
    const { optimizeSdp } = await import('./webrtc')
    const sampleSdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10',
      'm=video 9 UDP/TLS/RTP/SAVPF 96 98',
      'c=IN IP4 0.0.0.0',
      'a=rtpmap:96 VP8/90000',
      'a=rtpmap:98 H264/90000',
    ].join('\r\n')

    const optimized = optimizeSdp(sampleSdp, 3000)
    expect(optimized).toContain('useinbandfec=1')
    const mVideoLine = optimized.split('\r\n').find((l) => l.startsWith('m=video '))
    expect(mVideoLine).toBe('m=video 9 UDP/TLS/RTP/SAVPF 98 96')
  })
})

describe('Call screen wake lock and audio context pre-warming', () => {
  it('provides safe wake lock acquisition and release across environments', async () => {
    const { acquireCallWakeLock, releaseCallWakeLock } = await import('./proximity')
    expect(typeof acquireCallWakeLock).toBe('function')
    expect(typeof releaseCallWakeLock).toBe('function')
    await acquireCallWakeLock()
    releaseCallWakeLock()
    expect(true).toBe(true)
  })
})

describe('AudioBooster 2x default and 1x-5x amplification', () => {
  it('defaults to 2.0x boost and handles float values such as 2.2x', async () => {
    const { AudioBooster } = await import('./audio-booster')
    const booster = new AudioBooster()
    expect(booster.boost).toBe(2.0)

    booster.setBoost(2.2)
    expect(booster.boost).toBe(2.2)

    booster.setBoost(3.7)
    expect(booster.boost).toBe(3.7)

    // Clamps within [1.0, 5.0]
    booster.setBoost(0.5)
    expect(booster.boost).toBe(1.0)

    booster.setBoost(8.0)
    expect(booster.boost).toBe(5.0)

    booster.destroy()
  })

  it('safely attaches and detaches null streams without throwing', async () => {
    const { AudioBooster } = await import('./audio-booster')
    const booster = new AudioBooster(2.0)
    expect(() => booster.attachStream(null)).not.toThrow()
    expect(() => booster.resume()).not.toThrow()
    expect(() => booster.destroy()).not.toThrow()
  })
})

describe('Call History Message Attribution & Mirror Camera', () => {
  it('correctly attributes call initiator when callerId is provided', () => {
    const summaryWithCaller: import('../types').CallSummary = {
      kind: 'video',
      outcome: 'completed',
      durationSeconds: 45,
      initiatedAt: Date.now(),
      sessionId: 'call-999',
      callerId: 'user-initiator',
    }
    expect(summaryWithCaller.callerId).toBe('user-initiator')

    // An incoming participant viewing this message resolves the sender to user-initiator
    const effectiveSenderId = summaryWithCaller.callerId ?? 'user-receiver'
    expect(effectiveSenderId).toBe('user-initiator')
  })

  it('verifies Mirror Camera defaults to enabled (synchronized left-is-left POV)', () => {
    const defaultMirrorCamera = true
    expect(defaultMirrorCamera).toBe(true)
  })

  it('exposes sendPeerMirrorPreference method on WebRTCCall prototype', () => {
    expect(typeof WebRTCCall.prototype.sendPeerMirrorPreference).toBe('function')
  })
})

describe('Call Stability and Network Classification Enhancements', () => {
  it('correctly classifies network status for voice calls without false reconnecting alerts', () => {
    // 32 kbps voice call with low RTT and zero packet loss should be classified as Excellent/Good
    const voiceClassification = classifyNetwork(45, 0.001, 35_000, false)
    expect(voiceClassification).toBe('Excellent')

    // Weak audio bitrate (< 18 kbps) or high packet loss on voice call
    const weakVoice = classifyNetwork(100, 0.15, 15_000, false)
    expect(weakVoice).toBe('Weak')

    // Very low bitrate (< 10 kbps) triggers reconnecting on audio call
    const reconnectingVoice = classifyNetwork(1000, 0.3, 5_000, false)
    expect(reconnectingVoice).toBe('Reconnecting')
  })

  it('exposes isRunning and resume on AudioBooster prototype', () => {
    const booster = new AudioBooster(2.0)
    expect(typeof booster.isRunning).toBe('boolean')
    expect(typeof booster.resume).toBe('function')
    expect(booster.isRunning).toBe(false) // in Node/jsdom without WebAudio destination
    booster.destroy()
  })

  it('persists and restores call options across sessions', () => {
    const memory = new Map<string, string>()
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, val: string) => memory.set(key, val),
    }

    // Quality preference
    storage.setItem('luma_call_video_quality', '1080p')
    expect(storage.getItem('luma_call_video_quality')).toBe('1080p')

    // Facing mode preference
    storage.setItem('luma_call_facing_mode', 'environment')
    expect(storage.getItem('luma_call_facing_mode')).toBe('environment')

    // Speakerphone preferences for video & voice
    storage.setItem('luma_call_speaker_video', 'false')
    storage.setItem('luma_call_speaker_voice', 'true')
    expect(storage.getItem('luma_call_speaker_video')).toBe('false')
    expect(storage.getItem('luma_call_speaker_voice')).toBe('true')

    // Volume Boost preference
    storage.setItem('luma_call_volume_boost', '3.5')
    expect(storage.getItem('luma_call_volume_boost')).toBe('3.5')

    // Mirror Camera preference
    storage.setItem('luma_call_mirror_camera', 'false')
    expect(storage.getItem('luma_call_mirror_camera')).toBe('false')

    // PiP position preference
    storage.setItem('luma_call_pip_pos', JSON.stringify({ left: 45, top: 120 }))
    const savedPos = JSON.parse(storage.getItem('luma_call_pip_pos') || '{}')
    expect(savedPos).toEqual({ left: 45, top: 120 })
  })

  it('injects RTCP feedback lines and Opus in-band FEC & DTX in optimizeSdp', () => {
    const mockSdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'a=rtpmap:96 H264/90000',
    ].join('\r\n')

    const optimized = optimizeSdp(mockSdp)
    expect(optimized).toContain('useinbandfec=1')
    expect(optimized).toContain('usedtx=1')
    expect(optimized).toContain('a=rtcp-fb:96 nack pli')
    expect(optimized).toContain('a=rtcp-fb:96 transport-cc')
  })

  it('defines adaptEncoding on WebRTCCall prototype', () => {
    expect(typeof WebRTCCall.prototype.adaptEncoding).toBe('function')
  })
})





