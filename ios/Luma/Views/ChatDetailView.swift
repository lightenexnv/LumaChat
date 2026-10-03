import SwiftUI
import PhotosUI
import AVFoundation

// MARK: - Voice Recorder Helper
final class VoiceRecorderHelper: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published var isRecording: Bool = false
    @Published var recordDuration: Double = 0
    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var fileURL: URL?
    
    func startRecording() {
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true)
            
            let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("voice_\(UUID().uuidString).m4a")
            self.fileURL = url
            
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]
            
            recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder?.delegate = self
            recorder?.record()
            isRecording = true
            recordDuration = 0
            
            timer?.invalidate()
            timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
                self?.recordDuration += 1
            }
        } catch {
            print("Failed to record audio: \(error)")
        }
    }
    
    func stopRecording() -> (Data, Double)? {
        timer?.invalidate()
        timer = nil
        isRecording = false
        recorder?.stop()
        let dur = recordDuration
        recordDuration = 0
        guard let url = fileURL, let data = try? Data(contentsOf: url), data.count > 0 else {
            return nil
        }
        try? FileManager.default.removeItem(at: url)
        return (data, dur)
    }
    
    func cancelRecording() {
        timer?.invalidate()
        timer = nil
        isRecording = false
        recorder?.stop()
        recordDuration = 0
        if let url = fileURL {
            try? FileManager.default.removeItem(at: url)
        }
    }
}

// MARK: - Voice Player Helper
final class VoicePlayerHelper: NSObject, ObservableObject, AVAudioPlayerDelegate {
    static let shared = VoicePlayerHelper()
    @Published var playingMessageId: String? = nil
    @Published var progress: Double = 0
    private var player: AVAudioPlayer?
    private var timer: Timer?
    
    func play(data: Data, messageId: String) {
        if playingMessageId == messageId {
            stop()
            return
        }
        stop()
        
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            
            player = try AVAudioPlayer(data: data)
            player?.delegate = self
            player?.play()
            playingMessageId = messageId
            
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                guard let self = self, let p = self.player else { return }
                self.progress = p.currentTime / max(1.0, p.duration)
            }
        } catch {
            print("Audio playback failed: \(error)")
        }
    }
    
    func stop() {
        timer?.invalidate()
        timer = nil
        player?.stop()
        player = nil
        playingMessageId = nil
        progress = 0
    }
    
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        stop()
    }
}

// MARK: - Native Chat Detail View (Full WhatsApp Web & iOS Parity)
public struct ChatDetailView: View {
    let friend: Friend
    var onDismiss: (() -> Void)? = nil
    
    @ObservedObject var db = DatabaseService.shared
    @ObservedObject var webrtc = WebRTCService.shared
    @ObservedObject var sound = SoundManager.shared
    @Environment(\.presentationMode) var presentationMode
    
    @StateObject private var voiceRecorder = VoiceRecorderHelper()
    
    @State private var draft: String = ""
    @State private var replyingTo: ChatMessage? = nil
    @State private var editingMessage: ChatMessage? = nil
    @State private var selectedContextMenuMessage: ChatMessage? = nil
    @State private var forwardingMessage: ChatMessage? = nil
    @State private var infoMessage: ChatMessage? = nil
    @State private var deletingMessage: ChatMessage? = nil
    @State private var showAttachmentActionSheet: Bool = false
    @State private var showPhotosPicker: Bool = false
    @State private var selectedPhotoItem: PhotosPickerItem? = nil
    
    public init(friend: Friend, onDismiss: (() -> Void)? = nil) {
        self.friend = friend
        self.onDismiss = onDismiss
    }
    
    private var messages: [ChatMessage] {
        db.messages[friend.conversationId] ?? []
    }
    
