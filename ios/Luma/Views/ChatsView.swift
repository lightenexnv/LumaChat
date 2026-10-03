import SwiftUI

// MARK: - Chats View (Full Parity with Web ChatsView)
public struct ChatsView: View {
    @ObservedObject var db = DatabaseService.shared
    @ObservedObject var webrtc = WebRTCService.shared
    
    @Binding var activeFriend: Friend?
    
    @State private var friendSearch: String = ""
    @State private var friendFilter: String = "all" // "all" | "unread" | "favourites" | "groups"
    @State private var showNewChatSheet: Bool = false
    @State private var activeSheetFriend: Friend? = nil
    @State private var previewAvatarFriend: Friend? = nil
    @State private var nicknameModalFriend: Friend? = nil
    
    public init(activeFriend: Binding<Friend?> = .constant(nil)) {
        self._activeFriend = activeFriend
    }
    
    private var totalUnreadCount: Int {
        db.friends.reduce(0) { $0 + $1.unreadCount }
    }
    
    private var filteredFriends: [Friend] {
        let normalized = friendSearch.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return db.friends.filter { friend in
            var matchesFilter = true
            if friendFilter == "unread" {
                matchesFilter = friend.unreadCount > 0
            } else if friendFilter == "favourites" {
                matchesFilter = friend.pinned || friend.favourite
            } else if friendFilter == "groups" {
                matchesFilter = friend.isGroup
            }
            let matchesSearch = normalized.isEmpty ||
                friend.displayName.lowercased().contains(normalized) ||
                friend.handle.lowercased().contains(normalized)
            return matchesFilter && matchesSearch
        }.sorted { ($1.pinned ? 1 : 0) < ($0.pinned ? 1 : 0) }
    }
    
