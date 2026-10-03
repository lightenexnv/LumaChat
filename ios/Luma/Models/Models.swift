import Foundation

// MARK: - Quality Mode
public enum QualityMode: String, Codable, CaseIterable {
    case auto = "auto"
    case p1080 = "1080p"
    case p720 = "720p"
    case p480 = "480p"
    case p360 = "360p"
    case p240 = "240p"
    case audio = "audio"
    
    public var label: String {
        switch self {
        case .auto: return "Auto"
        case .p1080: return "1080p HD"
        case .p720: return "720p HD"
        case .p480: return "480p"
        case .p360: return "360p"
        case .p240: return "240p"
        case .audio: return "Audio Only"
        }
    }
}

// MARK: - User Profile (matches web `UserProfile`)
public struct LumaUser: Identifiable, Codable, Equatable {
    public let id: String
    public var email: String
    public var displayName: String
    public var handle: String
    public var initials: String
    public var color: String
    public var photoURL: String?
    public var statusText: String
    public var createdAt: Double
    public var lastSeen: Double?
    
    public init(
        id: String = UUID().uuidString,
        email: String = "",
        displayName: String,
        handle: String = "",
        initials: String = "",
        color: String = "#25D366",
        photoURL: String? = nil,
        statusText: String = "Express yourself in emoji!",
        createdAt: Double = Date().timeIntervalSince1970 * 1000,
        lastSeen: Double? = nil
    ) {
        self.id = id
        self.email = email
        self.displayName = displayName
        self.handle = handle.isEmpty ? "@\(displayName.lowercased().replacingOccurrences(of: " ", with: "_"))" : handle
        self.initials = initials.isEmpty ? String(displayName.prefix(1)).uppercased() : initials
        self.color = color
        self.photoURL = photoURL
        self.statusText = statusText
        self.createdAt = createdAt
        self.lastSeen = lastSeen
    }
}

// MARK: - Friend Contact (matches web `Friend`)
public struct Friend: Identifiable, Codable, Equatable, Hashable {
    public let id: String
    public var name: String
    public var nickname: String?
    public var handle: String
    public var initials: String
    public var color: String
    public var photoURL: String?
    public var online: Bool
    public var lastSeen: Double?
    public var verified: Bool
    public var conversationId: String
    public var pairingSecret: String
    public var pinned: Bool
    public var favourite: Bool
    public var muted: Bool
    public var disappearingTimer: Double // ms: 0, 86400000 (24h), 604800000 (7d), 7776000000 (90d)
    public var unreadCount: Int
    public var clearedAt: Double?
    public var isGroup: Bool
    public var memberCount: Int?
    public var memberIds: [String]?
    
    // Transient client helpers
    public var lastMessageText: String?
    public var lastMessageTime: Double?
    public var lastMessageStatus: String?
    
    public init(
        id: String,
        name: String,
        nickname: String? = nil,
        handle: String = "",
        initials: String = "",
        color: String = "#25D366",
        photoURL: String? = nil,
        online: Bool = false,
        lastSeen: Double? = nil,
        verified: Bool = true,
        conversationId: String = "",
        pairingSecret: String = "",
        pinned: Bool = false,
        favourite: Bool = false,
        muted: Bool = false,
        disappearingTimer: Double = 0,
        unreadCount: Int = 0,
        clearedAt: Double? = nil,
        isGroup: Bool = false,
        memberCount: Int? = nil,
        memberIds: [String]? = nil,
        lastMessageText: String? = nil,
        lastMessageTime: Double? = nil,
        lastMessageStatus: String? = nil
    ) {
        self.id = id
        self.name = name
        self.nickname = nickname
        self.handle = handle.isEmpty ? "@\(name.lowercased().replacingOccurrences(of: " ", with: "_"))" : handle
        self.initials = initials.isEmpty ? String(name.prefix(1)).uppercased() : initials
        self.color = color
        self.photoURL = photoURL
        self.online = online
        self.lastSeen = lastSeen
        self.verified = verified
        self.conversationId = conversationId.isEmpty ? "conv_\(id)" : conversationId
        self.pairingSecret = pairingSecret
        self.pinned = pinned
        self.favourite = favourite
        self.muted = muted
        self.disappearingTimer = disappearingTimer
        self.unreadCount = unreadCount
        self.clearedAt = clearedAt
        self.isGroup = isGroup
        self.memberCount = memberCount
        self.memberIds = memberIds
        self.lastMessageText = lastMessageText
        self.lastMessageTime = lastMessageTime
        self.lastMessageStatus = lastMessageStatus
    }
    
