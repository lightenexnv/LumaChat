import SwiftUI

@main
struct LumaApp: App {
    @StateObject private var authService = AuthService.shared
    @StateObject private var databaseService = DatabaseService.shared
    @StateObject private var soundManager = SoundManager.shared
    @StateObject private var webrtcService = WebRTCService.shared
    @StateObject private var callManager = CallManager.shared
    
    init() {
        configureAppearance()
    }
    
    var body: some Scene {
        WindowGroup {
            MainTabView()
                .environmentObject(authService)
                .environmentObject(databaseService)
                .environmentObject(soundManager)
                .environmentObject(webrtcService)
                .environmentObject(callManager)
                .preferredColorScheme(.dark)
        }
    }
    
    private func configureAppearance() {
        // Configure transparent nav bars for true glass effect
        let navBarAppearance = UINavigationBarAppearance()
        navBarAppearance.configureWithTransparentBackground()
        navBarAppearance.backgroundColor = .clear
        navBarAppearance.titleTextAttributes = [.foregroundColor: UIColor.white]
        navBarAppearance.largeTitleTextAttributes = [.foregroundColor: UIColor.white]
        
        UINavigationBar.appearance().standardAppearance = navBarAppearance
        UINavigationBar.appearance().compactAppearance = navBarAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navBarAppearance
        
        // Disable default UITabBar since we render a custom floating glass pill
        UITabBar.appearance().isHidden = true
    }
}