    private var pinnedMessage: ChatMessage? {
        if let pinnedId = db.pinnedMessageIds[friend.conversationId] {
            return messages.first { $0.id == pinnedId }
        }
        return nil
    }
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            
            VStack(spacing: 0) {
                // Header Bar matching WhatsApp iOS
                HStack(spacing: 10) {
                    GlassBackButton {
                        onDismiss?()
                        presentationMode.wrappedValue.dismiss()
                    }
                    
                    // Contact Info
                    HStack(spacing: 10) {
                        ZStack(alignment: .bottomTrailing) {
                            Circle()
                                .fill(GlassTheme.avatarColor(for: friend.id))
                                .frame(width: 38, height: 38)
                            
                            if let photo = friend.photoURL, let url = URL(string: photo) {
                                AsyncImage(url: url) { img in
                                    img.resizable().scaledToFill()
                                } placeholder: {
                                    Text(friend.initials)
                                        .font(.system(size: 15, weight: .bold))
                                        .foregroundColor(.white)
                                }
                                .frame(width: 38, height: 38)
                                .clipShape(Circle())
                            } else {
                                Text(friend.initials)
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundColor(.white)
                            }
                            
                            if friend.online {
                                Circle()
                                    .fill(GlassTheme.accentEmerald)
                                    .frame(width: 10, height: 10)
                                    .overlay(Circle().stroke(Color.black, lineWidth: 1.5))
                            }
                        }
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text(friend.displayName)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(.white)
                                .lineLimit(1)
                            
                            Text(friend.online ? "online" : "tap here for contact info")
                                .font(.system(size: 11))
                                .foregroundColor(friend.online ? GlassTheme.accentEmerald : GlassTheme.textSecondary)
                        }
                    }
                    
                    Spacer()
                    
                    // Video Call Pill Button
                    GlassPillButton(icon: "video.fill", size: 36) {
                        webrtc.startCall(with: friend, isVideo: true)
                    }
                    
                    // Audio Call Pill Button
                    GlassPillButton(icon: "phone.fill", size: 36) {
                        webrtc.startCall(with: friend, isVideo: false)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.ultraThinMaterial)
                .overlay(
                    Rectangle().frame(height: 0.5).foregroundColor(GlassTheme.glassBorder),
                    alignment: .bottom
                )
                
                // Pinned Message Bar
                if let pinned = pinnedMessage {
                    HStack(spacing: 8) {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 13))
                            .foregroundColor(GlassTheme.accentEmerald)
                        
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Pinned Message")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(GlassTheme.accentEmerald)
                            Text(pinned.text.isEmpty ? "Attachment" : pinned.text)
                                .font(.system(size: 13))
                                .foregroundColor(.white)
                                .lineLimit(1)
                        }
                        
                        Spacer()
                        
                        Button(action: {
                            db.togglePinMessage(conversationId: friend.conversationId, messageId: pinned.id)
                        }) {
                            Image(systemName: "xmark")
                                .font(.system(size: 12))
                                .foregroundColor(GlassTheme.textSecondary)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(Color.white.opacity(0.06))
                }
                