    public var displayName: String {
        if let nick = nickname, !nick.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return nick
        }
        return name
    }
}

// MARK: - Message Status & Kind
public enum MessageStatus: String, Codable {
    case pending = "pending"
    case sent = "sent"
    case delivered = "delivered"
    case read = "read"
}

public enum MessageKind: String, Codable {
    case text = "text"
    case image = "image"
    case video = "video"
    case audio = "audio"
    case document = "document"
    case location = "location"
    case contact = "contact"
    case call = "call"
}

// MARK: - Shared Location & Contact
public struct SharedLocation: Codable, Equatable {
    public let latitude: Double
    public let longitude: Double
    public let accuracy: Double?
    public let label: String?
    
    public init(latitude: Double, longitude: Double, accuracy: Double? = nil, label: String? = "Shared location") {
        self.latitude = latitude
        self.longitude = longitude
        self.accuracy = accuracy
        self.label = label
    }
}

public struct SharedContact: Codable, Equatable {
    public let uid: String
    public let name: String
    public let handle: String
    public let initials: String
    public let color: String
    public let photoURL: String?
    
    public init(uid: String, name: String, handle: String, initials: String, color: String, photoURL: String? = nil) {
        self.uid = uid
        self.name = name
        self.handle = handle
        self.initials = initials
        self.color = color
        self.photoURL = photoURL
    }
}

// MARK: - Reply Reference
public struct ReplyReference: Codable, Equatable {
    public let messageId: String
    public let senderName: String?
    public let snippet: String
    
    public init(messageId: String, senderName: String? = nil, snippet: String) {
        self.messageId = messageId
        self.senderName = senderName
        self.snippet = snippet
    }
}

// MARK: - Attachment Metadata
public struct ChatAttachment: Codable, Equatable {
    public var fileName: String
    public var contentType: String
    public var size: Int
    public var storagePath: String
    public var url: String?
    public var durationSeconds: Double?
    public var width: Double?
    public var height: Double?
    public var mediaGroupId: String?
    public var callSessionId: String?
    public var capturedAt: Double?
    public var uploadState: String? // "pending" | "uploading" | "ready" | "failed"
    public var uploadProgress: Double?
    public var isDocument: Bool?
    
    public init(
        fileName: String,
        contentType: String,
        size: Int,
        storagePath: String,
        url: String? = nil,
        durationSeconds: Double? = nil,
        width: Double? = nil,
        height: Double? = nil,
        mediaGroupId: String? = nil,
        callSessionId: String? = nil,
        capturedAt: Double? = nil,
        uploadState: String? = "ready",
        uploadProgress: Double? = 1.0,
        isDocument: Bool? = false
    ) {
        self.fileName = fileName
        self.contentType = contentType
        self.size = size
        self.storagePath = storagePath
        self.url = url
        self.durationSeconds = durationSeconds
        self.width = width
        self.height = height
        self.mediaGroupId = mediaGroupId
        self.callSessionId = callSessionId
        self.capturedAt = capturedAt
        self.uploadState = uploadState
        self.uploadProgress = uploadProgress
        self.isDocument = isDocument
    }
}

// MARK: - Call Summary
public struct CallSummary: Codable, Equatable {
    public let kind: String // "voice" | "video"
    public let outcome: String // "completed" | "missed" | "declined" | "cancelled"
    public let durationSeconds: Int
    public let initiatedAt: Double
    public let endedAt: Double?
    public let sessionId: String?
    public let callerId: String?
    
    public init(
        kind: String,
        outcome: String,
        durationSeconds: Int,
        initiatedAt: Double,
        endedAt: Double? = nil,
        sessionId: String? = nil,
        callerId: String? = nil
    ) {
        self.kind = kind
        self.outcome = outcome
        self.durationSeconds = durationSeconds
        self.initiatedAt = initiatedAt
        self.endedAt = endedAt
        self.sessionId = sessionId
        self.callerId = callerId
    }
}

// MARK: - Chat Message (matches web `ChatMessage`)
public struct ChatMessage: Identifiable, Codable, Equatable {
    public let id: String
    public var conversationId: String
    public let senderId: String
    public var text: String
    public let createdAt: Double
    public var status: MessageStatus
    public var kind: MessageKind
    public var attachment: ChatAttachment?
    public var location: SharedLocation?
    public var contact: SharedContact?
    public var call: CallSummary?
    public var encrypted: Bool
    public var replyTo: ReplyReference?
    public var forwarded: Bool?
    public var edited: Bool?
    public var editedAt: Double?
    public var starred: Bool?
    public var deletedForEveryone: Bool?
    public var deletedAt: Double?
    public var deletedBy: String?
    public var deletedFor: [String]?
    public var mediaGroupId: String?
    public var callSessionId: String?
    public var capturedAt: Double?
    
