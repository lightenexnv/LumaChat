import SwiftUI

// MARK: - Native You (Settings) View (Matches Web YouView & IMG_1631.PNG)
public struct YouView: View {
    @ObservedObject var auth = AuthService.shared
    @ObservedObject var db = DatabaseService.shared
    
    @State private var displayNameDraft: String = ""
    @State private var statusDraft: String = ""
    @State private var selectedTheme: String = "oled" // "oled" | "graphite" | "light"
    @State private var showingStatusModal: Bool = false
    @State private var showingStarredModal: Bool = false
    @State private var showingAccountModal: Bool = false
    @State private var showingPrivacyModal: Bool = false
    @State private var showingQRModal: Bool = false
    
    public init() {}
    
    private var currentUser: LumaUser {
        auth.currentUser ?? LumaUser(id: "user_you", displayName: "You")
    }
    
    public var body: some View {
        NavigationView {
            ZStack {
                GlassTheme.backgroundBlack.ignoresSafeArea()
                
                VStack(spacing: 0) {
                    // Header
                    HStack {
                        Text("You")
                            .font(.system(size: 34, weight: .bold))
                            .foregroundColor(GlassTheme.textPrimary)
                        Spacer()
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 10)
                    .padding(.bottom, 12)
                    
                    ScrollView {
                        VStack(spacing: 16) {
                            // Profile Hero Section matching IMG_1631.PNG
                            VStack(spacing: 12) {
                                // Speech Bubble Status
                                Button(action: { showingStatusModal = true }) {
                                    HStack(spacing: 6) {
                                        Text(currentUser.statusText)
                                            .font(.system(size: 14))
                                            .foregroundColor(.white)
                                    }
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .background(Color.white.opacity(0.1))
                                    .clipShape(Capsule())
                                }
                                
                                // Avatar with Camera Badge
                                ZStack(alignment: .bottomTrailing) {
                                    Circle()
                                        .fill(GlassTheme.avatarColor(for: currentUser.id))
                                        .frame(width: 84, height: 84)
                                        .overlay(
                                            Text(currentUser.initials)
                                                .font(.system(size: 34, weight: .bold))
                                                .foregroundColor(.white)
                                        )
                                    
                                    Circle()
                                        .fill(Color.white)
                                        .frame(width: 26, height: 26)
                                        .overlay(
                                            Image(systemName: "camera.fill")
                                                .font(.system(size: 13))
                                                .foregroundColor(.black)
                                        )
                                }
                                
                                // Display Name
                                HStack(spacing: 4) {
                                    Text(currentUser.displayName)
                                        .font(.system(size: 20, weight: .bold))
                                        .foregroundColor(.white)
                                    Image(systemName: "chevron.down")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundColor(GlassTheme.textSecondary)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .glassBackground(cornerRadius: 18)
                            .padding(.horizontal, 16)
                            
                            // Edit Name Row
                            HStack {
                                Text("Display Name")
                                    .font(.system(size: 15))
                                    .foregroundColor(GlassTheme.textSecondary)
                                    .frame(width: 100, alignment: .leading)
                                
                                TextField("Your name", text: $displayNameDraft)
                                    .font(.system(size: 16))
                                    .foregroundColor(.white)
                                
                                Button(action: saveDisplayName) {
                                    Text("Save")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(GlassTheme.accentEmerald)
                                }
                                .disabled(displayNameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .glassBackground(cornerRadius: 16)
                            .padding(.horizontal, 16)
                            
                            // Starred Messages Cell
                            Button(action: { showingStarredModal = true }) {
                                HStack(spacing: 14) {
                                    ZStack {
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Color(hex: "FFCC00"))
                                            .frame(width: 30, height: 30)
                                        Image(systemName: "star.fill")
                                            .font(.system(size: 15))
                                            .foregroundColor(.white)
                                    }
                                    
                                    Text("Starred Messages")
                                        .font(.system(size: 16))
                                        .foregroundColor(.white)
                                    
                                    Spacer()
                                    
                                    Text(db.starredMessageIds.isEmpty ? "None" : "\(db.starredMessageIds.count)")
                                        .font(.system(size: 14))
                                        .foregroundColor(GlassTheme.textSecondary)
                                    
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 13))
                                        .foregroundColor(GlassTheme.textSecondary.opacity(0.4))
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)
                            }
                            .glassBackground(cornerRadius: 16)
                            .padding(.horizontal, 16)
                            
                            // Main Settings Group
                            VStack(spacing: 0) {
                                // Account
                                SettingsCell(icon: "shield.fill", iconColor: Color.blue, title: "Account") {
                                    showingAccountModal = true
                                }
                                Divider().background(GlassTheme.separator).padding(.leading, 56)
                                
                                // Privacy
                                SettingsCell(icon: "lock.fill", iconColor: Color(hex: "00C896"), title: "Privacy") {
                                    showingPrivacyModal = true
                                }
                                Divider().background(GlassTheme.separator).padding(.leading, 56)
                                
                                // Appearance (Themes)
                                HStack(spacing: 14) {
                                    ZStack {
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(GlassTheme.accentEmerald)
                                            .frame(width: 30, height: 30)
                                        Image(systemName: "paintpalette.fill")
                                            .font(.system(size: 15))
                                            .foregroundColor(.white)
                                    }
                                    
                                    Text("Appearance")
                                        .font(.system(size: 16))
                                        .foregroundColor(.white)
                                    
                                    Spacer()
                                    
                                    // Theme pills
                                    HStack(spacing: 4) {
                                        ThemePill(title: "OLED", isSelected: selectedTheme == "oled") { selectedTheme = "oled" }
                                        ThemePill(title: "Graphite", isSelected: selectedTheme == "graphite") { selectedTheme = "graphite" }
                                        ThemePill(title: "Light", isSelected: selectedTheme == "light") { selectedTheme = "light" }
                                    }
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)
                                
                                Divider().background(GlassTheme.separator).padding(.leading, 56)
                                
                                // QR Share Code
                                SettingsCell(icon: "qrcode", iconColor: Color.purple, title: "Share My QR Code") {
                                    showingQRModal = true
                                }
                            }
                            .glassBackground(cornerRadius: 18)
                            .padding(.horizontal, 16)
                            
                            // Log Out Button
                            Button(action: handleLogout) {
                                HStack {
                                    Spacer()
                                    Text("Log Out")
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundColor(GlassTheme.dangerRed)
                                    Spacer()
                                }
                                .padding(.vertical, 14)
                            }
                            .glassBackground(cornerRadius: 16)
                            .padding(.horizontal, 16)
                            .padding(.top, 8)
                        }
                        .padding(.bottom, 90) // Padding for floating glass tab bar
                    }
                }
            }
            .navigationBarHidden(true)
            .onAppear {
                displayNameDraft = currentUser.displayName
                statusDraft = currentUser.statusText
            }
            .sheet(isPresented: $showingStatusModal) {
                StatusTextSheetView(isPresented: $showingStatusModal, status: $statusDraft)
            }
            .sheet(isPresented: $showingQRModal) {
                QRInviteSheetView(isPresented: $showingQRModal, username: currentUser.handle)
            }
            .sheet(isPresented: $showingAccountModal) {
                AccountModalView(user: currentUser)
            }
        }
    }
    
    private func saveDisplayName() {
        var updated = currentUser
        updated.displayName = displayNameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            try? await auth.saveUserProfile(updated)
        }
    }
    