                // Messages List (WhatsApp Bubbles)
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 6) {
                            // E2EE Lock Banner
                            HStack(spacing: 6) {
                                Image(systemName: "lock.fill")
                                    .font(.system(size: 11))
                                    .foregroundColor(GlassTheme.accentGold)
                                Text("Messages and calls are end-to-end encrypted. No one outside of this chat, not even Luma, can read or listen to them.")
                                    .font(.system(size: 11))
                                    .foregroundColor(GlassTheme.textSecondary)
                                    .multilineTextAlignment(.center)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(Color.white.opacity(0.04))
                            .cornerRadius(10)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                            
                            ForEach(messages) { message in
                                NativeSwipeableMessageRow(
                                    message: message,
                                    pairingSecret: friend.pairingSecret,
                                    isMine: message.senderId == (db.currentUser?.id ?? ""),
                                    onReply: { replyingTo = message },
                                    onOpenMenu: { selectedContextMenuMessage = message }
                                )
                                .id(message.id)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                    }
                    .onAppear {
                        if let last = messages.last {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                        Task {
                            await db.markConversationAsRead(conversationId: friend.conversationId, messages: messages)
                        }
                    }
                    .onChange(of: messages.count) { _ in
                        if let last = messages.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                        Task {
                            await db.markConversationAsRead(conversationId: friend.conversationId, messages: messages)
                        }
                    }
                }
                
                // Replying-To Banner
                if let reply = replyingTo {
                    HStack(spacing: 8) {
                        Rectangle()
                            .fill(GlassTheme.accentEmerald)
                            .frame(width: 3)
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Replying to \(reply.senderId == db.currentUser?.id ? "yourself" : friend.displayName)")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(GlassTheme.accentEmerald)
                            Text(reply.text.isEmpty ? "Attachment" : reply.text)
                                .font(.system(size: 13))
                                .foregroundColor(.white)
                                .lineLimit(1)
                        }
                        
                        Spacer()
                        
                        Button(action: { replyingTo = nil }) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(GlassTheme.textSecondary)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(GlassTheme.bgSecondary)
                }
                
                // Editing Message Banner
                if let edit = editingMessage {
                    HStack(spacing: 8) {
                        Image(systemName: "pencil")
                            .font(.system(size: 12))
                            .foregroundColor(GlassTheme.accentEmerald)
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Edit Message")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(GlassTheme.accentEmerald)
                            Text(edit.text)
                                .font(.system(size: 13))
                                .foregroundColor(.white)
                                .lineLimit(1)
                        }
                        
                        Spacer()
                        
                        Button(action: {
                            editingMessage = nil
                            draft = ""
                        }) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(GlassTheme.textSecondary)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(GlassTheme.bgSecondary)
                }
                
                // WhatsApp Composer Bar or Audio Recording Bar
                if voiceRecorder.isRecording {
                    // Audio Recording Bar
                    HStack(spacing: 14) {
                        // Flashing red record dot
                        Circle()
                            .fill(GlassTheme.dangerRed)
                            .frame(width: 12, height: 12)
                        
                        let mins = Int(voiceRecorder.recordDuration) / 60
                        let secs = Int(voiceRecorder.recordDuration) % 60
                        Text(String(format: "%d:%02d", mins, secs))
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                        
                        Spacer()
                        
                        // Cancel button
                        Button(action: {
                            voiceRecorder.cancelRecording()
                        }) {
                            Image(systemName: "trash.fill")
                                .font(.system(size: 17))
                                .foregroundColor(GlassTheme.dangerRed)
                                .padding(8)
                        }
                        
                        // Send Voice Note button
                        Button(action: handleSendVoiceNote) {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundColor(.black)
                                .frame(width: 36, height: 36)
                                .background(GlassTheme.accentEmerald)
                                .clipShape(Circle())
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.ultraThinMaterial)
                    .overlay(
                        Rectangle().frame(height: 0.5).foregroundColor(GlassTheme.glassBorder),
                        alignment: .top
                    )
                } else {
                    // Standard WhatsApp Composer Bar
                    HStack(spacing: 8) {
                        // Attachment Plus Button
                        Button(action: { showAttachmentActionSheet = true }) {
                            Image(systemName: "plus")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(GlassTheme.textSecondary)
                                .frame(width: 36, height: 36)
                                .background(Color.white.opacity(0.08))
                                .clipShape(Circle())
                        }
                        
                        // Message Pill Field
                        HStack(spacing: 6) {
                            TextField(editingMessage != nil ? "Edit message..." : "Message", text: $draft)
                                .font(.system(size: 16))
                                .foregroundColor(.white)
                            
                            Button(action: {
                                draft += " 😊"
                            }) {
                                Image(systemName: "face.smiling")
                                    .foregroundColor(GlassTheme.textSecondary)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.white.opacity(0.08))
                        .cornerRadius(20)
                        
                        // Send / Mic Button
                        if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Button(action: {
                                voiceRecorder.startRecording()
                            }) {
                                Image(systemName: "mic.fill")
                                    .font(.system(size: 16))
                                    .foregroundColor(GlassTheme.textSecondary)
                                    .frame(width: 36, height: 36)
                                    .background(Color.white.opacity(0.08))
                                    .clipShape(Circle())
                            }
                        } else {
                            Button(action: handleSend) {
                                Image(systemName: editingMessage != nil ? "checkmark" : "arrow.up")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundColor(.black)
                                    .frame(width: 36, height: 36)
                                    .background(GlassTheme.accentEmerald)
                                    .clipShape(Circle())
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial)
                    .overlay(
                        Rectangle().frame(height: 0.5).foregroundColor(GlassTheme.glassBorder),
                        alignment: .top
                    )
                }
            }
            .navigationBarHidden(true)
            
            // Custom WhatsApp Context Menu Sheet
            if let menuMsg = selectedContextMenuMessage {
                ContextMenuOverlay(
                    message: menuMsg,
                    isMine: menuMsg.senderId == (db.currentUser?.id ?? ""),
                    onReaction: { emoji in
                        draft = "\(draft) \(emoji)".trimmingCharacters(in: .whitespaces)
                        selectedContextMenuMessage = nil
                    },
                    onPin: {
                        db.togglePinMessage(conversationId: friend.conversationId, messageId: menuMsg.id)
                        selectedContextMenuMessage = nil
                    },
                    onReply: {
                        replyingTo = menuMsg
                        selectedContextMenuMessage = nil
                    },
                    onForward: {
                        forwardingMessage = menuMsg
                        selectedContextMenuMessage = nil
                    },
                    onCopy: {
                        UIPasteboard.general.string = menuMsg.text
                        selectedContextMenuMessage = nil
                    },
                    onEdit: {
                        editingMessage = menuMsg
                        draft = menuMsg.text
                        selectedContextMenuMessage = nil
                    },
                    onInfo: {
                        infoMessage = menuMsg
                        selectedContextMenuMessage = nil
                    },
                    onDelete: {
                        deletingMessage = menuMsg
                        selectedContextMenuMessage = nil
                    },
                    onClose: {
                        selectedContextMenuMessage = nil
                    }
                )
            }
        }
        .actionSheet(isPresented: $showAttachmentActionSheet) {
            ActionSheet(
                title: Text("Share Content"),
                message: nil,
                buttons: [
                    .default(Text("📷 Photo & Video Library")) {
                        showPhotosPicker = true
                    },
                    .default(Text("👤 Contact Card")) {
                        handleShareContact()
                    },
                    .cancel()
                ]
            )
        }
        .photosPicker(isPresented: $showPhotosPicker, selection: $selectedPhotoItem, matching: .images)
        .onChange(of: selectedPhotoItem) { item in
            guard let item = item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    try? await db.sendPhotoAttachment(
                        conversationId: friend.conversationId,
                        pairingSecret: friend.pairingSecret,
                        imageData: data
                    )
                    sound.playOutgoingMessageSound()
                }
                selectedPhotoItem = nil
            }
        }
        .sheet(item: $forwardingMessage) { msg in
            ForwardModalView(message: msg)
        }
        .sheet(item: $infoMessage) { msg in
            MessageInfoModalView(message: msg)
        }
        .actionSheet(item: $deletingMessage) { msg in
            ActionSheet(
                title: Text("Delete message?"),
                message: Text("You can delete this message for yourself or for everyone in this chat."),
                buttons: [
                    .destructive(Text("Delete for everyone")) {
                        Task {
                            try? await db.deleteForEveryone(conversationId: friend.conversationId, pairingSecret: friend.pairingSecret, messageId: msg.id)
                        }
                    },
                    .default(Text("Delete for me")) {
                        Task {
                            try? await db.deleteForMe(conversationId: friend.conversationId, messageId: msg.id)
                        }
                    },
                    .cancel()
                ]
            )
        }
    }
    
    private func handleSend() {
        let clean = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        
        if let editing = editingMessage {
            Task {
                try? await db.editEncryptedMessage(
                    conversationId: friend.conversationId,
                    pairingSecret: friend.pairingSecret,
                    messageId: editing.id,
                    newText: clean
                )
            }
            editingMessage = nil
            draft = ""
            return
        }
        
        let replyRef = replyingTo.map {
            ReplyReference(messageId: $0.id, senderName: $0.senderId == db.currentUser?.id ? "You" : friend.displayName, snippet: $0.text.isEmpty ? "Attachment" : $0.text)
        }
        
        Task {
            try? await db.sendEncryptedMessage(
                conversationId: friend.conversationId,
                pairingSecret: friend.pairingSecret,
                text: clean,
                replyTo: replyRef
            )
        }
        
        sound.playOutgoingMessageSound()
        draft = ""
        replyingTo = nil
    }
    
    private func handleSendVoiceNote() {
        guard let (audioData, duration) = voiceRecorder.stopRecording() else { return }
        Task {
            try? await db.sendVoiceNote(
                conversationId: friend.conversationId,
                pairingSecret: friend.pairingSecret,
                audioData: audioData,
                durationSeconds: duration
            )
        }
        sound.playOutgoingMessageSound()
    }
    
    private func handleShareContact() {
        guard let user = db.currentUser else { return }
        let payloadDict: [String: Any] = [
            "kind": "contact",
            "text": "",
            "contact": [
                "uid": user.id,
                "name": user.displayName,
                "handle": user.handle,
                "initials": user.initials,
                "color": user.color,
                "photoURL": user.photoURL ?? ""
            ]
        ]
        Task {
            if let ciphertext = try? db.encryptPayload(conversationId: friend.conversationId, pairingSecret: friend.pairingSecret, payload: payloadDict),
               let token = AuthService.shared.idToken {
                let endpoint = "https://firestore.googleapis.com/v1/projects/\(AuthService.shared.projectId)/databases/(default)/documents/conversations/\(friend.conversationId)/messages"
                if let url = URL(string: endpoint) {
                    var req = URLRequest(url: url)
                    req.httpMethod = "POST"
                    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    let body: [String: Any] = [
                        "fields": [
                            "ciphertext": ["stringValue": ciphertext],
                            "senderId": ["stringValue": user.id],
                            "status": ["stringValue": "sent"],
                            "type": ["stringValue": "contact"],
                            "createdAt": ["timestampValue": ISO8601DateFormatter().string(from: Date())]
                        ]
                    ]
                    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
                    _ = try? await URLSession.shared.data(for: req)
                    await db.fetchMessages(conversationId: friend.conversationId, pairingSecret: friend.pairingSecret, idToken: token)
                }
            }
        }
    }
}

