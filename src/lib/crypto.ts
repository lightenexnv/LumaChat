const encoder = new TextEncoder()
const decoder = new TextDecoder()
const conversationKeyCache = new Map<string, Promise<CryptoKey>>()

function toBase64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

async function conversationKey(conversationId: string, pairingSecret: string) {
  const cacheKey = `${conversationId}:${pairingSecret}`
  const cached = conversationKeyCache.get(cacheKey)
  if (cached) return cached
  const pending = (async () => {
    const material = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(pairingSecret),
      'PBKDF2',
      false,
      ['deriveKey'],
    )
    return globalThis.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: encoder.encode(`luma:${conversationId}`), iterations: 120_000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  })()
  conversationKeyCache.set(cacheKey, pending)
  return pending
}

export async function encryptMessage(text: string, conversationId: string, pairingSecret: string) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await conversationKey(conversationId, pairingSecret),
    encoder.encode(text),
  )
  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`
}

export async function decryptMessage(payload: string, conversationId: string, pairingSecret: string) {
  const [ivText, encryptedText] = payload.split('.')
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivText) },
    await conversationKey(conversationId, pairingSecret),
    fromBase64(encryptedText),
  )
  return decoder.decode(decrypted)
}

export async function encryptBlob(blob: Blob, conversationId: string, pairingSecret: string) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await conversationKey(conversationId, pairingSecret),
    await blob.arrayBuffer(),
  )
  return new Blob([iv, new Uint8Array(encrypted)], { type: 'application/octet-stream' })
}

export async function decryptBlob(blob: Blob, contentType: string, conversationId: string, pairingSecret: string) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const iv = bytes.slice(0, 12)
  const encrypted = bytes.slice(12)
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    await conversationKey(conversationId, pairingSecret),
    encrypted,
  )
  return new Blob([decrypted], { type: contentType })
}

export function createPairingSecret() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (value) => chars[value % chars.length]).join('')
}

export async function hashText(value: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