    private func handleLogout() {
        Task {
            await db.setMyPresence(online: false)
            await MainActor.run {
                auth.logout()
            }
        }
    }
}

// MARK: - Settings Cell
public struct SettingsCell: View {
    let icon: String
    let iconColor: Color
    let title: String
    let action: () -> Void
    
    public var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(iconColor)
                        .frame(width: 30, height: 30)
                    Image(systemName: icon)
                        .font(.system(size: 15))
                        .foregroundColor(.white)
                }
                
                Text(title)
                    .font(.system(size: 16))
                    .foregroundColor(.white)
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.system(size: 13))
                    .foregroundColor(GlassTheme.textSecondary.opacity(0.4))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }
}

// MARK: - Theme Pill
public struct ThemePill: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void
    
    public var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11, weight: isSelected ? .bold : .medium))
                .foregroundColor(isSelected ? .black : GlassTheme.textSecondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(isSelected ? GlassTheme.accentEmerald : Color.white.opacity(0.08))
                .clipShape(Capsule())
        }
    }
}

// MARK: - Status Text Sheet View
public struct StatusTextSheetView: View {
    @Binding var isPresented: Bool
    @Binding var status: String
    @ObservedObject var auth = AuthService.shared
    
    private let shortcuts = ["🎯 Working", "☕ Coffee break", "🌴 Traveling", "🎧 Busy", "🔋 In a meeting", "💻 Coding", "😴 Sleeping", "⚡ Focused", "✨ Available"]
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            
            VStack(spacing: 16) {
                HStack {
                    Text("About / Status").font(.system(size: 18, weight: .bold)).foregroundColor(.white)
                    Spacer()
                    Button("Save") {
                        if var user = auth.currentUser {
                            user.statusText = status
                            Task { try? await auth.saveUserProfile(user) }
                        }
                        isPresented = false
                    }
                    .foregroundColor(GlassTheme.accentEmerald)
                    .font(.system(size: 16, weight: .semibold))
                }
                .padding()
                
                TextField("Status text", text: $status)
                    .font(.system(size: 16))
                    .foregroundColor(.white)
                    .padding(14)
                    .background(Color.white.opacity(0.08))
                    .cornerRadius(12)
                    .padding(.horizontal)
                
                VStack(alignment: .leading, spacing: 8) {
                    Text("SELECT YOUR STATUS").font(.system(size: 12, weight: .semibold)).foregroundColor(GlassTheme.textSecondary)
                    ForEach(shortcuts, id: \.self) { s in
                        HStack {
                            Text(s).foregroundColor(.white).font(.system(size: 15))
                            Spacer()
                            if status == s { Image(systemName: "checkmark").foregroundColor(GlassTheme.accentEmerald) }
                        }
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                        .onTapGesture { status = s }
                    }
                }
                .padding()
                .glassBackground(cornerRadius: 16)
                .padding(.horizontal)
                
                Spacer()
            }
        }
    }
}

