import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import {
  ArrowLeft, Ban, Bell, Calendar, Camera, CameraOff, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Clock3, Copy, Download, Eraser, Eye, EyeOff, FileText, Forward, Globe, Headphones, Heart, KeyRound, Maximize2,
  Image as ImageIcon, Info, LockKeyhole, LogOut, MapPin, MessageCircle, Mic, MicOff, MoreHorizontal, Palette, Pause, Pencil, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Pin, PinOff, Play,
  Plus, PictureInPicture, QrCode, RefreshCw, Reply, Search, Send, Share2, Shield, ShieldCheck, Sliders, Smile, Sparkles, Star, Trash2, Upload, UserRound, UserRoundCheck, UserX, Users, Video, VideoOff, Volume2, X, MonitorUp, FlipHorizontal,
} from 'lucide-react'
import type { Html5Qrcode as Html5QrcodeInstance } from 'html5-qrcode'
import { auth, authErrorMessage, completeGoogleRedirect, hasFirebaseConfig, hasPasswordProvider, linkEmailPasswordToCurrentUser, loginWithEmail, loginWithGoogle, logout, observeAuth, registerWithEmail } from './lib/firebase'
import { createConversation, deleteMessageForEveryone, deleteMessageForMe, editEncryptedChatMessage, forwardEncryptedMessage, markMessagesRead, pinConversationMessage, sendCallHistoryMessage, sendEncryptedChatMessage, sendEncryptedPayload, subscribeToChat, subscribeToConversation } from './lib/chat'
import { acceptInvite, createInvite, inviteUrl, subscribeOwnedInvites } from './lib/invites'
import { createPairingSecret } from './lib/crypto'
import { deleteContact, ensureUserProfile, saveUserProfile, subscribeContacts, updateContactSettings, type UserProfile } from './lib/profiles'
import { setPresence, subscribePresence } from './lib/presence'
import { declineIncomingCall as declineIncomingCallRecord, isCanonicalCaller, resolveSimultaneousCall, subscribeIncomingCalls, type IncomingCall } from './lib/calls'
import { QUALITY_PROFILES, WebRTCCall } from './lib/webrtc'
import { playIncomingMessageSound, startIncomingRingtone, stopIncomingRingtone, unlockAudioContext } from './lib/ringtone'
import { AudioBooster } from './lib/audio-booster'
import { processCallPhotoAsync } from './lib/image-processor'
import { removeAttachment, uploadEncryptedAttachment, uploadProfilePhoto } from './lib/storage'
import { acquireCallWakeLock, releaseCallWakeLock, startProximitySensor, stopProximitySensor } from './lib/proximity'
import { getMediaGridConfig, groupDisplayMessages } from './lib/media-groups'
import { extractFirstUrl, extractUrls, getDomain, useLinkPreview } from './lib/link-preview'
import { getNotificationPermission, isPushSupported, isStandalonePWA, registerServiceWorker, subscribeToPush, unsubscribeFromPush, updateAppBadge } from './lib/push'
import type { CallLogEntry, CallSummary, ChatMessage, Friend, MessageKind, MessageStatus, NetworkSnapshot, QualityMode, ReplyReference } from './types'
import GatewayScreen from './GatewayScreen'
import { clearGatewayVerification } from './lib/gateway'
import './styles.css'

export async function downloadAttachment(url: string, fileName: string) {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = fileName || 'download.jpg'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500)
  } catch {
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'download.jpg'
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
}

export async function downloadAllAttachments(attachments: NonNullable<ChatMessage['attachment']>[]) {
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i]
    if (att.url) {
      await downloadAttachment(att.url, att.fileName || `photo_${i + 1}.jpg`)
      if (i < attachments.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
  }
}

type View = 'home' | 'calls' | 'settings'
type CallKind = 'video' | 'voice'
type InviteMode = 'group' | 'create' | 'accept' | 'scan'
type AppTheme = 'light' | 'oled' | 'graphite' | 'midnight'
type MediaSendOptions = { callSessionId?: string; targetFriend?: Friend; isDocument?: boolean; messageId?: string }
type MediaKind = Extract<MessageKind, 'image' | 'video' | 'document' | 'audio'>
type MediaRetryJob = { file: File; forcedKind?: MediaKind; durationSeconds?: number; options: MediaSendOptions; targetFriend: Friend }

