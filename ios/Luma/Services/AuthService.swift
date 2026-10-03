import Foundation
import Combine

// MARK: - Auth State
public enum AuthState {
    case unauthenticated
    case authenticated(LumaUser)
    case loading
    case error(String)
}

public final class AuthService: ObservableObject {
    public static let shared = AuthService()
    
    // Live Firebase Project Configuration (matches web .env.local)
    public let apiKey = "AIzaSyC0rRivbkEP7Pc-czm-_pdwHspnkuPDLqg"
    public let projectId = "luma-1d1cf"
    public let databaseURL = "https://luma-1d1cf-default-rtdb.firebaseio.com"
    public let storageBucket = "luma-1d1cf.firebasestorage.app"
    
    @Published public var state: AuthState = .unauthenticated
    @Published public var isAuthenticated: Bool = false
    @Published public var currentUser: LumaUser?
    @Published public var idToken: String?
    @Published public var refreshToken: String?
    
    private let tokenKey = "luma_id_token"
    private let refreshTokenKey = "luma_refresh_token"
    private let uidKey = "luma_user_uid"
    private let userProfileKey = "luma_user_profile"
    
    private init() {
        restoreSession()
    }
    
    // MARK: - Restore Cached Session
    public func restoreSession() {
        if let token = UserDefaults.standard.string(forKey: tokenKey),
           UserDefaults.standard.string(forKey: uidKey) != nil,
           let profileData = UserDefaults.standard.data(forKey: userProfileKey),
           let profile = try? JSONDecoder().decode(LumaUser.self, from: profileData) {
            self.idToken = token
            self.refreshToken = UserDefaults.standard.string(forKey: refreshTokenKey)
            self.currentUser = profile
            self.state = .authenticated(profile)
            self.isAuthenticated = true
            
            // Refresh token in background
            refreshIdToken()
        } else {
            self.state = .unauthenticated
            self.isAuthenticated = false
        }
    }
    
