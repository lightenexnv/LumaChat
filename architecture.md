# Luma — Cross-Platform Rebuild Architecture Specification

## 1. System Overview & Technology Stack

```
                                      ┌────────────────────────────────────────────────────────┐
                                      │                  Firebase Services                     │
                                      │  ┌──────────────────┐  ┌─────────────────────────────┐ │
                                      │  │  Firebase Auth   │  │ Firebase Realtime Database  │ │
                                      │  │  (Google / Email)│  │ (Signaling, Presence, Glare)│ │
                                      │  └────────┬─────────┘  └──────────────┬──────────────┘ │
                                      │           │                           │                │
                                      │  ┌────────┴─────────┐  ┌──────────────┴──────────────┐ │
                                      │  │ Cloud Firestore  │  │      Firebase Storage       │ │
                                      │  │ (Users, Messages)│  │ (Encrypted Payloads <=100MB)│ │
                                      │  └──────────────────┘  └─────────────────────────────┘ │
                                      └────────────────────────────────────────────────────────┘
                                                                  ▲
                                                                  │
                      ┌───────────────────────────────────────────┼───────────────────────────────────────────┐
                      │                                           │                                           │
                      ▼                                           ▼                                           ▼
          ┌───────────────────────┐                   ┌───────────────────────┐                   ┌───────────────────────┐
          │      Luma Web         │                   │       Luma iOS        │                   │      Luma Android     │
          │  React 19 + TypeScript│                   │     Pure SwiftUI      │                   │  Kotlin + Jetpack Compose
          │  Vite, Tailwind, CSS  │                   │  AVFoundation, CallKit│                   │  CameraX, TelecomManager
          │  Browser RTCPeerConn  │                   │  GoogleWebRTC Native  │                   │  GoogleWebRTC Native  │
          └───────────┬───────────┘                   └───────────┬───────────┘                   └───────────┬───────────┘
                      │                                           │                                           │
                      └───────────────────────────────┬───────────┴───────────────────────────────────────────┘
                                                      │
                                                      ▼ Direct P2P Media Streams (SRTP)
                                            ┌───────────────────┐
                                            │ Coturn / Xirsys   │
                                            │ STUN / TURN Relay │
                                            └───────────────────┘
```

---

## 2. Core Architectural Pillars

### Pillar 1: No Hybrid Wrappers / No WebViews
- **Web**: Standalone modern Single Page Application (Vite 6, React 19, TypeScript).
- **iOS**: Pure native Swift 5.9+ application target. Zero WKWebView for core chat/calling. Utilizes `SwiftUI`, `Combine`, `AVFoundation`, `CallKit`, and the official native `GoogleWebRTC` framework.
- **Android**: Pure native Kotlin application target using `Jetpack Compose`, `Kotlin Coroutines/Flow`, `CameraX`, and `google-webrtc`.

### Pillar 2: Decoupled Feature Architecture
Both Web and Native clients discard monolithic god-objects (such as the legacy 6,300-line `App.tsx`) in favor of clean layered modules:
1. **Domain / State Layer**:
   - `AuthService`: Session restoration, token refresh, multi-factor, Google OAuth tokens.
   - `ContactService`: Friend pairing, invite codes, contacts sync.
   - `ChatService`: Optimistic message sending, status reconciliation (sent/delivered/read), message reactions, paging.
   - `CallService`: Call state machine, CallKit/TelecomManager lifecycle, audio routing, glare resolution.
   - `CryptoService`: E2EE key derivation (PBKDF2), AES-GCM 256 encrypt/decrypt, IV generation.
   - `StorageService`: Chunked resumable uploads, streaming encryption, progress observation.
2. **Transport / Infrastructure Layer**:
   - `FirestoreClient`: Strongly-typed document mappings.
   - `RTDBClient`: Real-time signaling listeners & heartbeat presence hooks.
   - `WebRTCClient`: Native PeerConnection factory, local audio/video track management, ICE gathering, SDP munging, dynamic bitrate controllers.
3. **Presentation Layer**:
   - SwiftUI Views / React Components built with strict unidirectional data flow (UDF).

---

## 3. WebRTC Call & Signaling Topology

### Firebase Realtime Database Signaling Schema
Signaling takes place under root nodes protected by strict database security rules:

1. **Active Call Node (`/calls/{callId}`)**:
   ```json
   {
     "callerId": "user_uid_1",
     "calleeId": "user_uid_2",
     "kind": "video",
     "callerProfile": {
       "name": "Alex Vance",
       "initials": "AV",
       "color": "#30D158",
       "photoURL": "https://..."
     },
     "state": "ringing",
     "createdAt": 1727952000000,
     "endedAt": 1727952120000,
     "offer": {
       "type": "offer",
       "sdp": "v=0\r\no=..."
     },
     "answer": {
       "type": "answer",
       "sdp": "v=0\r\no=..."
     },
     "callerCandidates": {
       "-O9kLmNoP": {
         "candidate": "candidate:...",
         "sdpMid": "0",
         "sdpMLineIndex": 0,
         "usernameFragment": "ufrag1"
       }
     },
     "calleeCandidates": {
       "-O9kLmNoQ": {
         "candidate": "candidate:...",
         "sdpMid": "0",
         "sdpMLineIndex": 0,
         "usernameFragment": "ufrag2"
       }
     }
   }
   ```