const qualityLabel: Record<QualityMode, string> = { auto: 'Auto', '1080p': 'Full HD', '720p': 'HD', '480p': 'Standard', '360p': 'Low', '240p': 'Data saver', audio: 'Audio only' }
const qualityModes: QualityMode[] = ['auto', '1080p', '720p', '480p', '360p', '240p', 'audio']
const formatTime = (timestamp: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp)
const formatLastSeen = (timestamp?: number) => {
  if (!timestamp || !Number.isFinite(timestamp)) return 'Last seen recently'
  const elapsed = Math.max(0, Date.now() - timestamp)
  if (elapsed < 60_000) return 'Last seen just now'
  if (elapsed < 3_600_000) return `Last seen ${Math.floor(elapsed / 60_000)} min ago`
  return `Last seen ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp)}`
}
export function formatChatRowTimestamp(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return ''
  const now = Date.now()
  const diff = Math.max(0, now - timestamp)
  const oneHour = 3600_000
  const oneDay = 86400_000
  const oneWeek = 7 * oneDay

  const msgDate = new Date(timestamp)
  const nowDate = new Date(now)

  const isToday = msgDate.toDateString() === nowDate.toDateString()
  const isYesterday = new Date(now - oneDay).toDateString() === msgDate.toDateString()

  // If within 24 hours / today: show hours (e.g. "2h ago" or "Just now" or "15m ago")
  if (isToday || diff < oneDay) {
    const hours = Math.floor(diff / oneHour)
    if (hours < 1) {
      const mins = Math.floor(diff / 60_000)
      return mins <= 1 ? 'Just now' : `${mins}m ago`
    }
    return `${hours}h ago`
  }

  // If yesterday
  if (isYesterday || diff < 2 * oneDay) {
    return 'Yesterday'
  }

  // If more than yesterday but less than a week: show weekday name (e.g. Thursday, Friday)
  if (diff < oneWeek) {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(msgDate)
  }

  // If more than a week: show date in DD/MM/YYYY
  const day = String(msgDate.getDate()).padStart(2, '0')
  const month = String(msgDate.getMonth() + 1).padStart(2, '0')
  const year = msgDate.getFullYear()
  return `${day}/${month}/${year}`
}
const formatDuration = (startedAt: number) => { const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }
const formatCallDuration = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
const messageId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`

function formatMessageDayHeader(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((today.getTime() - msgDate.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7 && diffDays > 1) return date.toLocaleDateString(undefined, { weekday: 'long' })
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

async function readMediaDimensions(file: File, kind: MessageKind) {
  if (kind !== 'image' && kind !== 'video') return {}
  const previewUrl = URL.createObjectURL(file)
  try {
    if (kind === 'image') {
      const image = new Image()
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => reject(new Error('The image dimensions could not be read.'))
        image.src = previewUrl
      })
      return dimensions
    }
    const video = document.createElement('video')
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight })
      video.onerror = () => reject(new Error('The video dimensions could not be read.'))
      video.preload = 'metadata'
      video.src = previewUrl
    })
    return dimensions
  } catch {
    return {}
  } finally {
    URL.revokeObjectURL(previewUrl)
  }
}

function LumaMark({ size = 'normal' }: { size?: 'small' | 'normal' | 'large' }) {
  return <div className={`stitch-luma-mark stitch-luma-mark-${size}`} aria-hidden="true"><MessageCircle /><span><i /><i /><i /></span></div>
}

export function getDisplayName(friend?: { name: string; nickname?: string } | null): string {
  if (!friend) return ''
  return friend.nickname?.trim() || friend.name
}

export function getFriendAvatarUrl(friend?: { name?: string; photoURL?: string } | null): string | undefined {
  if (!friend) return undefined
  if (friend.photoURL) return friend.photoURL
  if (friend.name && friend.name.toLowerCase().includes('gunnu')) return '/avatars/gunnu_verma.png'
  return undefined
}

function Avatar({ friend, size = 'normal' }: { friend: Pick<Friend, 'initials' | 'color'> & { photoURL?: string; name?: string; nickname?: string }; size?: 'small' | 'normal' | 'large' }) {
  const photo = getFriendAvatarUrl(friend)
  const initial = friend.nickname ? friend.nickname.slice(0, 1).toUpperCase() : friend.initials
  return (
    <div
      className={`stitch-avatar stitch-avatar-${size}`}
      style={{ '--avatar-color': friend.color } as CSSProperties}
    >
      {photo ? (
        <img
          src={photo}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', aspectRatio: '1 / 1', display: 'block' }}
        />
      ) : (
        initial
      )}
    </div>
  )
}

function AvatarPreviewModal({
  friend,
  onClose,
  onOpenChat,
  onVoiceCall,
  onVideoCall,
  onInfo,
}: {
  friend: Friend
  onClose: () => void
  onOpenChat: () => void
  onVoiceCall: () => void
  onVideoCall: () => void
  onInfo: () => void
}) {
  const photo = getFriendAvatarUrl(friend)
  const displayName = getDisplayName(friend)

  return (
    <div className="wa-sheet-backdrop" onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, background: 'rgba(0,0,0,0.6)' }}>
      <div
        className="wa-avatar-preview-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(280px, 80vw)',
          background: 'var(--bg-secondary)',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
          animation: 'avatar-pop 0.2s ease-out',
        }}
      >
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', background: friend.color || '#2C2C2E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button
            type="button"
            className="stitch-back-button wa-back-pill"
            onClick={onClose}
            aria-label="Close preview"
            style={{ position: 'absolute', top: 10, left: 10, zIndex: 10 }}
          >
            <ChevronLeft size={22} className="wa-back-chevron" />
          </button>
          {photo ? (
            <img
              src={photo}
              alt={displayName}
              style={{ width: '100%', height: '100%', objectFit: 'cover', aspectRatio: '1 / 1', display: 'block' }}
            />
          ) : (
            <span style={{ fontSize: 72, fontWeight: 700, color: '#fff' }}>{friend.nickname ? friend.nickname.slice(0, 1).toUpperCase() : friend.initials}</span>
          )}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              padding: '10px 14px 10px 54px',
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)',
              color: '#fff',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {displayName}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            padding: '8px 4px',
            background: 'var(--bg-secondary)',
            borderTop: '0.5px solid var(--separator)',
          }}
        >
          <button
            onClick={() => { onClose(); onOpenChat() }}
            style={{ background: 'none', border: 'none', color: 'var(--accent-green)', padding: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label="Message"
          >
            <MessageCircle size={22} />
          </button>
          <button
            onClick={() => { onClose(); onVoiceCall() }}
            style={{ background: 'none', border: 'none', color: 'var(--accent-green)', padding: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label="Audio call"
          >
            <Phone size={22} />
          </button>
          <button
            onClick={() => { onClose(); onVideoCall() }}
            style={{ background: 'none', border: 'none', color: 'var(--accent-green)', padding: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label="Video call"
          >
            <Video size={22} />
          </button>
          <button
            onClick={() => { onClose(); onInfo() }}
            style={{ background: 'none', border: 'none', color: 'var(--accent-green)', padding: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label="Info"
          >
            <Info size={22} />
          </button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [gatewayVerified, setGatewayVerified] = useState(() => {
    clearGatewayVerification()
    return false
  })
  const [authState, setAuthState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>(hasFirebaseConfig ? 'loading' : 'error')
  const [errorMessage, setErrorMessage] = useState(hasFirebaseConfig ? '' : 'Firebase is not configured. Add the required values to .env.local before running the app.')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [view, setView] = useState<View>('home')
  const [friends, setFriends] = useState<Friend[]>([])
  const [activeFriendId, setActiveFriendId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isInviteOpen, setInviteOpen] = useState(false)
  const [inviteMode, setInviteMode] = useState<InviteMode>('create')
  const [inviteCode, setInviteCode] = useState('')
  const [inviteInput, setInviteInput] = useState('')
  const [inviteQr, setInviteQr] = useState('')
  const [inviteExpiresAt, setInviteExpiresAt] = useState(0)
  const [toast, setToast] = useState('')
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => {
    return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  })
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)
  const [callPeer, setCallPeer] = useState<Friend | null>(null)
  const [callKind, setCallKind] = useState<CallKind | null>(null)
  const [callPhase, setCallPhase] = useState<'connecting' | 'connected'>('connecting')
  const [callStartedAt, setCallStartedAt] = useState(0)
  const [callElapsed, setCallElapsed] = useState('00:00')
  const [callLogs, setCallLogs] = useState<CallLogEntry[]>(() => {
    try {
      const raw = localStorage.getItem('luma.callLogs')
      const parsed = raw ? JSON.parse(raw) as CallLogEntry[] : []
      return Array.isArray(parsed) ? parsed.slice(0, 100) : []
    } catch {
      return []
    }
  })
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [quality, setQuality] = useState<QualityMode>(() => {
    try {
      const saved = localStorage.getItem('luma_call_video_quality') as QualityMode | null
      if (saved && (saved === 'auto' || saved === '1080p' || saved === '720p' || saved === '480p' || saved === '360p')) return saved
    } catch {
      /* ignore */
    }
    return 'auto'
  })
  const [effectiveQuality, setEffectiveQuality] = useState<QualityMode>(() => {
    try {
      const saved = localStorage.getItem('luma_call_video_quality') as QualityMode | null
      if (saved && saved !== 'auto' && (saved === '1080p' || saved === '720p' || saved === '480p' || saved === '360p')) return saved
    } catch {
      /* ignore */
    }
    return '720p'
  })
  const [network, setNetwork] = useState<NetworkSnapshot>({ label: 'Excellent', rtt: 0, packetLoss: 0, bitrate: 0, mode: 'auto' })
  const [muted, setMuted] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [speakerEnabled, setSpeakerEnabled] = useState(false)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(() => {
    try {
      const saved = localStorage.getItem('luma_call_facing_mode') as 'user' | 'environment' | null
      if (saved === 'user' || saved === 'environment') return saved
    } catch {
      /* ignore */
    }
    return 'user'
  })
  const [remoteMirrorMode, setRemoteMirrorMode] = useState<boolean>(true)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [isOnline, setOnline] = useState(navigator.onLine)
  const [showQualityMenu, setShowQualityMenu] = useState(false)
  const [showContactInfo, setShowContactInfo] = useState(false)
  const [friendSearch, setFriendSearch] = useState('')
  const [friendFilter, setFriendFilter] = useState<'all' | 'unread' | 'favourites' | 'groups'>('all')
  const [profileName, setProfileName] = useState('')
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia?.('(max-width: 899px)').matches ?? false)
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => document.visibilityState === 'visible')
  const [chatMenuFriend, setChatMenuFriend] = useState<Friend | null>(null)
  const [nicknameModalFriend, setNicknameModalFriend] = useState<Friend | null>(null)
  const [contactPickerOpen, setContactPickerOpen] = useState(false)
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [starredMessageIds, setStarredMessageIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('luma.starred')
      return new Set(raw ? JSON.parse(raw) as string[] : [])
    } catch {
      return new Set()
    }
  })
  const [statusMessage, setStatusMessage] = useState<string>(() => {
    try { return localStorage.getItem('luma.statusText') || 'Express yourself in emoji!' } catch { return 'Express yourself in emoji!' }
  })
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [showPrivacyModal, setShowPrivacyModal] = useState(false)
  const [showNotificationsModal, setShowNotificationsModal] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [showStarredModal, setShowStarredModal] = useState(false)
  const [showMediaGalleryModal, setShowMediaGalleryModal] = useState(false)
  const [showSecurityModal, setShowSecurityModal] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [previewAvatarFriend, setPreviewAvatarFriend] = useState<Friend | null>(null)
  const [lastMessages, setLastMessages] = useState<Record<string, { text: string; timestamp: number; status?: MessageStatus }>>(() => {
    try {
      const raw = localStorage.getItem('luma.lastMessages')
      return raw ? (JSON.parse(raw) as Record<string, { text: string; timestamp: number; status?: MessageStatus }>) : {}
    } catch {
      return {}
    }
  })
  const [inChatSearchOpen, setInChatSearchOpen] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')

  const [theme, setTheme] = useState<AppTheme>(() => {
    try {
      const stored = localStorage.getItem('luma.theme') as AppTheme | null
      if (stored === 'midnight') return 'oled'
      return stored ?? 'oled'
    } catch {
      return 'oled'
    }
  })
  const callRef = useRef<WebRTCCall | null>(null)
  const callMetaRef = useRef<{ role: 'caller' | 'callee'; friend: Friend; kind: CallKind; initiatedAt: number; connectedAt: number; sessionId?: string } | null>(null)
  const qualityRef = useRef<QualityMode>('auto')
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pendingMediaUrlsRef = useRef(new Map<string, string>())
  const pendingMediaJobsRef = useRef(new Map<string, MediaRetryJob>())
  const activeMediaUploadsRef = useRef(0)
  const mediaUploadQueueRef = useRef<Array<() => void>>([])
  const lastAutoQualityRef = useRef<QualityMode | null>(null)
  const endCallRef = useRef<() => void>(() => undefined)
  const initializedConversationsRef = useRef<Set<string>>(new Set())
  const seenMessageIdsRef = useRef<Set<string>>(new Set())
  const mountTimeRef = useRef<number>(Date.now())
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('luma.soundEnabled')
      return stored === null ? true : stored === 'true'
    } catch {
      return true
    }
  })
  const [previewEnabled, setPreviewEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('luma.previewEnabled')
      return stored === null ? true : stored === 'true'
    } catch {
      return true
    }
  })

  const activeFriend = useMemo(() => friends.find((friend) => friend.id === activeFriendId) ?? null, [activeFriendId, friends])
  const activeMessages = useMemo(() => {
    const loadedIds = new Set(messages.map((message) => message.id))
    const pendingForConversation = pendingMessages.filter((message) => activeFriend && message.conversationId === activeFriend.conversationId && !loadedIds.has(message.id))
    return [...messages, ...pendingForConversation]
      .sort((first, second) => first.createdAt - second.createdAt)
  }, [activeFriend, messages, pendingMessages])

  const totalUnreadCount = useMemo(() => {
    return Object.values(unreadCounts).reduce((acc, count) => acc + count, 0)
  }, [unreadCounts])

  const missedCallsCount = useMemo(() => {
    return callLogs.filter((log) => log.outcome === 'missed' && log.direction === 'incoming').length
  }, [callLogs])

  const filteredFriends = useMemo(() => {
    const normalizedSearch = friendSearch.trim().toLowerCase()
    return friends.filter((friend) => {
      let matchesFilter = true
      if (friendFilter === 'unread') {
        matchesFilter = (unreadCounts[friend.id] ?? 0) > 0
      } else if (friendFilter === 'favourites') {
        matchesFilter = Boolean(friend.pinned || friend.favourite)
      } else if (friendFilter === 'groups') {
        matchesFilter = Boolean(friend.isGroup)
      }
      const matchesSearch = !normalizedSearch || `${friend.name} ${friend.nickname ?? ''} ${friend.handle}`.toLowerCase().includes(normalizedSearch)
      return matchesFilter && matchesSearch
    }).sort((first, second) => Number(Boolean(second.pinned)) - Number(Boolean(first.pinned)))
  }, [friendFilter, friendSearch, friends, unreadCounts])
  const onlineFriendCount = useMemo(() => friends.filter((friend) => friend.online).length, [friends])
  const friendIds = useMemo(() => friends.map((friend) => friend.id).join(','), [friends])
  const activeConversationId = activeFriend?.conversationId
  const activePairingSecret = activeFriend?.pairingSecret

  function toggleStarMessage(msgId: string) {
    setStarredMessageIds((current) => {
      const next = new Set(current)
      if (next.has(msgId)) next.delete(msgId)
      else next.add(msgId)
      try { localStorage.setItem('luma.starred', JSON.stringify([...next])) } catch { /* optional */ }
      return next
    })
  }

  function saveStatusMessage(newStatus: string) {
    setStatusMessage(newStatus)
    try { localStorage.setItem('luma.statusText', newStatus) } catch { /* optional */ }
    if (profile) {
      void saveUserProfile({ ...profile, statusText: newStatus }).catch(() => undefined)
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('luma.theme', theme)
      const metaTheme = document.querySelector('meta[name="theme-color"]')
      if (metaTheme) {
        metaTheme.setAttribute('content', theme === 'light' ? '#FFFFFF' : (theme === 'graphite' ? '#141518' : '#000000'))
      }
    } catch { /* Local preferences can be unavailable in private browsing. */ }
  }, [theme])

  useEffect(() => {
    if (!hasFirebaseConfig) return
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    let authEvent = 0

    async function bootstrapAuth() {
      try { await completeGoogleRedirect() } catch (error: unknown) { if (!cancelled) setErrorMessage(authErrorMessage(error)) }
      if (cancelled) return
      unsubscribe = observeAuth((user) => {
        const currentEvent = ++authEvent
        if (!user) { setProfile(null); setAuthState('signed-out'); return }
        void ensureUserProfile(user).then(async (nextProfile) => {
          if (cancelled || currentEvent !== authEvent || auth?.currentUser?.uid !== user.uid) return
          setProfile(nextProfile)
          setProfileName(nextProfile.displayName)
          setErrorMessage('')
          setAuthState('ready')
          try { await setPresence(user.uid, true) } catch (presenceError) { setToast(presenceError instanceof Error ? `Signed in, but live presence is unavailable: ${presenceError.message}` : 'Signed in, but live presence is unavailable.') }
        }).catch((error: unknown) => {
          if (cancelled || currentEvent !== authEvent) return
          setAuthState('error')
          setErrorMessage(error instanceof Error ? error.message : 'Authentication failed.')
        })
      })
    }

    void bootstrapAuth()
    return () => { cancelled = true; unsubscribe?.(); if (auth?.currentUser) void setPresence(auth.currentUser.uid, false) }
  }, [])

  useEffect(() => {
    updateAppBadge(totalUnreadCount)
  }, [totalUnreadCount])

  useEffect(() => {
    void registerServiceWorker()
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        void Notification.requestPermission().then((perm) => {
          setNotificationPermission(perm)
          if (perm === 'granted' && auth?.currentUser) {
            void subscribeToPush(auth.currentUser)
          }
        }).catch(() => undefined)
      } else {
        const perm = Notification.permission
        setNotificationPermission(perm)
        if (perm === 'granted' && auth?.currentUser) {
          void subscribeToPush(auth.currentUser)
        }
      }
    }
  }, [profile?.uid])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const chatParam = params.get('chat')
    if (chatParam && friends.length > 0) {
      const match = friends.find((f) => f.conversationId === chatParam || f.id === chatParam)
      if (match) {
        setActiveFriendId(match.id)
        setMobileChatOpen(true)
        setView('home')
      }
    }

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NAVIGATE_CHAT' && event.data.conversationId) {
        const targetId = event.data.conversationId
        const match = friends.find((f) => f.conversationId === targetId || f.id === targetId)
        if (match) {
          setActiveFriendId(match.id)
          setMobileChatOpen(true)
          setView('home')
        }
      }
    }

    navigator.serviceWorker?.addEventListener('message', handleSwMessage)
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleSwMessage)
    }
  }, [friends])

  useEffect(() => {
    if (!profile) return
    const unsubscribeContacts = subscribeContacts(profile.uid, (next) => {
      setFriends(next)
      setActiveFriendId((current) => current || next[0]?.id || '')
    }, (error) => setToast(error.message))
    const unsubscribeInvites = subscribeOwnedInvites(profile, (error) => setToast(error.message))
    const unsubscribeIncoming = subscribeIncomingCalls(profile.uid, (call) => {
      if (!call) {
        setIncomingCall(null)
        return
      }
      // If we are already on an active connected call with another user, auto-decline as busy
      if (callRef.current && !callRef.current.isClosed && callPhase === 'connected' && callPeer?.id !== call.callerId) {
        void declineIncomingCallRecord(call.callId).catch(() => undefined)
        return
      }
      // Simultaneous call (glare) resolution when both peers are ringing each other
      if (callRef.current && !callRef.current.isClosed && callPhase === 'connecting' && callPeer?.id === call.callerId) {
        if (!isCanonicalCaller(profile.uid, call.callerId)) {
          // Peer's call is canonical: tear down our outgoing session and automatically accept their incoming call
          callRef.current?.terminate(false)
          callRef.current = null
          setIncomingCall(call)
          return
        }
      }
      setIncomingCall(call)
    })
    return () => { unsubscribeContacts?.(); unsubscribeInvites?.(); unsubscribeIncoming?.() }
  }, [profile])

  useEffect(() => {
    if (!friendIds) return
    const ids = friendIds.split(',').filter(Boolean)
    const unsubscribes = ids.map((friendId) => subscribePresence(friendId, (presence) => setFriends((current) => current.map((friend) => friend.id === friendId ? { ...friend, online: presence.online, lastSeen: presence.lastSeen } : friend))))
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe?.())
  }, [friendIds])

  useEffect(() => {
    setMessages([])
    setPendingMessages([])
    if (!activeConversationId || !activePairingSecret) return
    const unsubscribe = subscribeToChat(activeConversationId, activePairingSecret, setMessages, (error) => setToast(error.message), activeFriend?.clearedAt)
    return () => unsubscribe?.()
  }, [activeConversationId, activePairingSecret, activeFriend?.clearedAt])

  useEffect(() => {
    setPinnedMessageId(null)
    if (!activeConversationId) return
    const unsubscribe = subscribeToConversation(activeConversationId, (data) => {
      setPinnedMessageId(data?.pinnedMessageId ?? null)
    }, (error) => setToast(error.message))
    return () => unsubscribe?.()
  }, [activeConversationId])

  useEffect(() => {
    if (activeFriend && activeMessages.length > 0) {
      const last = activeMessages[activeMessages.length - 1]
      let text = last.text
      if (!text) {
        if (last.kind === 'image') text = '📷 Photo'
        else if (last.kind === 'video') text = '📹 Video'
        else if (last.kind === 'audio') text = '🎵 Voice note'
        else if (last.kind === 'document') text = '📄 Document'
        else if (last.kind === 'location') text = '📍 Location'
        else if (last.kind === 'contact') text = '👤 Contact'
        else if (last.kind === 'call') text = '📞 Call'
        else text = 'Attachment'
      }
      setLastMessages((prev) => {
        const next = {
          ...prev,
          [activeFriend.id]: {
            text,
            timestamp: last.createdAt,
            status: last.status,
          },
        }
        try { localStorage.setItem('luma.lastMessages', JSON.stringify(next)) } catch { /* optional */ }
        return next
      })
    }
  }, [activeFriend, activeMessages])

  useEffect(() => {
    if (!friendIds || !friends.length) return
    const unsubscribes: Array<(() => void) | null | undefined> = []

    friends.forEach((friend) => {
      if (!friend.conversationId || !friend.pairingSecret) return
      const unsub = subscribeToChat(
        friend.conversationId,
        friend.pairingSecret,
        (msgs) => {
          if (msgs.length > 0) {
            const last = msgs[msgs.length - 1]
            let text = last.text
            if (!text) {
              if (last.kind === 'image') text = '📷 Photo'
              else if (last.kind === 'video') text = '📹 Video'
              else if (last.kind === 'audio') text = '🎵 Voice note'
              else if (last.kind === 'document') text = '📄 Document'
              else if (last.kind === 'location') text = '📍 Location'
              else if (last.kind === 'contact') text = '👤 Contact'
              else if (last.kind === 'call') text = '📞 Call'
              else text = 'Attachment'
            }
            setLastMessages((prev) => {
              const next = {
                ...prev,
                [friend.id]: {
                  text,
                  timestamp: last.createdAt,
                  status: last.status,
                },
              }
              try { localStorage.setItem('luma.lastMessages', JSON.stringify(next)) } catch { /* optional */ }
              return next
            })

            // Check for new incoming messages
            const convId = friend.conversationId
            const isFirstLoad = !initializedConversationsRef.current.has(convId)
            if (isFirstLoad) {
              initializedConversationsRef.current.add(convId)
              msgs.forEach((m) => seenMessageIdsRef.current.add(m.id))
            } else {
              const newIncoming = msgs.filter((m) =>
                !seenMessageIdsRef.current.has(m.id) &&
                m.senderId !== profile?.uid &&
                m.createdAt >= (mountTimeRef.current - 30_000)
              )
              msgs.forEach((m) => seenMessageIdsRef.current.add(m.id))

              if (newIncoming.length > 0 && !friend.muted) {
                const latest = newIncoming[newIncoming.length - 1]
                let notifBody = latest.text
                if (!notifBody) {
                  if (latest.kind === 'image') notifBody = '📷 Photo'
                  else if (latest.kind === 'video') notifBody = '📹 Video'
                  else if (latest.kind === 'audio') notifBody = '🎵 Voice note'
                  else if (latest.kind === 'document') notifBody = '📄 Document'
                  else if (latest.kind === 'location') notifBody = '📍 Location'
                  else if (latest.kind === 'contact') notifBody = '👤 Contact'
                  else if (latest.kind === 'call') notifBody = '📞 Call'
                  else notifBody = 'Attachment'
                }

                const senderDisplayName = getDisplayName(friend)
                const isActivelyFocusedOnThisChat = (
                  typeof document !== 'undefined' &&
                  document.visibilityState === 'visible' &&
                  mobileChatOpen &&
                  activeFriendId === friend.id
                )

                if (!isActivelyFocusedOnThisChat) {
                  // Dispatch browser desktop / push notification
                  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                    try {
                      const notif = new Notification(senderDisplayName, {
                        body: previewEnabled ? (notifBody || 'New message') : 'New message',
                        icon: getFriendAvatarUrl(friend) || '/favicon.ico',
                        tag: `msg-${friend.id}`,
                      })
                      notif.onclick = () => {
                        window.focus()
                        setActiveFriendId(friend.id)
                        setMobileChatOpen(true)
                        notif.close()
                      }
                    } catch (err) {
                      console.error('Notification dispatch error:', err)
                    }
                  }

                  // Play message chime
                  if (soundEnabled) {
                    playIncomingMessageSound()
                  }

                  // In-app preview toast if looking elsewhere
                  if (!mobileChatOpen || activeFriendId !== friend.id) {
                    setToast(`${senderDisplayName}: ${notifBody}`)
                  }
                }
              }
            }
          }
        },
        () => undefined,
        friend.clearedAt
      )
      unsubscribes.push(unsub)
    })

    return () => {
      unsubscribes.forEach((u) => u?.())
    }
  }, [friendIds, friends, profile?.uid, mobileChatOpen, activeFriendId, soundEnabled, previewEnabled])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 899px)')
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches)
    updateViewport()
    mediaQuery.addEventListener?.('change', updateViewport)
    return () => mediaQuery.removeEventListener?.('change', updateViewport)
  }, [])
  useEffect(() => {
    const updateVisibility = () => setIsDocumentVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', updateVisibility)
    return () => document.removeEventListener('visibilitychange', updateVisibility)
  }, [])
  useEffect(() => {
    try { localStorage.setItem('luma.callLogs', JSON.stringify(callLogs.slice(0, 100))) } catch { /* Local call history is optional. */ }
  }, [callLogs])
  useEffect(() => () => {
    pendingMediaUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    pendingMediaUrlsRef.current.clear()
  }, [])
  useEffect(() => {
    const loadedIds = new Set(messages.map((message) => message.id))
    if (loadedIds.size === 0) return
    setPendingMessages((current) => current.filter((message) => {
      if (!message.id.startsWith('media-') || !loadedIds.has(message.id)) return true
      const url = pendingMediaUrlsRef.current.get(message.id)
      if (url) {
        URL.revokeObjectURL(url)
        pendingMediaUrlsRef.current.delete(message.id)
      }
      return false
    }))
  }, [messages])
  useEffect(() => {
    const shouldMarkRead = view === 'home' && isDocumentVisible && (!isMobileViewport || mobileChatOpen)
    if (!shouldMarkRead || !activeConversationId) return
    const currentUserId = auth?.currentUser?.uid
    if (!currentUserId) return
    const readIds = activeMessages.filter((message) => message.senderId !== currentUserId && message.status === 'delivered').map((message) => message.id)
    if (readIds.length > 0) void markMessagesRead(activeConversationId, readIds)
  }, [activeConversationId, activeMessages, isDocumentVisible, isMobileViewport, mobileChatOpen, view])
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream
      void localVideoRef.current.play().catch(() => undefined)
    }
  }, [localStream])
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream
      void remoteVideoRef.current.play().catch(() => undefined)
    }
  }, [remoteStream])
  useEffect(() => { qualityRef.current = quality }, [quality])
  useEffect(() => {
    const goOnline = () => setOnline(true); const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline); window.addEventListener('offline', goOffline)
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline) }
  }, [])
  // iOS Safari / PWA Media Lifecycle & Background Persistence:
  // Preserves active WebRTC calls when opening Notification/Control Center or switching apps
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        unlockAudioContext()
        if (callRef.current && callRef.current.localStream) {
          const stream = callRef.current.localStream
          stream.getVideoTracks().forEach((track) => {
            if (track.readyState === 'live' && !track.enabled && cameraEnabled) {
              track.enabled = true
            }
          })
          stream.getAudioTracks().forEach((track) => {
            if (track.readyState === 'live' && !track.enabled && !muted) {
              track.enabled = true
            }
          })
        }
        if (remoteVideoRef.current && remoteStream) {
          void remoteVideoRef.current.play().catch(() => undefined)
        }
        if (localVideoRef.current && localStream) {
          void localVideoRef.current.play().catch(() => undefined)
        }
      } else if (document.visibilityState === 'hidden') {
        // When going to background on iOS/Safari, attempt auto-PiP on remote video if permitted
        if (callKind === 'video' && remoteVideoRef.current && typeof remoteVideoRef.current.requestPictureInPicture === 'function' && !document.pictureInPictureElement) {
          void remoteVideoRef.current.requestPictureInPicture().catch(() => undefined)
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleVisibilityChange)
    }
  }, [callKind, cameraEnabled, muted, remoteStream, localStream])
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3800); return () => window.clearTimeout(timer) }, [toast])
  useEffect(() => {
    if (!callStartedAt || callPhase !== 'connected') {
      setCallElapsed('00:00')
      return
    }
    const timer = window.setInterval(() => setCallElapsed(formatDuration(callStartedAt)), 1000)
    return () => window.clearInterval(timer)
  }, [callStartedAt, callPhase])

  useEffect(() => {
    if (!activeFriend) return
    setUnreadCounts((current) => {
      if (!current[activeFriend.id]) return current
      const next = { ...current }
      delete next[activeFriend.id]
      return next
    })
    const unread = messages.filter((m) => m.senderId !== profile?.uid && m.status !== 'read')
    if (unread.length > 0 && activeConversationId) {
      void markMessagesRead(activeConversationId, unread.map((m) => m.id)).catch(() => undefined)
    }
  }, [activeFriend, activeConversationId, activePairingSecret, messages, profile?.uid])
  // Proximity sensor: turn screen off when phone is on ear during audio calls in earpiece mode
  useEffect(() => {
    const isAudioCallEarpiece = callKind === 'voice' && !speakerEnabled && (callPhase === 'connected' || callPhase === 'connecting' || callPhase === 'ringing')
    if (!isAudioCallEarpiece) {
      stopProximitySensor()
      return
    }
    void startProximitySensor()
    return () => stopProximitySensor()
  }, [callKind, callPhase, speakerEnabled])
  useEffect(() => {
    const incomingCallId = incomingCall?.callId
    if (!incomingCallId) {
      stopIncomingRingtone()
      return
    }
    startIncomingRingtone()
    const isAllowed = typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
    if (isAllowed) {
      const callerFriend = friends.find((f) => f.id === incomingCall.callerId)
      const callerName = callerFriend ? getDisplayName(callerFriend) : incomingCall.callerProfile.name
      try {
        new Notification(`${callerName} is calling…`, {
          body: `Incoming ${incomingCall.kind === 'video' ? 'Video' : 'Audio'} Call on LumaChat`,
          icon: '/favicon.ico',
        })
      } catch {
        /* ignore */
      }
    }
    return () => stopIncomingRingtone()
  }, [incomingCall?.callId, notificationPermission, friends])

  async function sendMessage(replyTo?: ReplyReference) {
    const text = draft.trim()
    if (!text || !activeFriend) return
    const senderId = auth?.currentUser?.uid
    if (!senderId) return
    const pendingMessage: ChatMessage = {
      id: `pending-${Date.now()}`,
      conversationId: activeFriend.conversationId,
      senderId,
      text,
      createdAt: Date.now(),
      status: 'pending',
      kind: 'text',
      encrypted: true,
      replyTo,
    }
    setDraft('')
    setPendingMessages((current) => [...current, pendingMessage])
    try {
      await sendEncryptedChatMessage(activeFriend.conversationId, activeFriend.pairingSecret, text, replyTo)
      setPendingMessages((current) => current.filter((message) => message.id !== pendingMessage.id))
    } catch (error) {
      setPendingMessages((current) => current.filter((message) => message.id !== pendingMessage.id))
      setDraft(text)
      setToast(error instanceof Error ? error.message : 'Message could not be sent.')
    }
  }

  async function handleEditMessage(messageId: string, newText: string) {
    if (!activeFriend) return
    try {
      await editEncryptedChatMessage(activeFriend.conversationId, activeFriend.pairingSecret, messageId, newText)
      setToast('Message edited')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not edit message.')
    }
  }

  async function handleDeleteForMe(messageId: string) {
    if (!activeFriend) return
    try {
      await deleteMessageForMe(activeFriend.conversationId, messageId)
      setMessages((current) => current.filter((m) => m.id !== messageId))
      setToast('Deleted for you')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not delete message.')
    }
  }

  async function handleDeleteForEveryone(messageId: string) {
    if (!activeFriend) return
    try {
      await deleteMessageForEveryone(activeFriend.conversationId, activeFriend.pairingSecret, messageId)
      setToast('Deleted for everyone')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not delete message for everyone.')
    }
  }

  async function handleTogglePin(messageId: string) {
    if (!activeFriend) return
    const nextPinnedId = pinnedMessageId === messageId ? null : messageId
    try {
      await pinConversationMessage(activeFriend.conversationId, nextPinnedId)
      setToast(nextPinnedId ? 'Message pinned' : 'Message unpinned')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not update pinned message.')
    }
  }

  async function handleForwardMessage(targetFriends: Friend[], message: ChatMessage) {
    try {
      for (const target of targetFriends) {
        await forwardEncryptedMessage(target.conversationId, target.pairingSecret, message)
      }
      setToast(targetFriends.length === 1 ? `Forwarded to ${getDisplayName(targetFriends[0])}` : `Forwarded to ${targetFriends.length} contacts`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not forward message.')
    }
  }

  function runMediaUpload<T>(task: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        activeMediaUploadsRef.current += 1
        void Promise.resolve().then(task).then(resolve, reject).finally(() => {
          activeMediaUploadsRef.current -= 1
          mediaUploadQueueRef.current.shift()?.()
        })
      }
      if (activeMediaUploadsRef.current < 3) start()
      else mediaUploadQueueRef.current.push(start)
    })
  }

  async function sendMediaFile(file: File, forcedKind?: MediaKind, durationSeconds?: number, options: MediaSendOptions = {}) {
    const targetFriend = options.targetFriend ?? activeFriend
    if (!targetFriend) return
    const kind = forcedKind ?? (file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'document')
    const id = options.messageId ?? messageId('media')
    const existingPending = pendingMessages.find((message) => message.id === id)
    const previewUrl = existingPending?.attachment?.url ?? URL.createObjectURL(file)
    pendingMediaUrlsRef.current.set(id, previewUrl)
    const pendingMessage: ChatMessage = existingPending ?? {
      id,
      conversationId: targetFriend.conversationId,
      senderId: auth?.currentUser?.uid ?? '',
      text: '',
      createdAt: Date.now(),
      status: 'pending',
      kind,
      encrypted: true,
      attachment: {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        storagePath: '',
        url: previewUrl,
        durationSeconds,
        isDocument: options.isDocument ?? kind === 'document',
        callSessionId: options.callSessionId,
        uploadState: 'pending',
        uploadProgress: 0,
      },
    }
    pendingMediaJobsRef.current.set(id, { file, forcedKind, durationSeconds, options: { ...options, messageId: id }, targetFriend })
    setPendingMessages((current) => current.some((message) => message.id === id)
      ? current.map((message) => message.id === id ? { ...message, status: 'pending', attachment: { ...message.attachment!, uploadState: 'pending', uploadProgress: 0 } } : message)
      : [...current, pendingMessage])
    let storagePath = ''
    try {
      await runMediaUpload(async () => {
        const dimensions = await readMediaDimensions(file, kind)
        setPendingMessages((current) => current.map((message) => message.id === id ? { ...message, attachment: { ...message.attachment!, ...dimensions, uploadState: 'uploading' } } : message))
        storagePath = await uploadEncryptedAttachment(targetFriend.conversationId, id, targetFriend.pairingSecret, file, (progress) => {
          setPendingMessages((current) => current.map((message) => message.id === id ? { ...message, attachment: { ...message.attachment!, uploadState: 'uploading', uploadProgress: progress } } : message))
        })
        const attachment = {
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          storagePath,
          durationSeconds,
          ...dimensions,
          isDocument: options.isDocument ?? kind === 'document',
          callSessionId: options.callSessionId,
          uploadState: 'ready' as const,
          uploadProgress: 1,
        }
        await sendEncryptedPayload(targetFriend.conversationId, targetFriend.pairingSecret, { kind, attachment }, id)
        setPendingMessages((current) => current.map((message) => message.id === id ? { ...message, status: 'sent', attachment: { ...message.attachment!, ...attachment } } : message))
      })
      pendingMediaJobsRef.current.delete(id)
      setToast(kind === 'audio' ? 'Voice note sent' : 'Attachment sent')
    } catch (error) {
      if (storagePath) await removeAttachment(storagePath).catch(() => undefined)
      setPendingMessages((current) => current.map((message) => message.id === id ? { ...message, status: 'pending', attachment: { ...message.attachment!, uploadState: 'failed', uploadProgress: 0 } } : message))
      setToast(error instanceof Error ? error.message : 'Attachment could not be sent.')
    }
  }

  function retryMediaMessage(id: string) {
    const job = pendingMediaJobsRef.current.get(id)
    if (!job) { setToast('This upload is no longer available to retry.'); return }
    void sendMediaFile(job.file, job.forcedKind, job.durationSeconds, { ...job.options, targetFriend: job.targetFriend, messageId: id })
  }

  async function sendLocation() {
    if (!activeFriend) return
    if (!navigator.geolocation) { setToast('Location is not available on this browser.'); return }
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        await sendEncryptedPayload(activeFriend.conversationId, activeFriend.pairingSecret, {
          kind: 'location',
          location: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, label: 'Shared location' },
        })
        setToast('Location sent')
      } catch (error) { setToast(error instanceof Error ? error.message : 'Location could not be sent.') }
    }, (error) => setToast(error.message || 'Location permission was denied.'), { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 })
  }

  async function sendContact(contact: Friend) {
    if (!activeFriend) return
    try {
      await sendEncryptedPayload(activeFriend.conversationId, activeFriend.pairingSecret, {
        kind: 'contact',
        contact: { uid: contact.id, name: contact.name, handle: contact.handle, initials: contact.initials, color: contact.color, photoURL: contact.photoURL },
      })
      setContactPickerOpen(false)
      setToast('Contact sent')
    } catch (error) { setToast(error instanceof Error ? error.message : 'Contact could not be sent.') }
  }

  async function sendVoiceNote(blob: Blob, durationSeconds: number) {
    const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: blob.type || 'audio/webm' })
    await sendMediaFile(file, 'audio', durationSeconds)
  }

  async function openCreateInvite(initialTab: InviteMode = 'group') {
    if (!profile) return
    try {
      const { default: QRCode } = await import('qrcode')
      const invite = await createInvite(profile)
      setInviteCode(invite.secret)
      setInviteExpiresAt(invite.expiresAt)
      setInviteQr(await QRCode.toDataURL(inviteUrl(invite.secret), { width: 240, margin: 1, color: { dark: '#101513', light: '#ffffff' } }))
      setInviteMode(initialTab)
      setInviteOpen(true)
    } catch (error) { setToast(error instanceof Error ? error.message : 'Invite could not be created.') }
  }

  async function acceptCode(rawCode = inviteInput) {
    if (!profile || !auth?.currentUser) return
    const cleaned = rawCode.trim().toUpperCase()
    try {
      await acceptInvite(cleaned, auth.currentUser, profile)
      setInviteInput('')
      setInviteOpen(false)
      setToast('Friend added securely.')
    } catch (error) { setToast(error instanceof Error ? error.message : 'Invite could not be accepted.') }
  }

  async function copyInvite() {
    try { await navigator.clipboard?.writeText(inviteCode.replaceAll(' ', '')); setToast('6-digit invite code copied') } catch { setToast('Copy is unavailable on this browser.') }
  }

  async function handleCreateGroup(groupName: string, memberIds: string[]) {
    const trimmedName = groupName.trim()
    const currentUid = auth?.currentUser?.uid
    if (!trimmedName || !currentUid) return
    const id = `group_${Date.now()}`
    const conversationId = `conv_${id}`
    const pairingSecret = createPairingSecret()
    const allMembers = [currentUid, ...memberIds]
    const newGroup: Friend = {
      id,
      name: trimmedName,
      handle: `@${trimmedName.toLowerCase().replace(/\s+/g, '_')}`,
      initials: trimmedName.slice(0, 2).toUpperCase(),
      color: '#128C7E',
      online: true,
      conversationId,
      pairingSecret,
      isGroup: true,
      memberCount: allMembers.length,
      memberIds: allMembers,
    }
    try {
      await createConversation(conversationId, allMembers)
    } catch (err) {
      console.error('Failed to create group conversation doc:', err)
    }
    setFriends((prev) => [newGroup, ...prev])
    setActiveFriendId(id)
    setMobileChatOpen(true)
    setInviteOpen(false)
    setToast(`Group "${trimmedName}" created`)
  }

  function iceServers() {
    const servers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ]
    const turnUrls = String(import.meta.env.VITE_TURN_URLS ?? import.meta.env.VITE_TURN_URL ?? '').split(',').map((url) => url.trim()).filter(Boolean)
    const turnUsername = String(import.meta.env.VITE_TURN_USERNAME ?? '').trim()
    const turnCredential = String(import.meta.env.VITE_TURN_CREDENTIAL ?? '').trim()
    if (turnUrls.length && turnUsername && turnCredential) servers.push({ urls: turnUrls, username: turnUsername, credential: turnCredential })
    return servers
  }

  function attachCallCallbacks(call: WebRTCCall) {
    call.onRemoteStream = (stream) => setRemoteStream(stream)
    call.onPeerMirrorChange = (enabled) => setRemoteMirrorMode(enabled)
    call.onScreenShareEnded = () => {
      setIsScreenSharing(false)
      if (call.localStream) setLocalStream(call.localStream)
    }
    call.onConnected = () => {
      if (callRef.current === call) {
        const connectedAt = Date.now()
        setCallPhase('connected')
        setCallStartedAt((current) => current || connectedAt)
        if (callMetaRef.current) callMetaRef.current.connectedAt = connectedAt
      }
    }
    call.onStats = (snapshot) => {
      setNetwork(snapshot)
      if (qualityRef.current !== 'audio') {
        void call.adaptEncoding(snapshot, qualityRef.current).then((effective) => {
          if (effective) setEffectiveQuality(effective)
        })
      }
    }
    call.onCallEnded = () => {
      if (callRef.current === call) endCall()
      else call.stop()
    }
  }

  function getSavedSpeakerPreference(kind: CallKind): boolean {
    try {
      const key = kind === 'video' ? 'luma_call_speaker_video' : 'luma_call_speaker_voice'
      const saved = localStorage.getItem(key)
      if (saved !== null) return saved === 'true'
    } catch {
      /* ignore */
    }
    return kind === 'video'
  }

  function getSavedVideoQualityPreference(): QualityMode {
    try {
      const saved = localStorage.getItem('luma_call_video_quality') as QualityMode | null
      if (saved && (saved === 'auto' || saved === '1080p' || saved === '720p' || saved === '480p' || saved === '360p')) {
        return saved
      }
    } catch {
      /* ignore */
    }
    return 'auto'
  }

  function getSavedFacingModePreference(): 'user' | 'environment' {
    try {
      const saved = localStorage.getItem('luma_call_facing_mode') as 'user' | 'environment' | null
      if (saved === 'user' || saved === 'environment') return saved
    } catch {
      /* ignore */
    }
    return 'user'
  }

  async function startCall(kind: CallKind) {
    if (!activeFriend || !profile) return
    unlockAudioContext()

    // Simultaneous Cross-Call (Glare) Resolution: If there is already a ringing incoming call from this friend, automatically accept it!
    const glare = resolveSimultaneousCall(activeFriend.id, incomingCall)
    if (glare.action === 'accept_existing') {
      await acceptIncomingCall()
      return
    }

    const savedQuality = getSavedVideoQualityPreference()
    const chosenQuality: QualityMode = kind === 'voice' ? 'audio' : savedQuality
    const chosenEffective: QualityMode = kind === 'voice' ? 'audio' : (savedQuality === 'auto' ? '720p' : savedQuality)
    const chosenFacing = getSavedFacingModePreference()
    const chosenSpeaker = getSavedSpeakerPreference(kind)

    const initiatedAt = Date.now()
    callMetaRef.current = { role: 'caller', friend: activeFriend, kind, initiatedAt, connectedAt: 0 }
    lastAutoQualityRef.current = kind === 'video' ? (savedQuality === 'auto' ? '720p' : savedQuality) : 'audio'
    setCallKind(kind); setCallPeer(activeFriend); setCallPhase('connecting'); setCallStartedAt(0); setQuality(chosenQuality); setEffectiveQuality(chosenEffective); setCameraEnabled(kind === 'video'); setMuted(false); setSpeakerEnabled(chosenSpeaker); setFacingMode(chosenFacing); setIsScreenSharing(false)
    void acquireCallWakeLock()
    try {
      const call = new WebRTCCall('caller', iceServers())
      callRef.current = call
      attachCallCallbacks(call)
      const stream = await call.prepare(chosenQuality, chosenFacing)
      if (call.isClosed || callRef.current !== call) return
      setLocalStream(stream); setRemoteStream(call.remoteStream)
      const sessionId = await call.startCaller(activeFriend.id, kind, { name: profile.displayName, initials: profile.initials, color: profile.color })
      if (call.isClosed || callRef.current !== call) return
      callMetaRef.current = { role: 'caller', friend: activeFriend, kind, initiatedAt, connectedAt: 0, sessionId: sessionId ?? undefined }
    } catch (error) { const wasEnded = callRef.current?.isClosed; endCall(); if (!wasEnded) setToast(error instanceof Error ? error.message : 'Camera or microphone access was not available.') }
  }

  async function acceptIncomingCall() {
    if (!incomingCall || !profile) return
    unlockAudioContext()
    const callToAccept = incomingCall
    const incomingPeer = friends.find((friend) => friend.id === callToAccept.callerId) ?? { id: callToAccept.callerId, name: callToAccept.callerProfile.name, handle: '', initials: callToAccept.callerProfile.initials, color: callToAccept.callerProfile.color, online: true, verified: true, conversationId: '', pairingSecret: '' }
    
    const savedQuality = getSavedVideoQualityPreference()
    const chosenQuality: QualityMode = callToAccept.kind === 'voice' ? 'audio' : savedQuality
    const chosenEffective: QualityMode = callToAccept.kind === 'voice' ? 'audio' : (savedQuality === 'auto' ? '720p' : savedQuality)
    const chosenFacing = getSavedFacingModePreference()
    const chosenSpeaker = getSavedSpeakerPreference(callToAccept.kind)

    callMetaRef.current = { role: 'callee', friend: incomingPeer, kind: callToAccept.kind, initiatedAt: callToAccept.createdAt, connectedAt: 0, sessionId: callToAccept.callId }
    lastAutoQualityRef.current = callToAccept.kind === 'video' ? (savedQuality === 'auto' ? '720p' : savedQuality) : 'audio'
    setCallKind(callToAccept.kind); setCallPeer(incomingPeer); setCallPhase('connecting'); setCallStartedAt(0); setQuality(chosenQuality); setEffectiveQuality(chosenEffective); setCameraEnabled(callToAccept.kind === 'video'); setMuted(false); setSpeakerEnabled(chosenSpeaker); setFacingMode(chosenFacing); setIncomingCall(null); setIsScreenSharing(false)
    void acquireCallWakeLock()
    try {
      const call = new WebRTCCall('callee', iceServers())
      callRef.current = call
      attachCallCallbacks(call)
      const stream = await call.prepare(chosenQuality, chosenFacing)
      if (call.isClosed || callRef.current !== call) return
      setLocalStream(stream); setRemoteStream(call.remoteStream)
      await call.acceptCallee(callToAccept.callId)
      if (call.isClosed || callRef.current !== call) return
      const connectedAt = Date.now()
      callMetaRef.current = { role: 'callee', friend: incomingPeer, kind: callToAccept.kind, initiatedAt: callToAccept.createdAt, connectedAt, sessionId: callToAccept.callId }
      setCallPhase('connected'); setCallStartedAt(connectedAt)
    } catch (error) { const wasEnded = callRef.current?.isClosed; endCall(); if (!wasEnded) setToast(error instanceof Error ? error.message : 'The call could not be accepted.') }
  }

  async function declineIncomingCall() {
    const call = incomingCall
    setIncomingCall(null)
    if (!call) return
    const peer = friends.find((friend) => friend.id === call.callerId)
    const summary: CallSummary = { kind: call.kind, outcome: 'declined', durationSeconds: 0, initiatedAt: call.createdAt, endedAt: Date.now(), sessionId: call.callId, callerId: call.callerId }
    if (peer) {
      const log: CallLogEntry = { id: `log-${call.callId}`, ...summary, friendId: peer.id, friendName: getDisplayName(peer), friendInitials: peer.initials, friendColor: peer.color, friendPhotoURL: peer.photoURL, direction: 'incoming' }
      setCallLogs((current) => [log, ...current.filter((entry) => entry.id !== log.id)].slice(0, 100))
      void sendCallHistoryMessage(peer.conversationId, peer.pairingSecret, summary, call.callId).catch(() => undefined)
    }
    try { await declineIncomingCallRecord(call.callId) } catch (error) { setToast(error instanceof Error ? error.message : 'The call could not be declined.') }
  }

  function recordCallLog(meta: NonNullable<typeof callMetaRef.current>, callId: string, outcome: CallSummary['outcome']) {
    const endedAt = Date.now()
    const durationSeconds = meta.connectedAt ? Math.max(0, Math.floor((endedAt - meta.connectedAt) / 1000)) : 0
    const callerId = meta.role === 'caller' ? (auth?.currentUser?.uid ?? '') : meta.friend.id
    const callSummary: CallSummary = { kind: meta.kind, outcome, durationSeconds, initiatedAt: meta.initiatedAt, endedAt, sessionId: meta.sessionId ?? callId, callerId }
    const logId = `log-${callId}`
    const log: CallLogEntry = { id: logId, ...callSummary, friendId: meta.friend.id, friendName: getDisplayName(meta.friend), friendInitials: meta.friend.initials, friendColor: meta.friend.color, friendPhotoURL: meta.friend.photoURL, direction: meta.role === 'caller' ? 'outgoing' : 'incoming' }
    setCallLogs((current) => [log, ...current.filter((entry) => entry.id !== logId)].slice(0, 100))
    if (meta.friend.conversationId && meta.friend.pairingSecret) void sendCallHistoryMessage(meta.friend.conversationId, meta.friend.pairingSecret, callSummary, callId).catch(() => undefined)
  }

  function endCall() {
    releaseCallWakeLock()
    stopProximitySensor()
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null
    }
    const call = callRef.current
    const meta = callMetaRef.current
    if (call && meta && call.callId) recordCallLog(meta, call.callId, meta.connectedAt ? 'completed' : 'missed')
    call?.terminate(true)
    callRef.current = null
    callMetaRef.current = null
    setIncomingCall(null); setLocalStream(null); setRemoteStream(null); setCallKind(null); setCallPeer(null); setCallPhase('connecting'); setCallStartedAt(0); setCallElapsed('00:00'); setShowQualityMenu(false); setIsScreenSharing(false); setRemoteMirrorMode(true)
  }

  endCallRef.current = endCall

  async function saveProfilePhoto(file: File) {
    if (!profile) return
    try {
      const photoURL = await uploadProfilePhoto(profile.uid, file)
      const next = { ...profile, photoURL }
      await saveUserProfile(next)
      setProfile(next)
      setToast('Profile picture updated')
    } catch (error) { setToast(error instanceof Error ? error.message : 'Profile picture could not be updated.') }
  }

  async function updateChatPin(friend: Friend) {
    if (!profile) return
    try { await updateContactSettings(profile.uid, friend.id, { pinned: !friend.pinned }); setChatMenuFriend(null); setToast(friend.pinned ? 'Chat unpinned' : 'Chat pinned') } catch (error) { setToast(error instanceof Error ? error.message : 'Chat could not be updated.') }
  }

  async function updateNickname(friend: Friend, nickname: string) {
    if (!profile) return
    try {
      const cleanNick = nickname.trim() || undefined
      await updateContactSettings(profile.uid, friend.id, { nickname: cleanNick || '' })
      setFriends((prev) =>
        prev.map((f) => (f.id === friend.id ? { ...f, nickname: cleanNick } : f))
      )
      setNicknameModalFriend(null)
      setToast(cleanNick ? `Nickname set to "${cleanNick}"` : 'Nickname removed')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Nickname could not be updated.')
    }
  }

  async function clearChat(friend: Friend) {
    if (!profile) return
    try { await updateContactSettings(profile.uid, friend.id, { clearedAt: Date.now() }); setChatMenuFriend(null); setToast('Chat cleared on this device') } catch (error) { setToast(error instanceof Error ? error.message : 'Chat could not be cleared.') }
  }

  async function removeChat(friend: Friend) {
    if (!profile) return
    try { await deleteContact(profile.uid, friend.id); if (activeFriendId === friend.id) { setActiveFriendId(''); setMobileChatOpen(false) }; setChatMenuFriend(null); setToast('Chat deleted from your contacts') } catch (error) { setToast(error instanceof Error ? error.message : 'Chat could not be deleted.') }
  }
  async function setCallQuality(next: QualityMode) {
    setQuality(next)
    if (next !== 'auto') setEffectiveQuality(next)
    if (next !== 'audio') {
      try {
        localStorage.setItem('luma_call_video_quality', next)
      } catch {
        /* ignore */
      }
    }
    await callRef.current?.changeQuality(next)
    setCameraEnabled(next !== 'audio')
    setShowQualityMenu(false)
  }
  function toggleMic() { setMuted((value) => { const next = !value; callRef.current?.localStream?.getAudioTracks().forEach((track) => { track.enabled = !next }); return next }) }
  function toggleCamera() { setCameraEnabled((value) => { const next = !value; callRef.current?.localStream?.getVideoTracks().forEach((track) => { track.enabled = next }); return next }) }
  async function switchCamera() {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user'
    if (!callRef.current || callKind !== 'video') return
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextFacing }, audio: false }); const nextTrack = nextStream.getVideoTracks()[0]
      const sender = callRef.current.pc.getSenders().find((item) => item.track?.kind === 'video'); if (sender) await sender.replaceTrack(nextTrack)
      callRef.current.setCameraTrack(nextTrack)
      const currentStream = callRef.current.localStream
      currentStream?.getVideoTracks().forEach((track) => { currentStream.removeTrack(track); track.stop() })
      const nextLocalStream = new MediaStream([...(currentStream?.getAudioTracks() ?? []), nextTrack])
      callRef.current.localStream = nextLocalStream
      setLocalStream(nextLocalStream)
      setFacingMode(nextFacing)
      try {
        localStorage.setItem('luma_call_facing_mode', nextFacing)
      } catch {
        /* ignore */
      }
    } catch { setToast('This camera is not available on the current device.') }
  }

  async function toggleScreenShare() {
    const call = callRef.current
    if (!call || callKind !== 'video') return
    try {
      if (isScreenSharing) {
        const stream = await call.stopScreenShare()
        if (stream) setLocalStream(stream)
        setIsScreenSharing(false)
        setToast('Screen sharing stopped')
      } else {
        const stream = await call.startScreenShare()
        setLocalStream(stream)
        setIsScreenSharing(true)
        setToast('Screen sharing started')
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Screen sharing could not be started.')
    }
  }

  async function openPictureInPicture() {
    const video = remoteVideoRef.current
    if (!video) {
      setToast('Video is not ready for picture-in-picture.')
      return
    }
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else if (typeof video.requestPictureInPicture === 'function') {
        await video.requestPictureInPicture()
      } else if ('webkitSetPresentationMode' in video) {
        (video as unknown as { webkitSetPresentationMode: (mode: string) => void }).webkitSetPresentationMode('picture-in-picture')
      } else {
        setToast('Picture-in-picture is not supported on this browser.')
      }
    } catch {
      setToast('Picture-in-picture could not be opened.')
    }
  }

  async function captureCallPhoto(): Promise<string | null> {
    const video = remoteVideoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      setToast('The other camera is not ready for a photo yet.')
      return null
    }
    const meta = callMetaRef.current
    const targetFriend = meta?.friend ?? activeFriend
    if (!targetFriend) {
      setToast('The call photo could not be linked to this chat.')
      return null
    }

    try {
      const processed = await processCallPhotoAsync(video, localVideoRef.current)
      if (!processed) {
        setToast('The call photo could not be captured.')
        return null
      }
      // Send image asynchronously in background queue without interrupting active call or requiring call to stay alive
      void sendMediaFile(processed.file, 'image', undefined, {
        targetFriend,
        callSessionId: meta?.sessionId ?? 'unknown-call',
      })
      setToast('Call photo captured & saved to chat')
      return processed.thumbDataUrl
    } catch {
      setToast('Photo capture failed.')
      return null
    }
  }

  async function saveProfile() {
    if (!profile || !profileName.trim()) return
    const displayName = profileName.trim()
    const next = { ...profile, displayName, initials: displayName.slice(0, 1).toUpperCase() }
    try { const savedProfile = await saveUserProfile(next); setProfile(savedProfile); setProfileName(savedProfile.displayName); setToast('Profile updated') } catch (error) { setToast(error instanceof Error ? error.message : 'Profile could not be updated.') }
  }

  if (!gatewayVerified) return <GatewayScreen onVerified={() => setGatewayVerified(true)} />
  if (authState === 'loading') return <LoadingScreen />
  if (authState === 'error') return <SetupScreen message={errorMessage} />
  if (authState === 'signed-out') return <AuthScreen initialError={errorMessage} />

  return <div className={`stitch-app wa-app-root ${mobileChatOpen ? 'stitch-chat-mode wa-chat-mode' : ''}`} data-theme={theme}>
    <div className="wa-phone-container">
      {/* WhatsApp Top Navigation Bar */}
      {!mobileChatOpen && (
        <header className="stitch-header wa-nav-header">
          <div className="wa-nav-left">
            {view !== 'home' && (
              <button
                type="button"
                className="stitch-back-button wa-back-pill"
                onClick={() => setView('home')}
                aria-label="Back to chats"
              >
                <ChevronLeft size={22} className="wa-back-chevron" />
              </button>
            )}
            {view === 'settings' ? (
              <button
                className="stitch-icon-button wa-circle-btn"
                onClick={() => { setFriendSearch(''); setView('home') }}
                aria-label="Search"
              >
                <Search size={20} />
              </button>
            ) : (
              <button
                className="stitch-icon-button wa-circle-btn"
                onClick={() => { setInviteMode('accept'); setInviteOpen(true) }}
                aria-label="More options"
              >
                <MoreHorizontal size={20} />
              </button>
            )}
          </div>
          <div className="wa-nav-right">
            {view === 'settings' ? (
              <div className="wa-you-top-pill">
                <button
                  type="button"
                  className="wa-you-pill-item"
                  onClick={() => { setInviteMode('create'); setInviteOpen(true) }}
                  aria-label="QR code"
                >
                  <QrCode size={19} />
                </button>
                <button
                  type="button"
                  className="wa-you-pill-item"
                  onClick={() => { setInviteMode('accept'); setInviteOpen(true) }}
                  aria-label="Edit options"
                >
                  <Pencil size={18} />
                </button>
              </div>
            ) : view === 'calls' ? (
              <button
                className="stitch-icon-button wa-plus-btn"
                onClick={() => void openCreateInvite()}
                aria-label="New call / Invite"
              >
                <Plus size={20} strokeWidth={2.8} />
              </button>
            ) : (
              <>
                <button
                  className="stitch-icon-button wa-circle-btn"
                  onClick={() => setScannerOpen(true)}
                  aria-label="Camera"
                >
                  <Camera size={20} />
                </button>
                <button
                  className="stitch-icon-button wa-plus-btn"
                  onClick={() => void openCreateInvite('group')}
                  aria-label="New chat / Group / Invite"
                >
                  <Plus size={20} strokeWidth={2.8} />
                </button>
              </>
            )}
          </div>
        </header>
      )}

      {/* Large Title Row (Chats & Calls only, matching IMG_1628 & IMG_1632) */}
      {!mobileChatOpen && view !== 'settings' && (
        <div className="wa-large-title-row">
          <h1 className="wa-large-title">
            {view === 'calls' ? 'Calls' : 'Chats'}
          </h1>
        </div>
      )}

      <main className="stitch-main wa-main">
        {view === 'home' ? (
          <div className={`stitch-workspace wa-workspace ${mobileChatOpen ? 'stitch-detail-open wa-detail-open' : ''}`}>
            <ChatsView
              friends={friends}
              filteredFriends={filteredFriends}
              activeFriendId={activeFriendId}
              friendSearch={friendSearch}
              friendFilter={friendFilter}
              totalUnreadCount={totalUnreadCount}
              unreadCounts={unreadCounts}
              lastMessages={lastMessages}
              onSearch={setFriendSearch}
              onFilter={setFriendFilter}
              onCreateInvite={() => void openCreateInvite('group')}
              onEnterCode={() => { setInviteMode('accept'); setInviteOpen(true) }}
              onSelectFriend={(friendId) => { setActiveFriendId(friendId); setMobileChatOpen(true) }}
              onLongPress={(friendId) => setChatMenuFriend(friends.find((friend) => friend.id === friendId) ?? null)}
              onPreviewAvatar={(friend) => setPreviewAvatarFriend(friend)}
            />
            {mobileChatOpen && activeFriend && (
              <ChatDetailView
                friend={activeFriend}
                messages={activeMessages}
                userId={auth?.currentUser?.uid ?? ''}
                draft={draft}
                bottomRef={bottomRef}
                pinnedMessageId={pinnedMessageId}
                friends={friends}
                onBack={() => setMobileChatOpen(false)}
                onDraft={setDraft}
                onSend={(replyTo) => void sendMessage(replyTo)}
                onEditMessage={handleEditMessage}
                onDeleteForMe={handleDeleteForMe}
                onDeleteForEveryone={handleDeleteForEveryone}
                onTogglePin={handleTogglePin}
                onForwardMessage={handleForwardMessage}
                onToast={setToast}
                onSendFile={(file, kind, duration, options) => void sendMediaFile(file, kind, duration, options)}
                onRetryMedia={retryMediaMessage}
                onSendLocation={() => void sendLocation()}
                onOpenContactPicker={() => setContactPickerOpen(true)}
                onSendVoice={(blob, duration) => void sendVoiceNote(blob, duration)}
                onVoiceError={(message) => setToast(message)}
                onVoiceCall={() => void startCall('voice')}
                onVideoCall={() => void startCall('video')}
                onShowInfo={() => setShowContactInfo(true)}
              />
            )}
          </div>
        ) : view === 'calls' ? (
          <CallsView
            logs={callLogs}
            friends={friends}
            onOpenChat={(friendId) => { setActiveFriendId(friendId); setMobileChatOpen(true); setView('home') }}
            onVoiceCall={() => { if (friends[0]) { setActiveFriendId(friends[0].id); void startCall('voice') } }}
            onBack={() => setView('home')}
          />
        ) : (
          <YouView
            profile={profile}
            profileName={profileName}
            theme={theme}
            onTheme={setTheme}
            onName={setProfileName}
            onSave={() => void saveProfile()}
            onPhotoChange={(file) => void saveProfilePhoto(file)}
            onSignOut={() => void logout()}
            onBack={() => setView('home')}
            canAddPassword={Boolean(auth?.currentUser?.email && !hasPasswordProvider())}
            onAddPassword={async (password) => { await linkEmailPasswordToCurrentUser(password); setToast('Password sign-in enabled') }}
            onSaveStatus={async (statusText) => {
              if (profile) {
                const updated = { ...profile, statusText }
                setProfile(updated)
                await saveUserProfile(updated)
                setToast('Status updated')
              }
            }}
            starredMessages={activeMessages.filter((m) => starredMessageIds.has(m.id))}
            soundEnabled={soundEnabled}
            onSoundEnabled={(val) => {
              setSoundEnabled(val)
              try { localStorage.setItem('luma.soundEnabled', String(val)) } catch { /* optional */ }
            }}
            previewEnabled={previewEnabled}
            onPreviewEnabled={(val) => {
              setPreviewEnabled(val)
              try { localStorage.setItem('luma.previewEnabled', String(val)) } catch { /* optional */ }
            }}
            notificationPermission={notificationPermission}
            onRequestNotificationPermission={() => {
              if (typeof window !== 'undefined' && 'Notification' in window) {
                void Notification.requestPermission().then((perm) => {
                  setNotificationPermission(perm)
                  if (perm === 'granted') setToast('Notifications enabled')
                  else if (perm === 'denied') setToast('Notifications blocked in browser settings')
                }).catch(() => undefined)
              }
            }}
          />
        )}
      </main>

      {!mobileChatOpen && !showContactInfo && !isInviteOpen && !scannerOpen && (
        <StitchBottomNav
          view={view}
          onView={(nextView) => { setView(nextView); setMobileChatOpen(false) }}
          profilePhotoURL={profile?.photoURL}
          unreadChats={totalUnreadCount}
          missedCalls={missedCallsCount}
        />
      )}
    </div>

    {incomingCall && <IncomingCallBanner call={incomingCall} friends={friends} onAccept={() => void acceptIncomingCall()} onDecline={() => void declineIncomingCall()} />}
    {chatMenuFriend && (
      <ChatActionsSheet
        friend={chatMenuFriend}
        onPin={() => void updateChatPin(chatMenuFriend)}
        onNickname={() => {
          const target = chatMenuFriend
          setChatMenuFriend(null)
          setNicknameModalFriend(target)
        }}
        onClear={() => void clearChat(chatMenuFriend)}
        onDelete={() => void removeChat(chatMenuFriend)}
        onClose={() => setChatMenuFriend(null)}
      />
    )}
    {nicknameModalFriend && (
      <NicknameModal
        friend={nicknameModalFriend}
        onSave={async (nickname) => {
          await updateNickname(nicknameModalFriend, nickname)
        }}
        onClose={() => setNicknameModalFriend(null)}
      />
    )}
    {contactPickerOpen && <ContactPicker friends={friends} onSelect={(friend) => void sendContact(friend)} onClose={() => setContactPickerOpen(false)} />}
    {isInviteOpen && (
      <NewChatPage
        mode={inviteMode}
        code={inviteCode}
        input={inviteInput}
        qr={inviteQr}
        expiresAt={inviteExpiresAt}
        friends={friends}
        onMode={setInviteMode}
        onInput={setInviteInput}
        onCopy={() => void copyInvite()}
        onAccept={(code) => void acceptCode(code)}
        onCreateGroup={(name, ids) => handleCreateGroup(name, ids)}
        onRegenerateCode={() => void openCreateInvite('create')}
        onClose={() => setInviteOpen(false)}
      />
    )}
    {scannerOpen && (
      <CameraScannerPage
        onDetected={(payload) => {
          setScannerOpen(false)
          void acceptCode(payload)
        }}
        onEnterManually={() => {
          setScannerOpen(false)
          setInviteMode('accept')
          setInviteOpen(true)
        }}
        onClose={() => setScannerOpen(false)}
      />
    )}
    {showContactInfo && activeFriend && (
      <ContactInfoPage
        friend={activeFriend}
        messages={activeMessages}
        starredMessageIds={starredMessageIds}
        onClose={() => setShowContactInfo(false)}
        onMessage={() => setShowContactInfo(false)}
        onEditNickname={() => {
          setNicknameModalFriend(activeFriend)
        }}
        onVoiceCall={() => { setShowContactInfo(false); void startCall('voice') }}
        onVideoCall={() => { setShowContactInfo(false); void startCall('video') }}
        onToggleMute={() => {
          setFriends((prev) => prev.map((f) => f.id === activeFriend.id ? { ...f, muted: !f.muted } : f))
          setToast(activeFriend.muted ? 'Notifications unmuted' : 'Notifications muted')
        }}
        onCycleDisappearing={() => {
          const nextTimer = !activeFriend.disappearingTimer ? 86400000 : activeFriend.disappearingTimer === 86400000 ? 604800000 : activeFriend.disappearingTimer === 604800000 ? 7776000000 : 0
          setFriends((prev) => prev.map((f) => f.id === activeFriend.id ? { ...f, disappearingTimer: nextTimer } : f))
          setToast(`Disappearing messages set to ${nextTimer === 0 ? 'Off' : nextTimer === 86400000 ? '24 hours' : nextTimer === 604800000 ? '7 days' : '90 days'}`)
        }}
      />
    )}
    {previewAvatarFriend && (
      <AvatarPreviewModal
        friend={previewAvatarFriend}
        onClose={() => setPreviewAvatarFriend(null)}
        onOpenChat={() => {
          setActiveFriendId(previewAvatarFriend.id)
          setMobileChatOpen(true)
        }}
        onVoiceCall={() => {
          setActiveFriendId(previewAvatarFriend.id)
          void startCall('voice')
        }}
        onVideoCall={() => {
          setActiveFriendId(previewAvatarFriend.id)
          void startCall('video')
        }}
        onInfo={() => {
          setActiveFriendId(previewAvatarFriend.id)
          setShowContactInfo(true)
        }}
      />
    )}
    {callKind && <CallOverlay kind={callKind} friend={callPeer ?? activeFriend ?? { id: '', name: 'Caller', handle: '', initials: '?', color: '#9f8cad', online: true, conversationId: '', pairingSecret: '' }} phase={callPhase} elapsed={callElapsed} quality={quality} effectiveQuality={effectiveQuality} network={network} localVideoRef={localVideoRef} remoteVideoRef={remoteVideoRef} localStream={localStream} remoteStream={remoteStream} cameraEnabled={cameraEnabled} facingMode={facingMode} remoteMirrorMode={remoteMirrorMode} muted={muted} speakerEnabled={speakerEnabled} isScreenSharing={isScreenSharing} showQualityMenu={showQualityMenu} setShowQualityMenu={setShowQualityMenu} onQuality={setCallQuality} onMute={toggleMic} onCamera={toggleCamera} onSwitchCamera={() => void switchCamera()} onCapturePhoto={() => void captureCallPhoto()} onScreenShare={() => void toggleScreenShare()} onPictureInPicture={() => void openPictureInPicture()} onSpeaker={() => setSpeakerEnabled((value) => { const next = !value; try { if (callKind) localStorage.setItem(callKind === 'video' ? 'luma_call_speaker_video' : 'luma_call_speaker_voice', String(next)) } catch {} return next })} onToggleOutgoingMirror={(enabled) => callRef.current?.sendPeerMirrorPreference(enabled)} onApplyZoom={(zoom) => callRef.current?.applyCameraZoom(zoom)} onEnd={endCall} />}
    {toast && <div className="stitch-toast wa-toast"><Check size={15} />{toast}</div>}
  </div>
}

function ChatsView({
  friends,
  filteredFriends,
  activeFriendId,
  friendSearch,
  friendFilter,
  totalUnreadCount,
  unreadCounts,
  lastMessages,
  onSearch,
  onFilter,
  onCreateInvite,
  onEnterCode,
  onSelectFriend,
  onLongPress,
  onPreviewAvatar,
}: {
  friends: Friend[]
  filteredFriends: Friend[]
  activeFriendId: string
  friendSearch: string
  friendFilter: 'all' | 'unread' | 'favourites' | 'groups'
  totalUnreadCount: number
  unreadCounts: Record<string, number>
  lastMessages: Record<string, { text: string; timestamp: number; status?: MessageStatus }>
  onSearch: (value: string) => void
  onFilter: (value: 'all' | 'unread' | 'favourites' | 'groups') => void
  onCreateInvite: () => void
  onEnterCode: () => void
  onSelectFriend: (friendId: string) => void
  onLongPress: (friendId: string) => void
  onPreviewAvatar: (friend: Friend) => void
}) {
  const longPressTimer = useRef<number | null>(null)
  const longPressTriggered = useRef(false)
  function clearLongPress() { if (longPressTimer.current) window.clearTimeout(longPressTimer.current); longPressTimer.current = null }
  function startLongPress(friendId: string, event: React.PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    longPressTriggered.current = false
    clearLongPress()
    longPressTimer.current = window.setTimeout(() => { longPressTriggered.current = true; onLongPress(friendId) }, 520)
  }

  return (
    <section className="stitch-chats-view wa-chats-view">
      {/* Search Pill matching IMG_1628.PNG */}
      <div className="stitch-search-wrap wa-search-wrap">
        <div className="wa-search-pill">
          <span className="wa-meta-ai-badge" aria-hidden="true">
            <span className="wa-meta-ai-ring" />
          </span>
          <Search size={18} className="wa-search-lens" />
          <input
            value={friendSearch}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Ask Meta AI or Search"
            aria-label="Ask Meta AI or Search"
          />
          {friendSearch && (
            <button onClick={() => onSearch('')} aria-label="Clear search" className="wa-search-clear">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Filter chips matching IMG_1628.PNG */}
      <div className="stitch-filter-row wa-filter-chips">
        <button
          className={`wa-filter-chip ${friendFilter === 'all' ? 'active' : ''}`}
          onClick={() => onFilter('all')}
        >
          All
        </button>
        <button
          className={`wa-filter-chip ${friendFilter === 'unread' ? 'active' : ''}`}
          onClick={() => onFilter('unread')}
        >
          Unread {totalUnreadCount > 0 && <span className="wa-chip-badge">{totalUnreadCount}</span>}
        </button>
        <button
          className={`wa-filter-chip ${friendFilter === 'favourites' ? 'active' : ''}`}
          onClick={() => onFilter('favourites')}
        >
          Favourites
        </button>
        <button
          className={`wa-filter-chip ${friendFilter === 'groups' ? 'active' : ''}`}
          onClick={() => onFilter('groups')}
        >
          Groups
        </button>
      </div>

      {/* Contact list matching IMG_1628.PNG */}
      <div className="stitch-contact-list wa-chat-list">
        {filteredFriends.map((friend) => {
          const count = unreadCounts[friend.id] ?? 0
          const lastMsg = lastMessages[friend.id]
          const displayTime = lastMsg?.timestamp
            ? formatChatRowTimestamp(lastMsg.timestamp)
            : friend.online
            ? 'Online'
            : friend.lastSeen
            ? formatChatRowTimestamp(friend.lastSeen)
            : ''
          const snippetText = lastMsg?.text
            ? lastMsg.text
            : friend.isGroup
            ? 'Group created'
            : friend.online
            ? 'Online'
            : 'Tap to chat'

          return (
            <button
              className={`stitch-contact-row wa-chat-row ${friend.id === activeFriendId ? 'selected' : ''}`}
              key={friend.id}
              onPointerDown={(event) => startLongPress(friend.id, event)}
              onPointerUp={clearLongPress}
              onPointerCancel={clearLongPress}
              onPointerLeave={clearLongPress}
              onContextMenu={(event) => {
                event.preventDefault()
                clearLongPress()
                longPressTriggered.current = true
                onLongPress(friend.id)
              }}
              onClick={(event) => {
                if (longPressTriggered.current) {
                  event.preventDefault()
                  longPressTriggered.current = false
                  return
                }
                onSelectFriend(friend.id)
              }}
            >
              <div
                className="stitch-contact-avatar wa-chat-avatar-wrap"
                onClick={(e) => {
                  e.stopPropagation()
                  onPreviewAvatar(friend)
                }}
              >
                <Avatar friend={friend} size="normal" />
                {friend.online && <span className="wa-presence-dot" />}
              </div>
              <div className="stitch-contact-copy wa-chat-row-middle">
                <div className="wa-chat-row-top">
                  <span className="wa-contact-name">{getDisplayName(friend)}</span>
                  <span className="wa-chat-time">{displayTime}</span>
                </div>
                <div className="wa-chat-row-bottom">
                  <div className="wa-chat-snippet">
                    {lastMsg?.status && <MessageStatusIcon status={lastMsg.status} />}
                    <span className="wa-snippet-text">{snippetText}</span>
                  </div>
                  <div className="wa-chat-row-badges">
                    {friend.pinned && <Pin size={14} className="wa-pinned-icon" />}
                    {count > 0 && <span className="wa-unread-pill">{count}</span>}
                  </div>
                </div>
              </div>
            </button>
          )
        })}

        {filteredFriends.length === 0 && (
          <div className="stitch-empty-list wa-empty-chats">
            <div className="wa-empty-icon"><MessageCircle size={36} /></div>
            <strong>{friends.length ? (friendFilter === 'favourites' ? 'No favourite chats yet' : friendFilter === 'unread' ? 'No unread chats' : 'No results found') : 'No chats yet'}</strong>
            <p>{friends.length ? (friendFilter === 'favourites' ? 'Long-press a chat to pin or add it to favourites.' : friendFilter === 'unread' ? 'All caught up! No unread messages.' : 'Try a different search term.') : 'Start chatting with a friend by sharing a private one-time invite code.'}</p>
            <div className="wa-empty-btn-group">
              <button className="wa-action-button-green" onClick={onCreateInvite}>New Chat / Invite</button>
              <button className="wa-action-button-gray" onClick={onEnterCode}>Enter Code</button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function PinnedMessageBanner({
  pinnedMessage,
  onJump,
  onUnpin,
}: {
  pinnedMessage: ChatMessage
  onJump: () => void
  onUnpin: () => void
}) {
  return (
    <div className="stitch-pinned-bar" onClick={onJump}>
      <Pin size={16} />
      <div className="stitch-pinned-bar-text">
        <strong>Pinned Message</strong>
        <span>{pinnedMessage.text || (pinnedMessage.kind === 'call' ? 'Call' : 'Attachment')}</span>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onUnpin()
        }}
        aria-label="Unpin message"
      >
        <X size={15} />
      </button>
    </div>
  )
}

function SwipeableMessageRow({
  message,
  groupedMessages,
  mine,
  isPinned,
  onReply,
  onOpenMenu,
  onJumpToQuoted,
  onRetryMedia,
}: {
  message: ChatMessage
  groupedMessages?: ChatMessage[]
  mine: boolean
  isPinned: boolean
  onReply: (message: ChatMessage) => void
  onOpenMenu: (message: ChatMessage, rect: DOMRect, isMine: boolean, groupedMessages?: ChatMessage[]) => void
  onJumpToQuoted: (messageId: string) => void
  onRetryMedia: (messageId: string) => void
}) {
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const isHorizontalDragRef = useRef<boolean | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const hasVibratedRef = useRef(false)

  function clearLongPress() {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    touchStartRef.current = { x: e.clientX, y: e.clientY }
    isHorizontalDragRef.current = null
    hasVibratedRef.current = false
    clearLongPress()
    longPressTimerRef.current = window.setTimeout(() => {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(15)
      const el = document.getElementById(`stitch-msg-${message.id}`)
      const rect = el?.getBoundingClientRect() ?? e.currentTarget.getBoundingClientRect()
      onOpenMenu(message, rect, mine, groupedMessages)
    }, 450)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!touchStartRef.current) return
    const dx = e.clientX - touchStartRef.current.x
    const dy = e.clientY - touchStartRef.current.y

    if (Math.hypot(dx, dy) > 8) {
      clearLongPress()
    }

    if (isHorizontalDragRef.current === null) {
      if (Math.abs(dy) > 7 && Math.abs(dy) > Math.abs(dx)) {
        isHorizontalDragRef.current = false
        clearLongPress()
      } else if (dx > 10 && Math.abs(dx) > Math.abs(dy)) {
        isHorizontalDragRef.current = true
        clearLongPress()
        setIsDragging(true)
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* optional */
        }
      }
    }

    if (isHorizontalDragRef.current === true) {
      const clamped = Math.max(0, Math.min(dx, 75))
      setDragX(clamped)
      if (clamped >= 45 && !hasVibratedRef.current) {
        hasVibratedRef.current = true
        if (typeof navigator.vibrate === 'function') navigator.vibrate(10)
      } else if (clamped < 45) {
        hasVibratedRef.current = false
      }
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    clearLongPress()
    if (isHorizontalDragRef.current === true) {
      if (dragX >= 45 && !message.deletedForEveryone) {
        onReply(message)
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* optional */
      }
    }
    setDragX(0)
    setIsDragging(false)
    touchStartRef.current = null
    isHorizontalDragRef.current = null
  }

  function handlePointerCancel() {
    clearLongPress()
    setDragX(0)
    setIsDragging(false)
    touchStartRef.current = null
    isHorizontalDragRef.current = null
  }

  return (
    <div
      className={`stitch-message-row ${mine ? 'mine' : ''}`}
      id={`stitch-msg-${message.id}`}
      style={{ touchAction: 'pan-y' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => {
        e.preventDefault()
        clearLongPress()
        const rect = e.currentTarget.getBoundingClientRect()
        onOpenMenu(message, rect, mine, groupedMessages)
      }}
    >
      {!message.deletedForEveryone && (
        <div
          className="stitch-swipe-reply-icon"
          style={{
            opacity: Math.min(1, dragX / 35),
            transform: `translate3d(${dragX - 28}px, -50%, 0) scale(${Math.min(1, Math.max(0.4, dragX / 45))})`,
          }}
        >
          <Reply size={15} />
        </div>
      )}

      <div
        className={`stitch-message ${mine ? 'mine' : ''} ${isPinned ? 'pinned' : ''}`}
        style={{
          transform: dragX ? `translate3d(${dragX}px, 0, 0)` : undefined,
          transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          position: 'relative',
        }}
      >
        {isPinned && (
          <div className="stitch-message-pinned-tag">
            <Pin size={11} />
            <span>Pinned</span>
          </div>
        )}

        {message.forwarded && !message.deletedForEveryone && (
          <div className="stitch-message-forwarded-tag">
            <Forward size={12} />
            <span>Forwarded</span>
          </div>
        )}

        {message.replyTo && !message.deletedForEveryone && (
          <div
            className="stitch-quoted-bubble"
            onClick={(e) => {
              e.stopPropagation()
              if (message.replyTo) onJumpToQuoted(message.replyTo.messageId)
            }}
          >
            <strong>{message.replyTo.senderName}</strong>
            <p>{message.replyTo.snippet}</p>
          </div>
        )}

        {message.deletedForEveryone ? (
          <div className="stitch-deleted-bubble">
            <Ban size={15} />
            <span>This message was deleted</span>
          </div>
        ) : (
          <MessageBubble message={message} groupedMessages={groupedMessages} onRetryMedia={onRetryMedia} />
        )}

        <span className="stitch-message-time">
          {formatTime(message.createdAt)}
          {message.edited && !message.deletedForEveryone && <span className="stitch-edited-badge"> · edited</span>}
          {mine && <MessageStatusIcon status={message.status} />}
        </span>

        {!message.deletedForEveryone && (
          <button
            type="button"
            className="stitch-message-more-btn"
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.closest('.stitch-message')?.getBoundingClientRect() ?? e.currentTarget.getBoundingClientRect()
              onOpenMenu(message, rect, mine, groupedMessages)
            }}
            aria-label="Message options"
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

function WhatsAppPinnedContextMenu({
  message,
  groupedMessages,
  rect,
  isMine,
  pinnedMessageId,
  userId,
  onReaction,
  onReply,
  onForward,
  onCopy,
  onDownloadAll,
  onDownloadSingle,
  onEdit,
  onPin,
  onInfo,
  onDelete,
  onClose,
}: {
  message: ChatMessage
  groupedMessages?: ChatMessage[]
  rect: DOMRect
  isMine: boolean
  pinnedMessageId: string | null
  userId: string
  onReaction: (reaction: string) => void
  onReply: () => void
  onForward: () => void
  onCopy: () => void
  onDownloadAll?: () => void
  onDownloadSingle?: () => void
  onEdit?: () => void
  onPin: () => void
  onInfo: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const isPinned = pinnedMessageId === message.id
  const hasGroup = groupedMessages && groupedMessages.length > 1
  const hasAttachment = Boolean(message.attachment?.url)
  const canEdit = message.senderId === userId && !message.deletedForEveryone && message.kind === 'text'

  const cardWidth = 230
  const reactionTop = Math.max(16, rect.top - 54)
  const reactionLeft = isMine
    ? Math.max(12, Math.min(window.innerWidth - 270, rect.right - 260))
    : Math.max(12, Math.min(window.innerWidth - 270, rect.left))

  const showBelow = rect.bottom + 320 < window.innerHeight
  const cardTop = showBelow ? rect.bottom + 8 : Math.max(16, rect.top - 310)
  const cardLeft = isMine
    ? Math.max(12, Math.min(window.innerWidth - cardWidth - 16, rect.right - cardWidth))
    : Math.max(12, Math.min(window.innerWidth - cardWidth - 16, rect.left))

  return (
    <div className="wa-message-menu-backdrop" onClick={onClose}>
      <div
        className="wa-message-reaction-bar"
        style={{ top: `${reactionTop}px`, left: `${reactionLeft}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        {['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="wa-reaction-btn"
            onClick={() => onReaction(emoji)}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className="wa-reaction-btn plus"
          onClick={() => onReaction('✨')}
          aria-label="Add reaction"
        >
          <Plus size={18} />
        </button>
      </div>

      <div
        className="wa-message-context-card"
        style={{ top: `${cardTop}px`, left: `${cardLeft}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        {!message.deletedForEveryone && (
          <button type="button" className="wa-menu-row" onClick={onPin}>
            <span>{isPinned ? 'Unpin' : 'Star / Pin'}</span>
            {isPinned ? <PinOff size={18} /> : <Pin size={18} />}
          </button>
        )}
        <button type="button" className="wa-menu-row" onClick={onReply}>
          <span>Reply</span>
          <Reply size={18} />
        </button>
        {!message.deletedForEveryone && (
          <button type="button" className="wa-menu-row" onClick={onForward}>
            <span>Forward</span>
            <Forward size={18} />
          </button>
        )}
        {!message.deletedForEveryone && Boolean(message.text) && (
          <button type="button" className="wa-menu-row" onClick={onCopy}>
            <span>Copy</span>
            <Copy size={18} />
          </button>
        )}
        {hasGroup && onDownloadAll && (
          <button type="button" className="wa-menu-row" onClick={onDownloadAll}>
            <span>Download all ({groupedMessages.length})</span>
            <Download size={18} />
          </button>
        )}
        {!hasGroup && hasAttachment && onDownloadSingle && (
          <button type="button" className="wa-menu-row" onClick={onDownloadSingle}>
            <span>Download photo</span>
            <Download size={18} />
          </button>
        )}
        {canEdit && onEdit && (
          <button type="button" className="wa-menu-row" onClick={onEdit}>
            <span>Edit</span>
            <Pencil size={18} />
          </button>
        )}
        <button type="button" className="wa-menu-row" onClick={onInfo}>
          <span>Info</span>
          <Info size={18} />
        </button>
        <button type="button" className="wa-menu-row danger" onClick={onDelete}>
          <span>Delete</span>
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  )
}

function ForwardModal({
  friends,
  message,
  onForward,
  onClose,
}: {
  friends: Friend[]
  message: ChatMessage
  onForward: (targetFriends: Friend[], message: ChatMessage) => void
  onClose: () => void
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const toggleFriend = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    )
  }
  const handleSubmit = () => {
    const targets = friends.filter((f) => selectedIds.includes(f.id))
    if (targets.length === 0) return
    onForward(targets, message)
    onClose()
  }
  return (
    <div className="stitch-sheet-backdrop" onClick={onClose}>
      <div className="stitch-forward-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="stitch-forward-header">
          <strong>Forward to…</strong>
          <button type="button" onClick={onClose} aria-label="Close forward dialog">
            <X size={18} />
          </button>
        </div>
        <div className="stitch-forward-list">
          {friends.map((f) => {
            const isSelected = selectedIds.includes(f.id)
            return (
              <div
                key={f.id}
                className={`stitch-forward-row ${isSelected ? 'selected' : ''}`}
                onClick={() => toggleFriend(f.id)}
              >
                <Avatar friend={f} size="small" />
                <div className="stitch-forward-info">
                  <strong>{getDisplayName(f)}</strong>
                  <span>Private contact</span>
                </div>
                <div className={`stitch-forward-checkbox ${isSelected ? 'checked' : ''}`}>
                  {isSelected && <Check size={14} />}
                </div>
              </div>
            )
          })}
          {friends.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
              No contacts available to forward to.
            </p>
          )}
        </div>
        <div className="stitch-forward-footer">
          <button type="button" className="stitch-forward-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="stitch-forward-submit"
            disabled={selectedIds.length === 0}
            onClick={handleSubmit}
          >
            Forward{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageInfoModal({
  message,
  onClose,
}: {
  message: ChatMessage
  onClose: () => void
}) {
  const isRead = message.status === 'read'
  const isDelivered = message.status === 'delivered' || isRead
  return (
    <div className="stitch-sheet-backdrop" onClick={onClose}>
      <div className="stitch-info-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="stitch-info-header">
          <strong>Message Info</strong>
          <button type="button" onClick={onClose} aria-label="Close message info">
            <X size={18} />
          </button>
        </div>
        <div className="stitch-info-preview">
          <p>{message.text || (message.kind === 'call' ? 'Call event' : 'Attachment')}</p>
        </div>
        <div className="stitch-info-timeline">
          <div className="stitch-info-timeline-item">
            <div className={`stitch-info-icon-wrap ${isRead ? 'read' : ''}`}>
              <CheckCheck size={16} />
            </div>
            <div className="stitch-info-item-content">
              <strong>Read</strong>
              <span>{isRead ? formatTime(message.createdAt) : '—'}</span>
            </div>
          </div>
          <div className="stitch-info-timeline-item">
            <div className={`stitch-info-icon-wrap ${isDelivered ? 'delivered' : ''}`}>
              <CheckCheck size={16} />
            </div>
            <div className="stitch-info-item-content">
              <strong>Delivered</strong>
              <span>{isDelivered ? formatTime(message.createdAt) : '—'}</span>
            </div>
          </div>
          <div className="stitch-info-timeline-item">
            <div className="stitch-info-icon-wrap sent">
              <Check size={16} />
            </div>
            <div className="stitch-info-item-content">
              <strong>Sent</strong>
              <span>{formatTime(message.createdAt)}</span>
            </div>
          </div>
          {message.edited && message.editedAt && (
            <div className="stitch-info-timeline-item">
              <div className="stitch-info-icon-wrap edited">
                <Pencil size={15} />
              </div>
              <div className="stitch-info-item-content">
                <strong>Edited</strong>
                <span>{formatTime(message.editedAt)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DeleteConfirmDialog({
  message,
  userId,
  onDeleteForMe,
  onDeleteForEveryone,
  onClose,
}: {
  message: ChatMessage
  userId: string
  onDeleteForMe: (id: string) => void
  onDeleteForEveryone: (id: string) => void
  onClose: () => void
}) {
  const canDeleteForEveryone = message.senderId === userId && !message.deletedForEveryone
  return (
    <div className="stitch-sheet-backdrop" onClick={onClose}>
      <div className="stitch-delete-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="stitch-delete-header">
          <div>
            <strong>Delete message?</strong>
            <p>You can delete this message for yourself or for everyone in this chat.</p>
          </div>
        </div>
        <div className="stitch-delete-actions">
          {canDeleteForEveryone && (
            <button
              type="button"
              className="stitch-delete-btn everyone"
              onClick={() => {
                onDeleteForEveryone(message.id)
                onClose()
              }}
            >
              Delete for everyone
            </button>
          )}
          <button
            type="button"
            className="stitch-delete-btn me"
            onClick={() => {
              onDeleteForMe(message.id)
              onClose()
            }}
          >
            Delete for me
          </button>
          <button
            type="button"
            className="stitch-delete-btn cancel"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatDetailView({
  friend,
  messages,
  userId,
  draft,
  bottomRef,
  pinnedMessageId,
  friends,
  onBack,
  onDraft,
  onSend,
  onEditMessage,
  onDeleteForMe,
  onDeleteForEveryone,
  onTogglePin,
  onForwardMessage,
  onToast,
  onSendFile,
  onRetryMedia,
  onSendLocation,
  onOpenContactPicker,
  onSendVoice,
  onVoiceError,
  onVoiceCall,
  onVideoCall,
  onShowInfo,
}: {
  friend: Friend
  messages: ChatMessage[]
  userId: string
  draft: string
  bottomRef: RefObject<HTMLDivElement | null>
  pinnedMessageId: string | null
  friends: Friend[]
  onBack: () => void
  onDraft: (value: string) => void
  onSend: (replyTo?: ReplyReference) => void
  onEditMessage: (messageId: string, text: string) => Promise<void>
  onDeleteForMe: (messageId: string) => Promise<void>
  onDeleteForEveryone: (messageId: string) => Promise<void>
  onTogglePin: (messageId: string) => Promise<void>
  onForwardMessage: (targetFriends: Friend[], message: ChatMessage) => Promise<void>
  onToast: (msg: string) => void
  onSendFile: (file: File, kind?: Extract<MessageKind, 'image' | 'video' | 'document' | 'audio'>, durationSeconds?: number, options?: MediaSendOptions) => void
  onRetryMedia: (messageId: string) => void
  onSendLocation: () => void
  onOpenContactPicker: () => void
  onSendVoice: (blob: Blob, durationSeconds: number) => void
  onVoiceError: (message: string) => void
  onVoiceCall: () => void
  onVideoCall: () => void
  onShowInfo: () => void
}) {
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [stickerMenuOpen, setStickerMenuOpen] = useState(false)
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null)
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null)
  const [activeMessageMenu, setActiveMessageMenu] = useState<{ message: ChatMessage; groupedMessages?: ChatMessage[]; rect: DOMRect; isMine: boolean } | null>(null)
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null)
  const [infoMessage, setInfoMessage] = useState<ChatMessage | null>(null)
  const [deletingMessage, setDeletingMessage] = useState<ChatMessage | null>(null)
  const [voiceMode, setVoiceMode] = useState(false)
  const [edgeDragX, setEdgeDragX] = useState(0)
  const [isEdgeSwiping, setIsEdgeSwiping] = useState(false)
  const edgeTouchStartRef = useRef<{ x: number; y: number; active: boolean; eligible: boolean }>({
    x: 0,
    y: 0,
    active: false,
    eligible: false,
  })

  const composerInputRef = useRef<HTMLInputElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)

  const pinnedMessage = useMemo(
    () => messages.find((m) => m.id === pinnedMessageId) ?? null,
    [messages, pinnedMessageId]
  )

  function handleEdgePointerDown(e: React.PointerEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const relativeX = e.clientX - rect.left
    if (relativeX <= 38 || e.clientX <= 38) {
      edgeTouchStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        active: true,
        eligible: true,
      }
    } else {
      edgeTouchStartRef.current.eligible = false
    }
  }

  function handleEdgePointerMove(e: React.PointerEvent<HTMLElement>) {
    if (!edgeTouchStartRef.current.eligible || !edgeTouchStartRef.current.active) return
    const deltaX = e.clientX - edgeTouchStartRef.current.x
    const deltaY = Math.abs(e.clientY - edgeTouchStartRef.current.y)

    if (deltaX < 0 || (deltaY > 20 && deltaY > deltaX)) {
      edgeTouchStartRef.current.eligible = false
      setIsEdgeSwiping(false)
      setEdgeDragX(0)
      return
    }

    if (deltaX > 8) {
      setIsEdgeSwiping(true)
      setEdgeDragX(Math.min(deltaX, window.innerWidth))
    }
  }

  function handleEdgePointerUp(e: React.PointerEvent<HTMLElement>) {
    if (edgeTouchStartRef.current.active && isEdgeSwiping) {
      const deltaX = e.clientX - edgeTouchStartRef.current.x
      if (deltaX > 75 || edgeDragX > 75) {
        onBack()
      }
    }
    edgeTouchStartRef.current = { x: 0, y: 0, active: false, eligible: false }
    setIsEdgeSwiping(false)
    setEdgeDragX(0)
  }

  function handleEdgePointerCancel() {
    edgeTouchStartRef.current = { x: 0, y: 0, active: false, eligible: false }
    setIsEdgeSwiping(false)
    setEdgeDragX(0)
  }

  function chooseFiles(ref: RefObject<HTMLInputElement | null>) {
    setAttachmentMenuOpen(false)
    ref.current?.click()
  }

  function handleFiles(
    event: React.ChangeEvent<HTMLInputElement>,
    kind?: Extract<MessageKind, 'image' | 'video' | 'document'>
  ) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    files.forEach((file) => onSendFile(file, kind, undefined, { isDocument: kind === 'document' }))
  }

  function scrollToMessage(id: string) {
    const el = document.getElementById(`stitch-msg-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('flash-highlight')
      window.setTimeout(() => {
        el.classList.remove('flash-highlight')
      }, 1500)
    }
  }

  function handleStartReply(message: ChatMessage) {
    setEditingMessage(null)
    setReplyingTo(message)
    window.setTimeout(() => composerInputRef.current?.focus(), 50)
  }

  function handleStartEdit(message: ChatMessage) {
    setReplyingTo(null)
    setEditingMessage(message)
    onDraft(message.text)
    window.setTimeout(() => composerInputRef.current?.focus(), 50)
  }

  async function handleCopyMessage(message: ChatMessage) {
    if (message.deletedForEveryone) {
      onToast('Cannot copy deleted message')
      return
    }
    if (!message.text) return
    try {
      await navigator.clipboard.writeText(message.text)
      onToast('Copied to clipboard')
    } catch {
      onToast('Could not copy to clipboard')
    }
  }

  function handleComposerSubmit() {
    if (editingMessage) {
      const text = draft.trim()
      if (text && text !== editingMessage.text) {
        void onEditMessage(editingMessage.id, text)
      }
      setEditingMessage(null)
      onDraft('')
      return
    }

    const replyReference: ReplyReference | undefined = replyingTo
      ? {
          messageId: replyingTo.id,
          senderName: replyingTo.senderId === userId ? 'You' : getDisplayName(friend),
          snippet: replyingTo.text
            ? replyingTo.text.length > 80
              ? replyingTo.text.slice(0, 77) + '…'
              : replyingTo.text
            : replyingTo.kind === 'call'
              ? 'Call'
              : 'Attachment',
        }
      : undefined

    onSend(replyReference)
    setReplyingTo(null)
  }



  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [friend.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  return (
    <section
      className={`stitch-chat-view wa-chat-view ${isEdgeSwiping ? 'is-edge-swiping' : ''}`}
      style={{
        transform: edgeDragX > 0 ? `translateX(${edgeDragX}px)` : undefined,
        transition: isEdgeSwiping ? 'none' : 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        touchAction: 'pan-y',
      }}
      onPointerDown={handleEdgePointerDown}
      onPointerMove={handleEdgePointerMove}
      onPointerUp={handleEdgePointerUp}
      onPointerCancel={handleEdgePointerCancel}
    >
      <div className="wa-edge-swipe-hitbox" aria-hidden="true" />
      <header className="stitch-chat-header wa-detail-header">
        <button className="stitch-back-button wa-back-pill" onClick={onBack} aria-label="Back to chats">
          <ChevronLeft size={22} className="wa-back-chevron" />
        </button>
        <button type="button" className="stitch-chat-identity wa-detail-contact" onClick={onShowInfo} aria-label={`Open ${getDisplayName(friend)}'s profile`}>
          <div className="wa-detail-avatar-wrap">
            <Avatar friend={friend} size="small" />
            {friend.online && <span className="wa-presence-dot small" />}
          </div>
          <div className="stitch-chat-person wa-detail-titles">
            <strong className="wa-detail-name">{getDisplayName(friend)}</strong>
            <small className="wa-detail-subtitle">
              {friend.online ? 'online' : 'tap here for contact info'}
            </small>
          </div>
        </button>
        <div className="wa-call-pill-group">
          <button className="stitch-chat-action wa-call-pill-btn" onClick={onVideoCall} aria-label="Video call">
            <Video size={19} />
          </button>
          <button className="stitch-chat-action wa-call-pill-btn" onClick={onVoiceCall} aria-label="Voice call">
            <Phone size={18} />
          </button>
        </div>
      </header>

      {pinnedMessage && (
        <PinnedMessageBanner
          pinnedMessage={pinnedMessage}
          onJump={() => scrollToMessage(pinnedMessage.id)}
          onUnpin={() => void onTogglePin(pinnedMessage.id)}
        />
      )}

      <div className="stitch-conversation wa-conversation">
        {messages.length === 0 && (
          <div className="stitch-empty-conversation">
            <MessageCircle size={26} />
            <strong>Start a private conversation</strong>
            <span>Messages are encrypted before they leave your device.</span>
          </div>
        )}
        {groupDisplayMessages(messages).map(({ message, messages: groupedMessages }, idx, all) => {
          const mine = message.senderId === userId
          const isPinned = groupedMessages.some((item) => item.id === pinnedMessageId)
          const currentDay = formatMessageDayHeader(message.createdAt)
          const prevMsg = idx > 0 ? all[idx - 1].message : null
          const prevDay = prevMsg ? formatMessageDayHeader(prevMsg.createdAt) : null
          const showDayHeader = idx === 0 || currentDay !== prevDay

          return (
            <div key={message.id} className="wa-msg-wrapper">
              {showDayHeader && (
                <div className="stitch-day-label wa-day-pill">{currentDay}</div>
              )}
              {idx === 0 && (
                <div className="wa-encryption-notice">
                  <LockKeyhole size={12} className="wa-yellow-lock" />
                  <span>Messages and calls are end-to-end encrypted. No one outside of this chat, not even LumaChat, can read or listen to them.</span>
                </div>
              )}
              <SwipeableMessageRow
                message={message}
                groupedMessages={groupedMessages}
                mine={mine}
                isPinned={isPinned}
                onReply={handleStartReply}
                onOpenMenu={(msg, rect, isMine, grp) => setActiveMessageMenu({ message: msg, rect, isMine, groupedMessages: grp })}
                onJumpToQuoted={scrollToMessage}
                onRetryMedia={onRetryMedia}
              />
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="stitch-composer-area">
        <input ref={mediaInputRef} hidden type="file" accept="image/*,video/*" multiple onChange={(event) => handleFiles(event)} />
        <input ref={cameraInputRef} hidden type="file" accept="image/*,video/*" capture="environment" onChange={(event) => handleFiles(event)} />
        <input ref={documentInputRef} hidden type="file" accept="*/*" onChange={(event) => handleFiles(event, 'document')} />

        {attachmentMenuOpen && (
          <div className="stitch-attachment-menu">
            <button onClick={() => chooseFiles(mediaInputRef)}><ImageIcon size={18} /><span>Photos & videos</span></button>
            <button onClick={() => chooseFiles(cameraInputRef)}><Camera size={18} /><span>Camera</span></button>
            <button onClick={() => { setAttachmentMenuOpen(false); onSendLocation() }}><MapPin size={18} /><span>Location</span></button>
            <button onClick={() => { setAttachmentMenuOpen(false); onOpenContactPicker() }}><UserRoundCheck size={18} /><span>Contact</span></button>
            <button onClick={() => chooseFiles(documentInputRef)}><FileText size={18} /><span>Document</span></button>
          </div>
        )}

        {stickerMenuOpen && (
          <div className="stitch-sticker-menu" aria-label="Stickers">
            {['❤️', '😊', '😘', '😂', '🥰', '🤍', '✨', '👍'].map((sticker) => (
              <button key={sticker} onClick={() => { onDraft(`${draft}${sticker}`); setStickerMenuOpen(false) }}>{sticker}</button>
            ))}
          </div>
        )}

        {replyingTo && (
          <div className="stitch-reply-banner">
            <div className="stitch-reply-banner-content">
              <div className="stitch-reply-banner-title">
                <Reply size={13} />
                <span>Replying to {replyingTo.senderId === userId ? 'yourself' : getDisplayName(friend)}</span>
              </div>
              <p className="stitch-reply-banner-preview">
                {replyingTo.text || (replyingTo.kind === 'call' ? 'Call' : 'Attachment')}
              </p>
            </div>
            <button
              type="button"
              className="stitch-reply-banner-close"
              onClick={() => setReplyingTo(null)}
              aria-label="Cancel reply"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {editingMessage && (
          <div className="stitch-edit-banner">
            <div className="stitch-edit-banner-content">
              <div className="stitch-edit-banner-title">
                <Pencil size={13} />
                <span>Edit message</span>
              </div>
              <p className="stitch-edit-banner-preview">{editingMessage.text}</p>
            </div>
            <button
              type="button"
              className="stitch-edit-banner-close"
              onClick={() => {
                setEditingMessage(null)
                onDraft('')
              }}
              aria-label="Cancel edit"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className={`stitch-composer wa-composer-bar ${voiceMode ? 'voice-mode' : ''}`}>
          {!voiceMode ? (
            <div className="stitch-composer-controls wa-composer-row">
              <button type="button" className="stitch-composer-plus wa-composer-plus" onClick={() => setAttachmentMenuOpen((open) => !open)} aria-label="Add attachment">
                <Plus size={24} />
              </button>
              <div className="wa-composer-pill">
                <input
                  ref={composerInputRef}
                  type="text"
                  value={draft}
                  onChange={(event) => onDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      handleComposerSubmit()
                    }
                  }}
                  placeholder={editingMessage ? 'Edit message…' : 'Message'}
                  aria-label="Message"
                  autoComplete="off"
                  autoCorrect="on"
                  autoCapitalize="sentences"
                  spellCheck={true}
                  enterKeyHint="send"
                  inputMode="text"
                  tabIndex={0}
                />
                <button type="button" className="stitch-composer-tool wa-composer-sticker" onClick={() => setStickerMenuOpen((open) => !open)} aria-label="Open stickers">
                  <Smile size={21} />
                </button>
              </div>
              <button type="button" className="stitch-composer-tool wa-composer-camera" onClick={() => chooseFiles(cameraInputRef)} aria-label="Capture photo or video">
                <Camera size={21} />
              </button>
              {draft.trim() ? (
                <button type="button" className="stitch-composer-action wa-send-circle ready" onClick={handleComposerSubmit} aria-label={editingMessage ? 'Save edit' : 'Send message'}>
                  {editingMessage ? <Check size={18} /> : <Send size={18} />}
                </button>
              ) : (
                <VoiceComposer onSend={onSendVoice} onError={onVoiceError} onActiveChange={setVoiceMode} disabled={Boolean(draft.trim())} />
              )}
            </div>
          ) : (
            <VoiceComposer onSend={onSendVoice} onError={onVoiceError} onActiveChange={setVoiceMode} disabled={Boolean(draft.trim())} />
          )}
        </div>
      </div>

      {/* Desktop Context Menu */}
      {/* WhatsApp Pinned Message Context Menu & Quick Reactions */}
      {activeMessageMenu && (
        <WhatsAppPinnedContextMenu
          message={activeMessageMenu.message}
          groupedMessages={activeMessageMenu.groupedMessages}
          rect={activeMessageMenu.rect}
          isMine={activeMessageMenu.isMine}
          pinnedMessageId={pinnedMessageId}
          userId={userId}
          onReaction={(emoji) => {
            const msg = activeMessageMenu.message
            setActiveMessageMenu(null)
            onDraft(`${draft} ${emoji}`.trim())
          }}
          onReply={() => {
            const msg = activeMessageMenu.message
            setActiveMessageMenu(null)
            handleStartReply(msg)
          }}
          onForward={() => {
            const msg = activeMessageMenu.message
            setActiveMessageMenu(null)
            setForwardingMessage(msg)
          }}
          onCopy={() => {
            const msg = activeMessageMenu.message
            setActiveMessageMenu(null)
            void handleCopyMessage(msg)
          }}
          onDownloadAll={() => {
            const grp = activeMessageMenu.groupedMessages
            setActiveMessageMenu(null)
            if (grp && grp.length > 1) {
              const atts = grp.map((m) => m.attachment).filter(Boolean) as NonNullable<ChatMessage['attachment']>[]
              void downloadAllAttachments(atts)
            }
          }}
          onDownloadSingle={() => {
            const att = activeMessageMenu.message.attachment
            setActiveMessageMenu(null)
            if (att?.url) void downloadAttachment(att.url, att.fileName)
          }}
          onEdit={() => {
            const msg = activeMessageMenu.message
            setActiveMessageMenu(null)
            handleStartEdit(msg)
          }}
          onPin={() => {
            const msg = activeMessageMenu.message
            setActiveMessageMenu(null)
            void onTogglePin(msg.id)
          }}
          onInfo={() => {
            const msg = activeMessageMenu.message
            setActiveMessageMenu(null)
            setInfoMessage(msg)
          }}
          onDelete={() => {
            const msg = activeMessageMenu.message
            setActiveMessageMenu(null)
            setDeletingMessage(msg)
          }}
          onClose={() => setActiveMessageMenu(null)}
        />
      )}

      {/* Forward Modal */}
      {forwardingMessage && (
        <ForwardModal
          friends={friends}
          message={forwardingMessage}
          onForward={onForwardMessage}
          onClose={() => setForwardingMessage(null)}
        />
      )}

      {/* Message Info Modal */}
      {infoMessage && (
        <MessageInfoModal
          message={infoMessage}
          onClose={() => setInfoMessage(null)}
        />
      )}

      {/* Delete Dialog */}
      {deletingMessage && (
        <DeleteConfirmDialog
          message={deletingMessage}
          userId={userId}
          onDeleteForMe={(id) => void onDeleteForMe(id)}
          onDeleteForEveryone={(id) => void onDeleteForEveryone(id)}
          onClose={() => setDeletingMessage(null)}
        />
      )}
    </section>
  )
}

function LinkPreviewCard({ url }: { url: string }) {
  const { preview, loading } = useLinkPreview(url)
  if (!preview && !loading) return null
  const targetUrl = preview?.url || url
  const domain = preview?.hostname || getDomain(url)

  return (
    <a
      href={targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="wa-link-preview-card"
      onClick={(e) => e.stopPropagation()}
      aria-label={`Preview: ${preview?.title || domain}`}
    >
      {preview?.image && (
        <div className="wa-link-preview-image-wrap">
          <img
            src={preview.image}
            alt={preview.title || domain}
            className="wa-link-preview-image"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget.parentElement as HTMLElement)?.style.setProperty('display', 'none')
            }}
          />
        </div>
      )}
      <div className="wa-link-preview-content">
        <div className="wa-link-preview-header">
          {preview?.favicon ? (
            <img
              src={preview.favicon}
              alt=""
              className="wa-link-preview-favicon"
              onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none' }}
            />
          ) : (
            <Globe size={13} className="wa-link-preview-favicon" />
          )}
          <span className="wa-link-preview-domain">{preview?.siteName || domain}</span>
        </div>
        {preview?.title && <strong className="wa-link-preview-title">{preview.title}</strong>}
        {preview?.description && <p className="wa-link-preview-desc">{preview.description}</p>}
      </div>
    </a>
  )
}

function FormattedMessageText({ text }: { text: string }) {
  if (!text) return null
  const firstUrl = useMemo(() => extractFirstUrl(text), [text])

  const renderedText = useMemo(() => {
    const urls = extractUrls(text)
    if (urls.length === 0) return text

    const regex = /(https?:\/\/[^\s<>"'{}|\\^`]+)/g
    const parts = text.split(regex)
    return parts.map((part, i) => {
      if (regex.test(part)) {
        const clean = part.replace(/[.,;:!?)]+$/, '')
        const trailing = part.slice(clean.length)
        return (
          <span key={i}>
            <a
              href={clean}
              target="_blank"
              rel="noopener noreferrer"
              className="wa-chat-link"
              onClick={(e) => e.stopPropagation()}
            >
              {clean}
            </a>
            {trailing}
          </span>
        )
      }
      return part
    })
  }, [text])

  return (
    <div className="stitch-message-text">
      {renderedText}
      {firstUrl && <LinkPreviewCard url={firstUrl} />}
    </div>
  )
}

function MessageBubble({ message, groupedMessages = [message], onRetryMedia }: { message: ChatMessage; groupedMessages?: ChatMessage[]; onRetryMedia?: (messageId: string) => void }) {
  if (message.kind === 'call' && message.call) {
    const title = message.call.outcome === 'completed' ? (message.call.kind === 'video' ? 'Video call' : 'Audio call') : message.call.outcome === 'declined' || message.call.outcome === 'missed' ? `Missed ${message.call.kind} call` : `Cancelled ${message.call.kind} call`
    return <div className="stitch-call-message"><span className="stitch-call-message-icon">{message.call.kind === 'video' ? <Video size={18} /> : <Phone size={18} />}</span><div><strong>{title}</strong><small>{message.call.durationSeconds ? `${formatCallDuration(message.call.durationSeconds)} · ` : ''}{formatTime(message.call.initiatedAt)}</small></div></div>
  }
  if (groupedMessages.length > 1 && groupedMessages.every((item) => item.kind === 'image' && item.attachment)) {
    return <MediaGroupMessage messages={groupedMessages} onRetryMedia={onRetryMedia} />
  }
  if ((message.kind === 'image' || message.kind === 'video') && message.attachment) return <MediaMessage messageId={message.id} kind={message.kind} attachment={message.attachment} caption={message.text} onRetry={onRetryMedia} />
  if (message.kind === 'audio' && message.attachment) return <div className="stitch-audio-message"><div className="stitch-audio-heading"><Mic size={16} /><strong>Voice note</strong><small>{message.attachment.durationSeconds ? formatCallDuration(message.attachment.durationSeconds) : ''}</small></div>{message.attachment.url ? <audio src={message.attachment.url} controls preload="metadata" /> : <span className="stitch-media-loading">Loading voice note…</span>}{message.attachment.uploadState === 'failed' && onRetryMedia && <RetryUploadButton onRetry={() => onRetryMedia(message.id)} />}</div>
  if (message.kind === 'document' && message.attachment) return <DocumentMessage messageId={message.id} attachment={message.attachment} onRetry={onRetryMedia} />
  if (message.kind === 'location' && message.location) return <a className="stitch-location-message" href={`https://www.google.com/maps/search/?api=1&query=${message.location.latitude},${message.location.longitude}`} target="_blank" rel="noreferrer"><MapPin size={22} /><span><strong>{message.location.label ?? 'Shared location'}</strong><small>{message.location.latitude.toFixed(5)}, {message.location.longitude.toFixed(5)}</small></span></a>
  if (message.kind === 'contact' && message.contact) return <div className="stitch-contact-message"><Avatar friend={message.contact} size="small" /><span><strong>{getDisplayName(message.contact)}</strong><small>Private contact</small></span></div>
  return <FormattedMessageText text={message.text} />
}

function MediaGroupMessage({
  messages,
  onRetryMedia,
}: {
  messages: ChatMessage[]
  onRetryMedia?: (messageId: string) => void
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const config = getMediaGridConfig(messages)
  const validMessages = messages.filter((m) => Boolean(m.attachment))

  const galleryItems = validMessages.map((m) => ({
    id: m.id,
    kind: (m.kind === 'video' ? 'video' : 'image') as 'image' | 'video',
    attachment: m.attachment!,
    caption: m.text,
  }))

  return (
    <>
      <div className={`wa-media-group-wrap layout-${config.layout}`} aria-label={`${messages.length} photos sent together`}>
        {config.layout === 'single' && validMessages[0] && (
          <MediaMessage
            messageId={validMessages[0].id}
            kind="image"
            attachment={validMessages[0].attachment!}
            caption={validMessages[0].text}
            onRetry={onRetryMedia}
          />
        )}

        {config.layout === 'two' && (
          <div className="wa-media-grid wa-media-grid-2">
            {validMessages.map((msg, idx) => (
              <button
                key={msg.id}
                type="button"
                className="wa-media-tile"
                onClick={() => setViewerIndex(idx)}
                aria-label={`View photo ${idx + 1}`}
              >
                <img src={msg.attachment!.url} alt={msg.attachment!.fileName} />
              </button>
            ))}
          </div>
        )}

        {config.layout === 'three' && (
          <div className="wa-media-grid wa-media-grid-3">
            {validMessages.map((msg, idx) => (
              <button
                key={msg.id}
                type="button"
                className={`wa-media-tile ${idx === 0 ? 'span-large' : ''}`}
                onClick={() => setViewerIndex(idx)}
                aria-label={`View photo ${idx + 1}`}
              >
                <img src={msg.attachment!.url} alt={msg.attachment!.fileName} />
              </button>
            ))}
          </div>
        )}

        {config.layout === 'four_plus' && (
          <div className="wa-media-grid wa-media-grid-2x2">
            {/* First 3 images displayed clearly */}
            {config.visibleImages.map((msg, idx) => (
              <button
                key={msg.id}
                type="button"
                className="wa-media-tile"
                onClick={() => setViewerIndex(idx)}
                aria-label={`View photo ${idx + 1}`}
              >
                <img src={msg.attachment!.url} alt={msg.attachment!.fileName} />
              </button>
            ))}

            {/* 4th tile: 4th image blurred with +X overlay */}
            {config.blurredTileMessage?.attachment && (
              <button
                type="button"
                className="wa-media-tile wa-media-tile-blurred"
                onClick={() => setViewerIndex(3)}
                aria-label={`View +${config.overflowCount} more photos`}
              >
                <img
                  src={config.blurredTileMessage.attachment.url}
                  alt={config.blurredTileMessage.attachment.fileName}
                  className="wa-media-blurred-img"
                />
                <div className="wa-media-overflow-overlay">
                  <span className="wa-media-overflow-count">+{config.overflowCount}</span>
                </div>
              </button>
            )}
          </div>
        )}
      </div>

      {viewerIndex !== null && (
        <AttachmentViewer
          items={galleryItems}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </>
  )
}

function MediaMessage({
  messageId,
  kind,
  attachment,
  caption,
  compact = false,
  onRetry,
}: {
  messageId: string
  kind: 'image' | 'video'
  attachment: NonNullable<ChatMessage['attachment']>
  caption: string
  compact?: boolean
  onRetry?: (messageId: string) => void
}) {
  const [viewerOpen, setViewerOpen] = useState(false)
  const mediaStyle = attachment.width && attachment.height ? ({ '--media-ratio': `${attachment.width} / ${attachment.height}` } as CSSProperties) : undefined

  return (
    <>
      <div className={`stitch-media-message ${compact ? 'compact' : ''}`}>
        {attachment.url ? (
          <button
            type="button"
            className="stitch-media-preview"
            style={mediaStyle}
            onClick={() => setViewerOpen(true)}
            aria-label={`Open ${kind} ${attachment.fileName}`}
          >
            {kind === 'image' ? (
              <img src={attachment.url} alt={attachment.fileName} />
            ) : (
              <video src={attachment.url} muted playsInline preload="metadata" />
            )}
            <span className="stitch-media-preview-overlay">
              {kind === 'video' && <Play size={24} fill="currentColor" />}
              <Maximize2 size={17} />
            </span>
            {attachment.uploadState === 'uploading' && (
              <span className="stitch-upload-badge">
                Uploading {Math.round((attachment.uploadProgress ?? 0) * 100)}%
              </span>
            )}
          </button>
        ) : (
          <span className="stitch-media-loading">
            <Upload size={18} /> Loading original…
          </span>
        )}
        {attachment.uploadState === 'failed' && onRetry && <RetryUploadButton onRetry={() => onRetry(messageId)} />}
        {caption && <FormattedMessageText text={caption} />}
      </div>
      {viewerOpen && (
        <AttachmentViewer
          kind={kind}
          attachment={attachment}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </>
  )
}

function DocumentMessage({
  messageId,
  attachment,
  onRetry,
}: {
  messageId: string
  attachment: NonNullable<ChatMessage['attachment']>
  onRetry?: (messageId: string) => void
}) {
  const [viewerOpen, setViewerOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="stitch-document-message"
        onClick={() => attachment.url && setViewerOpen(true)}
        disabled={!attachment.url}
      >
        <FileText size={23} />
        <span>
          <strong>{attachment.fileName}</strong>
          <small>{Math.ceil(attachment.size / 1024)} KB</small>
        </span>
        {attachment.url ? <Maximize2 size={17} /> : <Upload size={17} />}
        {attachment.uploadState === 'uploading' && (
          <em>{Math.round((attachment.uploadProgress ?? 0) * 100)}%</em>
        )}
      </button>
      {attachment.uploadState === 'failed' && onRetry && (
        <RetryUploadButton onRetry={() => onRetry(messageId)} />
      )}
      {viewerOpen && (
        <AttachmentViewer
          kind="document"
          attachment={attachment}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </>
  )
}

function RetryUploadButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button type="button" className="stitch-upload-retry" onClick={onRetry}>
      <Upload size={13} /> Retry upload
    </button>
  )
}

function AttachmentViewer({
  kind = 'image',
  attachment,
  items,
  initialIndex = 0,
  onClose,
}: {
  kind?: 'image' | 'video' | 'document'
  attachment?: NonNullable<ChatMessage['attachment']>
  items?: {
    id: string
    kind: 'image' | 'video' | 'document'
    attachment: NonNullable<ChatMessage['attachment']>
    caption?: string
  }[]
  initialIndex?: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(initialIndex)
  const allItems = useMemo(() => {
    if (items && items.length > 0) return items
    if (attachment) return [{ id: 'single', kind, attachment, caption: '' }]
    return []
  }, [items, attachment, kind])

  const current = allItems[index] ?? allItems[0]
  const currentAttachment = current?.attachment
  const currentKind = current?.kind ?? 'image'

  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  // Keyboard navigation & escape listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) setIndex((i) => i - 1)
      if (e.key === 'ArrowRight' && index < allItems.length - 1) setIndex((i) => i + 1)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [index, allItems.length, onClose])

  if (!currentAttachment) return null

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      className="stitch-attachment-viewer wa-attachment-fullscreen-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${currentAttachment.fileName}`}
      onClick={onClose}
    >
      <section className="stitch-attachment-viewer-panel wa-viewer-fullscreen-panel" onClick={(event) => event.stopPropagation()}>
        {/* Fullscreen Header */}
        <header className="stitch-attachment-viewer-header wa-viewer-fullscreen-header">
          <div className="wa-viewer-header-left">
            <button type="button" className="stitch-back-button wa-back-pill" onClick={onClose} aria-label="Close viewer">
              <ChevronLeft size={22} className="wa-back-chevron" />
            </button>
            <div className="wa-viewer-info">
              <strong>{allItems.length > 1 ? `${index + 1} of ${allItems.length}` : currentAttachment.fileName}</strong>
              <small>{Math.ceil(currentAttachment.size / 1024)} KB · {currentKind}</small>
            </div>
          </div>

          <div className="wa-viewer-header-actions">
            {/* Manual individual download button */}
            {currentAttachment.url && (
              <button
                type="button"
                className="wa-viewer-action-btn"
                onClick={() => {
                  if (currentAttachment.url) {
                    void downloadAttachment(currentAttachment.url, currentAttachment.fileName)
                  }
                }}
                title="Download this photo"
                aria-label="Download photo"
              >
                <Download size={20} />
              </button>
            )}

            {/* Batch download all photos if multi-image group */}
            {allItems.length > 1 && (
              <button
                type="button"
                className="wa-viewer-download-all-pill"
                onClick={() => void downloadAllAttachments(allItems.map((i) => i.attachment))}
                title="Download all photos"
              >
                <Download size={15} />
                <span>All ({allItems.length})</span>
              </button>
            )}

            <button type="button" className="stitch-viewer-close" onClick={onClose} aria-label="Close preview">
              <X size={22} />
            </button>
          </div>
        </header>

        {/* Content with Left / Right Navigation */}
        <div className="stitch-attachment-viewer-content wa-viewer-content-wrap">
          {allItems.length > 1 && index > 0 && (
            <button
              type="button"
              className="wa-viewer-nav-btn left"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              aria-label="Previous photo"
            >
              <ChevronLeft size={30} />
            </button>
          )}

          <div className="wa-viewer-media-display">
            {currentKind === 'image' && currentAttachment.url && (
              <img src={currentAttachment.url} alt={currentAttachment.fileName} />
            )}
            {currentKind === 'video' && currentAttachment.url && (
              <video
                ref={videoRef}
                src={currentAttachment.url}
                playsInline
                preload="metadata"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              />
            )}
            {currentKind === 'document' && (
              <div className="stitch-file-review">
                <div className="stitch-file-review-icon">
                  <FileText size={42} />
                </div>
                <strong>{currentAttachment.fileName}</strong>
                <span>Ready to download securely</span>
              </div>
            )}
            {current.caption && <p className="wa-viewer-caption">{current.caption}</p>}
          </div>

          {allItems.length > 1 && index < allItems.length - 1 && (
            <button
              type="button"
              className="wa-viewer-nav-btn right"
              onClick={() => setIndex((i) => Math.min(allItems.length - 1, i + 1))}
              aria-label="Next photo"
            >
              <ChevronRight size={30} />
            </button>
          )}
        </div>

        {/* Video Controls if playing video */}
        {currentKind === 'video' && (
          <div className="stitch-video-controls">
            <button
              type="button"
              onClick={() => {
                const video = videoRef.current
                if (!video) return
                if (video.paused) void video.play().then(() => setPlaying(true)).catch(() => undefined)
                else { video.pause(); setPlaying(false) }
              }}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
            </button>
            <input
              type="range"
              min="0"
              max={duration || 1}
              step="0.1"
              value={Math.min(currentTime, duration || 1)}
              onChange={(e) => {
                const video = videoRef.current
                if (!video) return
                const nextTime = Number(e.target.value)
                video.currentTime = nextTime
                setCurrentTime(nextTime)
              }}
              style={{ '--progress': `${progress}%` } as React.CSSProperties}
            />
            <span>{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span>
          </div>
        )}

        {/* Footer */}
        <footer className="stitch-attachment-viewer-footer wa-viewer-footer">
          {currentAttachment.url && (
            <button
              type="button"
              className="stitch-viewer-download wa-viewer-save-btn"
              onClick={() => {
                if (currentAttachment.url) {
                  void downloadAttachment(currentAttachment.url, currentAttachment.fileName)
                }
              }}
            >
              <Download size={17} /> Save photo
            </button>
          )}
          {allItems.length > 1 && (
            <button
              type="button"
              className="wa-viewer-save-all-btn"
              onClick={() => void downloadAllAttachments(allItems.map((i) => i.attachment))}
            >
              <Download size={17} /> Download all ({allItems.length})
            </button>
          )}
          <button type="button" className="stitch-viewer-done" onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </div>
  )
}

function formatMediaTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00'
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function VoiceComposer({ onSend, onError, onActiveChange, disabled = false }: { onSend: (blob: Blob, durationSeconds: number) => void; onError: (message: string) => void; onActiveChange?: (active: boolean) => void; disabled?: boolean }) {
  type VoicePhase = 'idle' | 'pending' | 'hold' | 'handsfree' | 'preview'
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [preview, setPreview] = useState<{ blob: Blob; url: string; duration: number } | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const holdTimerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const pointerStartXRef = useRef(0)
  const pointerReleasedRef = useRef(false)
  const cancelledRef = useRef(false)
  const sendAfterStopRef = useRef(false)

  useEffect(() => {
    if (!['pending', 'hold', 'handsfree'].includes(phase)) return
    const timer = window.setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000))), 250)
    return () => window.clearInterval(timer)
  }, [phase])
  useEffect(() => { onActiveChange?.(phase !== 'idle') }, [onActiveChange, phase])
  useEffect(() => () => { streamRef.current?.getTracks().forEach((track) => track.stop()); if (preview?.url) URL.revokeObjectURL(preview.url) }, [preview?.url])

  function reset() {
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current)
    holdTimerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []
    setPhase('idle'); setPaused(false); setElapsed(0)
  }
  function stopRecorder(discard: boolean) {
    cancelledRef.current = discard
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current)
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') { reset(); return }
    recorder.stop()
  }
  async function startRecording() {
    if (phase !== 'idle') return
    setPhase('pending')
    cancelledRef.current = false
    pointerReleasedRef.current = false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (cancelledRef.current) { stream.getTracks().forEach((track) => track.stop()); return }
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      streamRef.current = stream; recorderRef.current = recorder; chunksRef.current = []; startedAtRef.current = Date.now()
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const duration = Math.max(1, Math.floor((Date.now() - startedAtRef.current) / 1000))
        const shouldSend = sendAfterStopRef.current
        sendAfterStopRef.current = false
        const wasCancelled = cancelledRef.current
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null; recorderRef.current = null; chunksRef.current = []
        if (wasCancelled || blob.size === 0) { reset(); return }
        if (shouldSend) { onSend(blob, duration); reset(); return }
        const url = URL.createObjectURL(blob)
        setPreview({ blob, url, duration }); setPhase('preview'); setPaused(false)
      }
      recorder.start(250)
      setPhase(pointerReleasedRef.current ? 'handsfree' : 'pending')
    } catch (error) {
      reset()
      onError(error instanceof Error ? error.message : 'Microphone permission was denied.')
    }
  }
  function pointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (phase !== 'idle') return
    pointerStartXRef.current = event.clientX
    pointerReleasedRef.current = false
    event.currentTarget.setPointerCapture?.(event.pointerId)
    void startRecording()
    holdTimerRef.current = window.setTimeout(() => setPhase((current) => current === 'pending' ? 'hold' : current), 350)
  }
  function pointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!['pending', 'hold'].includes(phase)) return
    if (pointerStartXRef.current - event.clientX > 85) stopRecorder(true)
  }
  function pointerUp() {
    pointerReleasedRef.current = true
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current)
    holdTimerRef.current = null
    if (phase === 'pending') { setPhase('handsfree'); return }
    if (phase === 'hold') stopRecorder(false)
  }
  function sendPreview() { if (preview) { onSend(preview.blob, preview.duration); URL.revokeObjectURL(preview.url); setPreview(null); setPhase('idle') } }
  function deletePreview() { if (preview) URL.revokeObjectURL(preview.url); setPreview(null); reset() }
  if (phase === 'idle' && disabled) return <span className="stitch-voice-disabled" aria-hidden="true" />
  if (phase === 'idle') return <button type="button" className="stitch-composer-action stitch-mic-button" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => stopRecorder(true)} aria-label="Hold to record a voice note"><Mic size={19} /></button>
  if (phase === 'preview') return <div className="stitch-voice-preview"><button type="button" className="stitch-voice-delete" onClick={deletePreview} aria-label="Delete voice note"><Trash2 size={18} /></button><audio src={preview?.url} controls preload="metadata" /><button type="button" className="stitch-voice-send" onClick={sendPreview} aria-label="Send voice note"><Send size={18} /></button></div>
  return <div className="stitch-voice-recording"><button type="button" className="stitch-voice-delete" onClick={() => stopRecorder(true)} aria-label="Delete recording"><Trash2 size={18} /></button><div className="stitch-voice-wave" aria-label={`Recording ${elapsed} seconds`}>{Array.from({ length: 22 }, (_, index) => <i key={index} style={{ height: `${10 + ((index * 17) % 24)}px` }} />)}<strong>{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</strong></div>{phase === 'handsfree' && <button type="button" className="stitch-voice-pause" onClick={() => { const recorder = recorderRef.current; if (!recorder) return; if (recorder.state === 'paused') { recorder.resume(); setPaused(false) } else { recorder.pause(); setPaused(true) } }} aria-label={paused ? 'Resume recording' : 'Pause recording'}>{paused ? <Play size={17} /> : <Pause size={17} />}</button>}<button type="button" className="stitch-voice-send" onClick={() => { sendAfterStopRef.current = true; if (recorderRef.current?.state === 'paused') recorderRef.current.resume(); stopRecorder(false) }} aria-label="Send voice note"><Send size={18} /></button></div>
}