    public var body: some View {
        ZStack {
                GlassTheme.backgroundBlack.ignoresSafeArea()
                
                VStack(spacing: 0) {
                    // Top Navigation Bar matching WhatsApp iOS
                    HStack(spacing: 12) {
                        Button(action: { showNewChatSheet = true }) {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundColor(.white)
                                .frame(width: 36, height: 36)
                                .background(.ultraThinMaterial)
                                .clipShape(Circle())
                                .overlay(Circle().stroke(GlassTheme.glassBorder, lineWidth: 1))
                        }
                        
                        Spacer()
                        
                        // Camera Scanner Button
                        Button(action: { showNewChatSheet = true }) {
                            Image(systemName: "camera.fill")
                                .font(.system(size: 16))
                                .foregroundColor(.white)
                                .frame(width: 36, height: 36)
                                .background(.ultraThinMaterial)
                                .clipShape(Circle())
                                .overlay(Circle().stroke(GlassTheme.glassBorder, lineWidth: 1))
                        }
                        
                        // New Chat / Group / Invite Plus Button
                        Button(action: { showNewChatSheet = true }) {
                            Image(systemName: "plus")
                                .font(.system(size: 17, weight: .bold))
                                .foregroundColor(.black)
                                .frame(width: 36, height: 36)
                                .background(GlassTheme.accentEmerald)
                                .clipShape(Circle())
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 6)
                    
                    // Large Title "Chats"
                    HStack {
                        Text("Chats")
                            .font(.system(size: 34, weight: .bold))
                            .foregroundColor(GlassTheme.textPrimary)
                        Spacer()
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 10)
                    
                    // Search Pill matching Meta AI Pill in Web
                    HStack(spacing: 10) {
                        // Meta AI gradient ring
                        Circle()
                            .stroke(
                                LinearGradient(
                                    colors: [Color.blue, Color.purple, Color.cyan],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 2
                            )
                            .frame(width: 14, height: 14)
                        
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 15))
                            .foregroundColor(GlassTheme.textSecondary)
                        
                        TextField("Ask Meta AI or Search", text: $friendSearch)
                            .font(.system(size: 15))
                            .foregroundColor(GlassTheme.textPrimary)
                        
                        if !friendSearch.isEmpty {
                            Button(action: { friendSearch = "" }) {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.system(size: 14))
                                    .foregroundColor(GlassTheme.textSecondary)
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.white.opacity(0.08))
                    .cornerRadius(12)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
                    
                    // Filter Chips (All, Unread, Favourites, Groups)
                    HStack(spacing: 8) {
                        FilterChipButton(title: "All", isSelected: friendFilter == "all") {
                            friendFilter = "all"
                        }
                        
                        FilterChipButton(
                            title: "Unread",
                            badge: totalUnreadCount > 0 ? "\(totalUnreadCount)" : nil,
                            isSelected: friendFilter == "unread"
                        ) {
                            friendFilter = "unread"
                        }
                        
                        FilterChipButton(title: "Favourites", isSelected: friendFilter == "favourites") {
                            friendFilter = "favourites"
                        }
                        
                        FilterChipButton(title: "Groups", isSelected: friendFilter == "groups") {
                            friendFilter = "groups"
                        }
                        
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                    
                    // Chat Rows List
                    if filteredFriends.isEmpty {
                        VStack(spacing: 16) {
                            Spacer()
                            Image(systemName: "bubble.left.and.bubble.right")
                                .font(.system(size: 44))
                                .foregroundColor(GlassTheme.textSecondary)
                            Text(db.friends.isEmpty ? "No chats yet" : "No results found")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(GlassTheme.textPrimary)
                            Text(db.friends.isEmpty ? "Start chatting with a friend by sharing a private one-time 6-digit code." : "Try a different search term or filter.")
                                .font(.system(size: 14))
                                .foregroundColor(GlassTheme.textSecondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 36)
                            
                            Button(action: { showNewChatSheet = true }) {
                                Text("New Chat / Invite")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundColor(.black)
                                    .padding(.horizontal, 24)
                                    .padding(.vertical, 12)
                                    .background(GlassTheme.accentEmerald)
                                    .cornerRadius(12)
                            }
                            Spacer()
                        }
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 0) {
                                ForEach(filteredFriends) { friend in
                                    ChatRowView(
                                        friend: friend,
                                        onTapRow: {
                                            activeFriend = friend
                                        },
                                        onTapAvatar: { previewAvatarFriend = friend },
                                        onLongPress: { activeSheetFriend = friend }
                                    )
                                    
                                    Divider()
                                        .background(GlassTheme.separator)
                                        .padding(.leading, 80)
                                }
                            }
                            .padding(.bottom, 90) // Padding for floating glass bottom pill
                        }
                    }
                }
            }
            .sheet(isPresented: $showNewChatSheet) {
                NewChatPageView(isPresented: $showNewChatSheet, onFriendCreated: { newFriend in
                    activeFriend = newFriend
                })
            }
            .sheet(item: $activeSheetFriend) { friend in
                ChatActionsSheetView(
                    friend: friend,
                    onPin: {
                        Task { try? await db.togglePinContact(friend: friend) }
                    },
                    onNickname: {
                        nicknameModalFriend = friend
                    },
                    onClear: {
                        db.clearChat(friend: friend)
                    },
                    onDelete: {
                        Task { try? await db.deleteContact(friend: friend) }
                    }
                )
            }
            .sheet(item: $nicknameModalFriend) { friend in
                NicknameModalView(friend: friend)
            }
            .overlay(
                Group {
                    if let friend = previewAvatarFriend {
                        AvatarPreviewModalView(
                            friend: friend,
                            onClose: { previewAvatarFriend = nil },
                            onOpenChat: {
                                previewAvatarFriend = nil
                                activeFriend = friend
                            },
                            onVoiceCall: {
                                previewAvatarFriend = nil
                                webrtc.startCall(with: friend, isVideo: false)
                            },
                            onVideoCall: {
                                previewAvatarFriend = nil
                                webrtc.startCall(with: friend, isVideo: true)
                            }
                        )
                    }
                }
            )
        }
}

// MARK: - Filter Chip Button
public struct FilterChipButton: View {
    let title: String
    var badge: String? = nil
    let isSelected: Bool
    let action: () -> Void
    
    public var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(title)
                    .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
                    .foregroundColor(isSelected ? .black : GlassTheme.textSecondary)
                
                if let b = badge {
                    Text(b)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(isSelected ? .white : .black)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(isSelected ? Color.black : GlassTheme.accentEmerald)
                        .clipShape(Capsule())
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(isSelected ? GlassTheme.accentEmerald : Color.white.opacity(0.08))
            .clipShape(Capsule())
        }
    }
}

// MARK: - Chat Row View
public struct ChatRowView: View {
    let friend: Friend
    let onTapRow: () -> Void
    let onTapAvatar: () -> Void
    let onLongPress: () -> Void
    
