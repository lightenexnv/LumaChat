# Luma — Rebuild Implementation Phases & Completion Gates

Each phase is strictly sequential and dependency-gated. A phase cannot be marked complete until all verification tests in its completion gate pass.

---

## Phase 0: Foundations, Protocol & Shared Contracts
- **Objective**: Standardize all cross-platform data schemas, cryptographic algorithms, signaling contracts, and project scaffolding.
- **Tasks**:
  1. Define unified TypeScript types / Swift models / Kotlin data classes for all entities (User, Contact, Message, Call, Invite).
  2. Implement and unit test the E2EE engine (PBKDF2 120,000 iterations + AES-GCM 256) across Web (Web Crypto API), iOS (CryptoKit / CommonCrypto), and Android (javax.crypto).
  3. Validate cryptographic cross-compatibility: a test payload encrypted on Web MUST decrypt on iOS and Android with identical key/salt/IV.
  4. Audit and freeze Firebase Security Rules (`firestore.rules`, `database.rules.json`, `storage.rules`).
- **Completion Gate**:
  - Automated cross-platform test vectors pass for key derivation and payload encryption/decryption.
  - Zero lint/type errors.

---

## Phase 1: Authentication, Presence & Contact Pairing
- **Objective**: Flawless user identity, profile setup, contact discovery, and QR code / invite pairing across all platforms.
- **Tasks**:
  1. Implement Google Sign-In and Email/Password flows on Web, iOS, and Android.
  2. Implement User Profile management (display name, unique handle, initials, theme color, avatar upload).
  3. Build Realtime Database presence tracking (`.info/connected`, online, lastSeen) with clean `onDisconnect()` teardown.
  4. Implement Invite Link generation, 6-character pairing codes, and high-contrast QR code rendering.
  5. Implement camera-based QR scanning (HTML5-QRCode on Web, AVFoundation on iOS, CameraX/MLKit on Android).
  6. Enforce Firestore `/invites` validation rules and auto-provision bidirectional contact records in `/users/{uid}/contacts/{peerUid}`.
  7. Preserve & wire the authentic **Fake YouTube reCAPTCHA Gateway Screen** (`GatewayScreen.tsx` / `gateway.ts`) with 100% visual and behavioral parity across Web, iOS, and Android, verifying step 1 checkbox, step 2 distorted cursive graffiti canvas challenge, and secret unlock passphrase **`gune`**.
- **Completion Gate**:
  - Fresh app launch shows authentic YouTube reCAPTCHA check; entering random text fails; entering `gune` unlocks Luma.
  - Two test users (one on Web, one on iOS/Android) can sign in, pair via QR code or invite code, and see each other online in real time.


---

