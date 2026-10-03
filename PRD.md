# Luma — Product Requirements Document (PRD)

## 1. Executive Summary & Product Vision
**Luma** is a high-performance, private, cross-platform 1:1 communication application centered on encrypted messaging, real-time voice, and video calling. 
Unlike fragmented or wrapper-based communication apps, Luma delivers:
- **First-Class Platform Native Experiences**: 
  - **Web**: React 19 + TypeScript + Vite + Tailwind/Modern CSS.
  - **iOS**: Pure native Swift & SwiftUI with CallKit, AVFoundation, and native WebRTC (GoogleWebRTC framework).
  - **Android**: Pure native Kotlin & Jetpack Compose with TelecomManager/ConnectionService, CameraX, and WebRTC.
  - **Zero Capacitor / Zero WebView Wrappers** for native applications.
- **Flawless Interoperability**: Any user on iOS, Android, or Web can instantly discover, pair, chat, transfer files, and execute 1:1 voice/video calls with another user regardless of device.
- **Privacy & End-to-End Encryption (E2EE)**: Zero-knowledge conversation payload encryption where only paired peers hold the keys.
- **Apple Liquid Glass Design Language**: Translucent frosted materials, iOS-native blur depths (18px-32px), floating interactive pills, and FaceTime-grade calling overlays.

---

## 2. Target Personas & Core Problem Statement
### Personas
1. **The Cross-Platform User (e.g., iPhone User calling Android/Desktop user)**:
   - Expects FaceTime/WhatsApp fluidity without being locked into a single operating system ecosystem.
   - Demands instant call notifications, ringing states, and crisp low-latency audio even across spotty 4G/LTE mobile networks.
2. **The Privacy-Conscious Communicator**:
   - Needs guaranteed encrypted messaging and file transfer without central server snooping.
   - Values deterministic pairing via one-time invite codes and QR codes instead of public telephone directories.

### Problem Statement
The initial Luma codebase accumulated technical debt through piecemeal iterations:
- iOS was using fake REST polling against Firebase RTDB with static dummy SDP strings (`127.0.0.1`), meaning real cross-platform calls were impossible.
- File transfers failed silently when memory bloat occurred with monolithic base64 serialization.
- Chat state synchronization was prone to UI state desync between platforms.
- Web UI contained an unwieldy 6,300+ line monolithic `App.tsx` file combining auth, signaling, DOM rendering, and sound effects.

---

## 3. Scope of the Product

### In-Scope (MVP & Production Parity)
1. **Authentication & Identity**:
   - Google Sign-In & Email/Password authentication.
   - Unique User Handle, Display Name, Initials, Theme Color, and custom Profile Photo.
   - Global Presence (online / offline / last seen timestamp).
2. **Contact Pairing & Invites**:
   - One-time pairing invite links & 6-character alphanumeric invite codes.
   - Interactive QR code generator & camera-based QR scanner.
   - Local contact list with custom nicknames, contact pinning, and contact info cards.
