import type { ChatMessage, Friend, MessageKind } from '../types'

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

export const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp)

export const formatLastSeen = (timestamp?: number) => {
  if (!timestamp || !Number.isFinite(timestamp)) return 'Last seen recently'
  const elapsed = Math.max(0, Date.now() - timestamp)
  if (elapsed < 60_000) return 'Last seen just now'
  if (elapsed < 3_600_000) return `Last seen ${Math.floor(elapsed / 60_000)} min ago`
  return `Last seen ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)}`
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

  if (isToday || diff < oneDay) {
    const hours = Math.floor(diff / oneHour)
    if (hours < 1) {
      const mins = Math.floor(diff / 60_000)
      return mins <= 1 ? 'Just now' : `${mins}m ago`
    }
    return `${hours}h ago`
  }

  if (isYesterday || diff < 2 * oneDay) {
    return 'Yesterday'
  }

  if (diff < oneWeek) {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(msgDate)
  }

  const day = String(msgDate.getDate()).padStart(2, '0')
  const month = String(msgDate.getMonth() + 1).padStart(2, '0')
  const year = msgDate.getFullYear()
  return `${day}/${month}/${year}`
}

export const formatDuration = (startedAt: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export const formatCallDuration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

export function formatMediaTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00'
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

export function formatMessageDayHeader(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((today.getTime() - msgDate.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7 && diffDays > 1) return date.toLocaleDateString(undefined, { weekday: 'long' })
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

export function getDisplayName(friend?: { name: string; nickname?: string } | null): string {
  if (!friend) return ''
  return friend.nickname?.trim() || friend.name
}

export function getFriendAvatarUrl(
  friend?: { name?: string; photoURL?: string } | null,
): string | undefined {
  if (!friend) return undefined
  if (friend.photoURL) return friend.photoURL
  if (friend.name && friend.name.toLowerCase().includes('gunnu')) return '/avatars/gunnu_verma.png'
  return undefined
}

export async function readMediaDimensions(file: File, kind: MessageKind) {
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
