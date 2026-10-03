# LumaChat

> High-performance, cross-platform private communication application (Web, Native iOS, Native Android) built with End-to-End Encryption (E2EE), native WebRTC audio/video calling, and plausible deniability camouflage.

---

## 🌟 Highlights & Architecture

- **Plausible Deniability Decoy Gateway**: Covert YouTube mobile reCAPTCHA v2 challenge screen (`GatewayScreen` / `GatewayView` / `GatewayScreen.kt`) with 550ms spinner, distorted cursive graffiti canvas challenge, and secret unlock passphrase **`gune`**.
- **Universal E2EE Cryptographic Engine**: Interoperable across TypeScript, Swift, and Kotlin.
  - **Key Derivation**: PBKDF2 with SHA-256, 120,000 iterations, salt `luma:<conversationId>`, yielding 256-bit AES-GCM keys.
  - **Payload Structure**: 12-byte random IV prepended to AES-GCM ciphertext + 16-byte auth tag.
- **Resumable Encrypted Media Engine**: Uploads up to 100MB to Firebase Storage (`conversations/{id}/{msgId}/payload.bin`, `application/octet-stream`) with automatic inline fallback (`<= 700KB`).
- **Production WebRTC Voice & Video Calling**:
  - Firebase Realtime Database signaling (`/calls/{callId}`, `/incomingCalls/{calleeId}/{callId}`).
  - Dynamic Opus audio tuning with FEC (`useinbandfec=1`), DTX (`usedtx=1`), and 32 kbps bitrate cap.
  - Native iOS CallKit integration (`CXProvider`, `CXCallController`) for lock-screen ringing.
  - 200% Volume Booster, Picture-in-Picture (PiP), and deterministic glare resolution.
- **Apple Liquid Glass Design System**: Deep OLED canvas (`#050505`), translucent frosted panels (`backdrop-filter: blur(20px)`), and floating pill navigation.

---

## 📱 Platform Targets

| Platform | Technology Stack | Native Capabilities |
| :--- | :--- | :--- |
| **Web** | React 19, TypeScript, Vite, Tailwind/CSS | Web Crypto API, WebRTC, MediaRecorder, HTML5-QRCode |
| **iOS** | Pure Swift 5.9, SwiftUI, Xcode | CryptoKit, CommonCrypto, CallKit, AVFoundation, GoogleWebRTC |
| **Android** | Kotlin, Jetpack Compose, Gradle | `javax.crypto`, CameraX, TelecomManager, Stream-WebRTC |

---

## 🚀 Getting Started

### Web Client
```bash
# Install dependencies
npm ci

# Run development server
npm run dev

# Run unit & cryptographic test suite
npm test

# Build production bundle
npm run build
```

### iOS Native Target
```bash
# Open in Xcode on macOS
open ios/Luma.xcodeproj

# Package unsigned installable IPA
./ios/package_ipa.sh
```

### Android Native Target
```bash
# Build Android release APK
cd android
./gradlew assembleRelease
```

---

## 🔄 CI/CD Workflows

- `.github/workflows/web-build.yml`: Automated TypeScript typecheck, Vitest test suite, and Vite production bundle.
- `.github/workflows/build-ipa.yml`: macOS-14 Xcode build archiving and packaging `Luma.ipa`.
- `.github/workflows/android-build.yml`: JDK 17 Gradle build compiling `Luma.apk`.

---

## 📄 License
Private & Confidential.
