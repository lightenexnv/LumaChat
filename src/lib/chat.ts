import { addDoc, arrayUnion, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, type Unsubscribe } from 'firebase/firestore'
import { auth, firestore } from './firebase'
import { decryptMessage, encryptMessage } from './crypto'
import { downloadDecryptedAttachment } from './storage'
import { triggerWebPushNotification } from './push'
import type { CallSummary, ChatMessage, MessageKind, MessageStatus, ReplyReference, SharedContact, SharedLocation } from '../types'

export interface ChatPayload {
  kind: MessageKind
  text?: string
  attachment?: {
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
    isDocument?: boolean
    uploadState?: 'pending' | 'uploading' | 'ready' | 'failed'
    uploadProgress?: number
  }
  location?: SharedLocation
  contact?: SharedContact
  call?: CallSummary
  replyTo?: ReplyReference
  forwarded?: boolean
  edited?: boolean
  editedAt?: number
  deletedForEveryone?: boolean
}

export function canAdvanceMessageStatus(from: MessageStatus, to: MessageStatus) {
  return (from === 'pending' && to === 'sent')
    || (from === 'sent' && to === 'delivered')
    || (from === 'delivered' && to === 'read')
}

export function decodePayload(value: string): ChatPayload {
  try {
    const parsed = JSON.parse(value) as Partial<ChatPayload>
    if (parsed && typeof parsed.kind === 'string') return parsed as ChatPayload
  } catch {
    // Older Luma versions contain plain encrypted text.
  }
  return { kind: 'text', text: value }
}

export function subscribeToChat(
  conversationId: string,
  pairingSecret: string,
  onMessages: (messages: ChatMessage[]) => void,
  onError: (error: Error) => void,
  clearedAt?: number,
): Unsubscribe | null {
  if (!firestore || !auth?.currentUser) return null
  const messagesRef = collection(firestore, 'conversations', conversationId, 'messages')
  const messagesQuery = clearedAt
    ? query(messagesRef, where('createdAt', '>', Timestamp.fromMillis(clearedAt)), orderBy('createdAt', 'asc'))
    : query(messagesRef, orderBy('createdAt', 'asc'))
  const acknowledgedMessageIds = new Set<string>()
  const objectUrls = new Set<string>()
  let revision = 0
  let stopped = false

  const unsubscribe = onSnapshot(messagesQuery, async (snapshot) => {
    const currentRevision = ++revision
    const nextUrls = new Set<string>()
    try {
      const currentUid = auth?.currentUser?.uid
      const rawMessages = await Promise.all(snapshot.docs.map(async (message): Promise<ChatMessage | null> => {
        const data = message.data()
        const senderId = data.senderId as string
        const deletedFor = Array.isArray(data.deletedFor) ? (data.deletedFor as string[]) : []

        // Delete-for-me: Hide message if marked deleted by the current user
        if (currentUid && deletedFor.includes(currentUid)) {
          return null
        }

        const isDeletedForEveryone = Boolean(data.deletedForEveryone)
        let status: ChatMessage['status'] = data.status === 'delivered' || data.status === 'read' ? data.status : 'sent'
        let payload: ChatPayload = { kind: 'text', text: isDeletedForEveryone ? 'This message was deleted' : '[Unable to decrypt]' }

        if (!isDeletedForEveryone) {
          try {
            payload = decodePayload(await decryptMessage(data.ciphertext as string, conversationId, pairingSecret))
          } catch {
            // Keep an explicit placeholder instead of hiding a failed message.
          }
        }

        let attachment = payload.attachment
        if (!isDeletedForEveryone && attachment) {
          try {
            const decrypted = await downloadDecryptedAttachment(attachment.storagePath, attachment.contentType, conversationId, pairingSecret)
            const url = URL.createObjectURL(decrypted)
            nextUrls.add(url)
            attachment = { ...attachment, url, uploadState: 'ready', uploadProgress: 1 }
          } catch {
            // The attachment can be unavailable while Storage is offline or still uploading.
          }
        }

        if (senderId !== currentUid && canAdvanceMessageStatus(status, 'delivered') && !acknowledgedMessageIds.has(message.id)) {
          acknowledgedMessageIds.add(message.id)
          try {
            await updateDoc(doc(messagesRef, message.id), { status: 'delivered' })
            status = 'delivered'
          } catch {
            acknowledgedMessageIds.delete(message.id)
          }
        }

        const isEdited = Boolean(data.edited || payload.edited)
        const editedAt = data.editedAt?.toMillis?.() ?? payload.editedAt ?? undefined
        const effectiveSenderId = (payload.kind === 'call' && payload.call?.callerId) ? payload.call.callerId : senderId

        return {
          id: message.id,
          senderId: effectiveSenderId,
          text: isDeletedForEveryone ? 'This message was deleted' : (payload.text ?? ''),
          kind: isDeletedForEveryone ? 'text' : payload.kind,
          attachment: isDeletedForEveryone ? undefined : attachment,
          location: isDeletedForEveryone ? undefined : payload.location,
          contact: isDeletedForEveryone ? undefined : payload.contact,
          call: isDeletedForEveryone ? undefined : payload.call,
          createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
          status,
          encrypted: true,
          replyTo: isDeletedForEveryone ? undefined : payload.replyTo,
          forwarded: isDeletedForEveryone ? false : Boolean(payload.forwarded),
          edited: isDeletedForEveryone ? false : isEdited,
          editedAt: isDeletedForEveryone ? undefined : editedAt,
          deletedForEveryone: isDeletedForEveryone,
          deletedAt: data.deletedAt?.toMillis?.() ?? undefined,
          deletedBy: data.deletedBy as string | undefined,
          deletedFor,
          mediaGroupId: attachment?.mediaGroupId,
          callSessionId: attachment?.callSessionId,
          capturedAt: attachment?.capturedAt,
        } satisfies ChatMessage
      }))

      if (stopped || currentRevision !== revision) {
        nextUrls.forEach((url) => URL.revokeObjectURL(url))
        return
      }

      const validMessages = rawMessages.filter((m): m is ChatMessage => m !== null)

      objectUrls.forEach((url) => URL.revokeObjectURL(url))
      objectUrls.clear()
      nextUrls.forEach((url) => objectUrls.add(url))
      onMessages(validMessages)
    } catch (error) {
      nextUrls.forEach((url) => URL.revokeObjectURL(url))
      onError(error instanceof Error ? error : new Error('Messages could not be loaded.'))
    }
  }, (error) => onError(error))

  return () => {
    stopped = true
    unsubscribe()
    objectUrls.forEach((url) => URL.revokeObjectURL(url))
    objectUrls.clear()
  }
}

