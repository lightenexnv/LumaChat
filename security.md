# Luma — Security Architecture & Threat Model

## 1. Zero-Trust Security Model
Luma treats all intermediate network infrastructure, including Google Firebase servers and TURN relays, as untrusted with respect to user message text and media payloads:
1. **Zero Knowledge on Servers**: Cloud Firestore stores only AES-GCM ciphertext. Firebase Storage stores only binary encrypted streams (`payload.bin`).
2. **On-Device Key Derivation**: Encryption keys are derived strictly on client devices using PBKDF2-HMAC-SHA256 with 120,000 rounds. The pairing secret is exchanged peer-to-peer via one-time invites and never stored in cleartext at root-level unauthenticated endpoints.
3. **Strict Identity Binding**: Every read and write is enforced via declarative Firebase Security Rules.

---

## 2. Cryptographic Specifications

### 2.1. Key Derivation Function (KDF)
- **Algorithm**: PBKDF2 (Password-Based Key Derivation Function 2)
- **Pseudorandom Function (PRF)**: HMAC-SHA256
- **Iteration Count**: `120,000` iterations (balances brute-force hardness with mobile battery efficiency)
- **Salt**: `luma:<conversationId>` (prevents rainbow table attacks across different conversations)
- **Key Output**: 256-bit symmetric key for AES-GCM

### 2.2. Authenticated Encryption (AEAD)
- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **IV / Nonce**: 96-bit (12-byte) cryptographically secure random value generated fresh for every message and file.
- **Tag Length**: 128-bit (16-byte) authentication tag appended to ciphertext.
- **Wire Encoding**:
  - Messages: `Base64(12_byte_IV) + "." + Base64(Ciphertext_and_Tag)`
  - Files: Direct binary concatenation `[12_byte_IV] + [Ciphertext_and_Tag]`

---

## 3. Firebase Security Rules Enforcement

### 3.1. Firestore Rules Highlights (`firestore.rules`)
- **Conversations**: Only authenticated members whose UID is present in `memberIds` can read messages.
- **Message Integrity**: Message creation requires `request.resource.data.status == 'sent'` and sender UID match.
- **Status Updates**: Only the recipient can transition message status (`sent` -> `delivered` -> `read`).
- **Deletions**:
  - "Delete for Everyone": Permitted only by the original sender.
  - "Delete for Me": Permitted by any conversation member by appending their own UID to `deletedFor` array.
- **Invites**: Invites expire strictly after 1 hour (`expiresAt - createdAt <= 3600000`). Once accepted (`acceptedBy != null`), no further modifications are permitted.

### 3.2. Realtime Database Rules Highlights (`database.rules.json`)
- **Signaling Boundary**: Reads and writes to `/calls/{callId}` are restricted strictly to `callerId` and `calleeId`.
- **Validation**: Strict length bounds enforced on SDP strings (max 200,000 characters), candidate strings (max 20,000 characters), and user profile strings.
- **State Transition Guard**: Prevents invalid call state leaps (e.g. ringing cannot revert from ended).

### 3.3. Firebase Storage Rules Highlights (`storage.rules`)
- **Attachment Path**: `conversations/{conversationId}/{messageId}/payload.bin`
- **Membership Check**: Storage queries Firestore in rules (`firestore.get(/databases/(default)/documents/conversations/$(conversationId))`) to guarantee the uploader/downloader is an active member of that exact conversation.
- **Content-Type Lock**: Strictly enforces `application/octet-stream` to prevent malicious unencrypted uploads or executable file hosting.
- **Size Limit**: Hard cap at 100 MB (`104857600` bytes).

---

## 4. Threat Matrix & Mitigations

| Threat Vector | Attack Scenario | Mitigation in Luma |
| :--- | :--- | :--- |
| **Server Compromise** | Rogue administrator inspects Firestore / Storage | All payloads are AES-256-GCM encrypted; server has no access to `pairingSecret`. |
| **Replay Attacks** | Adversary re-submits old encrypted messages | Random 12-byte IV per message + Firestore timestamp validation blocks replay. |
| **Wire Tapping (Calls)**| Eavesdropping on WebRTC media stream | WebRTC mandates DTLS-SRTP encryption for all audio/video packets. |
| **MITM Signaling** | Attacker intercepts or modifies SDP offer/answer | Signaling is TLS-encrypted via Firebase Realtime Database with token-based ACLs. |
| **Invite Brute Force**| Attacker guesses 6-char pairing code | Invites expire in 60 minutes, require authenticated Google/Email session, and are single-use. |
