# MASTER IMPLEMENTATION PROMPT FOR LUMA REBUILD AGENT

> **INSTRUCTIONS FOR CODING AI:**
> You are the lead software engineer responsible for executing the rebuild of **Luma**, a high-performance cross-platform communication application (Web, Native iOS, Native Android).
> You have full access to the project specification repository.
> **DO NOT GUESS OR INVENT ARCHITECTURE.** All specifications, data schemas, cryptographic rules, and implementation phases are documented in the repository root.

---

## 1. MANDATORY SOURCE-OF-TRUTH DOCUMENTS
Before writing or modifying any code, you MUST inspect and follow these documents in the project root:
1. `PRD.md` — Complete Product Requirements & User Journeys.
2. `architecture.md` — Rebuild Architecture, WebRTC/TURN topology, and service layer design.
3. `rules.md` — Strict Engineering Rules & Constraints (Zero Capacitor, Zero WebViews, No Dummy SDPs, No Monolithic Files).
4. `phases.md` — Sequential Implementation Phases with Completion Gates.
5. `design.md` — Apple Liquid Glass Design System Specifications.
6. `memory.md` — Historical Context & Root-Cause Analysis of Past Bugs.
7. `webrtc.md` — WebRTC Signaling, Codecs, ICE & Network Adaptation Spec.
8. `file-transfer.md` — Resumable Encrypted File Transfer & Storage Spec.
9. `data-model.md` — Universal Cross-Platform Data Contracts & Firestore/RTDB Schemas.
10. `security.md` — Security Architecture, Threat Model & Rules Audit.
11. `testing.md` — Quality Assurance & Cross-Platform Test Matrix.
12. `ci-cd.md` — GitHub Actions Workflows & Build Pipelines.
13. `configuration-matrix.md` — Configuration & Environment Variable Matrix.
14. `CREDENTIALS_LOCAL.md` — Masked Credentials, Key Rotation & Secrets Policy.

---

## 2. STRICT NON-NEGOTIABLE CONSTRAINTS
- **No Capacitor / No WebViews**: Native iOS and Android apps MUST be real, first-class native applications (SwiftUI on iOS, Jetpack Compose on Android).
- **No Fake WebRTC or Dummy SDP**: Under no circumstances will you generate hardcoded dummy SDP strings (`127.0.0.1`). Real native WebRTC engines (`GoogleWebRTC` framework) MUST be integrated and utilized.
- **No Monolithic Files**: Do not write monolithic code like the legacy 6,346-line `App.tsx`. Decouple every screen into dedicated feature modules and service layers.
- **Authentic Fake YouTube Captcha Screen (100% Parity)**: The covert decoy gateway screen (`GatewayScreen.tsx` / `gateway.ts`) MUST be preserved 100% identically. The YouTube mobile header, decoy "Open App" link, Step 1 reCAPTCHA v2 checkbox with 550ms spinner, Step 2 distorted cursive captcha canvas with red tangled squiggles and slate-blue letters, TTS audio button, and the secret unlock passphrase **`gune`** MUST be implemented with exact parity across all platforms.
- **Zero Secrets in Git**: Never commit plaintext API keys or TURN credentials to git. Mask all references in committed documentation.
- **Rule Compliance**: All database writes to Firebase Realtime Database and Cloud Firestore MUST adhere strictly to `database.rules.json`, `firestore.rules`, and `storage.rules`.


---

## 3. IMPLEMENTATION EXECUTION SEQUENCE

Execute the rebuild strictly adhering to the phases in `phases.md`:

### Phase 0: Foundations & Shared Contracts
- Standardize all shared models across TypeScript, Swift, and Kotlin (`data-model.md`).
- Implement and verify cross-platform E2EE test vectors (PBKDF2 120,000 iterations + AES-GCM 256).

### Phase 1: Authentication, Presence & Contact Pairing
- Wire Google Sign-In and Email/Password auth with auto-refreshing ID tokens.
- Implement User Profile setup and RTDB presence engine (`.info/connected`, `onDisconnect`).
- Build QR code generator/scanner and 6-character pairing code invite system.
- Wire authentic Fake YouTube reCAPTCHA Gateway Screen (`GatewayScreen.tsx` / `gateway.ts`) with 100% visual parity and unlock passphrase `gune`.


### Phase 2: End-to-End Encrypted 1:1 Chat Engine
- Modularize Chat UI (Message List, Input Bar, Pinned Message Banner).
- Implement real-time Firestore listeners, delivery receipts (`sent` -> `delivered` -> `read`), formatting (`*bold*`, `_italic_`), reactions, edit, and delete.

### Phase 3: Resumable Encrypted File & Media Transfer
- Implement streaming AES-GCM encryption with 12-byte IV prepending.
- Wire resumable chunked Firebase Storage uploads to `conversations/{id}/{msgId}/payload.bin` with Content-Type `application/octet-stream`.
- Implement inline fallback for files <= 700KB.
- Build full-screen media viewers and live waveform voice note recorder.

### Phase 4: Production WebRTC Voice & Video Calling
- Integrate native `GoogleWebRTC` framework into iOS and Android projects.
- Wire real RTDB signaling (`/calls/{callId}`) with offer, answer, and ICE candidate exchange.
- Wire native CallKit on iOS (`CXProvider`) and TelecomManager on Android.
- Tune Opus audio with FEC (`useinbandfec=1`), DTX (`usedtx=1`), and 32 kbps cap.
- Implement in-call controls (Mute, Camera Flip, Camera Mirror, Volume Boost, End Call).
- Implement simultaneous calling (glare) resolution.

### Phase 5: Apple Liquid Glass UI/UX Polish
- Apply Cupertino Glass design tokens (`#050505` canvas, 24px blur frosted panels, floating pill bars, FaceTime calling layout).

### Phase 6: Automated CI/CD & Verification
- Ensure GitHub Actions workflows build cleanly: Web bundle, iOS IPA packaging (`build-ipa.yml`), and Android APK build.

---

## 4. HOW TO PROCEED
Begin execution by inspecting Phase 0 in `phases.md`. Execute tasks step-by-step, verifying each completion gate before advancing to the next phase.
