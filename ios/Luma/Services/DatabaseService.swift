import Foundation
import Combine
import CryptoKit
import CommonCrypto

public final class DatabaseService: ObservableObject {
    public static let shared = DatabaseService()
    
    @Published public var currentUser: LumaUser?
    @Published public var friends: [Friend] = []
    @Published public var messages: [String: [ChatMessage]] = [:] // conversationId -> [ChatMessage]
    @Published public var callHistory: [CallRecord] = []
    @Published public var starredMessageIds: Set<String> = []
    @Published public var pinnedMessageIds: [String: String] = [:] // conversationId -> pinnedMessageId
    @Published public var unreadCounts: [String: Int] = [:] // friendId -> count
    @Published public var isSyncing: Bool = false
    
    private let auth = AuthService.shared
    private var syncTimer: Timer?
    private var keyCache: [String: SymmetricKey] = [:]
    
    private let callHistoryDefaultsKey = "luma.callLogs"
    private let starredDefaultsKey = "luma.starred"
    private let cachedFriendsKey = "luma.cached_friends"
    
    private init() {
        loadLocalCache()
        startLiveSync()
    }
    
    // MARK: - Local Cache Loading
    private func loadLocalCache() {
        if let starredData = UserDefaults.standard.array(forKey: starredDefaultsKey) as? [String] {
            self.starredMessageIds = Set(starredData)
        }
        
        if let callData = UserDefaults.standard.data(forKey: callHistoryDefaultsKey),
           let cachedCalls = try? JSONDecoder().decode([CallRecord].self, from: callData) {
            self.callHistory = cachedCalls
        }
        
        if let friendsData = UserDefaults.standard.data(forKey: cachedFriendsKey),
           let cachedFriends = try? JSONDecoder().decode([Friend].self, from: friendsData) {
            self.friends = cachedFriends
        }
    }
    
    // MARK: - Live Sync (Timer-based polling mimicking real-time subscriptions)
    public func startLiveSync() {
        syncTimer?.invalidate()
        syncTimer = Timer.scheduledTimer(withTimeInterval: 3.5, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            Task {
                await self.syncAll()
            }
        }
        Task {
            await syncAll()
        }
    }
    
    public func syncAll() async {
        guard let user = auth.currentUser, let token = auth.idToken else { return }
        self.currentUser = user
        
        // 1. Sync Contacts
        await fetchContacts(userId: user.id, idToken: token)
        
        // 2. Sync Presence for all contacts
        await fetchPresenceForContacts()
        
        // 3. Sync Messages for all active conversations
        for friend in friends {
            if !friend.conversationId.isEmpty && !friend.pairingSecret.isEmpty {
                await fetchMessages(conversationId: friend.conversationId, pairingSecret: friend.pairingSecret, idToken: token)
            }
        }
    }
    
    // MARK: - End-to-End Cryptography Engine (PBKDF2 + AES-GCM 256)
    public func deriveKey(conversationId: String, pairingSecret: String) -> SymmetricKey? {
        let cacheKey = "\(conversationId):\(pairingSecret)"
        if let cached = keyCache[cacheKey] {
            return cached
        }
        
        let passwordData = pairingSecret.data(using: .utf8) ?? Data()
        // MUST match web salt: encoder.encode(`luma:${conversationId}`)
        let saltString = "luma:\(conversationId)"
        let saltData = saltString.data(using: .utf8) ?? Data()
        var derivedKeyData = Data(count: 32)
        
        let result = derivedKeyData.withUnsafeMutableBytes { derivedKeyBytes in
            passwordData.withUnsafeBytes { passwordBytes in
                saltData.withUnsafeBytes { saltBytes in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        passwordBytes.baseAddress?.assumingMemoryBound(to: Int8.self),
                        passwordData.count,
                        saltBytes.baseAddress?.assumingMemoryBound(to: UInt8.self),
                        saltData.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                        120_000,
                        derivedKeyBytes.baseAddress?.assumingMemoryBound(to: UInt8.self),
                        32
                    )
                }
            }
        }
        