// MARK: - Native Swipeable Message Row
public struct NativeSwipeableMessageRow: View {
    let message: ChatMessage
    let pairingSecret: String
    let isMine: Bool
    let onReply: () -> Void
    let onOpenMenu: () -> Void
    
    @State private var dragOffset: CGFloat = 0
    private let impactFeedback = UIImpactFeedbackGenerator(style: .light)
    
    private var formattedTime: String {
        let date = Date(timeIntervalSince1970: message.createdAt / 1000)
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
    
    public var body: some View {
        HStack {
            if isMine { Spacer(minLength: 40) }
            
            ZStack(alignment: .leading) {
                // Swipe-to-reply revealed icon
                if dragOffset > 0 {
                    Image(systemName: "arrowshape.turn.up.left.fill")
                        .font(.system(size: 14))
                        .foregroundColor(GlassTheme.accentEmerald)
                        .offset(x: -24)
                }
                
                VStack(alignment: isMine ? .trailing : .leading, spacing: 3) {
                    // Pinned Tag
                    if message.id == DatabaseService.shared.pinnedMessageIds[message.conversationId] {
                        HStack(spacing: 3) {
                            Image(systemName: "pin.fill").font(.system(size: 9))
                            Text("Pinned").font(.system(size: 10, weight: .bold))
                        }
                        .foregroundColor(Color.white.opacity(0.7))
                    }
                    
                    // Forwarded Tag
                    if message.forwarded == true {
                        HStack(spacing: 3) {
                            Image(systemName: "arrowshape.turn.up.forward.fill").font(.system(size: 9))
                            Text("Forwarded").font(.system(size: 10, weight: .medium)).italic()
                        }
                        .foregroundColor(Color.white.opacity(0.7))
                    }
                    
                    // Quoted Bubble
                    if let quote = message.replyTo {
                        HStack(spacing: 6) {
                            Rectangle()
                                .fill(isMine ? Color.white.opacity(0.6) : GlassTheme.accentEmerald)
                                .frame(width: 3)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(quote.senderName ?? "User")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundColor(isMine ? Color.white : GlassTheme.accentEmerald)
                                Text(quote.snippet)
                                    .font(.system(size: 12))
                                    .foregroundColor(Color.white.opacity(0.8))
                                    .lineLimit(1)
                            }
                        }
                        .padding(6)
                        .background(Color.black.opacity(0.15))
                        .cornerRadius(6)
                    }
                    
                    // Main Content
                    if message.deletedForEveryone == true {
                        HStack(spacing: 5) {
                            Image(systemName: "slash.circle")
                                .font(.system(size: 12))
                            Text("This message was deleted")
                                .font(.system(size: 14))
                                .italic()
                        }
                        .foregroundColor(Color.white.opacity(0.6))
                    } else if message.kind == .call, let call = message.call {
                        HStack(spacing: 8) {
                            Image(systemName: call.kind == "video" ? "video.fill" : "phone.fill")
                                .foregroundColor(call.outcome == "missed" ? GlassTheme.dangerRed : GlassTheme.accentEmerald)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(call.outcome == "completed" ? (call.kind == "video" ? "Video call" : "Voice call") : "Missed call")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(.white)
                                Text("\(call.durationSeconds)s")
                                    .font(.system(size: 11))
                                    .foregroundColor(GlassTheme.textSecondary)
                            }
                        }
                    } else if message.kind == .audio {
                        VoiceNoteBubbleView(message: message, pairingSecret: pairingSecret, isMine: isMine)
                    } else if message.kind == .image {
                        ImageBubbleView(message: message, pairingSecret: pairingSecret)
                    } else if message.kind == .contact, let c = message.contact {
                        HStack(spacing: 10) {
                            Circle()
                                .fill(GlassTheme.avatarColor(for: c.uid))
                                .frame(width: 40, height: 40)
                                .overlay(Text(c.initials).font(.system(size: 16, weight: .bold)).foregroundColor(.white))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(c.name).font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
                                Text(c.handle).font(.system(size: 12)).foregroundColor(GlassTheme.textSecondary)
                            }
                        }
                        .padding(4)
                    } else {
                        Text(message.text)
                            .font(.system(size: 15))
                            .foregroundColor(.white)
                    }
                    
                    // Footer: Timestamp + Status Ticks
                    HStack(spacing: 4) {
                        Text(formattedTime)
                            .font(.system(size: 10))
                            .foregroundColor(Color.white.opacity(0.6))
                        
                        if message.edited == true {
                            Text("· edited")
                                .font(.system(size: 10))
                                .foregroundColor(Color.white.opacity(0.6))
                        }
                        
                        if isMine {
                            HStack(spacing: -3) {
                                if message.status == .read {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundColor(GlassTheme.tickBlue)
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundColor(GlassTheme.tickBlue)
                                } else if message.status == .delivered {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundColor(Color.white.opacity(0.6))
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundColor(Color.white.opacity(0.6))
                                } else {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 9, weight: .medium))
                                        .foregroundColor(Color.white.opacity(0.6))
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(isMine ? GlassTheme.bubbleOutgoing : GlassTheme.bubbleIncoming)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .offset(x: dragOffset)
            }
            .gesture(
                DragGesture()
                    .onChanged { value in
                        if value.translation.width > 0 && value.translation.width < 80 {
                            dragOffset = value.translation.width
                            if dragOffset > 45 {
                                impactFeedback.impactOccurred()
                            }
                        }
                    }
                    .onEnded { value in
                        if dragOffset > 45 {
                            onReply()
                        }
                        withAnimation(.spring()) {
                            dragOffset = 0
                        }
                    }
            )
            .onLongPressGesture {
                onOpenMenu()
            }
            
            if !isMine { Spacer(minLength: 40) }
        }
    }
}

// MARK: - Voice Note Bubble View (WhatsApp Audio Note Parity)
struct VoiceNoteBubbleView: View {
    let message: ChatMessage
    let pairingSecret: String
    let isMine: Bool
    
