import SwiftUI
import AVFoundation

// MARK: - Tab Items
public enum TabItem: Int, CaseIterable {
    case chats = 0
    case calls = 1
    case you = 2
    
    public var title: String {
        switch self {
        case .chats: return "Chats"
        case .calls: return "Calls"
        case .you: return "You"
        }
    }
    
    public var icon: String {
        switch self {
        case .chats: return "bubble.left.and.bubble.right.fill"
        case .calls: return "phone.fill"
        case .you: return "person.crop.circle.fill"
        }
    }
}

// MARK: - Main Tab View with Gateway & Auth Gates
public struct MainTabView: View {
    @StateObject private var auth = AuthService.shared
    @StateObject private var db = DatabaseService.shared
    @StateObject private var webrtc = WebRTCService.shared
    
    @State private var isGatewayVerified: Bool = UserDefaults.standard.bool(forKey: "luma:verified-session")
    @State private var selectedTab: TabItem = .chats
    @State private var activeChatFriend: Friend? = nil
    
    public init() {}
    
    private var totalUnreadCount: Int {
        db.friends.reduce(0) { $0 + $1.unreadCount }
    }
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            
            if !isGatewayVerified {
                GatewayView {
                    isGatewayVerified = true
                }
                .transition(.opacity)
                .zIndex(9999)
            } else if !auth.isAuthenticated {
                // Authentication Screen (Email / Password Sign In & Sign Up)
                AuthScreenView()
                    .transition(.opacity)
            } else {
                // 3. Main Luma Application
                ZStack {
                    Group {
                        switch selectedTab {
                        case .chats:
                            ChatsView(activeFriend: $activeChatFriend)
                        case .calls:
                            CallsView()
                        case .you:
                            YouView()
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    
                    // Floating Liquid Glass Navigation Pill (Hidden when chat or call is open)
                    if activeChatFriend == nil && !webrtc.isCallActive {
                        VStack {
                            Spacer()
                            
                            HStack(spacing: 0) {
                                ForEach(TabItem.allCases, id: \.self) { tab in
                                    Button(action: {
                                        withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                                            selectedTab = tab
                                        }
                                    }) {
                                        VStack(spacing: 4) {
                                            ZStack(alignment: .topTrailing) {
                                                Image(systemName: tab.icon)
                                                    .font(.system(size: 21, weight: selectedTab == tab ? .semibold : .regular))
                                                    .foregroundColor(selectedTab == tab ? GlassTheme.accentEmerald : GlassTheme.textSecondary)
                                                
                                                if tab == .chats && totalUnreadCount > 0 {
                                                    Text("\(totalUnreadCount)")
                                                        .font(.system(size: 10, weight: .bold))
                                                        .foregroundColor(.black)
                                                        .padding(.horizontal, 5)
                                                        .padding(.vertical, 2)
                                                        .background(GlassTheme.accentEmerald)
                                                        .clipShape(Capsule())
                                                        .offset(x: 12, y: -6)
                                                }
                                            }
                                            
                                            Text(tab.title)
                                                .font(.system(size: 11, weight: selectedTab == tab ? .semibold : .medium))
                                                .foregroundColor(selectedTab == tab ? GlassTheme.accentEmerald : GlassTheme.textSecondary)
                                        }
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 8)
                                    }
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 6)
                            .background(.ultraThinMaterial)
                            .clipShape(Capsule())
                            .overlay(
                                Capsule()
                                    .stroke(GlassTheme.glassBorder, lineWidth: 1)
                            )
                            .shadow(color: Color.black.opacity(0.45), radius: 20, x: 0, y: 10)
                            .padding(.horizontal, 36)
                            .padding(.bottom, 16)
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    
                    // Active Fullscreen Chat View (Takes entire screen, perfectly hides bottom nav bar)
                    if let friend = activeChatFriend {
                        ChatDetailView(friend: friend, onDismiss: {
                            withAnimation(.easeInOut(duration: 0.25)) {
                                activeChatFriend = nil
                            }
                        })
                        .transition(.move(edge: .trailing))
                        .zIndex(60)
                    }
                    
                    // Incoming Call Overlay Alert (Matches WhatsApp incoming banner)
                    if let incoming = webrtc.incomingCall, !webrtc.isCallActive {
                        IncomingCallBannerView(
                            call: incoming,
                            onAccept: {
                                withAnimation {
                                    webrtc.acceptIncomingCall(incoming)
                                }
                            },
                            onDecline: {
                                withAnimation {
                                    webrtc.declineIncomingCall(incoming.id)
                                }
                            }
                        )
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .zIndex(90)
                    }
                    
                    // Full-screen Call Overlay when in a call
                    if webrtc.isCallActive {
                        CallOverlayView()
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                            .zIndex(100)
                    }
                }
            }
        }
        .onAppear {
            if auth.isAuthenticated {
                webrtc.startIncomingCallWatcher()
                Task {
                    await db.setMyPresence(online: true)
                }
            }
        }
        .onChange(of: auth.isAuthenticated) { authenticated in
            if authenticated {
                webrtc.startIncomingCallWatcher()
                Task {
                    await db.setMyPresence(online: true)
                }
            }
        }
    }
}

// MARK: - Native Incoming Call Banner View
public struct IncomingCallBannerView: View {
    let call: IncomingCallModel
    let onAccept: () -> Void
    let onDecline: () -> Void
    