function MessageStatusIcon({ status }: { status: ChatMessage['status'] }) {
  if (status === 'pending') return <Clock3 className="stitch-message-status pending" size={13} aria-label="Sending" />
  if (status === 'sent') return <Check className="stitch-message-status" size={13} aria-label="Sent" />
  if (status === 'read') return <CheckCheck className="stitch-message-status read" size={14} aria-label="Read" />
  return <CheckCheck className="stitch-message-status delivered" size={14} aria-label="Delivered" />
}

function ChatActionsSheet({
  friend,
  onPin,
  onClear,
  onDelete,
  onNickname,
  onClose,
}: {
  friend: Friend
  onPin: () => void
  onClear: () => void
  onDelete: () => void
  onNickname: () => void
  onClose: () => void
}) {
  const displayName = getDisplayName(friend)
  return (
    <div className="stitch-sheet-backdrop" onClick={onClose}>
      <section className="stitch-chat-actions-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="stitch-sheet-heading">
          <Avatar friend={friend} size="small" />
          <div>
            <strong>{displayName}</strong>
            <span>{friend.nickname ? `Real name: ${friend.name}` : 'Private contact'}</span>
          </div>
          <button className="stitch-sheet-close" onClick={onClose} aria-label="Close chat actions">
            <X size={18} />
          </button>
        </div>
        <button className="stitch-action-row" onClick={onPin}>
          <Pin size={19} />
          <span>{friend.pinned ? 'Unpin chat' : 'Pin chat'}</span>
          <ChevronRight size={16} />
        </button>
        <button className="stitch-action-row" onClick={onNickname}>
          <Pencil size={19} />
          <span>{friend.nickname ? `Edit nickname (${friend.nickname})` : 'Set nickname'}</span>
          <ChevronRight size={16} />
        </button>
        <button className="stitch-action-row" onClick={onClear}>
          <Eraser size={19} />
          <span>Clear chat</span>
          <ChevronRight size={16} />
        </button>
        <button className="stitch-action-row danger" onClick={onDelete}>
          <UserX size={19} />
          <span>Delete chat</span>
          <ChevronRight size={16} />
        </button>
        <p className="stitch-sheet-note">Clear hides messages on this device. Delete removes this contact from your chat list.</p>
      </section>
    </div>
  )
}