    @ObservedObject var player = VoicePlayerHelper.shared
    @State private var audioData: Data? = nil
    
    var isPlaying: Bool {
        player.playingMessageId == message.id
    }
    
    var durationText: String {
        let dur = Int(message.attachment?.durationSeconds ?? 0)
        let mins = dur / 60
        let secs = dur % 60
        return String(format: "%d:%02d", mins, secs)
    }
    
    var body: some View {
        HStack(spacing: 10) {
            Button(action: togglePlay) {
                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 34))
                    .foregroundColor(isMine ? .white : GlassTheme.accentEmerald)
            }
            
            VStack(alignment: .leading, spacing: 4) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color.white.opacity(0.3))
                            .frame(height: 4)
                        
                        Capsule()
                            .fill(isMine ? Color.white : GlassTheme.accentEmerald)
                            .frame(width: geo.size.width * CGFloat(isPlaying ? player.progress : 0), height: 4)
                    }
                }
                .frame(height: 4)
                
                HStack {
                    Text(durationText)
                        .font(.system(size: 11))
                        .foregroundColor(Color.white.opacity(0.7))
                    Spacer()
                    Image(systemName: "mic.fill")
                        .font(.system(size: 10))
                        .foregroundColor(Color.white.opacity(0.6))
                }
            }
            .frame(width: 140)
        }
        .padding(.vertical, 4)
        .onAppear {
            loadAudio()
        }
    }
    
    private func loadAudio() {
        guard let sPath = message.attachment?.storagePath else { return }
        audioData = DatabaseService.shared.decryptInlineStorageData(
            storagePath: sPath,
            conversationId: message.conversationId,
            pairingSecret: pairingSecret
        )
    }
    
    private func togglePlay() {
        if audioData == nil {
            loadAudio()
        }
        guard let data = audioData else { return }
        player.play(data: data, messageId: message.id)
    }
}