    public var body: some View {
        VStack {
            HStack(spacing: 14) {
                // Caller Avatar
                ZStack {
                    Circle()
                        .fill(GlassTheme.avatarColor(for: call.callerId))
                        .frame(width: 48, height: 48)
                    
                    if let photo = call.callerPhotoURL, let url = URL(string: photo) {
                        AsyncImage(url: url) { img in
                            img.resizable().scaledToFill()
                        } placeholder: {
                            Text(call.callerInitials)
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(.white)
                        }
                        .frame(width: 48, height: 48)
                        .clipShape(Circle())
                    } else {
                        Text(call.callerInitials)
                            .font(.system(size: 18, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
                
                VStack(alignment: .leading, spacing: 3) {
                    Text(call.callerName)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                    
                    HStack(spacing: 4) {
                        Image(systemName: call.kind == "video" ? "video.fill" : "phone.fill")
                            .font(.system(size: 11))
                            .foregroundColor(GlassTheme.accentEmerald)
                        Text(call.kind == "video" ? "Luma Video Call..." : "Luma Voice Call...")
                            .font(.system(size: 12))
                            .foregroundColor(GlassTheme.textSecondary)
                    }
                }
                
                Spacer()
                
                // Decline Button
                Button(action: onDecline) {
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 42, height: 42)
                        .background(GlassTheme.dangerRed)
                        .clipShape(Circle())
                }
                
                // Accept Button
                Button(action: onAccept) {
                    Image(systemName: call.kind == "video" ? "video.fill" : "phone.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 42, height: 42)
                        .background(GlassTheme.accentEmerald)
                        .clipShape(Circle())
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(GlassTheme.glassBorder, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.5), radius: 25, x: 0, y: 10)
            .padding(.horizontal, 16)
            .padding(.top, 50)
            
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.35).ignoresSafeArea())
    }
}

// MARK: - Native Authentication Screen (Matches Web AuthScreen)
public struct AuthScreenView: View {
    @ObservedObject var auth = AuthService.shared
    
    @State private var mode: Int = 0 // 0: Sign In, 1: Create Account
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var displayName: String = ""
    @State private var showPassword: Bool = false
    @State private var isBusy: Bool = false
    @State private var errorMessage: String = ""
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            
            ScrollView {
                VStack(spacing: 24) {
                    Spacer(minLength: 40)
                    
                    // Brand Logo & Title
                    VStack(spacing: 8) {
                        Image(systemName: "bubble.left.and.bubble.right.fill")
                            .font(.system(size: 46))
                            .foregroundColor(GlassTheme.accentEmerald)
                        
                        Text("LumaChat")
                            .font(.system(size: 32, weight: .bold))
                            .foregroundColor(GlassTheme.textPrimary)
                        
                        Text("Simple. Secure. Reliable messaging.")
                            .font(.system(size: 15))
                            .foregroundColor(GlassTheme.textSecondary)
                    }
                    
                    // Mode Tabs (Sign In vs Create Account)
                    HStack(spacing: 0) {
                        Button(action: { mode = 0; errorMessage = "" }) {
                            Text("Sign In")
                                .font(.system(size: 15, weight: mode == 0 ? .semibold : .regular))
                                .foregroundColor(mode == 0 ? .white : GlassTheme.textSecondary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(mode == 0 ? Color.white.opacity(0.12) : Color.clear)
                                .cornerRadius(12)
                        }
                        
                        Button(action: { mode = 1; errorMessage = "" }) {
                            Text("Create Account")
                                .font(.system(size: 15, weight: mode == 1 ? .semibold : .regular))
                                .foregroundColor(mode == 1 ? .white : GlassTheme.textSecondary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(mode == 1 ? Color.white.opacity(0.12) : Color.clear)
                                .cornerRadius(12)
                        }
                    }
                    .padding(3)
                    .background(Color.white.opacity(0.06))
                    .cornerRadius(14)
                    .padding(.horizontal, 24)
                    
                    // Form Fields
                    VStack(spacing: 14) {
                        if mode == 1 {
                            TextField("Display Name", text: $displayName)
                                .font(.system(size: 16))
                                .foregroundColor(.white)
                                .padding(14)
                                .background(Color.white.opacity(0.08))
                                .cornerRadius(12)
                        }
                        
                        TextField("Email Address", text: $email)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .font(.system(size: 16))
                            .foregroundColor(.white)
                            .padding(14)
                            .background(Color.white.opacity(0.08))
                            .cornerRadius(12)
                        
                        HStack {
                            if showPassword {
                                TextField("Password", text: $password)
                                    .autocapitalization(.none)
                                    .disableAutocorrection(true)
                                    .foregroundColor(.white)
                            } else {
                                SecureField("Password", text: $password)
                                    .foregroundColor(.white)
                            }
                            
                            Button(action: { showPassword.toggle() }) {
                                Image(systemName: showPassword ? "eye.slash" : "eye")
                                    .foregroundColor(GlassTheme.textSecondary)
                            }
                        }
                        .padding(14)
                        .background(Color.white.opacity(0.08))
                        .cornerRadius(12)
                    }
                    .padding(.horizontal, 24)
                    
                    // Error Notice
                    if !errorMessage.isEmpty {
                        Text(errorMessage)
                            .font(.system(size: 13))
                            .foregroundColor(GlassTheme.dangerRed)
                            .padding(.horizontal, 24)
                    }
                    
                    // Submit Button
                    Button(action: submitAuth) {
                        if isBusy {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .black))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(GlassTheme.accentEmerald)
                                .cornerRadius(14)
                        } else {
                            Text(mode == 0 ? "Sign In" : "Create Account")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundColor(.black)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(GlassTheme.accentEmerald)
                                .cornerRadius(14)
                        }
                    }
                    .disabled(isBusy || email.isEmpty || password.isEmpty)
                    .padding(.horizontal, 24)
                    
                    // Security Note
                    HStack(spacing: 6) {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 12))
                        Text("End-to-end encrypted · Private by design")
                            .font(.system(size: 12))
                    }
                    .foregroundColor(GlassTheme.textMuted)
                    .padding(.top, 16)
                    
                    Spacer()
                }
            }
        }
    }
    
    private func submitAuth() {
        isBusy = true
        errorMessage = ""
        
        Task {
            do {
                if mode == 0 {
                    try await auth.signIn(email: email, password: password)
                } else {
                    try await auth.signUp(email: email, password: password, displayName: displayName)
                }
                await MainActor.run {
                    self.isBusy = false
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.isBusy = false
                }
            }
        }
    }
}