    private var formattedTime: String {
        guard let time = friend.lastMessageTime else {
            return friend.online ? "Online" : ""
        }
        let now = Date().timeIntervalSince1970 * 1000
        let diff = now - time
        let date = Date(timeIntervalSince1970: time / 1000)
        let calendar = Calendar.current
        
        if calendar.isDateInToday(date) || diff < 86400000 {
            let mins = Int(diff / 60000)
            if mins <= 1 { return "Just now" }
            if mins < 60 { return "\(mins)m ago" }
            let hours = Int(diff / 3600000)
            return "\(hours)h ago"
        } else if calendar.isDateInYesterday(date) {
            return "Yesterday"
        } else if diff < 7 * 86400000 {
            let formatter = DateFormatter()
            formatter.dateFormat = "EEEE"
            return formatter.string(from: date)
        } else {
            let formatter = DateFormatter()
            formatter.dateFormat = "dd/MM/yyyy"
            return formatter.string(from: date)
        }
    }
    
    public var body: some View {
        HStack(spacing: 12) {
            // Avatar with online status
            Button(action: onTapAvatar) {
                ZStack(alignment: .bottomTrailing) {
                    Circle()
                        .fill(GlassTheme.avatarColor(for: friend.id))
                        .frame(width: 52, height: 52)
                    
                    if let photo = friend.photoURL, let url = URL(string: photo) {
                        AsyncImage(url: url) { img in
                            img.resizable().scaledToFill()
                        } placeholder: {
                            Text(friend.initials)
                                .font(.system(size: 20, weight: .bold))
                                .foregroundColor(.white)
                        }
                        .frame(width: 52, height: 52)
                        .clipShape(Circle())
                    } else {
                        Text(friend.initials)
                            .font(.system(size: 20, weight: .bold))
                            .foregroundColor(.white)
                    }
                    
                    if friend.online {
                        Circle()
                            .fill(GlassTheme.accentEmerald)
                            .frame(width: 13, height: 13)
                            .overlay(Circle().stroke(Color.black, lineWidth: 2))
                    }
                }
            }
            .buttonStyle(PlainButtonStyle())
            
            // Name, Snippet, Time & Badges
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(friend.displayName)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(GlassTheme.textPrimary)
                    
                    Spacer()
                    
                    Text(formattedTime)
                        .font(.system(size: 12))
                        .foregroundColor(friend.unreadCount > 0 ? GlassTheme.accentEmerald : GlassTheme.textSecondary)
                }
                
                HStack(spacing: 4) {
                    if let status = friend.lastMessageStatus {
                        if status == "read" {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 10))
                                .foregroundColor(GlassTheme.tickBlue)
                        } else {
                            Image(systemName: "checkmark")
                                .font(.system(size: 10))
                                .foregroundColor(GlassTheme.textSecondary)
                        }
                    }
                    
                    Text(friend.lastMessageText ?? (friend.online ? "Online" : "Tap to chat"))
                        .font(.system(size: 14))
                        .foregroundColor(GlassTheme.textSecondary)
                        .lineLimit(1)
                    
                    Spacer()
                    
                    if friend.pinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 11))
                            .foregroundColor(GlassTheme.textSecondary)
                    }
                    
                    if friend.unreadCount > 0 {
                        Text("\(friend.unreadCount)")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.black)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(GlassTheme.accentEmerald)
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .onTapGesture {
            onTapRow()
        }
        .onLongPressGesture {
            onLongPress()
        }
    }
}

// MARK: - Avatar Preview Modal
public struct AvatarPreviewModalView: View {
    let friend: Friend
    let onClose: () -> Void
    let onOpenChat: () -> Void
    let onVoiceCall: () -> Void
    let onVideoCall: () -> Void
    