export function subscribeToConversation(
  conversationId: string,
  onUpdate: (data: { pinnedMessageId?: string | null }) => void,
  onError?: (error: Error) => void,
): Unsubscribe | null {
  if (!firestore || !auth?.currentUser) return null
  const conversationRef = doc(firestore, 'conversations', conversationId)
  return onSnapshot(conversationRef, (snapshot) => {
    if (!snapshot.exists()) return
    const data = snapshot.data()
    onUpdate({ pinnedMessageId: (data.pinnedMessageId as string | null) ?? null })
  }, (error) => onError?.(error))
}

export async function sendEncryptedPayload(conversationId: string, pairingSecret: string, payload: ChatPayload, messageId?: string) {
  const currentUser = auth?.currentUser
  if (!firestore || !currentUser) throw new Error('Firebase is not configured.')
  const ciphertext = await encryptMessage(JSON.stringify(payload), conversationId, pairingSecret)
  const message = {
    ciphertext,
    senderId: currentUser.uid,
    createdAt: serverTimestamp(),
    status: 'sent' as const,
    type: payload.kind,
  }
  if (messageId) {
    await setDoc(doc(firestore, 'conversations', conversationId, 'messages', messageId), message)
  } else {
    await addDoc(collection(firestore, 'conversations', conversationId, 'messages'), message)
  }

  // Trigger web push notification for recipient(s) in background
  void (async () => {
    try {
      const convSnap = await getDoc(doc(firestore, 'conversations', conversationId))
      if (convSnap.exists()) {
        const data = convSnap.data()
        const memberIds = Array.isArray(data.memberIds) ? (data.memberIds as string[]) : []
        const recipientUids = memberIds.filter((uid) => uid !== currentUser.uid)
        const senderName = currentUser.displayName || 'Luma User'
        let previewText = 'Sent you a message'
        if (payload.kind === 'text' && payload.text) {
          previewText = payload.text
        } else if (payload.kind === 'image') {
          previewText = '📷 Photo'
        } else if (payload.kind === 'video') {
          previewText = '📹 Video'
        } else if (payload.kind === 'audio') {
          previewText = '🎤 Voice message'
        } else if (payload.kind === 'document') {
          previewText = '📄 Document'
        } else if (payload.kind === 'call') {
          previewText = `📞 ${payload.call?.kind === 'video' ? 'Video' : 'Voice'} call`
        }

        for (const recipientUid of recipientUids) {
          await triggerWebPushNotification({
            recipientUid,
            title: senderName,
            body: previewText,
            conversationId,
          })
        }
      }
    } catch {
      // Non-blocking best-effort push notification
    }
  })()
}