// MARK: - Image Bubble View (WhatsApp Photo Attachment Parity)
struct ImageBubbleView: View {
    let message: ChatMessage
    let pairingSecret: String
    @State private var uiImage: UIImage? = nil
    
    var body: some View {
        Group {
            if let img = uiImage {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 240, maxHeight: 240)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                HStack(spacing: 8) {
                    Image(systemName: "photo")
                        .font(.system(size: 20))
                        .foregroundColor(.white)
                    Text("Photo")
                        .font(.system(size: 14))
                        .foregroundColor(.white)
                }
                .frame(width: 160, height: 90)
                .background(Color.white.opacity(0.08))
                .cornerRadius(12)
            }
        }
        .onAppear {
            loadImage()
        }
    }
    
    private func loadImage() {
        guard let sPath = message.attachment?.storagePath else { return }
        if let data = DatabaseService.shared.decryptInlineStorageData(
            storagePath: sPath,
            conversationId: message.conversationId,
            pairingSecret: pairingSecret
        ) {
            self.uiImage = UIImage(data: data)
        }
    }
}

// MARK: - Context Menu Overlay
public struct ContextMenuOverlay: View {
    let message: ChatMessage
    let isMine: Bool
    let onReaction: (String) -> Void
    let onPin: () -> Void
    let onReply: () -> Void
    let onForward: () -> Void
    let onCopy: () -> Void
    let onEdit: () -> Void
    let onInfo: () -> Void
    let onDelete: () -> Void
    let onClose: () -> Void
    