2. **Incoming Ringing Dispatcher (`/incomingCalls/{calleeId}/{callId}`)**:
   - Callee client listens via real-time WebSocket on `/incomingCalls/{myUid}`.
   - Contains identical summary data so the callee displays full caller information and ringtone instantly without fetching secondary user documents.
   - Cleared automatically upon call accept, decline, or ring timeout (60 seconds).

### ICE / TURN Traversal
- **STUN**: `stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`.
- **TURN Relay**: Secure TURN-over-TLS (port 443 / 5349) fallback configured via environment variables (`VITE_TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`).
- TURN credentials fetched or statically injected to ensure connectivity across strict corporate firewalls, symmetric NATs, and carrier-grade NAT (CGNAT) on cellular networks.

---

## 4. End-to-End Encryption (E2EE) Architecture

### Key Derivation
- Key Derivation Function: **PBKDF2**
- Hash: **SHA-256**
- Iteration Count: **120,000 iterations**
- Salt Format: `luma:<conversationId>` (UTF-8 encoded)
- Input Key Material: `pairingSecret` (6-character uppercase alphanumeric code established during contact pairing)
- Derived Cipher: **AES-GCM (256-bit)**

### Payload Encryption
1. **Messages**:
   - Random 12-byte IV generated using cryptographically secure PRNG.
   - Payload encrypted with AES-GCM (256-bit).
   - Wire format stored in Firestore `ciphertext`:
     `base64(iv) + "." + base64(ciphertext_with_auth_tag)`
2. **Files & Binary Blobs**:
   - File bytes encrypted using AES-GCM (256-bit) with fresh 12-byte IV.
   - Encrypted byte payload: `[12 bytes IV] + [Ciphertext + 16 bytes GCM Auth Tag]`.
   - Uploaded directly to Firebase Storage bucket at path:
     `conversations/{conversationId}/{messageId}/payload.bin`.
   - Content-Type on Storage is strictly enforced to `application/octet-stream`.

---

## 5. File Transfer & Storage Pipeline

1. **Validation**: Check client file size against `MAX_ATTACHMENT_BYTES` (100 MB).
2. **Encryption**: AES-GCM encryption executed in streaming chunks or ArrayBuffer chunks.
3. **Upload Strategy**:
   - **Under 700 KB**: Resumable storage upload attempted. If network or storage permissions degrade, fallback to inline encrypted base64 payload (`inline:<base64>`) inside Firestore message to guarantee message delivery.
   - **Above 700 KB (up to 100 MB)**: Resumable chunked upload via Firebase Storage SDK (`uploadBytesResumable` on Web, `StorageUploadTask` on iOS/Android).
4. **Metadata Dispatch**: Firestore message document dispatched only after storage upload completes or commits chunks, guaranteeing no dead references in chat feed.
5. **Decryption**: Receiver downloads byte stream, extracts first 12 bytes as IV, decrypts remaining bytes using cached conversation AES key, and renders preview/player.

---

## 6. Network Resilience & State Recovery
- **Automatic Token Refresh**: Background token monitor refreshes Firebase ID Tokens before 60-minute expiry to prevent HTTP 401/403 failures during active calls or long chats.
- **ICE Restart**: If peer connection connectionState drops to `disconnected` or `failed`, an automatic ICE restart is negotiated via RTDB without dropping the call UI.
- **Presence Engine**: Utilizes Firebase Realtime Database `.info/connected` with `onDisconnect()` handlers to ensure true online/offline presence without stale indicators.

---

## 7. Covert Gateway & Plausible Deniability Architecture (YouTube Captcha Camouflage)

### 7.1. Purpose & Threat Vector
To guarantee operational privacy when opening the application in public, Luma mounts a decoy **YouTube Mobile reCAPTCHA v2 Challenge screen** (`GatewayScreen`) before rendering any authentication or chat screens.

### 7.2. Gateway State Machine & Flow
1. **Initial Mount**:
   - Check local session storage (`sessionStorage.getItem('luma:verified-session')` on Web, volatile in-memory session flag on iOS/Android).
   - If flag `!== 'verified'`, render `GatewayScreen` full screen with highest z-index (`z-index: 9999`).
2. **Step 1 (reCAPTCHA Checkbox)**:
   - Displays authentic Google reCAPTCHA v2 card ("I'm not a robot", blue/silver arrow badge).
   - Clicking checkbox triggers authentic 550ms spinner animation, transitioning to Step 2.
3. **Step 2 (Distorted Cursive Captcha Canvas)**:
   - Dynamic 2D Canvas renders 24 random red tangled bezier curve squiggles.
   - Letters rendered in dusty slate-blue (`#5c8699`), italic bold cursive (`44px`), random angle rotations, with 10 foreground quadratic curves crossing the letters.
   - Toolbar includes Audio Challenge playback (Web Speech API / native TTS) and Challenge Refresh.
   - Header includes functional decoy "Open App" action deep-linking to `youtube://` / intent / `m.youtube.com`.
4. **Secret Passphrase Verification**:
   - Secret key: **`gune`** (case-insensitive, normalized via `normalizeGatewayAnswer`).
   - Entering `gune` sets session key `luma:verified-session = 'verified'` and calls `onVerified()`, instantly transitioning to Luma main app.
   - Any other input displays "Incorrect captcha. Please try again." and generates a new random challenge.