        guard result == kCCSuccess else { return nil }
        let key = SymmetricKey(data: derivedKeyData)
        keyCache[cacheKey] = key
        return key
    }
    
    public func encryptPayload(conversationId: String, pairingSecret: String, payload: [String: Any]) throws -> String {
        guard let key = deriveKey(conversationId: conversationId, pairingSecret: pairingSecret) else {
            throw NSError(domain: "LumaCrypto", code: -1, userInfo: [NSLocalizedDescriptionKey: "Key derivation failed"])
        }
        
        let jsonData = try JSONSerialization.data(withJSONObject: payload)
        let nonce = AES.GCM.Nonce()
        let box = try AES.GCM.seal(jsonData, using: key, nonce: nonce)
        
        let combinedCiphertext = box.ciphertext + box.tag
        let ivBase64 = Data(nonce).base64EncodedString()
        let ctBase64 = combinedCiphertext.base64EncodedString()
        return "\(ivBase64).\(ctBase64)"
    }
    
    public func decryptPayload(conversationId: String, pairingSecret: String, ciphertext: String) throws -> [String: Any] {
        guard let key = deriveKey(conversationId: conversationId, pairingSecret: pairingSecret) else {
            throw NSError(domain: "LumaCrypto", code: -1, userInfo: [NSLocalizedDescriptionKey: "Key derivation failed"])
        }
        
        let parts = ciphertext.components(separatedBy: ".")
        guard parts.count == 2,
              let ivData = Data(base64Encoded: parts[0]),
              let combinedData = Data(base64Encoded: parts[1]),
              combinedData.count >= 16 else {
            throw NSError(domain: "LumaCrypto", code: -2, userInfo: [NSLocalizedDescriptionKey: "Malformed ciphertext"])
        }
        
        let nonce = try AES.GCM.Nonce(data: ivData)
        let tag = combinedData.suffix(16)
        let ciphertextOnly = combinedData.prefix(combinedData.count - 16)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertextOnly, tag: tag)
        let decryptedData = try AES.GCM.open(box, using: key)
        
        let json = (try? JSONSerialization.jsonObject(with: decryptedData) as? [String: Any]) ?? [:]
        if !json.isEmpty {
            return json
        }
        
        // Fallback for older Luma plain text messages
        if let plainText = String(data: decryptedData, encoding: .utf8) {
            return ["kind": "text", "text": plainText]
        }
        
        return [:]
    }
    
    // MARK: - Binary Data Encryption / Decryption (for Audio & Images matching Web encryptBlob / decryptBlob)
    public func encryptDataToInlineStorage(data: Data, conversationId: String, pairingSecret: String) throws -> String {
        guard let key = deriveKey(conversationId: conversationId, pairingSecret: pairingSecret) else {
            throw NSError(domain: "LumaCrypto", code: -1, userInfo: [NSLocalizedDescriptionKey: "Key derivation failed"])
        }
        let nonce = AES.GCM.Nonce()
        let box = try AES.GCM.seal(data, using: key, nonce: nonce)
        var blobBytes = Data(nonce)
        blobBytes.append(box.ciphertext)
        blobBytes.append(box.tag)
        return "inline:\(blobBytes.base64EncodedString())"
    }

    public func decryptInlineStorageData(storagePath: String, conversationId: String, pairingSecret: String) -> Data? {
        guard storagePath.hasPrefix("inline:") else { return nil }
        let b64 = String(storagePath.dropFirst(7))
        guard let allBytes = Data(base64Encoded: b64), allBytes.count >= 28 else { return nil }
        guard let key = deriveKey(conversationId: conversationId, pairingSecret: pairingSecret) else { return nil }
        
        let iv = allBytes.prefix(12)
        let cipherAndTag = allBytes.dropFirst(12)
        let tag = cipherAndTag.suffix(16)
        let ciphertextOnly = cipherAndTag.prefix(cipherAndTag.count - 16)
        
        do {
            let nonce = try AES.GCM.Nonce(data: iv)
            let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertextOnly, tag: tag)
            return try AES.GCM.open(box, using: key)
        } catch {
            return nil
        }
    }

    public func fetchAndDecryptStorageAttachment(storagePath: String, conversationId: String, pairingSecret: String) async -> Data? {
        if storagePath.hasPrefix("inline:") {
            return decryptInlineStorageData(storagePath: storagePath, conversationId: conversationId, pairingSecret: pairingSecret)
        }
        guard let token = await auth.getOrRefreshIdToken() else { return nil }
        guard let key = deriveKey(conversationId: conversationId, pairingSecret: pairingSecret) else { return nil }
        
        let encodedPath = storagePath.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? storagePath
        let bucket = auth.storageBucket.isEmpty ? "\(auth.projectId).appspot.com" : auth.storageBucket
        let urlString = "https://firebasestorage.googleapis.com/v0/b/\(bucket)/o/\(encodedPath)?alt=media"
        guard let url = URL(string: urlString) else { return nil }
        
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        do {
            let (allBytes, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200, allBytes.count >= 28 else { return nil }
            
            let iv = allBytes.prefix(12)
            let cipherAndTag = allBytes.dropFirst(12)
            let tag = cipherAndTag.suffix(16)
            let ciphertextOnly = cipherAndTag.prefix(cipherAndTag.count - 16)
            
            let nonce = try AES.GCM.Nonce(data: iv)
            let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertextOnly, tag: tag)
            return try AES.GCM.open(box, using: key)
        } catch {
            return nil
        }
    }
    
    // MARK: - Firestore User Profile Helper (/users/{uid})
    public func fetchUserProfile(uid: String, idToken: String) async -> [String: Any]? {
        let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/users/\(uid)"
        guard let url = URL(string: endpoint) else { return nil }
        
        var request = URLRequest(url: url)
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        
        guard let (data, resp) = try? await URLSession.shared.data(for: request),
              let http = resp as? HTTPURLResponse, http.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let fields = json["fields"] as? [String: Any] else {
            return nil
        }
        
        var result: [String: Any] = [:]
        if let val = (fields["displayName"] as? [String: Any])?["stringValue"] as? String {
            result["displayName"] = val
        }
        if let val = (fields["photoURL"] as? [String: Any])?["stringValue"] as? String {
            result["photoURL"] = val
        }
        if let val = (fields["handle"] as? [String: Any])?["stringValue"] as? String {
            result["handle"] = val
        }
        if let val = (fields["initials"] as? [String: Any])?["stringValue"] as? String {
            result["initials"] = val
        }
        if let val = (fields["color"] as? [String: Any])?["stringValue"] as? String {
            result["color"] = val
        }
        return result
    }
    
    // MARK: - Firestore Contacts Fetch (/users/{uid}/contacts)
    public func fetchContacts(userId: String, idToken: String) async {
        let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/users/\(userId)/contacts"
        guard let url = URL(string: endpoint) else { return }
        
        var request = URLRequest(url: url)
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        
        guard let (data, resp) = try? await URLSession.shared.data(for: request),
              let http = resp as? HTTPURLResponse, http.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let documents = json["documents"] as? [[String: Any]] else {
            return
        }
        
        var fetchedFriends: [Friend] = []
        
        for doc in documents {
            guard let fields = doc["fields"] as? [String: Any],
                  let uid = (fields["uid"] as? [String: Any])?["stringValue"] as? String,
                  let initialName = (fields["name"] as? [String: Any])?["stringValue"] as? String,
                  let conversationId = (fields["conversationId"] as? [String: Any])?["stringValue"] as? String,
                  let pairingSecret = (fields["pairingSecret"] as? [String: Any])?["stringValue"] as? String else {
                continue
            }
            
            // Fetch live profile from /users/{uid} to resolve "New Connection" and missing photoURL
            let liveProfile = await fetchUserProfile(uid: uid, idToken: idToken)
            
            var name = initialName
            if let liveName = liveProfile?["displayName"] as? String, !liveName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                if name.lowercased() == "new connection" || name.isEmpty || liveName.lowercased() != "new connection" {
                    name = liveName
                }
            }
            
            let nickname = (fields["nickname"] as? [String: Any])?["stringValue"] as? String
            let handle = (liveProfile?["handle"] as? String) ?? (fields["handle"] as? [String: Any])?["stringValue"] as? String ?? "@\(name.lowercased().replacingOccurrences(of: " ", with: "_"))"
            let initials = (liveProfile?["initials"] as? String) ?? (fields["initials"] as? [String: Any])?["stringValue"] as? String ?? String(name.prefix(1)).uppercased()
            let color = (liveProfile?["color"] as? String) ?? (fields["color"] as? [String: Any])?["stringValue"] as? String ?? "#25D366"
            
            var photoURL = (liveProfile?["photoURL"] as? String) ?? (fields["photoURL"] as? [String: Any])?["stringValue"] as? String
            if (photoURL == nil || photoURL?.isEmpty == true) && name.lowercased().contains("gunnu") {
                photoURL = "https://raw.githubusercontent.com/lightenexnv/Luma/main/public/avatars/gunnu_verma.png"
            }
            
            let pinned = (fields["pinned"] as? [String: Any])?["booleanValue"] as? Bool ?? false
            let clearedAtStr = (fields["clearedAt"] as? [String: Any])?["integerValue"] as? String
            let clearedAt = clearedAtStr != nil ? Double(clearedAtStr!) : nil
            
            let friend = Friend(
                id: uid,
                name: name,
                nickname: nickname,
                handle: handle,
                initials: initials,
                color: color,
                photoURL: photoURL,
                online: false,
                lastSeen: nil,
                verified: true,
                conversationId: conversationId,
                pairingSecret: pairingSecret,
                pinned: pinned,
                favourite: false,
                muted: false,
                disappearingTimer: 0,
                unreadCount: unreadCounts[uid] ?? 0,
                clearedAt: clearedAt
            )
            fetchedFriends.append(friend)
        }
        
        let currentFriends = await MainActor.run { self.friends }
        var mergedFriends = fetchedFriends
        for i in 0..<mergedFriends.count {
            if let existing = currentFriends.first(where: { $0.id == mergedFriends[i].id }) {
                mergedFriends[i].online = existing.online
                mergedFriends[i].lastSeen = existing.lastSeen
                mergedFriends[i].lastMessageText = existing.lastMessageText
                mergedFriends[i].lastMessageTime = existing.lastMessageTime
                mergedFriends[i].lastMessageStatus = existing.lastMessageStatus
            }
        }
        let finalFriends = mergedFriends
        await MainActor.run {
            self.friends = finalFriends
            if let enc = try? JSONEncoder().encode(finalFriends) {
                UserDefaults.standard.set(enc, forKey: self.cachedFriendsKey)
            }
        }
    }
    
    // MARK: - Realtime Database Presence Sync (/presence/{uid})
    public func fetchPresenceForContacts() async {
        guard let token = await auth.getOrRefreshIdToken() else { return }
        for friend in friends {
            let urlString = "\(auth.databaseURL)/presence/\(friend.id).json?auth=\(token)"
            guard let url = URL(string: urlString) else { continue }
            
            if let (data, _) = try? await URLSession.shared.data(from: url),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let online = json["online"] as? Bool ?? false
                let lastSeen = json["lastSeen"] as? Double
                
                await MainActor.run {
                    if let idx = self.friends.firstIndex(where: { $0.id == friend.id }) {
                        self.friends[idx].online = online
                        self.friends[idx].lastSeen = lastSeen
                    }
                }
            }
        }
    }
    
    public func setMyPresence(online: Bool) async {
        guard let user = auth.currentUser else { return }
        guard let token = await auth.getOrRefreshIdToken() else { return }
        let urlString = "\(auth.databaseURL)/presence/\(user.id).json?auth=\(token)"
        guard let url = URL(string: urlString) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let now = Date().timeIntervalSince1970 * 1000
        let payload: [String: Any] = [
            "online": online,
            "lastSeen": Int64(now)
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        _ = try? await URLSession.shared.data(for: request)
    }
    
    // MARK: - Firestore Messages Sync (/conversations/{id}/messages)
    public func fetchMessages(conversationId: String, pairingSecret: String, idToken: String) async {
        let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/conversations/\(conversationId)/messages?pageSize=300"
        guard let url = URL(string: endpoint) else { return }
        
        var request = URLRequest(url: url)
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        
        guard let (data, resp) = try? await URLSession.shared.data(for: request),
              let http = resp as? HTTPURLResponse, http.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let documents = json["documents"] as? [[String: Any]] else {
            return
        }
        
        var parsedMessages: [ChatMessage] = []
        
        for doc in documents {
            guard let nameStr = doc["name"] as? String,
                  let messageId = nameStr.components(separatedBy: "/").last,
                  let fields = doc["fields"] as? [String: Any],
                  let ciphertext = (fields["ciphertext"] as? [String: Any])?["stringValue"] as? String,
                  let senderId = (fields["senderId"] as? [String: Any])?["stringValue"] as? String else {
                continue
            }
            
            let statusStr = (fields["status"] as? [String: Any])?["stringValue"] as? String ?? "sent"
            let status = MessageStatus(rawValue: statusStr) ?? .sent
            let typeStr = (fields["type"] as? [String: Any])?["stringValue"] as? String ?? "text"
            var kind = MessageKind(rawValue: typeStr) ?? .text
            let edited = (fields["edited"] as? [String: Any])?["booleanValue"] as? Bool
            let deletedForEveryone = (fields["deletedForEveryone"] as? [String: Any])?["booleanValue"] as? Bool
            
            // Parse timestamp from createdAt timestampValue or createTime
            var timestampMs = Date().timeIntervalSince1970 * 1000
            let isoFormatter = ISO8601DateFormatter()
            isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let fallbackIso = ISO8601DateFormatter()
            
            if let createdAtField = (fields["createdAt"] as? [String: Any])?["timestampValue"] as? String {
                if let d = isoFormatter.date(from: createdAtField) ?? fallbackIso.date(from: createdAtField) {
                    timestampMs = d.timeIntervalSince1970 * 1000
                }
            } else if let createTimeStr = doc["createTime"] as? String {
                if let d = isoFormatter.date(from: createTimeStr) ?? fallbackIso.date(from: createTimeStr) {
                    timestampMs = d.timeIntervalSince1970 * 1000
                }
            }
            
            // Decrypt payload
            var text = ""
            var replyTo: ReplyReference? = nil
            var callSummary: CallSummary? = nil
            var attachment: ChatAttachment? = nil
            
            if let decrypted = try? decryptPayload(conversationId: conversationId, pairingSecret: pairingSecret, ciphertext: ciphertext) {
                text = decrypted["text"] as? String ?? ""
                if let k = decrypted["kind"] as? String, let parsedKind = MessageKind(rawValue: k) {
                    kind = parsedKind
                }
                if let rep = decrypted["replyTo"] as? [String: Any],
                   let msgId = rep["messageId"] as? String,
                   let snip = rep["snippet"] as? String {
                    replyTo = ReplyReference(messageId: msgId, senderName: rep["senderName"] as? String, snippet: snip)
                }
                if let c = decrypted["call"] as? [String: Any],
                   let k = c["kind"] as? String,
                   let o = c["outcome"] as? String,
                   let dur = c["durationSeconds"] as? Int,
                   let initAt = c["initiatedAt"] as? Double {
                    callSummary = CallSummary(kind: k, outcome: o, durationSeconds: dur, initiatedAt: initAt)
                }
                if let att = decrypted["attachment"] as? [String: Any],
                   let fName = att["fileName"] as? String,
                   let cType = att["contentType"] as? String,
                   let sPath = att["storagePath"] as? String {
                    attachment = ChatAttachment(
                        fileName: fName,
                        contentType: cType,
                        size: att["size"] as? Int ?? 0,
                        storagePath: sPath,
                        url: att["url"] as? String,
                        durationSeconds: att["durationSeconds"] as? Double,
                        width: att["width"] as? Double,
                        height: att["height"] as? Double
                    )
                }
            }
            
            var msg = ChatMessage(
                id: messageId,
                conversationId: conversationId,
                senderId: senderId,
                text: text,
                createdAt: timestampMs,
                status: status,
                kind: kind,
                attachment: attachment,
                call: callSummary,
                replyTo: replyTo,
                edited: edited,
                deletedForEveryone: deletedForEveryone
            )
            msg.starred = self.starredMessageIds.contains(messageId)
            parsedMessages.append(msg)
        }
        
        parsedMessages.sort { $0.createdAt < $1.createdAt }
        let finalMessages = parsedMessages
        let lastMsg = finalMessages.last
        
        await MainActor.run {
            self.messages[conversationId] = finalMessages
            
            // Update last message snippet on contact
            if let last = lastMsg,
               let friendIdx = self.friends.firstIndex(where: { $0.conversationId == conversationId }) {
                var preview = last.text
                if preview.isEmpty {
                    if last.kind == .call {
                        preview = last.call?.kind == "video" ? "📹 Video call" : "📞 Voice call"
                    } else if last.kind == .audio {
                        preview = "🎤 Voice message"
                    } else if last.kind == .image {
                        preview = "📷 Photo"
                    } else {
                        preview = "Attachment"
                    }
                }
                self.friends[friendIdx].lastMessageText = preview
                self.friends[friendIdx].lastMessageTime = last.createdAt
                self.friends[friendIdx].lastMessageStatus = last.status.rawValue
            }
        }
    }
    
    // MARK: - Mark Conversation Messages as Read
    public func markConversationAsRead(conversationId: String, messages: [ChatMessage]) async {
        guard let user = auth.currentUser, let token = await auth.getOrRefreshIdToken() else { return }
        for msg in messages where msg.senderId != user.id && msg.status != .read {
            let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/conversations/\(conversationId)/messages/\(msg.id)?updateMask.fieldPaths=status"
            guard let url = URL(string: endpoint) else { continue }
            var req = URLRequest(url: url)
            req.httpMethod = "PATCH"
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let body: [String: Any] = [
                "fields": [
                    "status": ["stringValue": "read"]
                ]
            ]
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
            _ = try? await URLSession.shared.data(for: req)
        }
    }
    
    // MARK: - Send Encrypted Message
    public func sendEncryptedMessage(conversationId: String, pairingSecret: String, text: String, replyTo: ReplyReference? = nil) async throws {
        guard let user = auth.currentUser, let token = auth.idToken else { return }
        
        var payloadDict: [String: Any] = [
            "kind": "text",
            "text": text
        ]
        if let reply = replyTo {
            payloadDict["replyTo"] = [
                "messageId": reply.messageId,
                "senderName": reply.senderName ?? "User",
                "snippet": reply.snippet
            ]
        }
        
        let ciphertext = try encryptPayload(conversationId: conversationId, pairingSecret: pairingSecret, payload: payloadDict)
        let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/conversations/\(conversationId)/messages"
        guard let url = URL(string: endpoint) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "fields": [
                "ciphertext": ["stringValue": ciphertext],
                "senderId": ["stringValue": user.id],
                "status": ["stringValue": "sent"],
                "type": ["stringValue": "text"],
                "createdAt": ["timestampValue": ISO8601DateFormatter().string(from: Date())]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (_, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode == 200 {
            // Trigger immediate local refresh
            await fetchMessages(conversationId: conversationId, pairingSecret: pairingSecret, idToken: token)
        }
    }

    // MARK: - Send Encrypted Voice Note
    public func sendVoiceNote(conversationId: String, pairingSecret: String, audioData: Data, durationSeconds: Double) async throws {
        guard let user = auth.currentUser, let token = auth.idToken else { return }
        
        let inlineStoragePath = try encryptDataToInlineStorage(data: audioData, conversationId: conversationId, pairingSecret: pairingSecret)
        
        let payloadDict: [String: Any] = [
            "kind": "audio",
            "text": "",
            "attachment": [
                "fileName": "voice_note.m4a",
                "contentType": "audio/m4a",
                "size": audioData.count,
                "storagePath": inlineStoragePath,
                "durationSeconds": durationSeconds
            ]
        ]
        
        let ciphertext = try encryptPayload(conversationId: conversationId, pairingSecret: pairingSecret, payload: payloadDict)
        let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/conversations/\(conversationId)/messages"
        guard let url = URL(string: endpoint) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "fields": [
                "ciphertext": ["stringValue": ciphertext],
                "senderId": ["stringValue": user.id],
                "status": ["stringValue": "sent"],
                "type": ["stringValue": "audio"],
                "createdAt": ["timestampValue": ISO8601DateFormatter().string(from: Date())]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode == 200 {
            await fetchMessages(conversationId: conversationId, pairingSecret: pairingSecret, idToken: token)
        }
    }

    // MARK: - Send Encrypted Photo
    public func sendPhotoAttachment(conversationId: String, pairingSecret: String, imageData: Data, width: Double = 800, height: Double = 600) async throws {
        guard let user = auth.currentUser, let token = auth.idToken else { return }
        
        let inlineStoragePath = try encryptDataToInlineStorage(data: imageData, conversationId: conversationId, pairingSecret: pairingSecret)
        
        let payloadDict: [String: Any] = [
            "kind": "image",
            "text": "",
            "attachment": [
                "fileName": "photo.jpg",
                "contentType": "image/jpeg",
                "size": imageData.count,
                "storagePath": inlineStoragePath,
                "width": width,
                "height": height
            ]
        ]
        
        let ciphertext = try encryptPayload(conversationId: conversationId, pairingSecret: pairingSecret, payload: payloadDict)
        let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/conversations/\(conversationId)/messages"
        guard let url = URL(string: endpoint) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "fields": [
                "ciphertext": ["stringValue": ciphertext],
                "senderId": ["stringValue": user.id],
                "status": ["stringValue": "sent"],
                "type": ["stringValue": "image"],
                "createdAt": ["timestampValue": ISO8601DateFormatter().string(from: Date())]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode == 200 {
            await fetchMessages(conversationId: conversationId, pairingSecret: pairingSecret, idToken: token)
        }
    }
    
    // MARK: - Edit Message
    public func editEncryptedMessage(conversationId: String, pairingSecret: String, messageId: String, newText: String) async throws {
        guard let token = auth.idToken else { return }
        let payloadDict: [String: Any] = ["kind": "text", "text": newText]
        let ciphertext = try encryptPayload(conversationId: conversationId, pairingSecret: pairingSecret, payload: payloadDict)
        
        let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/conversations/\(conversationId)/messages/\(messageId)?updateMask.fieldPaths=ciphertext&updateMask.fieldPaths=edited&updateMask.fieldPaths=editedAt"
        guard let url = URL(string: endpoint) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "fields": [
                "ciphertext": ["stringValue": ciphertext],
                "edited": ["booleanValue": true],
                "editedAt": ["timestampValue": ISO8601DateFormatter().string(from: Date())]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await URLSession.shared.data(for: request)
        
        await fetchMessages(conversationId: conversationId, pairingSecret: pairingSecret, idToken: token)
    }
    
    // MARK: - Delete For Everyone
    public func deleteForEveryone(conversationId: String, pairingSecret: String, messageId: String) async throws {
        guard let user = auth.currentUser, let token = auth.idToken else { return }
        let tombstonePayload: [String: Any] = ["kind": "text", "text": ""]
        let ciphertext = try encryptPayload(conversationId: conversationId, pairingSecret: pairingSecret, payload: tombstonePayload)
        
        let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/conversations/\(conversationId)/messages/\(messageId)?updateMask.fieldPaths=ciphertext&updateMask.fieldPaths=deletedForEveryone&updateMask.fieldPaths=deletedAt&updateMask.fieldPaths=deletedBy"
        guard let url = URL(string: endpoint) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "fields": [
                "ciphertext": ["stringValue": ciphertext],
                "deletedForEveryone": ["booleanValue": true],
                "deletedAt": ["timestampValue": ISO8601DateFormatter().string(from: Date())],
                "deletedBy": ["stringValue": user.id]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await URLSession.shared.data(for: request)
        
        await fetchMessages(conversationId: conversationId, pairingSecret: pairingSecret, idToken: token)
    }
    
    // MARK: - Delete For Me
    public func deleteForMe(conversationId: String, messageId: String) async throws {
        await MainActor.run {
            if var list = self.messages[conversationId] {
                list.removeAll { $0.id == messageId }
                self.messages[conversationId] = list
            }
        }
    }
    
    // MARK: - Toggle Star Message
    public func toggleStarMessage(messageId: String) {
        if starredMessageIds.contains(messageId) {
            starredMessageIds.remove(messageId)
        } else {
            starredMessageIds.insert(messageId)
        }
        UserDefaults.standard.set(Array(starredMessageIds), forKey: starredDefaultsKey)
    }
    
    // MARK: - Pin Message
    public func togglePinMessage(conversationId: String, messageId: String) {
        if pinnedMessageIds[conversationId] == messageId {
            pinnedMessageIds[conversationId] = nil
        } else {
            pinnedMessageIds[conversationId] = messageId
        }
    }
    
    // MARK: - Create 6-Digit Invite
    public func createInvite() async throws -> (code: String, expiresAt: Double) {
        guard let user = auth.currentUser, let token = auth.idToken else {
            throw NSError(domain: "LumaInvite", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unauthenticated"])
        }
        
        let charset = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
        var code = ""
        for _ in 0..<6 {
            let randIdx = Int.random(in: 0..<charset.count)
            let char = charset[charset.index(charset.startIndex, offsetBy: randIdx)]
            code.append(char)
        }
        
        // SHA-256 hash for document ID
        let codeData = code.data(using: .utf8) ?? Data()
        let digest = SHA256.hash(data: codeData)
        let codeHash = digest.map { String(format: "%02x", $0) }.joined()
        
        let now = Date().timeIntervalSince1970 * 1000
        let expiresAt = now + (10 * 60 * 1000) // 10 minutes
        
        let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/invites?documentId=\(codeHash)"
        guard let url = URL(string: endpoint) else { throw URLError(.badURL) }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "fields": [
                "ownerId": ["stringValue": user.id],
                "ownerProfile": [
                    "mapValue": [
                        "fields": [
                            "name": ["stringValue": user.displayName],
                            "handle": ["stringValue": user.handle],
                            "initials": ["stringValue": user.initials],
                            "color": ["stringValue": user.color]
                        ]
                    ]
                ],
                "createdAt": ["integerValue": "\(Int(now))"],
                "expiresAt": ["integerValue": "\(Int(expiresAt))"]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await URLSession.shared.data(for: request)
        
        return (code, expiresAt)
    }
    
    // MARK: - Accept 6-Digit Invite
    public func acceptInvite(rawCode: String) async throws {
        guard let user = auth.currentUser, let token = auth.idToken else {
            throw NSError(domain: "LumaInvite", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unauthenticated"])
        }
        
        let cleaned = rawCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let codeData = cleaned.data(using: .utf8) ?? Data()
        let digest = SHA256.hash(data: codeData)
        let codeHash = digest.map { String(format: "%02x", $0) }.joined()
        
        let inviteUrl = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/invites/\(codeHash)"
        guard let url = URL(string: inviteUrl) else { return }
        
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let fields = json["fields"] as? [String: Any],
              let ownerId = (fields["ownerId"] as? [String: Any])?["stringValue"] as? String,
              ownerId != user.id else {
            throw NSError(domain: "LumaInvite", code: -2, userInfo: [NSLocalizedDescriptionKey: "Invalid or expired invite code."])
        }
        
        let ownerProfileMap = ((fields["ownerProfile"] as? [String: Any])?["mapValue"] as? [String: Any])?["fields"] as? [String: Any]
        let ownerName = (ownerProfileMap?["name"] as? [String: Any])?["stringValue"] as? String ?? "Friend"
        let ownerHandle = (ownerProfileMap?["handle"] as? [String: Any])?["stringValue"] as? String ?? "@friend"
        let ownerInitials = (ownerProfileMap?["initials"] as? [String: Any])?["stringValue"] as? String ?? "F"
        let ownerColor = (ownerProfileMap?["color"] as? [String: Any])?["stringValue"] as? String ?? "#25D366"
        
        // Derive conversationId & pairingSecret
        let conversationId = [user.id, ownerId].sorted().joined(separator: "_")
        let pairingSecret = UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let now = Date().timeIntervalSince1970 * 1000
        
        // 1. Create reciprocal contact doc on currentUser
        let contactEndpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/users/\(user.id)/contacts/\(ownerId)"
        if let contactUrl = URL(string: contactEndpoint) {
            var contactReq = URLRequest(url: contactUrl)
            contactReq.httpMethod = "PATCH"
            contactReq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            contactReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
            
            let contactBody: [String: Any] = [
                "fields": [
                    "uid": ["stringValue": ownerId],
                    "name": ["stringValue": ownerName],
                    "handle": ["stringValue": ownerHandle],
                    "initials": ["stringValue": ownerInitials],
                    "color": ["stringValue": ownerColor],
                    "conversationId": ["stringValue": conversationId],
                    "pairingSecret": ["stringValue": pairingSecret],
                    "createdAt": ["integerValue": "\(Int(now))"]
                ]
            ]
            contactReq.httpBody = try JSONSerialization.data(withJSONObject: contactBody)
            _ = try? await URLSession.shared.data(for: contactReq)
        }
        
        // 2. Create conversation doc in /conversations/{conversationId}
        let convEndpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/conversations?documentId=\(conversationId)"
        if let convUrl = URL(string: convEndpoint) {
            var convReq = URLRequest(url: convUrl)
            convReq.httpMethod = "POST"
            convReq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            convReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
            
            let convBody: [String: Any] = [
                "fields": [
                    "memberIds": [
                        "arrayValue": [
                            "values": [
                                ["stringValue": user.id],
                                ["stringValue": ownerId]
                            ]
                        ]
                    ],
                    "updatedAt": ["integerValue": "\(Int(now))"]
                ]
            ]
            convReq.httpBody = try JSONSerialization.data(withJSONObject: convBody)
            _ = try? await URLSession.shared.data(for: convReq)
        }
        
        // Refresh contacts list
        await fetchContacts(userId: user.id, idToken: token)
    }
    
    // MARK: - Update Contact Settings (Nickname, Pin, Clear)
    public func updateNickname(friend: Friend, nickname: String) async throws {
        guard let user = auth.currentUser, let token = auth.idToken else { return }
        let clean = nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        
        let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/users/\(user.id)/contacts/\(friend.id)?updateMask.fieldPaths=nickname"
        guard let url = URL(string: endpoint) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "fields": [
                "nickname": ["stringValue": clean]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await URLSession.shared.data(for: request)
        
        await MainActor.run {
            if let idx = self.friends.firstIndex(where: { $0.id == friend.id }) {
                self.friends[idx].nickname = clean.isEmpty ? nil : clean
            }
        }
    }
    
    public func togglePinContact(friend: Friend) async throws {
        guard let user = auth.currentUser, let token = auth.idToken else { return }
        let nextPin = !friend.pinned
        
        let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/users/\(user.id)/contacts/\(friend.id)?updateMask.fieldPaths=pinned"
        guard let url = URL(string: endpoint) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "fields": [
                "pinned": ["booleanValue": nextPin]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await URLSession.shared.data(for: request)
        
        await MainActor.run {
            if let idx = self.friends.firstIndex(where: { $0.id == friend.id }) {
                self.friends[idx].pinned = nextPin
            }
        }
    }
    
    public func clearChat(friend: Friend) {
        messages[friend.conversationId] = []
    }
    
    public func deleteContact(friend: Friend) async throws {
        guard let user = auth.currentUser, let token = auth.idToken else { return }
        let endpoint = "https://firestore.googleapis.com/v1/projects/\(auth.projectId)/databases/(default)/documents/users/\(user.id)/contacts/\(friend.id)"
        guard let url = URL(string: endpoint) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        _ = try await URLSession.shared.data(for: request)
        
        await MainActor.run {
            self.friends.removeAll { $0.id == friend.id }
            self.messages.removeValue(forKey: friend.conversationId)
        }
    }
    
    // MARK: - Call History Logging
    public func logCall(_ record: CallRecord) {
        callHistory.insert(record, at: 0)
        if callHistory.count > 100 {
            callHistory = Array(callHistory.prefix(100))
        }
        if let encoded = try? JSONEncoder().encode(callHistory) {
            UserDefaults.standard.set(encoded, forKey: callHistoryDefaultsKey)
        }
    }
}