// MARK: - Account Info Modal View
public struct AccountModalView: View {
    let user: LumaUser
    @Environment(\.presentationMode) var presentationMode
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            VStack(spacing: 16) {
                HStack {
                    Text("Account Info").font(.system(size: 18, weight: .bold)).foregroundColor(.white)
                    Spacer()
                    Button("Done") { presentationMode.wrappedValue.dismiss() }.foregroundColor(GlassTheme.accentEmerald)
                }
                .padding()
                
                VStack(spacing: 14) {
                    AccountRow(title: "Display Name", value: user.displayName)
                    AccountRow(title: "Handle", value: user.handle)
                    AccountRow(title: "User ID", value: user.id)
                    AccountRow(title: "Email", value: user.email.isEmpty ? "Connected" : user.email)
                }
                .padding()
                .glassBackground(cornerRadius: 16)
                .padding(.horizontal)
                
                Spacer()
            }
        }
    }
}

public struct AccountRow: View {
    let title: String
    let value: String
    
    public var body: some View {
        HStack {
            Text(title).foregroundColor(GlassTheme.textSecondary).font(.system(size: 15))
            Spacer()
            Text(value).foregroundColor(.white).font(.system(size: 14, weight: .medium))
        }
    }
}

// MARK: - QR Invite Sheet View
public struct QRInviteSheetView: View {
    @Binding var isPresented: Bool
    let username: String
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            
            VStack(spacing: 24) {
                HStack {
                    Spacer()
                    Button("Done") { isPresented = false }
                        .foregroundColor(GlassTheme.accentEmerald)
                        .font(.system(size: 16, weight: .semibold))
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                
                VStack(spacing: 12) {
                    Text("Share Your Profile")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(GlassTheme.textPrimary)
                    
                    Text("Friends can scan this code to connect directly via end-to-end encryption.")
                        .font(.system(size: 14))
                        .foregroundColor(GlassTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 30)
                }
                
                // Frosted QR Card
                VStack(spacing: 16) {
                    Image(systemName: "qrcode")
                        .font(.system(size: 160))
                        .foregroundColor(.white)
                        .padding(24)
                    
                    Text(username)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(GlassTheme.accentEmerald)
                }
                .padding(24)
                .glassBackground(cornerRadius: 24)
                
                Spacer()
            }
        }
    }
}
