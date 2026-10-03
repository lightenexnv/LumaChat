export type QualityMode = 'auto' | '1080p' | '720p' | '480p' | '360p' | '240p' | 'audio'

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read'
export type MessageKind = 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'contact' | 'call'

export interface ChatAttachment {
  fileName: string
  contentType: string
  size: number
  storagePath: string
  url?: string
  durationSeconds?: number
  width?: number
  height?: number
  mediaGroupId?: string
  callSessionId?: string
  capturedAt?: number
  uploadState?: 'pending' | 'uploading' | 'ready' | 'failed'
  uploadProgress?: number
  isDocument?: boolean
}

export interface SharedLocation {
  latitude: number
  longitude: number
  accuracy?: number
  label?: string
}

export interface SharedContact {
  uid: string
  name: string
  handle: string
  initials: string
  color: string
  photoURL?: string
}

export interface CallSummary {
  kind: 'voice' | 'video'
  outcome: 'completed' | 'missed' | 'declined' | 'cancelled'
  durationSeconds: number
  initiatedAt: number
  endedAt?: number
  sessionId?: string
  callerId?: string
}

export interface CallLogEntry extends CallSummary {
  id: string
  friendId: string
  friendName: string
  friendInitials: string
  friendColor: string
  friendPhotoURL?: string
  direction: 'incoming' | 'outgoing'
}

export interface Friend {
  id: string
  name: string
  nickname?: string
  handle: string
  initials: string
  color: string
  photoURL?: string
  online: boolean
  lastSeen?: number
  verified?: boolean
  conversationId: string
  pairingSecret: string
  pinned?: boolean
  favourite?: boolean
  muted?: boolean
  disappearingTimer?: number
  unreadCount?: number
  clearedAt?: number
  isGroup?: boolean
  memberCount?: number
  memberIds?: string[]
}

export interface ReplyReference {
  messageId: string
  senderName?: string
  snippet: string
}

export interface ChatMessage {
  id: string
  /** Client-only routing key for optimistic messages. Never persisted. */
  conversationId?: string
  senderId: string
  text: string
  createdAt: number
  status: MessageStatus
  kind: MessageKind
  attachment?: ChatAttachment
  location?: SharedLocation
  contact?: SharedContact
  call?: CallSummary
  encrypted?: boolean
  replyTo?: ReplyReference
  forwarded?: boolean
  edited?: boolean
  editedAt?: number
  starred?: boolean
  deletedForEveryone?: boolean
  deletedAt?: number
  deletedBy?: string
  deletedFor?: string[]
  mediaGroupId?: string
  callSessionId?: string
  capturedAt?: number
}

export interface QualityProfile {
  mode: QualityMode
  label: string
  width: number
  height: number
  fps: number
  maxBitrate: number
}

export interface NetworkSnapshot {
  label: 'Excellent' | 'Good' | 'Fair' | 'Weak' | 'Reconnecting'
  rtt: number
  packetLoss: number
  bitrate: number
  mode: QualityMode
}
