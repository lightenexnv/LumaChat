package com.luma.chat.crypto

import android.util.Base64
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

object CryptoEngine {
    private const val ITERATION_COUNT = 120_000
    private const val KEY_LENGTH_BITS = 256
    private const val GCM_TAG_LENGTH_BITS = 128
    private const val IV_LENGTH_BYTES = 12

    private val secureRandom = SecureRandom()
    private val keyCache = ConcurrentHashMap<String, SecretKey>()

    fun deriveKey(conversationId: String, pairingSecret: String): SecretKey {
        val cacheKey = "$conversationId:$pairingSecret"
        keyCache[cacheKey]?.let { return it }

        val salt = "luma:$conversationId".toByteArray(Charsets.UTF_8)
        val spec = PBEKeySpec(
            pairingSecret.toCharArray(),
            salt,
            ITERATION_COUNT,
            KEY_LENGTH_BITS
        )
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val derivedBytes = factory.generateSecret(spec).encoded
        val secretKey = SecretKeySpec(derivedBytes, "AES")

        keyCache[cacheKey] = secretKey
        return secretKey
    }

    fun encryptMessage(text: String, conversationId: String, pairingSecret: String): String {
        val key = deriveKey(conversationId, pairingSecret)
        val iv = ByteArray(IV_LENGTH_BYTES).also { secureRandom.nextBytes(it) }

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val gcmSpec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.ENCRYPT_MODE, key, gcmSpec)

        val plaintextBytes = text.toByteArray(Charsets.UTF_8)
        val ciphertextBytes = cipher.doFinal(plaintextBytes)

        val ivBase64 = Base64.encodeToString(iv, Base64.NO_WRAP)
        val cipherBase64 = Base64.encodeToString(ciphertextBytes, Base64.NO_WRAP)

        return "$ivBase64.$cipherBase64"
    }

    fun decryptMessage(payload: String, conversationId: String, pairingSecret: String): String {
        val parts = payload.split(".")
        require(parts.size == 2) { "Malformed encrypted message payload" }

        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val ciphertextBytes = Base64.decode(parts[1], Base64.NO_WRAP)

        val key = deriveKey(conversationId, pairingSecret)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val gcmSpec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.DECRYPT_MODE, key, gcmSpec)

        val decryptedBytes = cipher.doFinal(ciphertextBytes)
        return String(decryptedBytes, Charsets.UTF_8)
    }

    fun encryptBinary(data: ByteArray, conversationId: String, pairingSecret: String): ByteArray {
        val key = deriveKey(conversationId, pairingSecret)
        val iv = ByteArray(IV_LENGTH_BYTES).also { secureRandom.nextBytes(it) }

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val gcmSpec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.ENCRYPT_MODE, key, gcmSpec)

        val ciphertext = cipher.doFinal(data)
        val output = ByteArray(IV_LENGTH_BYTES + ciphertext.size)
        System.arraycopy(iv, 0, output, 0, IV_LENGTH_BYTES)
        System.arraycopy(ciphertext, 0, output, IV_LENGTH_BYTES, ciphertext.size)
        return output
    }

    fun decryptBinary(encryptedData: ByteArray, conversationId: String, pairingSecret: String): ByteArray {
        require(encryptedData.size >= IV_LENGTH_BYTES) { "Data too short for IV" }

        val iv = ByteArray(IV_LENGTH_BYTES)
        System.arraycopy(encryptedData, 0, iv, 0, IV_LENGTH_BYTES)

        val ciphertext = ByteArray(encryptedData.size - IV_LENGTH_BYTES)
        System.arraycopy(encryptedData, 0, ciphertext, 0, ciphertext.size)

        val key = deriveKey(conversationId, pairingSecret)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val gcmSpec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.DECRYPT_MODE, key, gcmSpec)

        return cipher.doFinal(ciphertext)
    }

    fun generatePairingSecret(): String {
        val chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
        val bytes = ByteArray(6).also { secureRandom.nextBytes(it) }
        return bytes.map { chars[(it.toInt() and 0xFF) % chars.length] }.joinToString("")
    }
}
