package com.luma.chat.data

import com.google.firebase.Timestamp

// 1. User Profile (/users/{uid})
data class UserProfile(
    val uid: String = "",
    val displayName: String = "",
    val handle: String = "",
    val initials: String = "",
    val color: String = "#30D158",
    val photoURL: String? = null,
    val statusText: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val lastSeen: Long? = null
)

// 2. Paired Contact (/users/{uid}/contacts/{contactUid})
data class Contact(
    val uid: String = "",
    val inviteId: String? = null,
    val name: String = "",
    val nickname: String? = null,
    val handle: String = "",
    val initials: String = "",
    val color: String = "#30D158",
    val photoURL: String? = null,
    val conversationId: String = "",
    val pairingSecret: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val pinned: Boolean? = false,
    val clearedAt: Long? = null
)

// 3. Pairing Invite (/invites/{inviteId})
data class UserSnapshot(
    val name: String = "",
    val handle: String = "",
    val initials: String = "",
    val color: String = "#30D158",
    val photoURL: String? = null
)

data class Invite(
    val ownerId: String = "",
    val ownerProfile: UserSnapshot = UserSnapshot(),
    val createdAt: Long = System.currentTimeMillis(),
    val expiresAt: Long = System.currentTimeMillis() + 3600_000,
    val acceptedBy: String? = null,
    val acceptedProfile: UserSnapshot? = null
)

// 4. Conversation (/conversations/{conversationId})
data class Conversation(
    val memberIds: List<String> = emptyList(),
    val updatedAt: Long = System.currentTimeMillis(),
    val pinnedMessageId: String? = null,
    val pinnedBy: String? = null,
    val pinnedAt: Timestamp? = null
)

// 5. Encrypted Message Document (/conversations/{conversationId}/messages/{messageId})
data class MessageDocument(
    val id: String = "",
    val ciphertext: String = "", // Base64(IV) + "." + Base64(Ciphertext)
    val senderId: String = "",
    val createdAt: Timestamp = Timestamp.now(),
    val status: String = "sent", // 'sent' | 'delivered' | 'read'
    val type: String = "text",
    val edited: Boolean? = false,
    val editedAt: Timestamp? = null,
    val deletedForEveryone: Boolean? = false,
    val deletedAt: Timestamp? = null,
    val deletedBy: String? = null,
    val deletedFor: List<String>? = emptyList()
)

// 6. Plaintext Payload inside Decrypted Ciphertext
data class DecryptedFileAttachment(
    val storagePath: String = "",
    val fileName: String = "",
    val fileSize: Long = 0,
    val contentType: String = "",
    val width: Int? = null,
    val height: Int? = null,
    val durationSeconds: Double? = null
)

data class DecryptedCallSummary(
    val kind: String = "voice", // 'voice' | 'video'
    val outcome: String = "completed",
    val durationSeconds: Long = 0,
    val initiatedAt: Long = System.currentTimeMillis(),
    val callerId: String = ""
)

data class DecryptedReplyTo(
    val messageId: String = "",
    val senderId: String = "",
    val previewText: String = ""
)

data class DecryptedMessagePayload(
    val kind: String = "text", // 'text' | 'media' | 'document' | 'call'
    val text: String? = null,
    val file: DecryptedFileAttachment? = null,
    val call: DecryptedCallSummary? = null,
    val replyTo: DecryptedReplyTo? = null
)

// 7. RTDB Signaling Node (/calls/{callId})
data class RTDBCallNode(
    val callerId: String = "",
    val calleeId: String = "",
    val kind: String = "voice",
    val callerProfile: UserSnapshot = UserSnapshot(),
    val state: String = "ringing", // 'ringing' | 'accepted' | 'declined' | 'ended'
    val createdAt: Long = System.currentTimeMillis(),
    val endedAt: Long? = null,
    val offer: Map<String, String>? = null,
    val answer: Map<String, String>? = null,
    val callerCandidates: Map<String, Any>? = null,
    val calleeCandidates: Map<String, Any>? = null
)

// 8. RTDB Incoming Call (/incomingCalls/{calleeId}/{callId})
data class RTDBIncomingCall(
    val callId: String = "",
    val callerId: String = "",
    val calleeId: String = "",
    val kind: String = "voice",
    val callerProfile: UserSnapshot = UserSnapshot(),
    val createdAt: Long = System.currentTimeMillis(),
    val state: String = "ringing"
)

// 9. RTDB Presence (/presence/{uid})
data class RTDBPresence(
    val online: Boolean = false,
    val lastSeen: Long = System.currentTimeMillis()
)
