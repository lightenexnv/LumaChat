# Luma — Resumable Encrypted File Transfer & Media Pipeline

## 1. Core Principles
- **End-to-End Encrypted**: Files are encrypted on the sender's device before hitting the network. Neither Firebase Storage nor any intermediary proxy can view the file contents.
- **Resumable & Chunked**: Large files (up to 100 MB) support pause, resume, and network recovery.
- **Fail-Safe Delivery**: Files <= 700 KB utilize an automatic fallback to inline encrypted Base64 payloads if storage uploads fail.
- **Zero Memory Exhaustion**: File encryption and decryption operate without loading entire 100 MB blobs into JavaScript strings or unmanaged heap allocations.

---

## 2. Binary Payload & Encryption Specification

### File Encryption Format
- **Algorithm**: AES-GCM (256-bit).
- **Key**: Derived via PBKDF2 from `pairingSecret` and `conversationId`.
- **Initialization Vector (IV)**: 12 bytes generated cryptographically randomly per file.
- **Wire Layout**:
  ```
  ┌──────────────────┬─────────────────────────────────────────────────────────────┐
  │  12 Bytes IV     │  AES-GCM Ciphertext + 16 Bytes Authentication Tag           │
  └──────────────────┴─────────────────────────────────────────────────────────────┘
  ```

### Storage Location & Security Rules Compliance
- **Storage Path**:
  `conversations/{conversationId}/{messageId}/payload.bin`
- **Content-Type**:
  `application/octet-stream` (**MANDATORY**; any other MIME type is rejected by Firebase Storage rules with HTTP 403 Forbidden).
- **Metadata**:
  Stored in Firebase Storage `customMetadata`:
  ```json
  {
    "originalFileName": "document.pdf",
    "originalContentType": "application/pdf"
  }
  ```
- **Size Bounds**: Max `104,857,600` bytes (100 MB).

---

## 3. Upload & Fallback Strategy

```
                         Select File
                              │
                    Size <= 100 MB Valid?
                     ├── No ──► Reject with User Warning
                     └── Yes
                              │
                    Encrypt to Binary Payload
                              │
                      Size <= 700 KB?
                       ├── Yes ──► Try Firebase Storage Upload
                       │                 ├── Success ──► Save Storage Path
                       │                 └── Error   ──► Fallback: encode inline:base64
                       └── No  ──► Resumable Firebase Storage Upload
                                         ├── Progress Stream (0-100%)
                                         └── Commit Storage Path
                              │
                    Dispatch Encrypted Message
                     to Firestore with Path
```

---

## 4. Media Types & Player Capabilities

| Type | Formats Supported | UI Representation | Player Capability |
| :--- | :--- | :--- | :--- |
| **Image** | JPEG, PNG, WebP, GIF | Translucent glass thumbnail with hero zoom | Full-screen pinch-to-zoom, pan, save to camera roll |
| **Video** | MP4, MOV, WebM | Blurred video thumbnail with play overlay | In-app native hardware-accelerated video player with scrubbing |
| **Audio / Voice** | Opus, AAC, M4A, WAV | Waveform bars with play/pause pill | Progressive audio streamer with playback rate (1x, 1.5x, 2x) |
| **Document** | PDF, DOCX, ZIP, XLSX | File icon, file size pill, original name | QuickLook preview (iOS), system intent (Android), save/share |

---

## 5. Voice Note Recorder Engine
- **Encoding**: Opus in WebM container (Web), AAC/M4A (iOS/Android) or Opus Ogg.
- **Sample Rate**: 48,000 Hz, mono.
- **Live Metering**: Audio decibel levels sampled at 60 Hz to drive the animated waveform bar visualizer.
- **Gestures**:
  - Hold mic icon to record.
  - Slide left to cancel (with trash-can sound).
  - Slide up to lock into hands-free recording mode.
  - Preview & review before sending.