3. **End-to-End Encrypted Chat**:
   - AES-GCM (256-bit) message payload encryption derived via PBKDF2 (`iterations: 120,000`, salt: `luma:<conversationId>`).
   - Rich formatting: Bold (`*`), Italic (`_`), Strikethrough (`~`), Monospace (```).
   - Message Delivery Receipts: Sending (clock), Sent (single check), Delivered (double gray checks), Read (double green checks).
   - Message Actions: Swipe-to-reply, emoji reactions, edit message, delete for me, delete for everyone, forward, and copy.
   - Pinned messages banner with quick unpin/jump.
4. **Covert Decoy Gateway / Authentic Fake YouTube reCAPTCHA Screen (100% Parity)**:
   - Plausible deniability & stealth entry gate: app defaults to displaying an authentic mobile YouTube reCAPTCHA verification page.
   - **Step 1**: "I'm not a robot" Google reCAPTCHA v2 checkbox box with authentic 550ms spinner animation and curved blue/silver arrow logo.
   - **Step 2**: Distorted Captcha challenge rendered dynamically on an HTML5 `<canvas>` (or native CoreGraphics / Android Canvas) with authentic tangled red bezier curve squiggles, wavy cursive graffiti letters (`#5c8699`), foreground crossing lines, and challenge refresh.
   - **Audio Challenge**: Integrated Web Speech API / TTS reading challenge letters aloud.
   - **Decoy "Open App" Action**: Realistic deep link trying `youtube://` / intent / `m.youtube.com`.
   - **Secret Unlock Passphrase**: Entering the secret answer **`gune`** (case-insensitive) unlocks the real Luma communication suite and marks session as verified (`luma:verified-session`). Any other input fails with "Incorrect captcha. Please try again."
5. **Resumable Encrypted File & Media Transfer**:

   - Streaming/chunked AES-GCM encryption with 12-byte IV prepended.
   - Support for Images (JPEG, PNG, WebP), Videos (MP4), Voice Notes, and Documents (PDF, ZIP, DOCX) up to 100 MB.
   - Dedicated full-screen attachment viewer with pinch-to-zoom, playback controls, and native share sheet export.
   - Integrated Voice Note recording with dynamic live audio level metering, pause, lock, and cancel gestures.
5. **Cross-Platform WebRTC Audio & Video Calling**:
   - Native GoogleWebRTC on iOS (via Swift Package Manager / binary framework) and Android (official WebRTC aar), matching Web's standard RTCPeerConnection.
   - Real-time RTDB signaling: `/calls/{callId}` (offer, answer, candidates, state).
   - Audio-first priority: Opus codec tuning with In-band FEC (`useinbandfec=1`), DTX (`usedtx=1`), and dynamic bitrate backoff.
   - CallKit integration on iOS; TelecomManager/ConnectionService on Android for native OS-level ringing and call lock-screen integration.
   - Call controls: Flip camera (front/back), local camera preview mirror toggle, microphone mute, speaker toggle, and Volume Booster (up to 200%).
   - Adaptive network quality indicator (1080p, 720p, 360p, Audio Only).
   - Full Glare resolution & simultaneous calling arbitration.

### Out-of-Scope (Deferred to Post-MVP)
- Multi-party group video conferences (>2 participants).
- Desktop Electron wrapper (Web application serves desktop users via responsive PWA).
- Cloud backup of private cryptographic keys (keys remain on-device or reconstructed via pairing secret).

---

## 4. User Journeys & Core Flows

### Journey A: Pairing Two Users (Web & iOS)
1. **User A (Web)** opens Luma -> Navigates to New Chat -> Clicks "Invite Friend".
2. Web displays a 6-character pairing code (`ABC-123`) and a high-resolution QR code, copying invite URL `https://<domain>/?invite=<code>`.
3. **User B (iPhone)** opens Luma -> Taps `+` -> Points native camera at User A's QR code (or inputs code).
4. System verifies invite validity against Firestore `/invites/{inviteId}`.
5. Bidirectional contact records are created in `/users/{uid}/contacts/{peerUid}` with identical `conversationId` and shared `pairingSecret`.
6. Both users immediately transition to the shared chat room.

### Journey B: Real-Time Cross-Platform Video Call
1. **User B (iPhone)** taps Video Call button inside chat with User A.
2. iOS creates RTDB record `/calls/{callId}` with state `ringing`, generates real native WebRTC SDP Offer, and writes to `/calls/{callId}/offer`.
3. iOS creates incoming notification in `/incomingCalls/{userA_id}/{callId}`.
4. **User A (Web)** hears ringing audio and sees top floating Glass Incoming Call banner displaying User B's avatar and name.
5. User A clicks "Accept":
   - Web creates native `RTCPeerConnection`, adds local media streams, sets remote offer SDP, generates SDP Answer, and writes to `/calls/{callId}/answer`.
   - Web sets `/calls/{callId}/state` to `accepted`.
6. iOS signaling poller/listener detects `accepted`, sets remote answer SDP, and starts ICE candidate exchange.
7. Both clients transition to active call overlay: live remote video stream, floating local PIP, live call duration timer, and audio meters.
8. When either user taps "End Call", `/calls/{callId}/state` changes to `ended`, hardware cameras/microphones release immediately, and an encrypted call log bubble appears in chat history.

---

## 5. Non-Functional Requirements (NFRs)
- **Audio Latency**: Target < 180ms one-way latency on 4G/5G/Wi-Fi.
- **Connection Setup Time**: WebRTC peer connection must reach `connected` state within 2.5 seconds of call acceptance on TURN/STUN.
- **Message Send-to-Render Latency**: < 500ms under standard mobile connectivity.
- **App Cold Start**: < 1.2 seconds on iOS (iPhone 12 or newer) and Android (modern devices).
- **Crash Rate**: 0% unhandled exception crashes; zero force-unwraps in Swift/Kotlin.