export async function sendEncryptedChatMessage(conversationId: string, pairingSecret: string, text: string, replyTo?: ReplyReference) {
  await sendEncryptedPayload(conversationId, pairingSecret, { kind: 'text', text, replyTo })
}

export async function forwardEncryptedMessage(conversationId: string, pairingSecret: string, originalMessage: ChatMessage) {
  const payload: ChatPayload = {
    kind: originalMessage.kind,
    text: originalMessage.text,
    attachment: originalMessage.attachment ? {
      fileName: originalMessage.attachment.fileName,
      contentType: originalMessage.attachment.contentType,
      size: originalMessage.attachment.size,
      storagePath: originalMessage.attachment.storagePath,
      durationSeconds: originalMessage.attachment.durationSeconds,
      width: originalMessage.attachment.width,
      height: originalMessage.attachment.height,
      mediaGroupId: originalMessage.attachment.mediaGroupId,
      callSessionId: originalMessage.attachment.callSessionId,
      capturedAt: originalMessage.attachment.capturedAt,
      isDocument: originalMessage.attachment.isDocument,
    } : undefined,
    location: originalMessage.location,
    contact: originalMessage.contact,
    call: originalMessage.call,
    forwarded: true,
  }
  await sendEncryptedPayload(conversationId, pairingSecret, payload)
}

export async function editEncryptedChatMessage(conversationId: string, pairingSecret: string, messageId: string, newText: string, originalMessage?: ChatMessage) {
  const currentUser = auth?.currentUser
  if (!firestore || !currentUser) throw new Error('Firebase is not configured.')
  const payload: ChatPayload = {
    kind: 'text',
    text: newText,
    replyTo: originalMessage?.replyTo,
    forwarded: originalMessage?.forwarded,
    edited: true,
  }
  const ciphertext = await encryptMessage(JSON.stringify(payload), conversationId, pairingSecret)
  await updateDoc(doc(firestore, 'conversations', conversationId, 'messages', messageId), {
    ciphertext,
    edited: true,
    editedAt: serverTimestamp(),
  })
}

export async function deleteMessageForMe(conversationId: string, messageId: string) {
  const currentUser = auth?.currentUser
  if (!firestore || !currentUser) throw new Error('Firebase is not configured.')
  await updateDoc(doc(firestore, 'conversations', conversationId, 'messages', messageId), {
    deletedFor: arrayUnion(currentUser.uid),
  })
}

export async function deleteMessageForEveryone(conversationId: string, pairingSecret: string, messageId: string) {
  const currentUser = auth?.currentUser
  if (!firestore || !currentUser) throw new Error('Firebase is not configured.')
  const tombstonePayload: ChatPayload = {
    kind: 'text',
    text: 'This message was deleted',
    deletedForEveryone: true,
  }
  const ciphertext = await encryptMessage(JSON.stringify(tombstonePayload), conversationId, pairingSecret)
  await updateDoc(doc(firestore, 'conversations', conversationId, 'messages', messageId), {
    ciphertext,
    deletedForEveryone: true,
    deletedAt: serverTimestamp(),
    deletedBy: currentUser.uid,
  })
}

export async function pinConversationMessage(conversationId: string, messageId: string | null) {
  const currentUser = auth?.currentUser
  if (!firestore || !currentUser) throw new Error('Firebase is not configured.')
  await updateDoc(doc(firestore, 'conversations', conversationId), {
    pinnedMessageId: messageId,
    pinnedBy: messageId ? currentUser.uid : null,
    pinnedAt: messageId ? serverTimestamp() : null,
  })
}

export async function sendCallHistoryMessage(conversationId: string, pairingSecret: string, call: CallSummary, callId: string) {
  await sendEncryptedPayload(conversationId, pairingSecret, { kind: 'call', call }, `call-${callId}`)
}

export async function markMessagesRead(conversationId: string, messageIds: string[]) {
  if (!firestore || !auth?.currentUser || messageIds.length === 0) return
  const messagesRef = collection(firestore, 'conversations', conversationId, 'messages')
  await Promise.all(messageIds.map(async (messageId) => {
    try {
      await updateDoc(doc(messagesRef, messageId), { status: 'read' })
    } catch {
      // A concurrent delivery/read transition or a stale listener must not break the visible chat.
    }
  }))
}

export async function createConversation(conversationId: string, memberIds: string[]) {
  if (!firestore) throw new Error('Firebase is not configured.')
  await setDoc(doc(firestore, 'conversations', conversationId), {
    memberIds,
    updatedAt: Date.now(),
  }, { merge: true })
}


