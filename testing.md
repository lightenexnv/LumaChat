# Luma — Cross-Platform Testing & Quality Assurance Plan

## 1. Testing Philosophy
Because Luma operates across Web, iOS, and Android with synchronized encryption and peer-to-peer real-time streams, tests must verify both **isolated unit behavior** and **heterogeneous cross-platform interoperability**.

---

## 2. Test Pyramid & Automation Levels

```
                     ┌─────────────────────────────┐
                     │   Cross-Platform E2E Tests  │
                     │  (Web <-> iOS <-> Android)  │
                     └──────────────┬──────────────┘
                                    │
                     ┌──────────────┴──────────────┐
                     │    Signaling & Glare Tests  │
                     │   (Firebase RTDB Emulators) │
                     └──────────────┬──────────────┘
                                    │
                     ┌──────────────┴──────────────┐
                     │   Cryptographic Unit Tests  │
                     │ (PBKDF2 & AES-GCM Vectors)  │
                     └─────────────────────────────┘
```

---

## 3. Cryptographic Standard Verification Vectors
Every client codebase (TypeScript, Swift, Kotlin) must include a test asserting that:
- **Input Secret**: `"A7K9X2"`
- **Conversation ID**: `"conv_test_8842"`
- **Plaintext**: `"Hello, Luma E2EE Security!"`
- **Output**:
  - Key derived from PBKDF2 with salt `"luma:conv_test_8842"` and 120,000 iterations must decrypt a known ciphertext vector produced by the Web implementation, and vice-versa.

---

## 4. Cross-Platform Test Matrix

| Test Case ID | Test Description | Platform A | Platform B | Expected Outcome |
| :--- | :--- | :--- | :--- | :--- |
| **TC-GATEWAY-01**| Decoy YouTube Challenge | Any Client | Local Session | Unverified launch renders fake YouTube reCAPTCHA; clicking Open App links to YouTube; entering invalid captcha fails. |
| **TC-GATEWAY-02**| Secret Passphrase Unlock| Any Client | Local Session | Entering `gune` (case-insensitive) unlocks the app and persists `luma:verified-session`. |
| **TC-PAIR-01** | QR Code Pairing | Web (Display QR) | iOS (Camera Scan) | Contact created on both sides with identical `conversationId` and `pairingSecret`. |

| **TC-PAIR-02** | Manual Code Pairing | Android (Invite) | Web (Enter Code) | Successful pairing; both users appear in contact list. |
| **TC-CHAT-01** | Real-Time Encrypted Text | Web | iOS | Message arrives in < 500ms; status updates `sent` -> `delivered` -> `read`. |
| **TC-CHAT-02** | Message Edit | iOS | Android | Edited text updates on recipient screen with `(edited)` tag. |
| **TC-CHAT-03** | Delete for Everyone | Android | Web | Message bubble replaced with "This message was deleted". |
| **TC-MEDIA-01**| 50MB Video Transfer | iOS | Web | Resumable upload completes; Web user plays video smoothly. |
| **TC-MEDIA-02**| 10MB PDF Document | Web | iOS | Storage upload succeeds; iOS user opens PDF in QuickLook. |
| **TC-CALL-01** | Voice Call (Web -> iOS) | Web (Caller) | iOS (Callee) | iOS rings via CallKit; audio streams with zero echo; Opus FEC active. |
| **TC-CALL-02** | Video Call (iOS -> Web) | iOS (Caller) | Web (Callee) | Web banner rings; answering initiates 720p/1080p video feed with PIP. |
| **TC-CALL-03** | Glare / Simultaneous Call| Web | iOS | Both call simultaneously; system cleanly elects canonical call; one active call session established. |
| **TC-CALL-04** | Cellular Degradation | iOS (4G 20% loss)| Web | WebRTC adapts to 360p/audio-only; audio stays intelligible via Opus FEC. |

---

## 5. Automated Test Execution Commands

### Web (Vitest)
```bash
npm run test
```
Runs unit tests for crypto (`src/lib/crypto.ts`), signaling sanitation (`src/lib/webrtc.ts`), and media grouping.

### iOS (Xcodebuild CLI)
```bash
xcodebuild test \
  -project ios/Luma.xcodeproj \
  -scheme Luma \
  -destination 'platform=iOS Simulator,name=iPhone 15,OS=latest'
```

### Android (Gradle CLI)
```bash
./gradlew testDebugUnitTest
```
