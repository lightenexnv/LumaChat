# Luma Rebuild — Master Implementation Log & Phase Checklist

Tracking execution of [LUMA_REBUILD_MASTER_PROMPT.md](file:///d:/Coding/LumaChat/LUMA_REBUILD_MASTER_PROMPT.md) and [phases.md](file:///d:/Coding/LumaChat/phases.md).

## Phase Checklist

### Phase 0: Foundations, Protocol & Shared Contracts
- [ ] Unified data contracts across TypeScript, Swift, Kotlin (`data-model.md`)
- [ ] Universal PBKDF2 (120,000 iterations) + AES-GCM (256-bit) E2EE engine & test vectors
- [ ] Cross-platform cryptographic test vector verification
- [ ] Firebase Security Rules audit and sync (`firestore.rules`, `database.rules.json`, `storage.rules`, `firebase.json`)
- [ ] **Phase 0 Completion Gate**: Cryptographic test suite passes, zero lint/type errors.

### Phase 1: Authentication, Presence & Contact Pairing
- [ ] Google Sign-In & Email/Password with token auto-refresh
- [ ] User Profile setup & management
- [ ] Realtime Database presence engine (`.info/connected`, `onDisconnect`)
- [ ] QR code generator/scanner (HTML5-QRCode) & 6-char pairing invite engine
- [ ] 100% Authentic Fake YouTube reCAPTCHA Gateway Screen (`GatewayScreen.tsx` / `gateway.ts`) with passphrase `gune`
- [ ] **Phase 1 Completion Gate**: Gateway verified, contact pairing verified, presence active.

### Phase 2: End-to-End Encrypted 1:1 Chat Engine
- [ ] Modular Chat UI (Message List, Input Bar, Pinned Message Banner)
- [ ] Real-time Firestore message listeners & optimistic sending
- [ ] Delivery state machine: `sent` -> `delivered` -> `read`
- [ ] Rich text parsing (`*bold*`, `_italic_`, `~strike~`, `code`)
- [ ] Message interactions: Reply quote, Copy, Edit, Delete for Me, Delete for Everyone
- [ ] **Phase 2 Completion Gate**: Cross-platform messaging sync, status ticks update in real-time.

### Phase 3: Resumable Encrypted File & Media Transfer
- [ ] Streaming AES-GCM encryption with 12-byte IV prepending
- [ ] Resumable chunked Firebase Storage uploads (`conversations/{id}/{msgId}/payload.bin`, `application/octet-stream`)
- [ ] Inline fallback for payloads <= 700KB
- [ ] Media previewers, Voice note recorder with live waveform visualizer
- [ ] Full-screen media viewer modal with system export
- [ ] **Phase 3 Completion Gate**: Transfer and decryption of files up to 100MB verified.

### Phase 4: Production WebRTC Real-Time Calling Engine
- [ ] Integration of real native `GoogleWebRTC`
- [ ] RTDB signaling engine (`/calls/{callId}`, `/incomingCalls/{calleeId}/{callId}`)
- [ ] CallKit / TelecomManager integration
- [ ] Opus audio tuning (FEC `useinbandfec=1`, DTX `usedtx=1`, 32 kbps cap)
- [ ] In-call controls: Mute, Camera flip/mirror, Volume booster (up to 200%), End call
- [ ] Simultaneous call (glare) resolution
- [ ] **Phase 4 Completion Gate**: Real bidirectional A/V call connection with zero fake SDPs.

### Phase 5: Apple Liquid Glass UI/UX Polish
- [ ] Cupertino Glass design tokens (`#050505` canvas, 24px blur frosted panels, floating pill bars)
- [ ] Dynamic type, 44px touch targets, fluid spring animations
- [ ] **Phase 5 Completion Gate**: Visual inspection passes across web and mobile.

### Phase 6: Automated CI/CD, Testing & Release
- [ ] Web bundle build and tests in GitHub Actions
- [ ] iOS IPA build workflow (`build-ipa.yml`)
- [ ] Android APK build workflow
- [ ] **Phase 6 Completion Gate**: All workflows green, downloadable IPA/APK artifacts.