    // MARK: - Sign In with Email & Password (Real Firebase Auth REST API)
    public func signIn(email: String, password: String) async throws {
        await MainActor.run { self.state = .loading }
        
        let endpoint = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=\(apiKey)"
        guard let url = URL(string: endpoint) else { throw URLError(.badURL) }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
            "password": password,
            "returnSecureToken": true
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        
        if httpResponse.statusCode != 200 {
            let errorObj = json["error"] as? [String: Any]
            let message = errorObj?["message"] as? String ?? "Authentication failed."
            let friendlyMessage = parseAuthError(message)
            await MainActor.run { self.state = .error(friendlyMessage) }
            throw NSError(domain: "FirebaseAuth", code: httpResponse.statusCode, userInfo: [NSLocalizedDescriptionKey: friendlyMessage])
        }
        
        guard let idToken = json["idToken"] as? String,
              let refreshToken = json["refreshToken"] as? String,
              let localId = json["localId"] as? String else {
            throw NSError(domain: "FirebaseAuth", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid server response"])
        }
        
        let emailVal = json["email"] as? String ?? email
        let displayName = (json["displayName"] as? String)?.isEmpty == false ? (json["displayName"] as! String) : (emailVal.components(separatedBy: "@").first?.capitalized ?? "User")
        
        // Fetch or create profile in Firestore
        let user = try await ensureUserProfile(uid: localId, email: emailVal, displayName: displayName, idToken: idToken)
        
        await MainActor.run {
            self.idToken = idToken
            self.refreshToken = refreshToken
            self.currentUser = user
            self.state = .authenticated(user)
            self.isAuthenticated = true
            
            UserDefaults.standard.set(idToken, forKey: self.tokenKey)
            UserDefaults.standard.set(refreshToken, forKey: self.refreshTokenKey)
            UserDefaults.standard.set(localId, forKey: self.uidKey)
            if let enc = try? JSONEncoder().encode(user) {
                UserDefaults.standard.set(enc, forKey: self.userProfileKey)
            }
        }
    }
    
    // MARK: - Sign Up with Email & Password (Real Firebase Auth REST API)
    public func signUp(email: String, password: String, displayName: String) async throws {
        await MainActor.run { self.state = .loading }
        
        let endpoint = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=\(apiKey)"
        guard let url = URL(string: endpoint) else { throw URLError(.badURL) }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let cleanEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanName = displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? (cleanEmail.components(separatedBy: "@").first?.capitalized ?? "User") : displayName
        
        let body: [String: Any] = [
            "email": cleanEmail,
            "password": password,
            "returnSecureToken": true
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        
        if httpResponse.statusCode != 200 {
            let errorObj = json["error"] as? [String: Any]
            let message = errorObj?["message"] as? String ?? "Registration failed."
            let friendlyMessage = parseAuthError(message)
            await MainActor.run { self.state = .error(friendlyMessage) }
            throw NSError(domain: "FirebaseAuth", code: httpResponse.statusCode, userInfo: [NSLocalizedDescriptionKey: friendlyMessage])
        }
        
        guard let idToken = json["idToken"] as? String,
              let refreshToken = json["refreshToken"] as? String,
              let localId = json["localId"] as? String else {
            throw NSError(domain: "FirebaseAuth", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid server response"])
        }
        
        // Create initial profile in Firestore
        let user = try await ensureUserProfile(uid: localId, email: cleanEmail, displayName: cleanName, idToken: idToken)
        
        await MainActor.run {
            self.idToken = idToken
            self.refreshToken = refreshToken
            self.currentUser = user
            self.state = .authenticated(user)
            self.isAuthenticated = true
            
            UserDefaults.standard.set(idToken, forKey: self.tokenKey)
            UserDefaults.standard.set(refreshToken, forKey: self.refreshTokenKey)
            UserDefaults.standard.set(localId, forKey: self.uidKey)
            if let enc = try? JSONEncoder().encode(user) {
                UserDefaults.standard.set(enc, forKey: self.userProfileKey)
            }
        }
    }
    
    // MARK: - Refresh ID Token
    public func refreshIdToken() {
        guard let refresh = self.refreshToken ?? UserDefaults.standard.string(forKey: refreshTokenKey) else { return }
        
        Task {
            let endpoint = "https://securetoken.googleapis.com/v1/token?key=\(apiKey)"
            guard let url = URL(string: endpoint) else { return }
            
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = "grant_type=refresh_token&refresh_token=\(refresh)".data(using: .utf8)
            
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                if let http = response as? HTTPURLResponse, http.statusCode == 200,
                   let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let newIdToken = json["id_token"] as? String {
                    await MainActor.run {
                        self.idToken = newIdToken
                        UserDefaults.standard.set(newIdToken, forKey: self.tokenKey)
                        if let newRefresh = json["refresh_token"] as? String {
                            self.refreshToken = newRefresh
                            UserDefaults.standard.set(newRefresh, forKey: self.refreshTokenKey)
                        }
                    }
                }
            } catch {
                print("Failed to refresh token: \(error)")
            }
        }
    }
    
    // MARK: - Get Valid ID Token
    public func getOrRefreshIdToken() async -> String? {
        if let token = self.idToken, !token.isEmpty {
            return token
        }
        if let token = UserDefaults.standard.string(forKey: tokenKey), !token.isEmpty {
            return token
        }
        guard let refresh = self.refreshToken ?? UserDefaults.standard.string(forKey: refreshTokenKey) else { return nil }
        let endpoint = "https://securetoken.googleapis.com/v1/token?key=\(apiKey)"
        guard let url = URL(string: endpoint) else { return nil }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = "grant_type=refresh_token&refresh_token=\(refresh)".data(using: .utf8)
        
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let newIdToken = json["id_token"] as? String else {
            return nil
        }
        
        await MainActor.run {
            self.idToken = newIdToken
            UserDefaults.standard.set(newIdToken, forKey: self.tokenKey)
            if let newRefresh = json["refresh_token"] as? String {
                self.refreshToken = newRefresh
                UserDefaults.standard.set(newRefresh, forKey: self.refreshTokenKey)
            }
        }
        return newIdToken
    }
    
    // MARK: - Firestore Profile Sync (/users/{uid})
    public func ensureUserProfile(uid: String, email: String, displayName: String, idToken: String) async throws -> LumaUser {
        let docUrl = "https://firestore.googleapis.com/v1/projects/\(projectId)/databases/(default)/documents/users/\(uid)"
        guard let url = URL(string: docUrl) else { throw URLError(.badURL) }
        
        var getReq = URLRequest(url: url)
        getReq.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        
        if let (data, resp) = try? await URLSession.shared.data(for: getReq),
           let http = resp as? HTTPURLResponse, http.statusCode == 200,
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let fields = json["fields"] as? [String: Any] {
            
            // Document exists, parse fields
            let fetchedName = (fields["displayName"] as? [String: Any])?["stringValue"] as? String ?? displayName
            let fetchedHandle = (fields["handle"] as? [String: Any])?["stringValue"] as? String ?? "@\(displayName.lowercased())"
            let fetchedInitials = (fields["initials"] as? [String: Any])?["stringValue"] as? String ?? String(fetchedName.prefix(1)).uppercased()
            let fetchedColor = (fields["color"] as? [String: Any])?["stringValue"] as? String ?? "#25D366"
            let fetchedPhoto = (fields["photoURL"] as? [String: Any])?["stringValue"] as? String
            let fetchedStatus = (fields["statusText"] as? [String: Any])?["stringValue"] as? String ?? "Express yourself in emoji!"
            
            return LumaUser(
                id: uid,
                email: email,
                displayName: fetchedName,
                handle: fetchedHandle,
                initials: fetchedInitials,
                color: fetchedColor,
                photoURL: fetchedPhoto,
                statusText: fetchedStatus
            )
        }
        
        // Document does not exist: Create it matching Firestore rules
        let now = Date().timeIntervalSince1970 * 1000
        let initials = String(displayName.prefix(1)).uppercased()
        let handle = "@\(displayName.lowercased().replacingOccurrences(of: " ", with: "_"))"
        let colorHex = "#25D366"
        
        var createReq = URLRequest(url: url)
        createReq.httpMethod = "PATCH"
        createReq.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        createReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let fieldsPayload: [String: Any] = [
            "fields": [
                "uid": ["stringValue": uid],
                "displayName": ["stringValue": displayName],
                "handle": ["stringValue": handle],
                "initials": ["stringValue": initials],
                "color": ["stringValue": colorHex],
                "statusText": ["stringValue": "Express yourself in emoji!"],
                "createdAt": ["integerValue": "\(Int(now))"],
                "lastSeen": ["integerValue": "\(Int(now))"]
            ]
        ]
        createReq.httpBody = try JSONSerialization.data(withJSONObject: fieldsPayload)
        _ = try? await URLSession.shared.data(for: createReq)
        
        return LumaUser(
            id: uid,
            email: email,
            displayName: displayName,
            handle: handle,
            initials: initials,
            color: colorHex,
            photoURL: nil,
            statusText: "Express yourself in emoji!",
            createdAt: now,
            lastSeen: now
        )
    }
    
    // MARK: - Save Profile Changes
    public func saveUserProfile(_ profile: LumaUser) async throws {
        guard let token = idToken, !profile.id.isEmpty else { return }
        let docUrl = "https://firestore.googleapis.com/v1/projects/\(projectId)/databases/(default)/documents/users/\(profile.id)?updateMask.fieldPaths=displayName&updateMask.fieldPaths=statusText"
        guard let url = URL(string: docUrl) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "fields": [
                "displayName": ["stringValue": profile.displayName],
                "statusText": ["stringValue": profile.statusText]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        _ = try await URLSession.shared.data(for: request)
        
        await MainActor.run {
            self.currentUser = profile
            if let enc = try? JSONEncoder().encode(profile) {
                UserDefaults.standard.set(enc, forKey: self.userProfileKey)
            }
        }
    }
    
    // MARK: - Sign Out
    public func logout() {
        UserDefaults.standard.removeObject(forKey: tokenKey)
        UserDefaults.standard.removeObject(forKey: refreshTokenKey)
        UserDefaults.standard.removeObject(forKey: uidKey)
        UserDefaults.standard.removeObject(forKey: userProfileKey)
        
        self.idToken = nil
        self.refreshToken = nil
        self.currentUser = nil
        self.isAuthenticated = false
        self.state = .unauthenticated
    }
    
    private func parseAuthError(_ message: String) -> String {
        if message.contains("EMAIL_NOT_FOUND") || message.contains("INVALID_PASSWORD") || message.contains("INVALID_LOGIN_CREDENTIALS") {
            return "Incorrect email or password. Please try again."
        }
        if message.contains("EMAIL_EXISTS") {
            return "An account with this email address already exists."
        }
        if message.contains("WEAK_PASSWORD") {
            return "Password should be at least 6 characters."
        }
        if message.contains("INVALID_EMAIL") {
            return "Please enter a valid email address."
        }
        if message.contains("USER_DISABLED") {
            return "This user account has been disabled."
        }
        return message
    }
}
