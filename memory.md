# Luma — Memory & Technical Knowledge Base

## 1. Project Overview & Identity
- **Repository**: `lightenexnv/Luma` (`d:\Coding\WebchatCode`)
- **App Name**: Luma (Luma Connect)
- **Target Platforms**: Web (React 19/TS), iOS (Swift/SwiftUI), Android (Kotlin/Jetpack Compose).
- **Core Features**: 1:1 E2EE encrypted chat, voice/video calling, file sharing up to 100MB, invite/pairing engine.

---

## 2. Firebase Infrastructure & Endpoints
- **Firebase Project ID**: `luma-1d1cf`
- **Realtime Database**: `https://luma-1d1cf-default-rtdb.firebaseio.com`
- **Storage Bucket**: `luma-1d1cf.firebasestorage.app`
- **Auth Providers**: Google Sign-In, Email & Password
- **Authorized Domains**: `localhost`, `luma-1d1cf.web.app`, `luma-1d1cf.firebaseapp.com`, `luma-delta-navy.vercel.app`

---

## 3. Past Critical Bugs & Root Causes Discovered in Audit

### Bug 1: Cross-Platform Video Call Not Received / Not Connecting
- **Root Cause**:
  1. The legacy iOS implementation in `WebRTCService.swift` was NOT using the real WebRTC library. Instead, it was writing hardcoded fake SDP strings (`127.0.0.1`) and simulating timers.
  2. The iOS Xcode project (`Luma.xcodeproj`) had NO GoogleWebRTC framework or package linked.
  3. Realtime Database security rules require `callerProfile` (with `name`, `initials`, `color`) on writes to `/calls/{callId}` and `/incomingCalls/{calleeId}/{callId}`. When these were missing or truncated, RTDB silently rejected the write with permission denied, causing the callee on Web to never receive incoming call alerts.
- **Permanent Solution**:
  - Integrate real native `GoogleWebRTC` framework into iOS project.
  - Standardize signaling contracts so both Web and iOS write valid RTDB payloads adhering strictly to `database.rules.json`.

### Bug 2: Chat Not Opening / Blank Screen on Connection
- **Root Cause**:
  - In `ChatsView.swift`, clicking a contact selected the friend but failed to push the navigation destination properly or had stale binding issues.
  - Nav bar remained visible on top of chat detail because `toolbar(.hidden, for: .tabBar)` or `.navigationBarHidden(true)` was not correctly applied across navigation stacks.
  - Profile sync bug: Initial connection showed "New Connection" because local contact record had not yet populated the friend's display name, handle, or avatar from Firestore.
- **Permanent Solution**:
  - Decouple navigation using explicit coordinator pattern or typed `NavigationPath`.
  - Automatically fetch the peer's public profile `/users/{peerUid}` to hydrate contact metadata upon pairing.

### Bug 3: File Transfer Failures & Memory Bloat
- **Root Cause**:
  - Legacy code converted entire files into monolithic Base64 strings in memory and attempted inline storage in Firestore messages. Files > 1MB exceeded Firestore document limit (1MB max per document), causing immediate write failures.
  - Firebase Storage rules strictly enforce `request.resource.contentType == 'application/octet-stream'` on `conversations/{id}/{msgId}/payload.bin`. When client uploaded with original mime type (`image/png`), Firebase Storage returned `403 Forbidden`.
- **Permanent Solution**:
  - Encrypt file bytes into `application/octet-stream`.
  - Upload via resumable Firebase Storage task.
  - Store storage path and encrypted metadata in Firestore message.

### Bug 4: Xcode Build Failures in CI
- **Root Cause**:
  1. Setting `configuration.localizedName = "Luma"` on `CXProviderConfiguration` failed because `localizedName` is a read-only property in iOS 14.5+.
  2. Concurrency warning/error in `WebRTCService.swift`: capturing mutable `activeCall` across `@MainActor.run` closures violated Swift 5.9 concurrency checks.
  3. Missing SoundManager methods: calling `playDeclinedSound()` or `playIncomingRing()` before declaring them.
- **Permanent Solution**:
  - Fix CallKit configuration to only modify mutable properties.
  - Strictly observe Swift concurrency boundaries using `@MainActor` methods.
  - Keep audio player APIs synchronized across platforms.

---

## 4. Key Security & Cryptographic Formulas
- **E2EE Key Formula**: `PBKDF2-HMAC-SHA256(secret: pairingSecret, salt: "luma:" + conversationId, iterations: 120000, keyLength: 256)`
- **E2EE Wire Format**: `Base64(12_byte_IV) + "." + Base64(AES_GCM_Ciphertext_with_Tag)`
- **Attachment Storage Path**: `conversations/{conversationId}/{messageId}/payload.bin` (Content-Type: `application/octet-stream`)