## Phase 2: End-to-End Encrypted 1:1 Chat Engine
- **Objective**: Production-grade real-time chat with message delivery receipts, formatting, reactions, and offline optimism.
- **Tasks**:
  1. Implement optimistic message sending with local cache.
  2. Real-time Firestore snapshot listeners for `/conversations/{conversationId}/messages`.
  3. Wire delivery state machine: `sent` -> `delivered` -> `read` with dual-checkmark UI indicators.
  4. Implement rich text parsing: Bold (`*`), Italic (`_`), Strikethrough (`~`), Monospace (```).
  5. Implement message interaction menu: Reply quote, Copy, Edit own message, Delete for Me, Delete for Everyone.
  6. Implement Pinned Messages banner and jump-to-message scrolling.
- **Completion Gate**:
  - Message sent on Web appears instantly (<500ms) on iOS/Android.
  - Recipient viewing chat updates sender's status checks from single gray to double green (read) in real time.
  - Edited and deleted messages synchronize properly without security rule violations.

---

## Phase 3: Resumable Encrypted File & Media Transfer
- **Objective**: Rock-solid media transfer up to 100MB with streaming encryption and full-screen viewers.
- **Tasks**:
  1. Implement streaming AES-GCM encryption for files.
  2. Wire resumable chunked upload to Firebase Storage path `conversations/{conversationId}/{messageId}/payload.bin` with Content-Type `application/octet-stream`.
  3. Implement inline base64 fallback for files <= 700KB when storage connectivity is degraded.
  4. Build media preview components: Image thumbnails, Video player with seek bar, Document card with size and extension tag.
  5. Implement Voice Note recorder with live waveform visualizer, lock-to-record, pause, and preview playback.
  6. Implement full-screen Attachment Viewer modal with zoom, pan, and native system share sheet export.
- **Completion Gate**:
  - Upload a 50MB video from iOS -> Web user receives, decrypts, and plays it with zero dropped bytes or memory crashes.
  - Upload a 10MB PDF from Web -> iOS user opens and exports via system share sheet.

---

## Phase 4: Production WebRTC Real-Time Calling Engine
- **Objective**: Full bidirectional cross-platform voice and video calling between Web and Native mobile devices.
- **Tasks**:
  1. Integrate native `GoogleWebRTC` framework into iOS project (via Swift Package Manager or verified binary xcframework).
  2. Configure native RTCPeerConnection factory, local audio tracks, and local camera capture (`RTCCameraVideoCapturer`).
  3. Wire RTDB signaling state machine in `/calls/{callId}`: Offer generation, Answer generation, ICE candidate queuing and trickle.
  4. Implement incoming call listener on `/incomingCalls/{myUid}` with instant caller profile extraction.
  5. Integrate CallKit on iOS (`CXProvider`, `CXCallController`) and TelecomManager on Android for native lock-screen ringing.
  6. Implement Opus audio optimizations: FEC (`useinbandfec=1`), DTX (`usedtx=1`), dynamic bitrate cap (32 kbps).
  7. Implement video quality profiles (1080p, 720p, 360p, audio-only) and adaptive network monitoring.
  8. Implement simultaneous calling (glare) resolution: automatic merge to existing call or deterministic caller election (`myUid < peerUid`).
  9. Implement in-call controls: Mute mic, Camera flip (front/back), Camera mirror toggle, Speakerphone, Volume Booster (up to 200%), and End Call.
  10. Dispatch encrypted call summary message bubble into chat upon call completion.
- **Completion Gate**:
  - Web calls iOS -> iPhone rings via CallKit -> iPhone answers -> Audio and video stream bidirectionally with zero lag.
  - iOS calls Web -> Web browser plays incoming ring and displays floating call banner -> Web user answers -> Call connects stably.
  - Simulate 20% packet loss on 4G network -> Audio remains intelligible without dropping due to Opus in-band FEC.

---

## Phase 5: Apple Liquid Glass UI/UX Polish
- **Objective**: Complete visual and tactile overhaul adhering to Apple Liquid Glass design tokens.
- **Tasks**:
  1. Implement Cupertino glass surfaces: `#050505` dark background, translucent blur panels (`rgba(255, 255, 255, 0.07)`, blur 20px), thin borders (`rgba(255, 255, 255, 0.12)`).
  2. Implement iOS-style floating pill navigation and header bars.
  3. Implement fluid spring animations and haptic feedback on iOS/Android.
  4. Implement Contact Info view, Call History view, and Profile/Settings ("You") tab.
  5. Ensure strict accessibility: 44px touch targets, dynamic type support, high-contrast labels.
- **Completion Gate**:
  - UI visual review passes across light and dark modes on iPhone, Android, and desktop browsers.

---

## Phase 6: Automated CI/CD, Testing & Release
- **Objective**: Zero-friction automated builds and verification workflows.
- **Tasks**:
  1. Configure GitHub Actions workflow for Web (`npm run build`, `vitest run`).
  2. Configure GitHub Actions workflow for iOS IPA packaging (`xcodebuild archive`, un-signed IPA artifact generation).
  3. Configure GitHub Actions workflow for Android APK build (`./gradlew assembleRelease`).
  4. Run automated end-to-end integration test suite simulating full user lifecycle.
- **Completion Gate**:
  - All GitHub Actions workflows trigger on push and complete with green checks.
  - Installable `.ipa` and `.apk` artifacts downloadable from GitHub Actions summaries.
