import { deleteObject, getBytes, getDownloadURL, ref, uploadBytes, uploadBytesResumable } from 'firebase/storage'
import { auth, storage } from './firebase'
import { decryptBlob, encryptBlob } from './crypto'
import { downloadCloudinaryAttachment } from './cloudinary'

export const MAX_ATTACHMENT_BYTES = (100 * 1024 * 1024) - 64

function requireStorage() {
  if (!storage || !auth?.currentUser) throw new Error('Firebase Storage is not configured or authentication is not ready.')
  return storage
}

function validateAttachment(file: Blob) {
  if (file.size === 0) throw new Error('The selected file is empty.')
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('Files must be smaller than 100 MB.')
}

export type UploadProgressHandler = (progress: number) => void

export async function uploadEncryptedAttachment(
  conversationId: string,
  messageId: string,
  pairingSecret: string,
  file: File,
  onProgress?: UploadProgressHandler,
) {
  validateAttachment(file)
  const encrypted = await encryptBlob(file, conversationId, pairingSecret)

  // Hybrid inline fallback:
  // For files <= 700KB, try Firebase Storage first if available; if Storage is offline,
  // misconfigured, or fails, fallback to inline encrypted payload so documents always send.
  if (file.size <= 700 * 1024) {
    try {
      if (storage && auth?.currentUser) {
        const dbStorage = requireStorage()
        const storagePath = `conversations/${conversationId}/${messageId}/payload.bin`
        const task = uploadBytesResumable(ref(dbStorage, storagePath), encrypted, {
          contentType: 'application/octet-stream',
          cacheControl: 'private, max-age=0, no-store',
          customMetadata: {
            originalContentType: file.type || 'application/octet-stream',
            originalFileName: file.name.slice(0, 180),
          },
        })
        await new Promise<void>((resolve, reject) => {
          task.on('state_changed', (snapshot) => {
            onProgress?.(snapshot.totalBytes > 0 ? snapshot.bytesTransferred / snapshot.totalBytes : 0)
          }, reject, resolve)
        })
        onProgress?.(1)
        return storagePath
      }
    } catch {
      // Storage failed or not available; fallback to inline encrypted base64
    }

    const arrayBuffer = await encrypted.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    let binary = ''
    const len = bytes.byteLength
    for (let i = 0; i < len; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, len)))
    }
    const b64 = btoa(binary)
    onProgress?.(1)
    return `inline:${b64}`
  }

  const dbStorage = requireStorage()
  const storagePath = `conversations/${conversationId}/${messageId}/payload.bin`
  const task = uploadBytesResumable(ref(dbStorage, storagePath), encrypted, {
    contentType: 'application/octet-stream',
    cacheControl: 'private, max-age=0, no-store',
    customMetadata: {
      originalContentType: file.type || 'application/octet-stream',
      originalFileName: file.name.slice(0, 180),
    },
  })
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', (snapshot) => {
      onProgress?.(snapshot.totalBytes > 0 ? snapshot.bytesTransferred / snapshot.totalBytes : 0)
    }, reject, resolve)
  })
  onProgress?.(1)
  return storagePath
}

export async function downloadDecryptedAttachment(storagePath: string, contentType: string, conversationId: string, pairingSecret: string) {
  let encrypted: Blob
  if (storagePath.startsWith('inline:')) {
    const b64 = storagePath.slice(7)
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    encrypted = new Blob([bytes], { type: 'application/octet-stream' })
  } else if (storagePath.startsWith('cloudinary:')) {
    encrypted = await downloadCloudinaryAttachment(storagePath)
  } else {
    const dbStorage = requireStorage()
    const encryptedBytes = await getBytes(ref(dbStorage, storagePath), MAX_ATTACHMENT_BYTES + 64)
    encrypted = new Blob([encryptedBytes], { type: 'application/octet-stream' })
  }
  return decryptBlob(encrypted, contentType, conversationId, pairingSecret)
}

export async function removeAttachment(storagePath: string) {
  if (!storage || storagePath.startsWith('inline:')) return
  try {
    await deleteObject(ref(storage, storagePath))
  } catch {
    // Non-fatal cleanup
  }
}

export async function uploadProfilePhoto(uid: string, file: File) {
  const dbStorage = requireStorage()
  if (!file.type.startsWith('image/')) throw new Error('Choose an image for your profile picture.')
  if (file.size > 10 * 1024 * 1024) throw new Error('Profile pictures must be smaller than 10 MB.')
  const uploaded = await uploadBytes(ref(dbStorage, `profiles/${uid}/avatar`), file, { contentType: file.type })
  return getDownloadURL(uploaded.ref)
}