    public var body: some View {
        ZStack {
            Color.black.opacity(0.65).ignoresSafeArea()
                .onTapGesture { onClose() }
            
            VStack(spacing: 0) {
                // Large Avatar with Name Overlay
                ZStack(alignment: .topLeading) {
                    ZStack {
                        GlassTheme.avatarColor(for: friend.id)
                            .frame(width: 270, height: 270)
                        
                        if let photo = friend.photoURL, let url = URL(string: photo) {
                            AsyncImage(url: url) { img in
                                img.resizable().scaledToFill()
                            } placeholder: {
                                Text(friend.initials)
                                    .font(.system(size: 80, weight: .bold))
                                    .foregroundColor(.white)
                            }
                            .frame(width: 270, height: 270)
                            .clipped()
                        } else {
                            Text(friend.initials)
                                .font(.system(size: 80, weight: .bold))
                                .foregroundColor(.white)
                        }
                    }
                    
                    Text(friend.displayName)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            LinearGradient(
                                colors: [Color.black.opacity(0.7), Color.clear],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                }
                .frame(width: 270, height: 270)
                .clipped()
                
                // Bottom Quick Action Bar
                HStack(spacing: 0) {
                    Button(action: onOpenChat) {
                        Image(systemName: "bubble.left.fill")
                            .font(.system(size: 20))
                            .foregroundColor(GlassTheme.accentEmerald)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                    
                    Button(action: onVoiceCall) {
                        Image(systemName: "phone.fill")
                            .font(.system(size: 20))
                            .foregroundColor(GlassTheme.accentEmerald)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                    
                    Button(action: onVideoCall) {
                        Image(systemName: "video.fill")
                            .font(.system(size: 20))
                            .foregroundColor(GlassTheme.accentEmerald)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                }
                .background(GlassTheme.bgSecondary)
            }
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(color: Color.black.opacity(0.6), radius: 30, y: 15)
        }
    }
}

// MARK: - Chat Actions Sheet (Long-Press Menu)
public struct ChatActionsSheetView: View {
    let friend: Friend
    let onPin: () -> Void
    let onNickname: () -> Void
    let onClear: () -> Void
    let onDelete: () -> Void
    
    @Environment(\.presentationMode) var presentationMode
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            
            VStack(spacing: 16) {
                // Header
                HStack(spacing: 12) {
                    Circle()
                        .fill(GlassTheme.avatarColor(for: friend.id))
                        .frame(width: 44, height: 44)
                        .overlay(
                            Text(friend.initials)
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(.white)
                        )
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text(friend.displayName)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white)
                        Text(friend.nickname != nil ? "Real name: \(friend.name)" : "Private contact")
                            .font(.system(size: 13))
                            .foregroundColor(GlassTheme.textSecondary)
                    }
                    
                    Spacer()
                    
                    Button("Done") { presentationMode.wrappedValue.dismiss() }
                        .foregroundColor(GlassTheme.accentEmerald)
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                
                Divider().background(GlassTheme.separator)
                
                // Actions
                VStack(spacing: 0) {
                    ActionRow(icon: "pin.fill", title: friend.pinned ? "Unpin chat" : "Pin chat") {
                        onPin()
                        presentationMode.wrappedValue.dismiss()
                    }
                    
                    ActionRow(icon: "pencil", title: friend.nickname != nil ? "Edit nickname (\(friend.nickname!))" : "Set nickname") {
                        presentationMode.wrappedValue.dismiss()
                        onNickname()
                    }
                    
                    ActionRow(icon: "eraser.fill", title: "Clear chat") {
                        onClear()
                        presentationMode.wrappedValue.dismiss()
                    }
                    
                    ActionRow(icon: "trash.fill", title: "Delete chat", isDestructive: true) {
                        onDelete()
                        presentationMode.wrappedValue.dismiss()
                    }
                }
                .glassBackground(cornerRadius: 16)
                .padding(.horizontal, 16)
                
                Spacer()
            }
        }
    }
}

public struct ActionRow: View {
    let icon: String
    let title: String
    var isDestructive: Bool = false
    let action: () -> Void
    
    public var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundColor(isDestructive ? GlassTheme.dangerRed : GlassTheme.accentEmerald)
                    .frame(width: 24)
                
                Text(title)
                    .font(.system(size: 16))
                    .foregroundColor(isDestructive ? GlassTheme.dangerRed : .white)
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.system(size: 14))
                    .foregroundColor(GlassTheme.textSecondary.opacity(0.4))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
    }
}

// MARK: - Nickname Modal View
public struct NicknameModalView: View {
    let friend: Friend
    @Environment(\.presentationMode) var presentationMode
    @State private var nicknameInput: String = ""
    @ObservedObject var db = DatabaseService.shared
    
