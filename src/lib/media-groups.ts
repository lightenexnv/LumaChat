import type { ChatMessage } from '../types'

export type DisplayMessageGroup = { message: ChatMessage; messages: ChatMessage[] }

const MAX_GROUP_GAP_MS = 10 * 60 * 1000

export function groupDisplayMessages(messages: ChatMessage[]): DisplayMessageGroup[] {
  const groups: DisplayMessageGroup[] = []
  for (const message of messages) {
    const previous = groups[groups.length - 1]
    const previousMessage = previous?.messages[previous.messages.length - 1]
    const explicitSession = message.callSessionId || message.attachment?.callSessionId
    const previousSession = previousMessage?.callSessionId || previousMessage?.attachment?.callSessionId
    const sessionCompatible = (!explicitSession && !previousSession) || Boolean(explicitSession && previousSession && explicitSession === previousSession)
    const canJoin = message.kind === 'image'
      && Boolean(previous)
      && previous.messages.every((item) => item.kind === 'image')
      && previousMessage?.senderId === message.senderId
      && message.createdAt - (previousMessage?.createdAt ?? message.createdAt) < MAX_GROUP_GAP_MS
      && sessionCompatible
    if (canJoin && previous) {
      previous.messages.push(message)
      previous.message = message
    } else {
      groups.push({ message, messages: [message] })
    }
  }
  return groups
}

export interface MediaGridConfig {
  layout: 'single' | 'two' | 'three' | 'four_plus'
  visibleImages: ChatMessage[]
  blurredTileMessage: ChatMessage | null
  overflowCount: number
}

export function getMediaGridConfig(messages: ChatMessage[]): MediaGridConfig {
  if (messages.length <= 1) {
    return {
      layout: 'single',
      visibleImages: messages,
      blurredTileMessage: null,
      overflowCount: 0,
    }
  }
  if (messages.length === 2) {
    return {
      layout: 'two',
      visibleImages: messages,
      blurredTileMessage: null,
      overflowCount: 0,
    }
  }
  if (messages.length === 3) {
    return {
      layout: 'three',
      visibleImages: messages,
      blurredTileMessage: null,
      overflowCount: 0,
    }
  }
  return {
    layout: 'four_plus',
    visibleImages: messages.slice(0, 3),
    blurredTileMessage: messages[3],
    overflowCount: messages.length - 3,
  }
}