function NicknameModal({
  friend,
  onSave,
  onClose,
}: {
  friend: Friend
  onSave: (nickname: string) => Promise<void>
  onClose: () => void
}) {
  const [nicknameDraft, setNicknameDraft] = useState(friend.nickname ?? '')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave(nicknameDraft.trim())
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stitch-sheet-backdrop wa-sheet-backdrop" onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, background: 'rgba(0,0,0,0.6)' }}>
      <div
        className="wa-custom-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(360px, 90vw)', background: 'var(--bg-secondary)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 16px 40px rgba(0,0,0,0.6)' }}
      >
        <div className="stitch-sheet-heading" style={{ padding: '16px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--separator)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar friend={friend} size="small" />
            <div>
              <strong style={{ fontSize: 16, color: 'var(--text-primary)' }}>Set Nickname</strong>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block' }}>{friend.name}</span>
            </div>
          </div>
          <button className="stitch-sheet-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '16px' }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Nicknames are only visible to you on your device and will be shown in chats and on the home page.
          </p>
          <div className="wa-grouped-table" style={{ margin: '0 0 16px' }}>
            <div className="wa-table-cell">
              <input
                className="wa-cell-input"
                style={{ width: '100%', fontSize: 16 }}
                value={nicknameDraft}
                onChange={(e) => setNicknameDraft(e.target.value)}
                placeholder={`Nickname for ${friend.name}`}
                maxLength={30}
                autoFocus
              />
              {nicknameDraft && (
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 4 }}
                  onClick={() => setNicknameDraft('')}
                  aria-label="Clear input"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="wa-btn-secondary" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </button>
            <button type="submit" className="wa-action-button-green" disabled={saving} style={{ flex: 1, padding: '10px 16px', borderRadius: 10, border: 'none', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ContactPicker({ friends, onSelect, onClose }: { friends: Friend[]; onSelect: (friend: Friend) => void; onClose: () => void }) {
  return <div className="stitch-sheet-backdrop" onClick={onClose}><section className="stitch-chat-actions-sheet" onClick={(event) => event.stopPropagation()}><div className="stitch-sheet-heading"><div><strong>Send contact</strong><span>Choose a contact to share</span></div><button className="stitch-sheet-close" onClick={onClose} aria-label="Close contact picker"><X size={18} /></button></div><div className="stitch-contact-picker">{friends.map((friend) => <button key={friend.id} className="stitch-action-row" onClick={() => onSelect(friend)}><Avatar friend={friend} size="small" /><span>{getDisplayName(friend)}<small>Private contact</small></span><ChevronRight size={16} /></button>)}</div>{friends.length === 0 && <p className="stitch-sheet-note">No contacts are available to share.</p>}</section></div>
}

function YouView({
  profile,
  profileName,
  theme,
  onTheme,
  onName,
  onSave,
  onPhotoChange,
  onSignOut,
  onBack,
  canAddPassword,
  onAddPassword,
  onSaveStatus,
  starredMessages = [],
  soundEnabled = true,
  onSoundEnabled,
  previewEnabled = true,
  onPreviewEnabled,
  notificationPermission = 'default',
  onRequestNotificationPermission,
}: {
  profile: UserProfile | null
  profileName: string
  theme: AppTheme
  onTheme: (theme: AppTheme) => void
  onName: (value: string) => void
  onSave: () => void
  onPhotoChange: (file: File) => void
  onSignOut: () => void
  onBack?: () => void
  canAddPassword: boolean
  onAddPassword: (password: string) => Promise<void>
  onSaveStatus?: (status: string) => Promise<void>
  starredMessages?: ChatMessage[]
  soundEnabled?: boolean
  onSoundEnabled?: (enabled: boolean) => void
  previewEnabled?: boolean
  onPreviewEnabled?: (enabled: boolean) => void
  notificationPermission?: NotificationPermission
  onRequestNotificationPermission?: () => void
}) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [activeModal, setActiveModal] = useState<'status' | 'account' | 'privacy' | 'appearance' | 'notifications' | 'starred' | null>(null)
  const [statusDraft, setStatusDraft] = useState(profile?.statusText ?? 'Express yourself in emoji!')
  const [readReceipts, setReadReceipts] = useState(true)
  const [lastSeenPrivacy, setLastSeenPrivacy] = useState<'everyone' | 'contacts' | 'nobody'>('everyone')
  const photoInputRef = useRef<HTMLInputElement>(null)

  const emojiStatusShortcuts = ['🎯 Working', '☕ Coffee break', '🌴 Traveling', '🎧 Busy', '🔋 In a meeting', '💻 Coding', '😴 Sleeping', '🍿 Movies', '⚡ Focused', '✨ Available']

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault()
    if (password.length < 6) { setError('Use a password with at least six characters.'); return }
    setBusy(true); setError('')
    try { await onAddPassword(password); setPassword('') } catch (reason) { setError(authErrorMessage(reason)) } finally { setBusy(false) }
  }

  async function handleSaveStatus() {
    if (onSaveStatus) {
      await onSaveStatus(statusDraft)
    }
    setActiveModal(null)
  }

  return (
    <section className="stitch-you-view wa-you-view">
      {/* Profile Hero Section matching IMG_1631.PNG */}
      <div className="wa-you-hero-card">
        <div className="wa-you-speech-bubble" onClick={() => setActiveModal('status')} title="Tap to change your status">
          <span>{profile?.statusText || 'Express yourself in emoji!'}</span>
          <span className="wa-speech-bubble-tail" />
        </div>

        <div className="wa-you-avatar-wrap">
          <button
            className="wa-you-avatar-btn"
            onClick={() => photoInputRef.current?.click()}
            aria-label="Change profile picture"
          >
            {profile?.photoURL ? (
              <img src={profile.photoURL} alt="" className="wa-you-avatar-img" />
            ) : (
              <span className="wa-you-avatar-initials">{profile?.initials ?? 'Y'}</span>
            )}
            <span className="wa-you-camera-badge">
              <Camera size={15} />
            </span>
          </button>
          <input
            ref={photoInputRef}
            hidden
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onPhotoChange(file)
            }}
          />
        </div>

        <div className="wa-you-hero-name">
          <h2 className="wa-you-display-name">{profile?.displayName ?? 'Your Account'}</h2>
          <ChevronDown size={19} className="wa-you-chevron-down" />
        </div>
      </div>

      {/* Edit Name Inline Row */}
      <div className="wa-grouped-table">
        <div className="wa-table-cell">
          <span className="wa-cell-label">Display Name</span>
          <input
            className="wa-cell-input"
            value={profileName}
            onChange={(event) => onName(event.target.value)}
            maxLength={32}
            aria-label="Display name"
            placeholder="Your name"
          />
          <button className="wa-cell-action-btn" onClick={onSave}>Save</button>
        </div>
      </div>

      {/* Starred Messages Section */}
      <div className="wa-grouped-table">
        <div className="wa-table-cell" onClick={() => setActiveModal('starred')}>
          <div className="wa-cell-icon-wrap yellow"><Star size={19} /></div>
          <span className="wa-cell-title">Starred Messages</span>
          <div className="wa-cell-right">
            <span className="wa-cell-count">{starredMessages.length > 0 ? starredMessages.length : 'None'}</span>
            <ChevronRight size={17} className="wa-chevron" />
          </div>
        </div>
      </div>

      {/* Main Settings Group */}
      <div className="wa-grouped-table">
        <div className="wa-table-cell" onClick={() => setActiveModal('account')}>
          <div className="wa-cell-icon-wrap blue"><Shield size={19} /></div>
          <span className="wa-cell-title">Account</span>
          <ChevronRight size={17} className="wa-chevron" />
        </div>
        <div className="wa-table-cell" onClick={() => setActiveModal('privacy')}>
          <div className="wa-cell-icon-wrap teal"><LockKeyhole size={19} /></div>
          <span className="wa-cell-title">Privacy</span>
          <ChevronRight size={17} className="wa-chevron" />
        </div>
        <div className="wa-table-cell" onClick={() => setActiveModal('appearance')}>
          <div className="wa-cell-icon-wrap green"><Palette size={19} /></div>
          <div className="wa-cell-middle">
            <span className="wa-cell-title">Appearance</span>
            <div className="wa-theme-pills" onClick={(e) => e.stopPropagation()}>
              {(['light', 'oled', 'graphite'] as const).map((t) => (
                <button
                  key={t}
                  className={`wa-theme-pill ${theme === t || (t === 'oled' && theme === 'midnight') ? 'active' : ''}`}
                  onClick={() => onTheme(t)}
                >
                  {t === 'oled' ? 'OLED Dark' : t === 'graphite' ? 'Graphite' : 'Light'}
                </button>
              ))}
            </div>
          </div>
          <ChevronRight size={17} className="wa-chevron" />
        </div>
        <div className="wa-table-cell" onClick={() => setActiveModal('notifications')}>
          <div className="wa-cell-icon-wrap red"><Bell size={19} /></div>
          <span className="wa-cell-title">Notifications</span>
          <ChevronRight size={17} className="wa-chevron" />
        </div>
      </div>

      {canAddPassword && (
        <div className="wa-grouped-table">
          <div className="wa-password-box">
            <strong>Add password sign-in</strong>
            <p>Link email and password to this LumaChat account.</p>
            <form onSubmit={(e) => void submitPassword(e)}>
              <div className="wa-password-input-row">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  minLength={6}
                  required
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button className="wa-btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Add Password'}
              </button>
            </form>
            {error && <div className="wa-auth-error">{error}</div>}
          </div>
        </div>
      )}

      <div className="wa-grouped-table">
        <button className="wa-table-cell wa-destructive-cell" onClick={onSignOut}>
          <LogOut size={19} />
          <span>Log Out</span>
        </button>
      </div>

      <div className="wa-you-footer">
        <ShieldCheck size={16} />
        <span>End-to-end encrypted · LumaChat Private</span>
      </div>

      {/* Status / Thought Full-Screen Page */}
      {activeModal === 'status' && (
        <div className="wa-fullscreen-page">
          <header className="wa-page-nav-header">
            <div className="wa-page-nav-left">
              <button type="button" className="stitch-back-button wa-back-pill" onClick={() => setActiveModal(null)} aria-label="Back">
                <ChevronLeft size={22} className="wa-back-chevron" />
              </button>
            </div>
            <h2 className="wa-page-title">Status</h2>
            <div className="wa-page-nav-right">
              <button className="wa-page-done-btn" onClick={() => void handleSaveStatus()}>
                Done
              </button>
            </div>
          </header>
          <div className="wa-page-scrollable-body">
            <div className="wa-grouped-table">
              <div className="wa-table-cell">
                <input
                  className="wa-cell-input"
                  style={{ width: '100%', fontSize: 16 }}
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value)}
                  placeholder="What's on your mind?"
                  maxLength={60}
                  autoFocus
                />
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600, padding: '0 4px' }}>
              Quick Status
            </div>
            <div className="wa-quick-status-grid">
              {emojiStatusShortcuts.map((item) => (
                <button
                  key={item}
                  className="wa-quick-status-chip"
                  onClick={() => setStatusDraft(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Account Full-Screen Page */}
      {activeModal === 'account' && (
        <div className="wa-fullscreen-page">
          <header className="wa-page-nav-header">
            <div className="wa-page-nav-left">
              <button type="button" className="stitch-back-button wa-back-pill" onClick={() => setActiveModal(null)} aria-label="Back">
                <ChevronLeft size={22} className="wa-back-chevron" />
              </button>
            </div>
            <h2 className="wa-page-title">Account</h2>
            <div className="wa-page-nav-right" />
          </header>
          <div className="wa-page-scrollable-body">
            <div className="wa-grouped-table">
              <div className="wa-table-cell">
                <span className="wa-cell-title">Email / Handle</span>
                <span className="wa-cell-value">{auth?.currentUser?.email || profile?.handle || 'Anonymous Guest'}</span>
              </div>
              <div className="wa-table-cell">
                <span className="wa-cell-title">Account ID</span>
                <span className="wa-cell-value">{profile?.uid.slice(0, 10)}…</span>
              </div>
              <div className="wa-table-cell">
                <span className="wa-cell-title">Security Protocol</span>
                <span className="wa-cell-value">AES-256-GCM / WebRTC</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Full-Screen Page */}
      {activeModal === 'privacy' && (
        <div className="wa-fullscreen-page">
          <header className="wa-page-nav-header">
            <div className="wa-page-nav-left">
              <button type="button" className="stitch-back-button wa-back-pill" onClick={() => setActiveModal(null)} aria-label="Back">
                <ChevronLeft size={22} className="wa-back-chevron" />
              </button>
            </div>
            <h2 className="wa-page-title">Privacy</h2>
            <div className="wa-page-nav-right" />
          </header>
          <div className="wa-page-scrollable-body">
            <div className="wa-grouped-table">
              <div className="wa-table-cell" onClick={() => setReadReceipts(!readReceipts)}>
                <div className="wa-cell-middle">
                  <span className="wa-cell-title">Read Receipts</span>
                  <span className="wa-cell-sub">If turned off, you won't send or receive read receipts (blue ticks).</span>
                </div>
                <span className="wa-cell-value">{readReceipts ? 'On' : 'Off'}</span>
              </div>
              <div className="wa-table-cell" onClick={() => {
                setLastSeenPrivacy((cur) => cur === 'everyone' ? 'contacts' : cur === 'contacts' ? 'nobody' : 'everyone')
              }}>
                <span className="wa-cell-title">Last Seen & Online</span>
                <span className="wa-cell-value">{lastSeenPrivacy === 'everyone' ? 'Everyone' : lastSeenPrivacy === 'contacts' ? 'My Contacts' : 'Nobody'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Appearance Full-Screen Page */}
      {activeModal === 'appearance' && (
        <div className="wa-fullscreen-page">
          <header className="wa-page-nav-header">
            <div className="wa-page-nav-left">
              <button type="button" className="stitch-back-button wa-back-pill" onClick={() => setActiveModal(null)} aria-label="Back">
                <ChevronLeft size={22} className="wa-back-chevron" />
              </button>
            </div>
            <h2 className="wa-page-title">Appearance</h2>
            <div className="wa-page-nav-right" />
          </header>
          <div className="wa-page-scrollable-body">
            <div className="wa-theme-selection-list">
              {[
                { id: 'light' as const, name: 'Light', desc: 'Clean, high-contrast iOS light theme with warm chat wallpaper.' },
                { id: 'oled' as const, name: 'OLED Dark', desc: 'True AMOLED pure black (#000000) for maximum battery life and contrast without greenish tint.' },
                { id: 'graphite' as const, name: 'Graphite', desc: 'Refined charcoal and slate grey dark theme with clear visual hierarchy.' },
              ].map((item) => {
                const isSelected = theme === item.id || (item.id === 'oled' && theme === 'midnight')
                return (
                  <div
                    key={item.id}
                    className={`wa-theme-card-option ${isSelected ? 'selected' : ''}`}
                    onClick={() => onTheme(item.id)}
                  >
                    <div className="wa-theme-card-info">
                      <strong className="wa-theme-card-title">{item.name}</strong>
                      <p className="wa-theme-card-desc">{item.desc}</p>
                    </div>
                    <div className="wa-theme-card-radio">
                      {isSelected && <Check size={20} style={{ color: 'var(--accent-green)' }} />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Notifications Full-Screen Page */}
      {activeModal === 'notifications' && (
        <div className="wa-fullscreen-page">
          <header className="wa-page-nav-header">
            <div className="wa-page-nav-left">
              <button type="button" className="stitch-back-button wa-back-pill" onClick={() => setActiveModal(null)} aria-label="Back">
                <ChevronLeft size={22} className="wa-back-chevron" />
              </button>
            </div>
            <h2 className="wa-page-title">Notifications</h2>
            <div className="wa-page-nav-right" />
          </header>
          <div className="wa-page-scrollable-body">
            <div className="wa-grouped-table">
              <div
                className="wa-table-cell"
                onClick={() => {
                  if (notificationPermission !== 'granted' && onRequestNotificationPermission) {
                    onRequestNotificationPermission()
                  }
                }}
              >
                <div className="wa-cell-middle">
                  <span className="wa-cell-title">Web Push Notifications</span>
                  <span className="wa-cell-subtitle">
                    {notificationPermission === 'granted'
                      ? 'Push notifications are active for this device'
                      : notificationPermission === 'denied'
                      ? 'Notifications are blocked in your browser / iOS settings'
                      : 'Tap to allow notifications for new messages and calls'}
                  </span>
                </div>
                <span className="wa-cell-value" style={{ color: notificationPermission === 'granted' ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                  {notificationPermission === 'granted' ? 'Active ✓' : notificationPermission === 'denied' ? 'Blocked' : 'Enable'}
                </span>
              </div>
              <div className="wa-table-cell" onClick={() => onSoundEnabled?.(!soundEnabled)}>
                <span className="wa-cell-title">Conversation Tones</span>
                <span className="wa-cell-value">{soundEnabled ? 'On' : 'Off'}</span>
              </div>
              <div className="wa-table-cell" onClick={() => onPreviewEnabled?.(!previewEnabled)}>
                <span className="wa-cell-title">Show Previews</span>
                <span className="wa-cell-value">{previewEnabled ? 'On' : 'Off'}</span>
              </div>
            </div>

            <div className="wa-info-card" style={{ margin: '16px 16px 8px', background: 'var(--card-bg, var(--bg-secondary))', padding: '14px', borderRadius: '12px', border: '1px solid var(--separator)' }}>
              <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>📱 iOS Home Screen Notifications</strong>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                To receive notifications when Luma is closed on iPhone or iPad (iOS 16.4+), tap the Share icon <strong>(⎋)</strong> in Safari and select <strong>&quot;Add to Home Screen&quot;</strong>, then open Luma from your Home Screen.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Starred Messages Full-Screen Page */}
      {activeModal === 'starred' && (
        <div className="wa-fullscreen-page">
          <header className="wa-page-nav-header">
            <div className="wa-page-nav-left">
              <button type="button" className="stitch-back-button wa-back-pill" onClick={() => setActiveModal(null)} aria-label="Back">
                <ChevronLeft size={22} className="wa-back-chevron" />
              </button>
            </div>
            <h2 className="wa-page-title">Starred Messages</h2>
            <div className="wa-page-nav-right" />
          </header>
          <div className="wa-page-scrollable-body">
            {starredMessages.length === 0 ? (
              <div className="wa-empty-modal-state" style={{ marginTop: 60 }}>
                <Star size={40} />
                <p>No starred messages yet. Long-press any message in a chat and tap Star to save it here.</p>
              </div>
            ) : (
              <div className="wa-starred-list">
                {starredMessages.map((m) => (
                  <div key={m.id} className="wa-starred-item">
                    <div className="wa-starred-header">
                      <span>{formatTime(m.createdAt)}</span>
                      <Star size={13} className="wa-yellow-star" />
                    </div>
                    <p className="wa-starred-text">{m.text || (m.kind === 'call' ? 'Call' : 'Media attachment')}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function StitchBottomNav({
  view,
  onView,
  profilePhotoURL,
  unreadChats = 0,
  missedCalls = 0,
}: {
  view: View
  onView: (view: View) => void
  profilePhotoURL?: string
  unreadChats?: number
  missedCalls?: number
}) {
  return (
    <nav className="stitch-bottom-nav wa-tab-bar" aria-label="Primary navigation">
      <button
        className={`wa-tab-btn ${view === 'home' ? 'active' : ''}`}
        onClick={() => onView('home')}
        aria-label="Chats"
      >
        <div className="wa-tab-icon-wrap">
          <MessageCircle size={23} strokeWidth={view === 'home' ? 2.4 : 1.8} />
          {unreadChats > 0 && <span className="wa-tab-badge">{unreadChats}</span>}
        </div>
        <span className="wa-tab-label">Chats</span>
      </button>

      <button
        className={`wa-tab-btn ${view === 'calls' ? 'active' : ''}`}
        onClick={() => onView('calls')}
        aria-label="Calls"
      >
        <div className="wa-tab-icon-wrap">
          <Phone size={22} strokeWidth={view === 'calls' ? 2.4 : 1.8} />
          {missedCalls > 0 && <span className="wa-tab-badge">{missedCalls}</span>}
        </div>
        <span className="wa-tab-label">Calls</span>
      </button>

      <button
        className={`wa-tab-btn ${view === 'settings' ? 'active' : ''}`}
        onClick={() => onView('settings')}
        aria-label="You"
      >
        <div className="wa-tab-icon-wrap">
          {profilePhotoURL ? (
            <img src={profilePhotoURL} alt="" className={`wa-tab-avatar ${view === 'settings' ? 'active' : ''}`} />
          ) : (
            <UserRound size={23} strokeWidth={view === 'settings' ? 2.4 : 1.8} />
          )}
        </div>
        <span className="wa-tab-label">You</span>
      </button>
    </nav>
  )
}

function CallsView({
  logs,
  friends = [],
  onOpenChat,
  onVoiceCall,
  onBack,
}: {
  logs: CallLogEntry[]
  friends: Friend[]
  onOpenChat: (friendId: string) => void
  onVoiceCall?: () => void
  onBack?: () => void
}) {
  return (
    <section className="stitch-calls-view wa-calls-view">
      {/* 4 Round action buttons matching IMG_1632.PNG */}
      <div className="wa-calls-quick-actions">
        <button className="wa-call-quick-btn" onClick={onVoiceCall}>
          <div className="wa-quick-circle">
            <Phone size={22} />
          </div>
          <span>Call</span>
        </button>
        <button className="wa-call-quick-btn" onClick={onVoiceCall}>
          <div className="wa-quick-circle">
            <Calendar size={22} />
          </div>
          <span>Schedule</span>
        </button>
        <button className="wa-call-quick-btn" onClick={onVoiceCall}>
          <div className="wa-quick-circle">
            <KeyRound size={22} />
          </div>
          <span>Keypad</span>
        </button>
        <button className="wa-call-quick-btn" onClick={onVoiceCall}>
          <div className="wa-quick-circle">
            <Heart size={22} />
          </div>
          <span>Favourites</span>
        </button>
      </div>

      <div className="wa-calls-recent-header">
        <h2>Recent</h2>
      </div>

      {logs.length === 0 ? (
        <div className="stitch-empty-list wa-empty-calls">
          <div className="wa-empty-icon"><Phone size={32} /></div>
          <strong>No recent calls</strong>
          <p>Stay connected with end-to-end encrypted audio and video calls.</p>
        </div>
      ) : (
        <div className="stitch-call-log-list wa-calls-list">
          {logs.map((log) => {
            const missed = log.outcome !== 'completed'
            const matchFriend = friends.find((f) => f.id === log.friendId)
            const resolvedName = matchFriend ? getDisplayName(matchFriend) : log.friendName
            const resolvedAvatar = matchFriend || { initials: log.friendInitials, color: log.friendColor, photoURL: log.friendPhotoURL, name: log.friendName }
            return (
              <div key={log.id} className="stitch-call-log-row wa-call-row">
                <div className="wa-call-avatar" onClick={() => onOpenChat(log.friendId)}>
                  <Avatar friend={resolvedAvatar} size="normal" />
                </div>
                <div className="wa-call-info" onClick={() => onOpenChat(log.friendId)}>
                  <strong className={`wa-call-name ${missed ? 'missed' : ''}`}>{resolvedName}</strong>
                  <div className="wa-call-type-row">
                    {missed ? (
                      <PhoneMissed size={14} className="wa-call-dir-missed" />
                    ) : log.direction === 'incoming' ? (
                      <PhoneIncoming size={14} className="wa-call-dir-in" />
                    ) : (
                      <PhoneOutgoing size={14} className="wa-call-dir-out" />
                    )}
                    <span className="wa-call-desc">
                      {log.kind === 'video' ? 'Video' : 'Audio'} · {missed ? (log.outcome === 'declined' ? 'Declined' : 'Missed') : formatCallDuration(log.durationSeconds)}
                    </span>
                  </div>
                </div>
                <div className="wa-call-trailing">
                  <span className="wa-call-date">{formatTime(log.initiatedAt)}</span>
                  <button className="wa-call-info-circle" onClick={() => onOpenChat(log.friendId)} aria-label="Call info">
                    <Info size={19} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ContactInfoPage({
  friend,
  messages = [],
  starredMessageIds = new Set(),
  onClose,
  onMessage,
  onEditNickname,
  onVoiceCall,
  onVideoCall,
  onToggleMute,
  onCycleDisappearing,
}: {
  friend: Friend
  messages?: ChatMessage[]
  starredMessageIds?: Set<string>
  onClose: () => void
  onMessage: () => void
  onEditNickname?: () => void
  onVoiceCall: () => void
  onVideoCall: () => void
  onToggleMute?: () => void
  onCycleDisappearing?: () => void
}) {
  const [subpage, setSubpage] = useState<'media' | 'starred' | 'security' | null>(null)
  const [mediaTab, setMediaTab] = useState<'media' | 'docs' | 'links'>('media')

  const mediaMessages = useMemo(
    () => messages.filter((m) => m.attachment && (m.attachment.contentType.startsWith('image/') || m.attachment.contentType.startsWith('video/'))),
    [messages]
  )
  const docMessages = useMemo(
    () => messages.filter((m) => m.attachment && !m.attachment.contentType.startsWith('image/') && !m.attachment.contentType.startsWith('video/')),
    [messages]
  )
  const linkMessages = useMemo(
    () => messages.filter((m) => m.text && (m.text.includes('http://') || m.text.includes('https://'))),
    [messages]
  )
  const starredMessages = useMemo(
    () => messages.filter((m) => starredMessageIds.has(m.id) || m.starred),
    [messages, starredMessageIds]
  )

  const disappearingLabel = !friend.disappearingTimer
    ? 'Off'
    : friend.disappearingTimer === 86400000
    ? '24 hours'
    : friend.disappearingTimer === 604800000
    ? '7 days'
    : '90 days'

  if (subpage === 'media') {
    return (
      <div className="wa-fullscreen-page">
        <header className="wa-page-nav-header">
          <div className="wa-page-nav-left">
            <button className="stitch-back-button wa-back-pill" onClick={() => setSubpage(null)} aria-label="Back to contact">
              <ChevronLeft size={22} className="wa-back-chevron" />
            </button>
          </div>
          <h2 className="wa-page-nav-title">Media, Links & Docs</h2>
          <div className="wa-page-nav-right" />
        </header>
        <div className="wa-filter-chips" style={{ padding: '12px 16px', background: 'var(--bg-secondary)' }}>
          <button className={`wa-filter-chip ${mediaTab === 'media' ? 'active' : ''}`} onClick={() => setMediaTab('media')}>Media ({mediaMessages.length})</button>
          <button className={`wa-filter-chip ${mediaTab === 'docs' ? 'active' : ''}`} onClick={() => setMediaTab('docs')}>Docs ({docMessages.length})</button>
          <button className={`wa-filter-chip ${mediaTab === 'links' ? 'active' : ''}`} onClick={() => setMediaTab('links')}>Links ({linkMessages.length})</button>
        </div>
        <div className="wa-page-scrollable-body" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {mediaTab === 'media' && (
            mediaMessages.length === 0 ? <p className="wa-empty-text">No photos or videos shared yet.</p> : (
              <div className="wa-media-grid">
                {mediaMessages.map((m) => (
                  <div key={m.id} className="wa-media-grid-item">
                    {m.attachment?.url ? (
                      m.attachment.contentType.startsWith('video/') ? (
                        <video src={m.attachment.url} />
                      ) : (
                        <img src={m.attachment.url} alt="" />
                      )
                    ) : null}
                  </div>
                ))}
              </div>
            )
          )}
          {mediaTab === 'docs' && (
            docMessages.length === 0 ? <p className="wa-empty-text">No documents shared yet.</p> : (
              <div className="wa-docs-list">
                {docMessages.map((m) => (
                  <div key={m.id} className="wa-doc-item">
                    <FileText size={20} />
                    <div className="wa-doc-info">
                      <strong>{m.attachment?.fileName || 'Document'}</strong>
                      <span>{formatTime(m.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
          {mediaTab === 'links' && (
            linkMessages.length === 0 ? <p className="wa-empty-text">No links shared yet.</p> : (
              <div className="wa-links-list">
                {linkMessages.map((m) => (
                  <div key={m.id} className="wa-link-item">
                    <p>{m.text}</p>
                    <span>{formatTime(m.createdAt)}</span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    )
  }

  if (subpage === 'starred') {
    return (
      <div className="wa-fullscreen-page">
        <header className="wa-page-nav-header">
          <div className="wa-page-nav-left">
            <button className="stitch-back-button wa-back-pill" onClick={() => setSubpage(null)} aria-label="Back to contact">
              <ChevronLeft size={22} className="wa-back-chevron" />
            </button>
          </div>
          <h2 className="wa-page-nav-title">Starred Messages</h2>
          <div className="wa-page-nav-right" />
        </header>
        <div className="wa-page-scrollable-body" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {starredMessages.length === 0 ? (
            <div className="wa-empty-modal-state" style={{ textAlign: 'center', marginTop: 60 }}>
              <Star size={40} color="var(--accent-yellow)" style={{ marginBottom: 12 }} />
              <p style={{ color: 'var(--text-secondary)' }}>No starred messages with {getDisplayName(friend)}.</p>
            </div>
          ) : (
            <div className="wa-starred-list">
              {starredMessages.map((m) => (
                <div key={m.id} className="wa-starred-item">
                  <div className="wa-starred-header">
                    <span>{formatTime(m.createdAt)}</span>
                    <Star size={13} className="wa-yellow-star" />
                  </div>
                  <p className="wa-starred-text">{m.text || (m.kind === 'call' ? 'Call' : 'Attachment')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (subpage === 'security') {
    return (
      <div className="wa-fullscreen-page">
        <header className="wa-page-nav-header">
          <div className="wa-page-nav-left">
            <button className="stitch-back-button wa-back-pill" onClick={() => setSubpage(null)} aria-label="Back to contact">
              <ChevronLeft size={22} className="wa-back-chevron" />
            </button>
          </div>
          <h2 className="wa-page-nav-title">Encryption</h2>
          <div className="wa-page-nav-right" />
        </header>
        <div className="wa-page-scrollable-body wa-security-body" style={{ flex: 1, overflowY: 'auto', padding: 24, textAlign: 'center' }}>
          <div className="wa-security-qr-wrap" style={{ margin: '20px auto', display: 'flex', justifyContent: 'center' }}>
            <QrCode size={160} color="#fff" />
          </div>
          <p className="wa-security-desc" style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '16px auto', maxWidth: 360 }}>
            To verify that messages and calls with <strong>{getDisplayName(friend)}</strong> are end-to-end encrypted, compare the 60-digit number below on their device.
          </p>
          <div className="wa-safety-numbers" style={{ background: 'var(--bg-secondary)', padding: 16, borderRadius: 12, fontFamily: 'monospace', letterSpacing: 2 }}>
            <div>59102 38471 90234 18273</div>
            <div style={{ margin: '8px 0' }}>94817 26354 01928 37465</div>
            <div>10293 84756 20192 83746</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="wa-fullscreen-page">
      <header className="wa-page-nav-header">
        <div className="wa-page-nav-left">
          <button className="stitch-back-button wa-back-pill" onClick={onClose} aria-label="Back to chat">
            <ChevronLeft size={22} className="wa-back-chevron" />
          </button>
        </div>
        <h2 className="wa-page-nav-title">Contact Info</h2>
        <div className="wa-page-nav-right" />
      </header>

      <div className="wa-page-scrollable-body" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 40px' }}>
        {/* Header Profile matching IMG_1633.PNG */}
        <div className="wa-contact-hero" style={{ textAlign: 'center', marginBottom: 20 }}>
          <div className="wa-hero-avatar-wrap" style={{ display: 'inline-block', position: 'relative' }}>
            <Avatar friend={friend} size="large" />
            {friend.online && <span className="wa-hero-presence-ring" />}
          </div>
          <h2 className="wa-hero-name" style={{ marginTop: 10, fontSize: 22, fontWeight: 700 }}>{getDisplayName(friend)}</h2>
          {friend.nickname && (
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginTop: 2 }}>
              Real name: {friend.name}
            </span>
          )}
          <span className="wa-hero-subtitle" style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {friend.isGroup ? `${friend.memberCount ?? 1} members` : friend.online ? 'Active now' : formatLastSeen(friend.lastSeen)}
          </span>
        </div>

        {/* 4 Action Cards matching IMG_1633.PNG */}
        <div className="wa-hero-actions-grid" style={{ marginBottom: 20 }}>
          <button className="wa-hero-action-card" onClick={onVoiceCall}>
            <Phone size={22} />
            <span>Audio</span>
          </button>
          <button className="wa-hero-action-card" onClick={onVideoCall}>
            <Video size={22} />
            <span>Video</span>
          </button>
          <button className="wa-hero-action-card" onClick={onMessage}>
            <MessageCircle size={22} />
            <span>Message</span>
          </button>
          <button className="wa-hero-action-card" onClick={onMessage}>
            <Search size={22} />
            <span>Search</span>
          </button>
        </div>

        {/* Grouped Info Cells matching IMG_1634.PNG */}
        <div className="wa-grouped-table">
          <div className="wa-table-cell" onClick={() => setSubpage('media')}>
            <span className="wa-cell-title">Media, Links and Docs</span>
            <div className="wa-cell-right">
              <span className="wa-cell-count">{mediaMessages.length + docMessages.length + linkMessages.length}</span>
              <ChevronRight size={17} className="wa-chevron" />
            </div>
          </div>
          <div className="wa-table-cell" onClick={() => setSubpage('starred')}>
            <span className="wa-cell-title">Starred Messages</span>
            <div className="wa-cell-right">
              <span className="wa-cell-count">{starredMessages.length > 0 ? starredMessages.length : 'None'}</span>
              <ChevronRight size={17} className="wa-chevron" />
            </div>
          </div>
          <div className="wa-table-cell" onClick={onMessage}>
            <span className="wa-cell-title">Chat Search</span>
            <ChevronRight size={17} className="wa-chevron" />
          </div>
        </div>

        <div className="wa-grouped-table">
          <div className="wa-table-cell" onClick={onEditNickname} style={{ cursor: 'pointer' }}>
            <span className="wa-cell-title">Nickname</span>
            <div className="wa-cell-right">
              <span className="wa-cell-value">{friend.nickname || 'None'}</span>
              <ChevronRight size={17} className="wa-chevron" />
            </div>
          </div>
          <div className="wa-table-cell" onClick={onToggleMute}>
            <span className="wa-cell-title">Mute Notifications</span>
            <span className="wa-cell-value">{friend.muted ? 'Yes' : 'No'}</span>
          </div>
          <div className="wa-table-cell" onClick={onCycleDisappearing}>
            <span className="wa-cell-title">Disappearing Messages</span>
            <span className="wa-cell-value">{disappearingLabel}</span>
          </div>
          <div className="wa-table-cell" onClick={() => setSubpage('security')}>
            <div className="wa-cell-middle">
              <span className="wa-cell-title">Encryption</span>
              <span className="wa-cell-sub">Messages and calls are end-to-end encrypted. Tap to verify.</span>
            </div>
            <LockKeyhole size={17} className="wa-cell-lock" />
          </div>
        </div>

        {/* Destructive Actions matching IMG_1635.PNG */}
        <div className="wa-grouped-table">
          <div className="wa-table-cell wa-destructive-cell" onClick={onClose}>
            <span>Block {getDisplayName(friend)}</span>
          </div>
          <div className="wa-table-cell wa-destructive-cell" onClick={onClose}>
            <span>Report {getDisplayName(friend)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function IncomingCallBanner({ call, friends = [], onAccept, onDecline }: { call: IncomingCall; friends?: Friend[]; onAccept: () => void; onDecline: () => void }) {
  const matchFriend = friends.find((f) => f.id === call.callerId)
  const callerDisplayName = matchFriend ? getDisplayName(matchFriend) : call.callerProfile.name
  const avatarFriend = matchFriend || call.callerProfile
  return (
    <div className="stitch-incoming-call wa-incoming-call-banner">
      <div className="wa-incoming-avatar">
        <Avatar friend={avatarFriend} size="small" />
      </div>
      <div className="wa-incoming-copy">
        <strong className="wa-incoming-name">{callerDisplayName}</strong>
        <span className="wa-incoming-desc">Incoming {call.kind} call</span>
      </div>
      <div className="wa-incoming-actions">
        <button className="decline wa-incoming-btn-decline" onClick={onDecline} aria-label="Decline call">
          <PhoneMissed size={18} />
        </button>
        <button className="accept wa-incoming-btn-accept" onClick={onAccept} aria-label="Accept call">
          <Phone size={18} />
        </button>
      </div>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="stitch-status-screen wa-status-screen">
      <div className="stitch-status-orb wa-status-orb">
        <Sparkles size={28} />
      </div>
      <h1>Opening LumaChat</h1>
      <p>Connecting securely with end-to-end encryption.</p>
    </div>
  )
}

function SetupScreen({ message }: { message: string }) {
  return (
    <div className="stitch-status-screen wa-status-screen">
      <div className="stitch-status-orb wa-status-orb">
        <ShieldCheck size={28} />
      </div>
      <h1>Configuration Required</h1>
      <p>{message}</p>
      <code>Copy .env.example to .env.local, add Firebase keys, and reload.</code>
    </div>
  )
}

function AuthScreen({ initialError = '' }: { initialError?: string }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)

  useEffect(() => {
    if (initialError) setError(initialError)
  }, [initialError])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'signin') await loginWithEmail(email, password)
      else await registerWithEmail(email, password, displayName)
    } catch (reason) {
      setError(authErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function google() {
    setBusy(true)
    setError('')
    try {
      await loginWithGoogle()
    } catch (reason) {
      setError(authErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stitch-auth-screen wa-auth-screen">
      <div className="wa-auth-phone-frame">
        <div className="wa-auth-brand">
          <LumaMark size="large" />
          <h1>LumaChat</h1>
          <p>Simple. Secure. Reliable messaging.</p>
        </div>

        <div className="wa-auth-tabs">
          <button
            className={mode === 'signin' ? 'active' : ''}
            onClick={() => { setMode('signin'); setError(''); setShowPassword(false) }}
          >
            Sign In
          </button>
          <button
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => { setMode('signup'); setError(''); setShowPassword(false) }}
          >
            Create Account
          </button>
        </div>

        <button className="wa-google-btn" onClick={() => void google()} disabled={busy}>
          <span className="wa-google-g">G</span> Continue with Google
        </button>

        <div className="wa-auth-divider">
          <span>or continue with email</span>
        </div>

        <form onSubmit={(event) => void submit(event)}>
          {mode === 'signup' && (
            <input
              className="wa-auth-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Display name"
              autoComplete="name"
              maxLength={32}
              required
            />
          )}
          <input
            className="wa-auth-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email address"
            autoComplete="email"
            required
          />
          <div className="wa-password-wrap">
            <input
              className="wa-auth-input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
            <button
              type="button"
              className="wa-pwd-toggle"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          <button className="wa-btn-primary full-width" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {error && <div className="wa-auth-error">{error}</div>}

        <div className="wa-auth-footer-note">
          <LockKeyhole size={14} />
          <span>End-to-end encrypted · Private by design</span>
        </div>
      </div>
    </div>
  )
}

function NewChatPage({
  mode,
  code,
  input,
  qr,
  expiresAt,
  friends,
  onMode,
  onInput,
  onCopy,
  onAccept,
  onCreateGroup,
  onRegenerateCode,
  onClose,
}: {
  mode: InviteMode
  code: string
  input: string
  qr: string
  expiresAt: number
  friends: Friend[]
  onMode: (mode: InviteMode) => void
  onInput: (value: string) => void
  onCopy: () => void
  onAccept: (code?: string) => void
  onCreateGroup: (name: string, memberIds: string[]) => void
  onRegenerateCode?: () => void
  onClose: () => void
}) {
  const [groupName, setGroupName] = useState('')
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set())
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!expiresAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  useEffect(() => {
    if (mode === 'create' && !code && onRegenerateCode) {
      onRegenerateCode()
    }
  }, [mode, code, onRegenerateCode])

  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const isExpired = Boolean(expiresAt && remainingSeconds <= 0)
  const countdown = `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`

  const individualFriends = useMemo(() => friends.filter((f) => !f.isGroup), [friends])

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="wa-fullscreen-page">
      <header className="wa-page-nav-header">
        <div className="wa-page-nav-left">
          <button type="button" className="stitch-back-button wa-back-pill" onClick={onClose} aria-label="Back">
            <ChevronLeft size={22} className="wa-back-chevron" />
          </button>
        </div>
        <h2 className="wa-page-nav-title">
          {mode === 'group' ? 'New Group' : mode === 'create' ? 'Share Code' : mode === 'accept' ? 'Enter Code' : 'Scan QR'}
        </h2>
        <div className="wa-page-nav-right">
          {mode === 'group' && groupName.trim() && (
            <button
              className="wa-page-back-btn"
              style={{ fontWeight: 600 }}
              onClick={() => onCreateGroup(groupName, Array.from(selectedMembers))}
            >
              Create
            </button>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div className="wa-filter-chips" style={{ padding: '12px 16px', background: 'var(--bg-secondary)' }}>
        <button
          className={`wa-filter-chip ${mode === 'group' ? 'active' : ''}`}
          onClick={() => onMode('group')}
        >
          <Users size={15} style={{ marginRight: 4 }} /> New Group
        </button>
        <button
          className={`wa-filter-chip ${mode === 'create' ? 'active' : ''}`}
          onClick={() => onMode('create')}
        >
          <Share2 size={15} style={{ marginRight: 4 }} /> Share 6-Digit Code
        </button>
        <button
          className={`wa-filter-chip ${mode === 'accept' ? 'active' : ''}`}
          onClick={() => onMode('accept')}
        >
          <KeyRound size={15} style={{ marginRight: 4 }} /> Enter 6-Digit Code
        </button>
        <button
          className={`wa-filter-chip ${mode === 'scan' ? 'active' : ''}`}
          onClick={() => onMode('scan')}
        >
          <QrCode size={15} style={{ marginRight: 4 }} /> Scan QR
        </button>
      </div>

      <div className="wa-page-scrollable-body" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {mode === 'group' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 14, padding: 14 }}>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Group Name
              </label>
              <input
                type="text"
                className="wa-search-pill"
                style={{ width: '100%', padding: '10px 14px', fontSize: 16, color: '#fff', background: 'var(--bg-tertiary)', border: 'none', borderRadius: 10 }}
                placeholder="Enter group subject or name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                autoFocus
              />
            </div>

            <div style={{ background: 'var(--bg-secondary)', borderRadius: 14, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Add Members ({selectedMembers.size} selected)
                </span>
              </div>
              {individualFriends.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '12px 0' }}>
                  No contacts available yet. Share your 6-digit invite code first!
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {individualFriends.map((friend) => {
                    const isSelected = selectedMembers.has(friend.id)
                    return (
                      <div
                        key={friend.id}
                        className="wa-group-member-item"
                        onClick={() => toggleMember(friend.id)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 8px', borderRadius: 8, cursor: 'pointer', background: isSelected ? 'rgba(37, 211, 102, 0.12)' : 'transparent' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <Avatar friend={friend} size="small" />
                          <div>
                            <strong style={{ display: 'block', fontSize: 15, color: 'var(--text-primary)' }}>{getDisplayName(friend)}</strong>
                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{friend.handle}</span>
                          </div>
                        </div>
                        <div
                          className={`wa-group-checkbox ${isSelected ? 'checked' : ''}`}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            border: isSelected ? 'none' : '2px solid var(--text-secondary)',
                            background: isSelected ? 'var(--accent-green)' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {isSelected && <Check size={14} color="#000" strokeWidth={3} />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <button
              className="wa-btn-primary full-width"
              disabled={!groupName.trim()}
              onClick={() => onCreateGroup(groupName, Array.from(selectedMembers))}
              style={{ marginTop: 8, padding: 14, fontSize: 16, fontWeight: 600, opacity: groupName.trim() ? 1 : 0.5 }}
            >
              Create Group
            </button>
          </div>
        )}

        {mode === 'create' && (
          <div className="wa-6digit-card">
            {isExpired ? (
              <div className="wa-expiry-pill expired" style={{ display: 'inline-flex', alignSelf: 'center', marginBottom: 12 }}>
                <span>⚠️</span> Expired · Code is no longer valid
              </div>
            ) : (
              <div className="wa-expiry-pill" style={{ display: 'inline-flex', alignSelf: 'center', marginBottom: 12 }}>
                <span>⏱</span> Expires in {countdown} · Single-use only
              </div>
            )}

            <div style={{ textAlign: 'center', margin: '16px 0' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Your 6-Digit Alphanumeric Code
              </span>
              <div
                className={`wa-6digit-badge ${isExpired ? 'expired' : ''}`}
                style={isExpired ? { opacity: 0.5, borderColor: 'var(--accent-red)', color: 'var(--accent-red)', textDecoration: 'line-through' } : undefined}
              >
                {code ? (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code) : '······'}
              </div>
            </div>

            {isExpired ? (
              <button
                className="wa-btn-primary full-width"
                onClick={onRegenerateCode}
                style={{ marginBottom: 16, background: 'var(--accent-green)', color: '#000', fontWeight: 600 }}
              >
                <RefreshCw size={18} style={{ marginRight: 6 }} /> Generate New Code
              </button>
            ) : (
              <button
                className="wa-btn-primary full-width"
                onClick={onCopy}
                disabled={!code}
                style={{ marginBottom: 16 }}
              >
                <Copy size={18} style={{ marginRight: 6 }} /> Copy 6-Digit Code
              </button>
            )}

            <div
              className="wa-qr-box"
              style={{
                margin: '16px auto',
                width: 180,
                height: 180,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#fff',
                borderRadius: 16,
                padding: 10,
                opacity: isExpired ? 0.35 : 1,
              }}
            >
              {qr ? <img src={qr} alt="6-Digit QR code" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <QrCode size={140} color="#000" />}
            </div>

            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, marginTop: 8 }}>
              {isExpired
                ? 'This 6-digit code has expired. Please generate a new code to pair with a friend.'
                : 'Share this direct 6-digit code or let them scan the QR code to pair immediately.'}
            </p>
          </div>
        )}

        {mode === 'accept' && (
          <div className="wa-6digit-card" style={{ maxWidth: 440, margin: '0 auto' }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6, textAlign: 'center' }}>Enter 6-Digit Code</h3>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20, textAlign: 'center' }}>
              Enter the 6-character code given by your friend.
            </p>

            <input
              className="wa-6digit-input"
              value={input}
              maxLength={6}
              autoFocus
              placeholder="••••••"
              onChange={(e) => {
                const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
                onInput(val)
              }}
              style={{
                textAlign: 'center',
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: 8,
                padding: '12px 16px',
                borderRadius: 12,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--separator)',
                color: 'var(--accent-green)',
                width: '100%',
                marginBottom: 20,
                textTransform: 'uppercase',
                fontFamily: 'monospace',
              }}
            />

            <button
              className="wa-btn-primary full-width"
              disabled={input.trim().length !== 6}
              onClick={() => onAccept(input)}
              style={{ opacity: input.trim().length === 6 ? 1 : 0.5, padding: 14, fontSize: 16, fontWeight: 600 }}
            >
              <Check size={18} /> Connect
            </button>

            <button
              className="wa-btn-secondary full-width"
              onClick={() => onMode('scan')}
              style={{ marginTop: 12, padding: 12 }}
            >
              <Camera size={18} /> Scan QR Code Instead
            </button>
          </div>
        )}

        {mode === 'scan' && (
          <div style={{ maxWidth: 440, margin: '0 auto', textAlign: 'center' }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Scan Friend's QR</h3>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Align the 6-digit QR code inside the camera frame.
            </p>
            <QrScanner onDetected={(payload) => onAccept(payload)} />
            <button className="wa-btn-secondary full-width" style={{ marginTop: 16 }} onClick={() => onMode('accept')}>
              Enter 6-digit code manually
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function CameraScannerPage({
  onDetected,
  onEnterManually,
  onClose,
}: {
  onDetected: (payload: string) => void
  onEnterManually: () => void
  onClose: () => void
}) {
  return (
    <div className="wa-fullscreen-page">
      <header className="wa-page-nav-header">
        <div className="wa-page-nav-left">
          <button type="button" className="stitch-back-button wa-back-pill" onClick={onClose} aria-label="Back">
            <ChevronLeft size={22} className="wa-back-chevron" />
          </button>
        </div>
        <h2 className="wa-page-nav-title">Scan Code</h2>
        <div className="wa-page-nav-right" />
      </header>
      <div className="wa-page-scrollable-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <QrScanner onDetected={onDetected} />
        <button className="wa-btn-secondary" style={{ marginTop: 24, maxWidth: 300, width: '100%' }} onClick={onEnterManually}>
          Enter 6-digit code manually
        </button>
      </div>
    </div>
  )
}

function QrScanner({ onDetected }: { onDetected: (payload: string) => void }) {
  const scannerRef = useRef<Html5QrcodeInstance | null>(null)
  const handledRef = useRef(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    void import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (disposed) return
      const scanner = new Html5Qrcode('luma-qr-reader')
      scannerRef.current = scanner
      return scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 230, height: 230 }, aspectRatio: 1 },
        (decodedText) => {
          if (disposed || handledRef.current) return
          handledRef.current = true
          onDetected(decodedText)
        },
        () => undefined
      )
    }).catch((reason: unknown) => {
      if (disposed) return
      const message = reason instanceof Error ? reason.message.toLowerCase() : ''
      setError(message.includes('permission') || message.includes('notallowed')
        ? 'Camera permission was denied. Allow camera access or enter code manually.'
        : 'QR scanning is unavailable on this browser. Enter code manually instead.')
    })

    return () => {
      disposed = true
      const activeScanner = scannerRef.current
      scannerRef.current = null
      if (!activeScanner) return
      void activeScanner.stop().catch(() => undefined).finally(() => {
        try { activeScanner.clear() } catch { /* ignore */ }
      })
    }
  }, [onDetected])

  return (
    <div className="stitch-qr-scanner wa-qr-scanner">
      <div id="luma-qr-reader" className="wa-qr-reader" />
      {error ? (
        <div className="wa-qr-error"><Info size={15} />{error}</div>
      ) : (
        <p className="wa-qr-prompt"><Camera size={15} /> Point camera at the invite QR code.</p>
      )}
    </div>
  )
}

function CallOverlay({
  kind,
  friend,
  phase,
  elapsed,
  quality,
  effectiveQuality,
  network,
  localVideoRef,
  remoteVideoRef,
  localStream,
  remoteStream,
  cameraEnabled,
  facingMode,
  remoteMirrorMode,
  muted,
  speakerEnabled,
  isScreenSharing,
  showQualityMenu,
  setShowQualityMenu,
  onQuality,
  onMute,
  onCamera,
  onSwitchCamera,
  onCapturePhoto,
  onScreenShare,
  onPictureInPicture,
  onSpeaker,
  onToggleOutgoingMirror,
  onApplyZoom,
  onEnd,
}: {
  kind: CallKind
  friend: Friend
  phase: 'connecting' | 'connected'
  elapsed: string
  quality: QualityMode
  effectiveQuality: QualityMode
  network: NetworkSnapshot
  localVideoRef: RefObject<HTMLVideoElement | null>
  remoteVideoRef: RefObject<HTMLVideoElement | null>
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  cameraEnabled: boolean
  facingMode: 'user' | 'environment'
  remoteMirrorMode: boolean
  muted: boolean
  speakerEnabled: boolean
  isScreenSharing: boolean
  showQualityMenu: boolean
  setShowQualityMenu: (value: boolean) => void
  onQuality: (mode: QualityMode) => void
  onMute: () => void
  onCamera: () => void
  onSwitchCamera: () => void
  onCapturePhoto: () => Promise<string | null> | void
  onScreenShare: () => void
  onPictureInPicture: () => void
  onSpeaker: () => void
  onToggleOutgoingMirror?: (enabled: boolean) => void
  onApplyZoom?: (zoom: number) => Promise<boolean> | void
  onEnd: () => void
}) {
  const isVideo = kind === 'video' && quality !== 'audio'
  const hasRemoteVideo = Boolean(remoteStream?.getVideoTracks().length)
  const hasLocalVideo = Boolean(localStream?.getVideoTracks().length)
  const [showCallControls, setShowCallControls] = useState(true)
  const [showSelfView, setShowSelfView] = useState(true)
  const [showMoreSheet, setShowMoreSheet] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
  const [captureBanner, setCaptureBanner] = useState<{ thumb: string; text: string } | null>(null)
  
  // Camera Swap State (false: Remote main, Local PiP; true: Local main, Remote PiP)
  const [isSwapped, setIsSwapped] = useState(false)

  // Zoom and Pan State for Main Video
  const [zoomLevel, setZoomLevel] = useState(1.0)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const pinchRef = useRef<{ dist: number; startZoom: number } | null>(null)
  const panRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null)
  const lastTapRef = useRef<number>(0)

  // Movable Floating PiP State
  const [selfViewPosition, setSelfViewPosition] = useState<{ left: number; top: number } | null>(() => {
    try {
      const saved = localStorage.getItem('luma_call_pip_pos')
      if (saved) {
        const parsed = JSON.parse(saved) as { left?: number; top?: number }
        if (typeof parsed.left === 'number' && typeof parsed.top === 'number') {
          return { left: parsed.left, top: parsed.top }
        }
      }
    } catch {
      /* ignore */
    }
    return null
  })

  useEffect(() => {
    try {
      if (selfViewPosition) {
        localStorage.setItem('luma_call_pip_pos', JSON.stringify(selfViewPosition))
      }
    } catch {
      /* ignore */
    }
  }, [selfViewPosition])

  const callSurfaceRef = useRef<HTMLDivElement>(null)
  const selfViewRef = useRef<HTMLDivElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const dragStartRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null)

  const [volumeBoost, setVolumeBoost] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('luma_call_volume_boost')
      if (saved) {
        const val = parseFloat(saved)
        if (!isNaN(val) && val >= 1.0 && val <= 5.0) return val
      }
    } catch {
      /* ignore */
    }
    return 2.0 // Default 2.0x (200% volume boost)
  })
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const boosterRef = useRef<AudioBooster | null>(null)

  // Initialize and attach AudioBooster for hardware-amplified volume (2x default, up to 5x)
  useEffect(() => {
    const booster = new AudioBooster(volumeBoost)
    boosterRef.current = booster
    booster.onStateChange = (running) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.muted = running
      }
    }
    booster.attachStream(remoteStream)
    return () => {
      booster.destroy()
      boosterRef.current = null
    }
  }, [])

  useEffect(() => {
    if (boosterRef.current) {
      boosterRef.current.attachStream(remoteStream)
    }
  }, [remoteStream])

  useEffect(() => {
    if (boosterRef.current) {
      boosterRef.current.setBoost(volumeBoost)
    }
    try {
      localStorage.setItem('luma_call_volume_boost', String(volumeBoost))
    } catch {
      /* ignore */
    }
  }, [volumeBoost])

  const [myMirrorPreference, setMyMirrorPreference] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('luma_call_mirror_camera')
      return saved !== null ? saved === 'true' : true
    } catch {
      return true
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('luma_call_mirror_camera', String(myMirrorPreference))
    } catch {
      /* ignore */
    }
  }, [myMirrorPreference])

  async function handleCapturePhoto() {
    setIsFlashing(true)
    setTimeout(() => setIsFlashing(false), 250)
    try {
      const result = await onCapturePhoto()
      if (result && typeof result === 'string') {
        setCaptureBanner({ thumb: result, text: 'Photo captured by you' })
        setTimeout(() => setCaptureBanner(null), 3500)
      }
    } catch {
      /* ignore */
    }
  }

  // Audio output synchronization with zero-latency unmuted fallback
  useEffect(() => {
    if (remoteAudioRef.current) {
      if (remoteStream) {
        if (remoteAudioRef.current.srcObject !== remoteStream) {
          remoteAudioRef.current.srcObject = remoteStream
        }
        // If booster is actively running, keep element muted to avoid double audio; otherwise unmute as fallback
        const isBoosterActive = boosterRef.current?.isRunning ?? false
        remoteAudioRef.current.muted = isBoosterActive
        void remoteAudioRef.current.play().catch(() => {
          const resumeAudio = () => {
            void boosterRef.current?.resume().then((running) => {
              if (remoteAudioRef.current) {
                remoteAudioRef.current.muted = running
              }
            })
            void remoteAudioRef.current?.play().catch(() => undefined)
            window.removeEventListener('click', resumeAudio)
            window.removeEventListener('touchstart', resumeAudio)
          }
          window.addEventListener('click', resumeAudio, { once: true })
          window.addEventListener('touchstart', resumeAudio, { once: true })
        })
      } else {
        remoteAudioRef.current.srcObject = null
      }
    }
  }, [remoteStream])

  // Remote & local video synchronization (isolated from layout swaps)
  useEffect(() => {
    if (remoteVideoRef.current) {
      if (remoteStream) {
        remoteVideoRef.current.muted = true
        if (remoteVideoRef.current.srcObject !== remoteStream) {
          remoteVideoRef.current.srcObject = remoteStream
          void remoteVideoRef.current.play().catch(() => undefined)
        }
      } else {
        remoteVideoRef.current.srcObject = null
      }
    }
  }, [remoteStream, remoteVideoRef])

  useEffect(() => {
    if (localVideoRef.current) {
      if (localStream) {
        if (localVideoRef.current.srcObject !== localStream) {
          localVideoRef.current.srcObject = localStream
          void localVideoRef.current.play().catch(() => undefined)
        }
      } else {
        localVideoRef.current.srcObject = null
      }
    }
  }, [localStream, localVideoRef])

  useEffect(() => {
    return () => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
      if (localVideoRef.current) localVideoRef.current.srcObject = null
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
    }
  }, [remoteVideoRef, localVideoRef])

  // PiP Viewport Boundary Clamping on Resize
  useEffect(() => {
    const clampSelfViewToSurface = () => {
      const surface = callSurfaceRef.current
      const selfView = selfViewRef.current
      if (!surface || !selfView) return
      setSelfViewPosition((position) => {
        if (!position) return position
        const surfaceRect = surface.getBoundingClientRect()
        const selfViewRect = selfView.getBoundingClientRect()
        return {
          left: Math.min(Math.max(12, position.left), Math.max(12, surfaceRect.width - selfViewRect.width - 12)),
          top: Math.min(Math.max(60, position.top), Math.max(60, surfaceRect.height - selfViewRect.height - 100)),
        }
      })
    }
    window.addEventListener('resize', clampSelfViewToSurface)
    return () => window.removeEventListener('resize', clampSelfViewToSurface)
  }, [showSelfView])

  // PiP Drag & Tap Swap Pointer Handlers
  function beginSelfViewDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const selfView = event.currentTarget
    const surface = callSurfaceRef.current
    if (!surface) return
    const selfViewRect = selfView.getBoundingClientRect()
    dragStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - selfViewRect.left,
      offsetY: event.clientY - selfViewRect.top,
      moved: false,
    }
    selfView.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  function moveSelfView(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragStartRef.current
    const surface = callSurfaceRef.current
    const selfView = selfViewRef.current
    if (!state || state.pointerId !== event.pointerId || !surface || !selfView) return
    const dist = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
    if (dist > 6) {
      state.moved = true
    }
    if (state.moved) {
      const surfaceRect = surface.getBoundingClientRect()
      const selfViewRect = selfView.getBoundingClientRect()
      const maxLeft = Math.max(12, surfaceRect.width - selfViewRect.width - 12)
      const maxTop = Math.max(60, surfaceRect.height - selfViewRect.height - 100)
      setSelfViewPosition({
        left: Math.min(Math.max(12, event.clientX - surfaceRect.left - state.offsetX), maxLeft),
        top: Math.min(Math.max(60, event.clientY - surfaceRect.top - state.offsetY), maxTop),
      })
    }
    event.preventDefault()
  }

  function finishSelfViewDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragStartRef.current
    if (!state || state.pointerId !== event.pointerId) return
    if (!state.moved) {
      // Tap detected! Swap camera views seamlessly without reconnecting WebRTC
      setIsSwapped((prev) => {
        const next = !prev
        setZoomLevel(1.0)
        setPanOffset({ x: 0, y: 0 })
        if (!next) {
          onApplyZoom?.(1.0)
        }
        return next
      })
    }
    dragStartRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.stopPropagation()
  }

  // Multi-Touch Pinch-to-Zoom & Pan Handlers for Main Video
  function handleMainTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 2) {
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
      pinchRef.current = { dist, startZoom: zoomLevel }
      panRef.current = null
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      panRef.current = { startX: t.clientX, startY: t.clientY, startPanX: panOffset.x, startPanY: panOffset.y }
      const now = Date.now()
      if (now - lastTapRef.current < 300) {
        // Double tap: reset zoom
        setZoomLevel(1.0)
        setPanOffset({ x: 0, y: 0 })
        if (isSwapped) onApplyZoom?.(1.0)
        lastTapRef.current = 0
      } else {
        lastTapRef.current = now
      }
    }
  }

  function handleMainTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 2 && pinchRef.current) {
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
      const factor = dist / Math.max(1, pinchRef.current.dist)
      const newZoom = Math.min(Math.max(1.0, pinchRef.current.startZoom * factor), 5.0)
      setZoomLevel(newZoom)
      if (newZoom === 1.0) {
        setPanOffset({ x: 0, y: 0 })
      }
      if (isSwapped) {
        onApplyZoom?.(newZoom)
      }
    } else if (e.touches.length === 1 && panRef.current && zoomLevel > 1.0) {
      const t = e.touches[0]
      const dx = t.clientX - panRef.current.startX
      const dy = t.clientY - panRef.current.startY
      const surface = callSurfaceRef.current
      const w = surface?.clientWidth ?? window.innerWidth
      const h = surface?.clientHeight ?? window.innerHeight
      const maxPanX = ((zoomLevel - 1) * w) / 2
      const maxPanY = ((zoomLevel - 1) * h) / 2
      const targetX = Math.min(Math.max(-maxPanX, panRef.current.startPanX + dx), maxPanX)
      const targetY = Math.min(Math.max(-maxPanY, panRef.current.startPanY + dy), maxPanY)
      setPanOffset({ x: targetX, y: targetY })
    }
  }

  function handleMainTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length < 2) pinchRef.current = null
    if (e.touches.length === 0) panRef.current = null
  }

  function toggleCallControls() {
    setShowCallControls((visible) => !visible)
    setShowQualityMenu(false)
  }

  const isLocalMain = isSwapped
  const mainHasVideo = isLocalMain ? hasLocalVideo : hasRemoteVideo
  const shouldMirrorLocal = facingMode === 'user' && !isScreenSharing
  const shouldMirrorRemote = remoteMirrorMode
  const isMainMirrored = isLocalMain ? shouldMirrorLocal : shouldMirrorRemote
  const mainZoomTransform = `${isMainMirrored ? 'scaleX(-1) ' : ''}translate(${isMainMirrored ? -panOffset.x : panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`

  return (
    <div
      ref={callSurfaceRef}
      className={`stitch-call-screen wa-call-screen ${showCallControls ? '' : 'controls-hidden'}`}
      onClick={toggleCallControls}
    >
      {/* White shutter flash */}
      {isFlashing && <div className="wa-shutter-flash" />}

      {/* Captured Photo Dropdown Banner */}
      {captureBanner && (
        <div className="wa-call-capture-toast animate-slide-down" onClick={(e) => e.stopPropagation()}>
          <img src={captureBanner.thumb} alt="Captured photo" className="wa-call-capture-toast-img" />
          <div className="wa-call-capture-toast-text">
            <strong>Photo captured</strong>
            <span>Saved & sent to chat</span>
          </div>
          <button
            type="button"
            className="wa-call-capture-toast-close"
            onClick={() => setCaptureBanner(null)}
            aria-label="Dismiss banner"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main Video Viewport with Touch Zoom and Pan */}
      {isVideo ? (
        <div
          className="wa-call-main-video-wrap"
          style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, overflow: 'hidden' }}
          onTouchStart={handleMainTouchStart}
          onTouchMove={handleMainTouchMove}
          onTouchEnd={handleMainTouchEnd}
        >
          {isLocalMain ? (
            <video
              ref={localVideoRef}
              className="stitch-remote-video wa-call-remote-video"
              autoPlay
              playsInline
              muted
              disablePictureInPicture
              onLoadedMetadata={(e) => {
                void e.currentTarget.play().catch(() => undefined)
              }}
              style={{ transform: mainZoomTransform }}
            />
          ) : (
            <video
              ref={remoteVideoRef}
              className="stitch-remote-video wa-call-remote-video"
              autoPlay
              playsInline
              muted
              onLoadedMetadata={(e) => {
                const vid = e.currentTarget as unknown as { autoPictureInPicture?: boolean; play: () => Promise<void> }
                vid.autoPictureInPicture = true
                void vid.play().catch(() => undefined)
              }}
              style={{ transform: mainZoomTransform }}
            />
          )}

          {/* Show ringing surface overlay only while connecting */}
          {phase === 'connecting' && (
            <div className="wa-call-ringing-surface" style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
              <div className="wa-call-ringing-wallpaper" />
              <div className="wa-call-ringing-content">
                <div className="wa-call-ringing-avatar-wrap">
                  <Avatar friend={friend} size="large" />
                  <span className="wa-call-pulse-ring" />
                </div>
                <h2 className="wa-call-ringing-name">{getDisplayName(friend)}</h2>
                <span className="wa-call-ringing-status">Video call</span>
                <span className="wa-call-ringing-sub">Ringing…</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="wa-call-ringing-surface">
          <div className="wa-call-ringing-wallpaper" />
          <div className="wa-call-ringing-content">
            <div className="wa-call-ringing-avatar-wrap">
              <Avatar friend={friend} size="large" />
              <span className="wa-call-pulse-ring" />
            </div>
            <h2 className="wa-call-ringing-name">{getDisplayName(friend)}</h2>
            <span className="wa-call-ringing-status">
              {phase === 'connecting' ? 'LumaChat Audio…' : 'Audio call'}
            </span>
            <span className="wa-call-ringing-sub">
              {phase === 'connecting' ? 'Ringing…' : elapsed}
            </span>
          </div>
        </div>
      )}

      {/* Floating Zoom Indicator & Reset Pill */}
      {zoomLevel > 1.0 && (
        <button
          className="wa-call-zoom-reset-pill animate-fade-in"
          onClick={(e) => {
            e.stopPropagation()
            setZoomLevel(1.0)
            setPanOffset({ x: 0, y: 0 })
            if (isSwapped) onApplyZoom?.(1.0)
          }}
          aria-label="Reset zoom"
        >
          <Search size={14} />
          <span>{zoomLevel.toFixed(1)}x</span>
          <span className="wa-zoom-reset-label">Reset</span>
        </button>
      )}

      {/* Remote audio output element (dedicated unmuted audio playback for voice and video calls) */}
      <audio ref={remoteAudioRef} className="stitch-remote-audio" autoPlay playsInline />

      {/* Top Bar matching WhatsApp iOS */}
      <div className="stitch-call-top wa-call-top-bar" onClick={(e) => e.stopPropagation()}>
        <button className="wa-call-top-back" onClick={onEnd} aria-label="End or minimize call">
          <ChevronLeft size={22} className="wa-back-chevron" />
        </button>
        <div className="wa-call-top-person">
          <strong className="wa-call-top-name">{getDisplayName(friend)}</strong>
          <span className="wa-call-top-timer">
            {phase === 'connecting' ? 'Connecting…' : elapsed}
          </span>
        </div>
        <div className="wa-call-top-right">
          <button
            className="stitch-quality-trigger wa-call-quality-pill"
            onClick={() => setShowQualityMenu(!showQualityMenu)}
          >
            <span className={`stitch-network-dot ${network.label.toLowerCase()}`} />
            {qualityLabel[effectiveQuality]}
            {network.label === 'Reconnecting' ? (
              <span className="wa-dim-reconnecting"> · reconnecting</span>
            ) : (
              ` · ${network.label}`
            )}
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {/* Floating PiP Tile (Tap to Swap, Drag anywhere on viewport) */}
      {isVideo && (
        <div
          ref={selfViewRef}
          className={`stitch-local-video-frame wa-call-pip-frame ${selfViewPosition ? 'is-dragged' : ''} ${showSelfView ? '' : 'is-hidden'}`}
          style={selfViewPosition ? { left: selfViewPosition.left, top: selfViewPosition.top } : undefined}
          onPointerDown={beginSelfViewDrag}
          onPointerMove={moveSelfView}
          onPointerUp={finishSelfViewDrag}
          onPointerCancel={finishSelfViewDrag}
          onClick={(e) => e.stopPropagation()}
          aria-hidden={!showSelfView}
          title="Tap to swap camera, drag to move preview"
        >
          {isLocalMain ? (
            <video
              ref={remoteVideoRef}
              className={`stitch-local-video wa-call-pip-video ${shouldMirrorRemote ? 'mirrored' : ''}`}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={(e) => {
                const vid = e.currentTarget as unknown as { autoPictureInPicture?: boolean; play: () => Promise<void> }
                vid.autoPictureInPicture = true
                void vid.play().catch(() => undefined)
              }}
            />
          ) : (
            <video
              ref={localVideoRef}
              className={`stitch-local-video wa-call-pip-video ${shouldMirrorLocal ? 'mirrored' : ''}`}
              autoPlay
              muted
              playsInline
              disablePictureInPicture
              onLoadedMetadata={(e) => {
                void e.currentTarget.play().catch(() => undefined)
              }}
            />
          )}
        </div>
      )}

      {showQualityMenu && (
        <div className="stitch-quality-menu wa-call-quality-menu" onClick={(e) => e.stopPropagation()}>
          <div>
            <span>Video quality</span>
            <b>{network.label}</b>
          </div>
          {qualityModes.map((mode) => (
            <button
              key={mode}
              className={quality === mode ? 'selected' : ''}
              onClick={() => onQuality(mode)}
            >
              <span>
                <strong>{qualityLabel[mode]}</strong>
                <small>
                  {mode === 'auto'
                    ? 'Adapts to network'
                    : mode === 'audio'
                    ? 'Lowest data'
                    : `${QUALITY_PROFILES[mode as Exclude<QualityMode, 'auto'>].width} × ${QUALITY_PROFILES[mode as Exclude<QualityMode, 'auto'>].height}`}
                </small>
              </span>
              {quality === mode && <Check size={16} />}
            </button>
          ))}
        </div>
      )}

      {/* Floating snapshot capture button matching IMG_1637.PNG */}
      {kind === 'video' && hasRemoteVideo && (
        <button
          className="wa-call-floating-capture"
          onClick={(e) => {
            e.stopPropagation()
            void handleCapturePhoto()
          }}
          aria-label="Capture photo"
        >
          <span className="wa-capture-inner" />
        </button>
      )}

      {/* Floating Capsule Dock matching WhatsApp iOS */}
      <div className="stitch-call-bottom wa-call-dock-wrap" onClick={(e) => e.stopPropagation()}>
        <div className="wa-call-floating-dock">
          <button
            className="wa-call-dock-btn"
            onClick={() => setShowMoreSheet(true)}
            aria-label="More options"
          >
            <MoreHorizontal size={22} />
          </button>
          {kind === 'video' && (
            <button
              className={`wa-call-dock-btn ${!cameraEnabled ? 'active' : ''}`}
              onClick={onCamera}
              aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            >
              {cameraEnabled ? <Video size={22} /> : <VideoOff size={22} />}
            </button>
          )}
          {kind === 'video' && (
            <button
              className="wa-call-dock-btn"
              onClick={onSwitchCamera}
              aria-label="Flip camera"
            >
              <RefreshCw size={20} />
            </button>
          )}
          <button
            className={`wa-call-dock-btn ${speakerEnabled ? 'active' : ''}`}
            onClick={onSpeaker}
            aria-label="Speaker"
          >
            {speakerEnabled ? <Volume2 size={22} /> : <Headphones size={22} />}
          </button>
          <button
            className={`wa-call-dock-btn ${muted ? 'active' : ''}`}
            onClick={onMute}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {muted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
          <button
            className="wa-call-dock-btn wa-end-call-circle"
            onClick={onEnd}
            aria-label="End call"
          >
            <Phone size={24} />
          </button>
        </div>
      </div>

      {/* More Options Sheet matching IMG_1638.PNG */}
      {showMoreSheet && (
        <div className="wa-sheet-backdrop" onClick={() => setShowMoreSheet(false)}>
          <div className="wa-call-more-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="wa-sheet-drag-handle" />
            <div className="wa-more-header">
              <LockKeyhole size={14} className="wa-yellow-lock" />
              <span>End-to-end encrypted call</span>
            </div>
            {/* Quick reaction emojis */}
            <div className="wa-call-reaction-bar">
              {['❤️', '👍', '😂', '😮', '😢', '🙏'].map((emoji) => (
                <button
                  key={emoji}
                  className="wa-call-reaction-btn"
                  onClick={() => setShowMoreSheet(false)}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className="wa-grouped-table">
              <button
                className="wa-table-cell"
                onClick={() => setShowVolumeSlider((v) => !v)}
              >
                <Volume2 size={20} />
                <span className="wa-cell-title">Volume Boost</span>
                <span className="wa-cell-value">{volumeBoost.toFixed(1)}x {volumeBoost === 2.0 ? '(Default)' : ''}</span>
              </button>

              {showVolumeSlider && (
                <div className="wa-volume-booster-card animate-fade-in" onClick={(e) => e.stopPropagation()}>
                  <div className="wa-volume-booster-header">
                    <span className="wa-volume-booster-label">Volume Boost</span>
                    <span className="wa-volume-booster-badge">{volumeBoost.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    className="wa-volume-slider"
                    min="1.0"
                    max="5.0"
                    step="0.1"
                    value={volumeBoost}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      setVolumeBoost(val)
                    }}
                    aria-label="Volume boost slider"
                  />
                  <div className="wa-volume-presets">
                    {[1.0, 2.0, 3.0, 4.0, 5.0].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={`wa-volume-preset-chip ${Math.abs(volumeBoost - preset) < 0.05 ? 'active' : ''}`}
                        onClick={() => setVolumeBoost(preset)}
                      >
                        {preset.toFixed(0)}x{preset === 2.0 ? ' (Default)' : ''}
                      </button>
                    ))}
                  </div>
                  <span className="wa-volume-booster-hint">
                    Amplifies whisper-quiet or low incoming call volume from 1.0x up to 5.0x using Web Audio hardware gain.
                  </span>
                </div>
              )}
              {kind === 'video' && (
                <button
                  className="wa-table-cell"
                  onClick={() => {
                    setMyMirrorPreference((prev) => {
                      const next = !prev
                      onToggleOutgoingMirror?.(next)
                      return next
                    })
                  }}
                >
                  <FlipHorizontal size={20} />
                  <span className="wa-cell-title">Mirror Camera</span>
                  <span className="wa-cell-value">
                    {myMirrorPreference ? 'On (Left is Left)' : 'Off (Direct POV)'}
                  </span>
                </button>
              )}
              {kind === 'video' && (
                <button
                  className="wa-table-cell"
                  onClick={() => {
                    setShowMoreSheet(false)
                    setShowSelfView((v) => !v)
                  }}
                >
                  {showSelfView ? <EyeOff size={20} /> : <Eye size={20} />}
                  <span className="wa-cell-title">
                    {showSelfView ? 'Hide Self View' : 'Show Self View'}
                  </span>
                </button>
              )}
              {kind === 'video' && (
                <button
                  className="wa-table-cell"
                  onClick={() => {
                    setShowMoreSheet(false)
                    onScreenShare()
                  }}
                >
                  <MonitorUp size={20} />
                  <span className="wa-cell-title">
                    {isScreenSharing ? 'Stop Screen Sharing' : 'Share Screen'}
                  </span>
                </button>
              )}
              {kind === 'video' && (
                <button
                  className="wa-table-cell"
                  onClick={() => {
                    setShowMoreSheet(false)
                    onPictureInPicture()
                  }}
                  disabled={!hasRemoteVideo}
                >
                  <PictureInPicture size={20} />
                  <span className="wa-cell-title">Picture in Picture</span>
                </button>
              )}
              <button
                className="wa-table-cell"
                onClick={() => {
                  setShowMoreSheet(false)
                  setShowQualityMenu(true)
                }}
              >
                <Sliders size={20} />
                <span className="wa-cell-title">Adjust Call Quality</span>
                <span className="wa-cell-value">{qualityLabel[quality]}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