    public var body: some View {
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea()
                .onTapGesture { onClose() }
            
            VStack(spacing: 12) {
                // Floating Emoji Reaction Bar
                HStack(spacing: 12) {
                    ForEach(["👍", "❤️", "😂", "😮", "😢", "🙏"], id: \.self) { emoji in
                        Button(action: { onReaction(emoji) }) {
                            Text(emoji).font(.system(size: 26))
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(.ultraThinMaterial)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(GlassTheme.glassBorder, lineWidth: 1))
                
                // Actions Menu Card
                VStack(spacing: 0) {
                    MenuRow(title: "Star / Pin", icon: "pin.fill", action: onPin)
                    MenuRow(title: "Reply", icon: "arrowshape.turn.up.left.fill", action: onReply)
                    MenuRow(title: "Forward", icon: "arrowshape.turn.up.right.fill", action: onForward)
                    MenuRow(title: "Copy", icon: "doc.on.doc.fill", action: onCopy)
                    if isMine && message.kind == .text {
                        MenuRow(title: "Edit", icon: "pencil", action: onEdit)
                    }
                    MenuRow(title: "Info", icon: "info.circle.fill", action: onInfo)
                    MenuRow(title: "Delete", icon: "trash.fill", isDestructive: true, action: onDelete)
                }
                .frame(width: 220)
                .glassBackground(cornerRadius: 16)
            }
        }
    }
}

public struct MenuRow: View {
    let title: String
    let icon: String
    var isDestructive: Bool = false
    let action: () -> Void
    