    public init(
        id: String = UUID().uuidString,
        conversationId: String = "",
        senderId: String,
        text: String = "",
        createdAt: Double = Date().timeIntervalSince1970 * 1000,
        status: MessageStatus = .sent,
        kind: MessageKind = .text,
        attachment: ChatAttachment? = nil,
        location: SharedLocation? = nil,
        contact: SharedContact? = nil,
        call: CallSummary? = nil,
        encrypted: Bool = true,
        replyTo: ReplyReference? = nil,
        forwarded: Bool? = nil,
        edited: Bool? = nil,
        editedAt: Double? = nil,
        starred: Bool? = nil,
        deletedForEveryone: Bool? = nil,
        deletedAt: Double? = nil,
        deletedBy: String? = nil,
        deletedFor: [String]? = nil,
        mediaGroupId: String? = nil,
        callSessionId: String? = nil,
        capturedAt: Double? = nil
    ) {
        self.id = id
        self.conversationId = conversationId
        self.senderId = senderId
        self.text = text
        self.createdAt = createdAt
        self.status = status
        self.kind = kind
        self.attachment = attachment
        self.location = location
        self.contact = contact
        self.call = call
        self.encrypted = encrypted
        self.replyTo = replyTo
        self.forwarded = forwarded
        self.edited = edited
        self.editedAt = editedAt
        self.starred = starred
        self.deletedForEveryone = deletedForEveryone
        self.deletedAt = deletedAt
        self.deletedBy = deletedBy
        self.deletedFor = deletedFor
        self.mediaGroupId = mediaGroupId
        self.callSessionId = callSessionId
        self.capturedAt = capturedAt
    }
}

// MARK: - Call Log Record (matches web `CallLogEntry`)
public struct CallRecord: Identifiable, Codable, Equatable {
    public let id: String
    public let friendId: String
    public let friendName: String
    public let friendInitials: String
    public let friendColor: String
    public let friendPhotoURL: String?
    public let direction: String // "incoming" | "outgoing"
    public let kind: String // "voice" | "video"
    public let outcome: String // "completed" | "missed" | "declined" | "cancelled"
    public let durationSeconds: Int
    public let initiatedAt: Double
    public let endedAt: Double?
    public let sessionId: String?
    public let callerId: String?
    
    public init(
        id: String = UUID().uuidString,
        friendId: String,
        friendName: String,
        friendInitials: String,
        friendColor: String,
        friendPhotoURL: String? = nil,
        direction: String,
        kind: String,
        outcome: String,
        durationSeconds: Int,
        initiatedAt: Double = Date().timeIntervalSince1970 * 1000,
        endedAt: Double? = nil,
        sessionId: String? = nil,
        callerId: String? = nil
    ) {
        self.id = id
        self.friendId = friendId
        self.friendName = friendName
        self.friendInitials = friendInitials
        self.friendColor = friendColor
        self.friendPhotoURL = friendPhotoURL
        self.direction = direction
        self.kind = kind
        self.outcome = outcome
        self.durationSeconds = durationSeconds
        self.initiatedAt = initiatedAt
        self.endedAt = endedAt
        self.sessionId = sessionId
        self.callerId = callerId
    }
}

// MARK: - Incoming Call Model
public struct IncomingCallModel: Identifiable, Codable, Equatable {
    public let id: String // callId
    public let callerId: String
    public let calleeId: String
    public let kind: String // "video" | "voice"
    public let callerName: String
    public let callerInitials: String
    public let callerColor: String
    public let callerPhotoURL: String?
    public let createdAt: Double
    
    public init(
        id: String,
        callerId: String,
        calleeId: String,
        kind: String,
        callerName: String,
        callerInitials: String,
        callerColor: String,
        callerPhotoURL: String? = nil,
        createdAt: Double = Date().timeIntervalSince1970 * 1000
    ) {
        self.id = id
        self.callerId = callerId
        self.calleeId = calleeId
        self.kind = kind
        self.callerName = callerName
        self.callerInitials = callerInitials
        self.callerColor = callerColor
        self.callerPhotoURL = callerPhotoURL
        self.createdAt = createdAt
    }
}
