import SwiftUI

// MARK: - Native iOS Liquid Glass Design System
public struct GlassTheme {
    // Backgrounds
    public static let bgPrimary = Color(red: 0.0, green: 0.0, blue: 0.0) // OLED Black
    public static let bgSecondary = Color(red: 0.11, green: 0.11, blue: 0.12) // System Gray 6 Dark
    public static let bgTertiary = Color(red: 0.17, green: 0.17, blue: 0.18)
    public static let backgroundBlack = Color.black
    
    // WhatsApp Accents & Indicators
    public static let accentGreen = Color(red: 0.145, green: 0.827, blue: 0.4) // #25D366
    public static let accentEmerald = Color(red: 0.145, green: 0.827, blue: 0.4)
    public static let accentEmeraldDark = Color(red: 0.07, green: 0.55, blue: 0.3)
    public static let tickBlue = Color(red: 0.325, green: 0.741, blue: 0.922)
    public static let dangerRed = Color(red: 1.0, green: 0.231, blue: 0.188)
    public static let lockYellow = Color(red: 1.0, green: 0.84, blue: 0.04)
    public static let accentGold = Color(red: 1.0, green: 0.84, blue: 0.04)
    
    // Message Bubble Colors (WhatsApp iOS Parity)
    public static let bubbleOutgoing = Color(red: 0.0, green: 0.36, blue: 0.29) // Emerald WhatsApp bubble
    public static let bubbleIncoming = Color(red: 0.125, green: 0.173, blue: 0.2) // Dark graphite slate bubble
    
    // Text Colors
    public static let textPrimary = Color.white
    public static let textSecondary = Color(white: 0.65)
    public static let textMuted = Color(white: 0.45)
    
    // Glass Borders, Highlights & Separators
    public static let glassBorder = Color.white.opacity(0.12)
    public static let glassHighlight = Color.white.opacity(0.22)
    public static let separator = Color.white.opacity(0.1)
    
    // Deterministic pastel avatar colors matching web `colorForUid()`
    public static let avatarPastels: [Color] = [
        Color(hex: "dca6bf"),
        Color(hex: "9cc8bc"),
        Color(hex: "a8b9d5"),
        Color(hex: "d7b18e"),
        Color(hex: "b3a2ca")
    ]
    
    public static func avatarColor(for uid: String) -> Color {
        if uid.isEmpty { return avatarPastels[0] }
        let sum = uid.utf8.reduce(0) { $0 + Int($1) }
        return avatarPastels[abs(sum) % avatarPastels.count]
    }
}

// MARK: - Color Hex Initializer Extension
public extension Color {
    init(hex: String) {
        let hexClean = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hexClean).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hexClean.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - Native Liquid Glass View Modifiers
public struct LiquidGlassModifier: ViewModifier {
    var cornerRadius: CGFloat = 20
    var material: Material = .ultraThinMaterial
    var borderOpacity: Double = 0.15
    var shadowRadius: CGFloat = 16
    
    public func body(content: Content) -> some View {
        content
            .background(material)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(borderOpacity * 1.6),
                                Color.white.opacity(borderOpacity * 0.4),
                                Color.black.opacity(0.3)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
            .shadow(color: Color.black.opacity(0.35), radius: shadowRadius, x: 0, y: shadowRadius * 0.5)
    }
}

public struct LiquidGlassCapsuleModifier: ViewModifier {
    var material: Material = .ultraThinMaterial
    var borderOpacity: Double = 0.16
    var shadowRadius: CGFloat = 16
    
    public func body(content: Content) -> some View {
        content
            .background(material)
            .clipShape(Capsule(style: .continuous))
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(borderOpacity * 1.6),
                                Color.white.opacity(borderOpacity * 0.4),
                                Color.black.opacity(0.3)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
            .shadow(color: Color.black.opacity(0.4), radius: shadowRadius, x: 0, y: shadowRadius * 0.5)
    }
}

public struct GlassPillButton: View {
    let icon: String
    let size: CGFloat
    let action: () -> Void
    
    public init(icon: String, size: CGFloat = 40, action: @escaping () -> Void) {
        self.icon = icon
        self.size = size
        self.action = action
    }
    
    public var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: size, height: size)
                .background(.ultraThinMaterial)
                .clipShape(Circle())
                .overlay(
                    Circle().stroke(GlassTheme.glassBorder, lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(0.3), radius: 6, y: 3)
        }
        .buttonStyle(.plain)
    }
}

public struct GlassBackButton: View {
    let action: () -> Void
    
    public init(action: @escaping () -> Void) {
        self.action = action
    }
    
    public var body: some View {
        Button(action: action) {
            Image(systemName: "chevron.left")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 36, height: 36)
                .background(.ultraThinMaterial)
                .clipShape(Circle())
                .overlay(
                    Circle().stroke(GlassTheme.glassBorder, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

public extension View {
    func lumaGlass(cornerRadius: CGFloat = 20, material: Material = .ultraThinMaterial, borderOpacity: Double = 0.15) -> some View {
        self.modifier(LiquidGlassModifier(cornerRadius: cornerRadius, material: material, borderOpacity: borderOpacity))
    }
    
    func glassBackground(cornerRadius: CGFloat = 20) -> some View {
        self.modifier(LiquidGlassModifier(cornerRadius: cornerRadius))
    }
    
    func glassCapsule() -> some View {
        self.modifier(LiquidGlassCapsuleModifier())
    }
}