    public init(friend: Friend) {
        self.friend = friend
        _nicknameInput = State(initialValue: friend.nickname ?? "")
    }
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            
            VStack(spacing: 20) {
                HStack {
                    Text("Set Nickname")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()
                    Button("Cancel") { presentationMode.wrappedValue.dismiss() }
                        .foregroundColor(GlassTheme.accentEmerald)
                }
                .padding(.top, 16)
                
                Text("Nicknames are only visible on this device and replace their display name.")
                    .font(.system(size: 14))
                    .foregroundColor(GlassTheme.textSecondary)
                
                TextField("Nickname for \(friend.name)", text: $nicknameInput)
                    .font(.system(size: 16))
                    .foregroundColor(.white)
                    .padding(14)
                    .background(Color.white.opacity(0.08))
                    .cornerRadius(12)
                
                Button(action: saveNickname) {
                    Text("Save")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(GlassTheme.accentEmerald)
                        .cornerRadius(14)
                }
                
                Spacer()
            }
            .padding(.horizontal, 20)
        }
    }
    
    private func saveNickname() {
        Task {
            try? await db.updateNickname(friend: friend, nickname: nicknameInput)
            await MainActor.run {
                presentationMode.wrappedValue.dismiss()
            }
        }
    }
}

// MARK: - Fullscreen New Chat Page View (New Group / 6-Digit Share / Enter Code)
public struct NewChatPageView: View {
    @Binding var isPresented: Bool
    var onFriendCreated: ((Friend) -> Void)? = nil
    
    @State private var mode: Int = 1 // 0: New Group, 1: Share 6-Digit Code, 2: Enter 6-Digit Code
    @State private var code: String = ""
    @State private var expiresAt: Double = 0
    @State private var inputCode: String = ""
    @State private var groupName: String = ""
    @State private var selectedMemberIds: Set<String> = []
    @State private var isBusy: Bool = false
    @State private var statusMessage: String = ""
    
    @ObservedObject var db = DatabaseService.shared
    
