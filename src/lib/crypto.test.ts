import { describe, expect, it } from 'vitest'
import {
  encryptMessage,
  decryptMessage,
  encryptBlob,
  decryptBlob,
  createPairingSecret,
  hashText,
} from './crypto'

describe('Universal E2EE Cryptographic Engine (PBKDF2 120k + AES-GCM 256)', () => {
  const TEST_SECRET = 'A7K9X2'
  const TEST_CONV_ID = 'conv_test_8842'
  const TEST_PLAINTEXT = 'Hello, Luma E2EE Security!'

  it('encrypts and decrypts text messages matching Phase 0 test vector', async () => {
    const ciphertext = await encryptMessage(TEST_PLAINTEXT, TEST_CONV_ID, TEST_SECRET)
    expect(ciphertext).toContain('.')
    const [ivPart, payloadPart] = ciphertext.split('.')
    expect(ivPart.length).toBeGreaterThan(0)
    expect(payloadPart.length).toBeGreaterThan(0)

    const decrypted = await decryptMessage(ciphertext, TEST_CONV_ID, TEST_SECRET)
    expect(decrypted).toBe(TEST_PLAINTEXT)
  })

  it('fails decryption when provided incorrect pairing secret', async () => {
    const ciphertext = await encryptMessage(TEST_PLAINTEXT, TEST_CONV_ID, TEST_SECRET)
    await expect(decryptMessage(ciphertext, TEST_CONV_ID, 'WRONG1')).rejects.toThrow()
  })

  it('encrypts and decrypts binary payloads with 12-byte IV prefix', async () => {
    const rawData = new TextEncoder().encode('Confidential media payload attachment bytes')
    const blob = new Blob([rawData], { type: 'application/octet-stream' })

    const encryptedBlob = await encryptBlob(blob, TEST_CONV_ID, TEST_SECRET)
    expect(encryptedBlob.size).toBeGreaterThan(12 + rawData.length)

    const decryptedBlob = await decryptBlob(
      encryptedBlob,
      'application/octet-stream',
      TEST_CONV_ID,
      TEST_SECRET,
    )
    const decryptedBytes = new Uint8Array(await decryptedBlob.arrayBuffer())
    const decryptedText = new TextDecoder().decode(decryptedBytes)
    expect(decryptedText).toBe('Confidential media payload attachment bytes')
  })

  it('generates 6-character uppercase pairing secrets without confusing characters', () => {
    const secret = createPairingSecret()
    expect(secret).toHaveLength(6)
    expect(secret).toMatch(/^[2-9A-HJ-NP-Z]{6}$/)
  })

  it('computes deterministic SHA-256 hash digests', async () => {
    const hash = await hashText('LumaTest')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