    public var body: some View {
        Button(action: action) {
            HStack {
                Text(title)
                    .font(.system(size: 15))
                    .foregroundColor(isDestructive ? GlassTheme.dangerRed : .white)
                Spacer()
                Image(systemName: icon)
                    .font(.system(size: 15))
                    .foregroundColor(isDestructive ? GlassTheme.dangerRed : .white)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }
}

// MARK: - Forward Modal View
public struct ForwardModalView: View {
    let message: ChatMessage
    @Environment(\.presentationMode) var presentationMode
    @ObservedObject var db = DatabaseService.shared
    @State private var selectedFriends: Set<String> = []
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            
            VStack(spacing: 0) {
                HStack {
                    Button("Cancel") { presentationMode.wrappedValue.dismiss() }
                        .foregroundColor(GlassTheme.accentEmerald)
                    Spacer()
                    Text("Forward to...")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()
                    Button("Send") { handleForward() }
                        .foregroundColor(selectedFriends.isEmpty ? GlassTheme.textSecondary : GlassTheme.accentEmerald)
                        .disabled(selectedFriends.isEmpty)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                
                List {
                    ForEach(db.friends) { friend in
                        HStack(spacing: 12) {
                            Circle()
                                .fill(GlassTheme.avatarColor(for: friend.id))
                                .frame(width: 40, height: 40)
                                .overlay(Text(friend.initials).font(.system(size: 16, weight: .bold)).foregroundColor(.white))
                            
                            Text(friend.displayName)
                                .font(.system(size: 16))
                                .foregroundColor(.white)
                            
                            Spacer()
                            
                            if selectedFriends.contains(friend.id) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(GlassTheme.accentEmerald)
                            } else {
                                Circle()
                                    .stroke(GlassTheme.textSecondary, lineWidth: 1.5)
                                    .frame(width: 22, height: 22)
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            if selectedFriends.contains(friend.id) {
                                selectedFriends.remove(friend.id)
                            } else {
                                selectedFriends.insert(friend.id)
                            }
                        }
                        .listRowBackground(Color.clear)
                    }
                }
                .listStyle(PlainListStyle())
            }
        }
    }
    
    private func handleForward() {
        for friendId in selectedFriends {
            if let f = db.friends.first(where: { $0.id == friendId }) {
                Task {
                    var payloadDict: [String: Any] = [
                        "kind": message.kind.rawValue,
                        "text": message.text,
                        "forwarded": true
                    ]
                    if let att = message.attachment {
                        payloadDict["attachment"] = [
                            "fileName": att.fileName,
                            "contentType": att.contentType,
                            "size": att.size,
                            "storagePath": att.storagePath
                        ]
                    }
                    if let token = AuthService.shared.idToken, let user = AuthService.shared.currentUser {
                        let ciphertext = try? db.encryptPayload(conversationId: f.conversationId, pairingSecret: f.pairingSecret, payload: payloadDict)
                        if let ct = ciphertext, let url = URL(string: "https://firestore.googleapis.com/v1/projects/\(AuthService.shared.projectId)/databases/(default)/documents/conversations/\(f.conversationId)/messages") {
                            var req = URLRequest(url: url)
                            req.httpMethod = "POST"
                            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                            let body: [String: Any] = [
                                "fields": [
                                    "ciphertext": ["stringValue": ct],
                                    "senderId": ["stringValue": user.id],
                                    "status": ["stringValue": "sent"],
                                    "type": ["stringValue": message.kind.rawValue],
                                    "createdAt": ["timestampValue": ISO8601DateFormatter().string(from: Date())]
                                ]
                            ]
                            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
                            _ = try? await URLSession.shared.data(for: req)
                        }
                    }
                }
            }
        }
        presentationMode.wrappedValue.dismiss()
    }
}

// MARK: - Message Info Modal View
public struct MessageInfoModalView: View {
    let message: ChatMessage
    @Environment(\.presentationMode) var presentationMode
    
    private var sentDateString: String {
        let date = Date(timeIntervalSince1970: message.createdAt / 1000)
        let f = DateFormatter()
        f.dateFormat = "dd/MM/yyyy HH:mm:ss"
        return f.string(from: date)
    }
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            
            VStack(spacing: 20) {
                HStack {
                    Text("Message Info")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()
                    Button("Done") { presentationMode.wrappedValue.dismiss() }
                        .foregroundColor(GlassTheme.accentEmerald)
                }
                .padding(.top, 16)
                
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Status").foregroundColor(GlassTheme.textSecondary)
                        Spacer()
                        Text(message.status.rawValue.capitalized).foregroundColor(.white).bold()
                    }
                    Divider().background(GlassTheme.separator)
                    HStack {
                        Text("Sent At").foregroundColor(GlassTheme.textSecondary)
                        Spacer()
                        Text(sentDateString).foregroundColor(.white)
                    }
                    Divider().background(GlassTheme.separator)
                    HStack {
                        Text("Type").foregroundColor(GlassTheme.textSecondary)
                        Spacer()
                        Text(message.kind.rawValue.capitalized).foregroundColor(.white)
                    }
                }
                .padding(16)
                .glassBackground(cornerRadius: 16)
                
                Spacer()
            }
            .padding(.horizontal, 16)
        }
    }
}