    public init(isPresented: Binding<Bool>, onFriendCreated: ((Friend) -> Void)? = nil) {
        self._isPresented = isPresented
        self.onFriendCreated = onFriendCreated
    }
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            
            VStack(spacing: 0) {
                // Header
                HStack {
                    Button("Done") { isPresented = false }
                        .foregroundColor(GlassTheme.accentEmerald)
                        .font(.system(size: 16, weight: .semibold))
                    Spacer()
                    Text(mode == 0 ? "New Group" : mode == 1 ? "Share 6-Digit Code" : "Enter 6-Digit Code")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()
                    Color.clear.frame(width: 40, height: 20)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                
                // Tabs
                HStack(spacing: 0) {
                    TabButton(title: "New Group", icon: "person.3.fill", isSelected: mode == 0) { mode = 0 }
                    TabButton(title: "Share Code", icon: "square.and.arrow.up.fill", isSelected: mode == 1) {
                        mode = 1
                        if code.isEmpty { generateCode() }
                    }
                    TabButton(title: "Enter Code", icon: "key.fill", isSelected: mode == 2) { mode = 2 }
                }
                .padding(3)
                .background(Color.white.opacity(0.08))
                .cornerRadius(12)
                .padding(.horizontal, 16)
                .padding(.bottom, 20)
                
                ScrollView {
                    VStack(spacing: 20) {
                        if mode == 0 {
                            // New Group Tab
                            VStack(alignment: .leading, spacing: 14) {
                                TextField("Group subject or name", text: $groupName)
                                    .font(.system(size: 16))
                                    .foregroundColor(.white)
                                    .padding(14)
                                    .background(Color.white.opacity(0.08))
                                    .cornerRadius(12)
                                
                                Text("SELECT MEMBERS (\(selectedMemberIds.count))")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(GlassTheme.textSecondary)
                                
                                ForEach(db.friends) { friend in
                                    HStack(spacing: 12) {
                                        Circle()
                                            .fill(GlassTheme.avatarColor(for: friend.id))
                                            .frame(width: 40, height: 40)
                                            .overlay(Text(friend.initials).foregroundColor(.white))
                                        
                                        Text(friend.displayName)
                                            .font(.system(size: 16))
                                            .foregroundColor(.white)
                                        
                                        Spacer()
                                        
                                        Image(systemName: selectedMemberIds.contains(friend.id) ? "checkmark.circle.fill" : "circle")
                                            .foregroundColor(selectedMemberIds.contains(friend.id) ? GlassTheme.accentEmerald : GlassTheme.textSecondary)
                                    }
                                    .contentShape(Rectangle())
                                    .onTapGesture {
                                        if selectedMemberIds.contains(friend.id) {
                                            selectedMemberIds.remove(friend.id)
                                        } else {
                                            selectedMemberIds.insert(friend.id)
                                        }
                                    }
                                }
                            }
                            .padding(.horizontal, 20)
                        } else if mode == 1 {
                            // Share 6-Digit Code Tab
                            VStack(spacing: 16) {
                                Text("Expires in 10 minutes · Single-use only")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(GlassTheme.accentEmerald)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 6)
                                    .background(GlassTheme.accentEmerald.opacity(0.15))
                                    .clipShape(Capsule())
                                
                                Text("Share this 6-digit code with your friend:")
                                    .font(.system(size: 15))
                                    .foregroundColor(GlassTheme.textSecondary)
                                
                                // 6-Digit Display
                                Text(code.isEmpty ? "••••••" : code)
                                    .font(.system(size: 42, weight: .bold, design: .monospaced))
                                    .foregroundColor(GlassTheme.accentEmerald)
                                    .padding(.vertical, 16)
                                    .padding(.horizontal, 28)
                                    .glassBackground(cornerRadius: 18)
                                
                                Button(action: copyCode) {
                                    HStack(spacing: 8) {
                                        Image(systemName: "doc.on.doc.fill")
                                        Text("Copy Code")
                                    }
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundColor(.black)
                                    .padding(.horizontal, 28)
                                    .padding(.vertical, 12)
                                    .background(GlassTheme.accentEmerald)
                                    .cornerRadius(12)
                                }
                                
                                Button(action: generateCode) {
                                    Text("Regenerate Code")
                                        .font(.system(size: 14))
                                        .foregroundColor(GlassTheme.textSecondary)
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.top, 20)
                        } else {
                            // Enter 6-Digit Code Tab
                            VStack(spacing: 20) {
                                Text("Enter your friend's 6-digit invite code:")
                                    .font(.system(size: 15))
                                    .foregroundColor(GlassTheme.textSecondary)
                                
                                TextField("e.g. 7K9P2X", text: $inputCode)
                                    .font(.system(size: 28, weight: .bold, design: .monospaced))
                                    .multilineTextAlignment(.center)
                                    .foregroundColor(GlassTheme.accentEmerald)
                                    .autocapitalization(.allCharacters)
                                    .disableAutocorrection(true)
                                    .padding(14)
                                    .background(Color.white.opacity(0.08))
                                    .cornerRadius(14)
                                
                                Button(action: acceptCode) {
                                    if isBusy {
                                        ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .black))
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 14)
                                            .background(GlassTheme.accentEmerald)
                                            .cornerRadius(14)
                                    } else {
                                        Text("Connect Securely")
                                            .font(.system(size: 16, weight: .bold))
                                            .foregroundColor(.black)
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 14)
                                            .background(GlassTheme.accentEmerald)
                                            .cornerRadius(14)
                                    }
                                }
                                .disabled(inputCode.trimmingCharacters(in: .whitespacesAndNewlines).count < 6 || isBusy)
                                
                                if !statusMessage.isEmpty {
                                    Text(statusMessage)
                                        .font(.system(size: 14))
                                        .foregroundColor(GlassTheme.dangerRed)
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.top, 20)
                        }
                    }
                }
            }
        }
        .onAppear {
            if mode == 1 && code.isEmpty {
                generateCode()
            }
        }
    }
    
    private func generateCode() {
        Task {
            if let result = try? await db.createInvite() {
                await MainActor.run {
                    self.code = result.code
                    self.expiresAt = result.expiresAt
                }
            }
        }
    }
    
    private func copyCode() {
        UIPasteboard.general.string = code
    }
    
    private func acceptCode() {
        isBusy = true
        statusMessage = ""
        Task {
            do {
                try await db.acceptInvite(rawCode: inputCode)
                await MainActor.run {
                    self.isBusy = false
                    self.isPresented = false
                    if let firstFriend = self.db.friends.first {
                        self.onFriendCreated?(firstFriend)
                    }
                }
            } catch {
                await MainActor.run {
                    self.statusMessage = error.localizedDescription
                    self.isBusy = false
                }
            }
        }
    }
}

public struct TabButton: View {
    let title: String
    let icon: String
    let isSelected: Bool
    let action: () -> Void
    
    public var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                Text(title)
                    .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
            }
            .foregroundColor(isSelected ? .black : GlassTheme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(isSelected ? GlassTheme.accentEmerald : Color.clear)
            .cornerRadius(10)
        }
    }
}
