import SwiftUI

// MARK: - Native Calls View (Matches Web CallsView & IMG_1632.PNG)
public struct CallsView: View {
    @ObservedObject var db = DatabaseService.shared
    @ObservedObject var webrtc = WebRTCService.shared
    
    public init() {}
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            
            VStack(spacing: 0) {
                // Header
                HStack {
                    Text("Calls")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundColor(GlassTheme.textPrimary)
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.top, 10)
                .padding(.bottom, 16)
                
                // 4 Round Action Buttons matching Web & IMG_1632.PNG
                HStack(spacing: 24) {
                    QuickCallAction(icon: "phone.fill", title: "Call") {
                        // Quick call first friend if available
                        if let first = db.friends.first {
                            webrtc.startCall(with: first, isVideo: false)
                        }
                    }
                    
                    QuickCallAction(icon: "calendar", title: "Schedule") {}
                    
                    QuickCallAction(icon: "circle.grid.3x3.fill", title: "Keypad") {}
                    
                    QuickCallAction(icon: "heart.fill", title: "Favourites") {}
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
                
                // "Recent" Section Header
                HStack {
                    Text("Recent")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundColor(GlassTheme.textPrimary)
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
                
                // Call History List
                if db.callHistory.isEmpty {
                    VStack(spacing: 12) {
                        Spacer()
                        Image(systemName: "phone")
                            .font(.system(size: 36))
                            .foregroundColor(GlassTheme.textSecondary)
                        Text("No recent calls")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(GlassTheme.textPrimary)
                        Text("Stay connected with end-to-end encrypted audio and video calls.")
                            .font(.system(size: 14))
                            .foregroundColor(GlassTheme.textSecondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                        Spacer()
                    }
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(db.callHistory) { record in
                                CallRecordRow(record: record) {
                                    // Quick redial
                                    if let friend = db.friends.first(where: { $0.id == record.friendId }) {
                                        webrtc.startCall(with: friend, isVideo: record.kind == "video")
                                    }
                                }
                                
                                Divider()
                                    .background(GlassTheme.separator)
                                    .padding(.leading, 70)
                            }
                        }
                        .padding(.bottom, 90) // Padding for floating glass bottom pill
                    }
                }
            }
        }
    }
}

// MARK: - Quick Call Action Circle
public struct QuickCallAction: View {
    let icon: String
    let title: String
    let action: () -> Void
    
    public var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(Color.white.opacity(0.1))
                        .frame(width: 58, height: 58)
                    
                    Image(systemName: icon)
                        .font(.system(size: 22))
                        .foregroundColor(GlassTheme.accentEmerald)
                }
                
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(GlassTheme.textPrimary)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Call Record Row
public struct CallRecordRow: View {
    let record: CallRecord
    let onRedial: () -> Void
    
    private var isMissed: Bool {
        record.outcome != "completed"
    }
    
    private var formattedTime: String {
        let date = Date(timeIntervalSince1970: record.initiatedAt / 1000)
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
    
    public var body: some View {
        HStack(spacing: 14) {
            // Avatar
            ZStack {
                Circle()
                    .fill(GlassTheme.avatarColor(for: record.friendId))
                    .frame(width: 44, height: 44)
                
                if let photo = record.friendPhotoURL, let url = URL(string: photo) {
                    AsyncImage(url: url) { img in
                        img.resizable().scaledToFill()
                    } placeholder: {
                        Text(record.friendInitials)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundColor(.white)
                    }
                    .frame(width: 44, height: 44)
                    .clipShape(Circle())
                } else {
                    Text(record.friendInitials)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.white)
                }
            }
            
            // Name & Description
            VStack(alignment: .leading, spacing: 3) {
                Text(record.friendName)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(isMissed ? GlassTheme.dangerRed : GlassTheme.textPrimary)
                
                HStack(spacing: 6) {
                    if isMissed {
                        Image(systemName: "phone.down.fill")
                            .font(.system(size: 12))
                            .foregroundColor(GlassTheme.dangerRed)
                    } else if record.direction == "incoming" {
                        Image(systemName: "arrow.down.left")
                            .font(.system(size: 12))
                            .foregroundColor(GlassTheme.accentEmerald)
                    } else {
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 12))
                            .foregroundColor(GlassTheme.textSecondary)
                    }
                    
                    Text("\(record.kind == "video" ? "Video" : "Audio") · \(isMissed ? (record.outcome == "declined" ? "Declined" : "Missed") : "\(record.durationSeconds)s")")
                        .font(.system(size: 13))
                        .foregroundColor(GlassTheme.textSecondary)
                }
            }
            
            Spacer()
            
            Text(formattedTime)
                .font(.system(size: 13))
                .foregroundColor(GlassTheme.textSecondary)
            
            // Info Circle
            Button(action: onRedial) {
                Image(systemName: "info.circle")
                    .font(.system(size: 20))
                    .foregroundColor(GlassTheme.accentEmerald)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .onTapGesture {
            onRedial()
        }
    }
}
