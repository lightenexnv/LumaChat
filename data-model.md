# Luma — Cross-Platform Data Model & Schema Contracts

All platforms (Web, iOS, Android) strictly adhere to these shared schemas. Field names, types, and constraints must remain identical.

---

## 1. Cloud Firestore Collections

### 1.1. `/users/{uid}` (User Profile)
```typescript
interface UserProfile {
  uid: string;                 // Matches auth.uid (1-128 chars)
  displayName: string;         // 1-100 chars
  handle: string;              // 1-100 chars (lowercase unique handle)
  initials: string;            // 1-8 chars (e.g. "AV")
  color: string;               // 1-32 chars (hex, e.g. "#30D158")
  photoURL?: string | null;    // Storage download URL or null
  statusText?: string | null;  // Max 200 chars
  createdAt: number;           // Unix epoch timestamp in milliseconds
  lastSeen?: number;           // Unix epoch timestamp in milliseconds
}
```

### 1.2. `/users/{uid}/contacts/{contactUid}` (Paired Contact)
```typescript
interface Contact {
  uid: string;                 // Peer's UID (matches contactUid)
  inviteId?: string | null;    // Invite ID that established connection
  name: string;                // Peer's display name
  nickname?: string | null;    // Local custom nickname assigned by user
  handle: string;              // Peer's handle
  initials: string;            // Peer's initials
  color: string;               // Peer's color
  photoURL?: string | null;    // Peer's avatar
  conversationId: string;      // Canonical conversation ID
  pairingSecret: string;       // 6-character shared PBKDF2 pairing secret
  createdAt: number;           // Timestamp connection established
  pinned?: boolean;            // Whether contact is pinned in chat list
  clearedAt?: number;          // Timestamp messages were locally cleared
}
```

### 1.3. `/invites/{inviteId}` (One-Time Pairing Invite)
```typescript
interface Invite {
  ownerId: string;             // UID of user creating invite
  ownerProfile: {
    name: string;
    handle: string;
    initials: string;
    color: string;
    photoURL?: string | null;
  };
  createdAt: number;           // Timestamp invite created
  expiresAt: number;           // Timestamp invite expires (max 1 hour after creation)
  acceptedBy: string | null;   // UID of accepting peer (null until claimed)
  acceptedProfile: {
    name: string;
    handle: string;
    initials: string;
    color: string;
    photoURL?: string | null;
  } | null;
}
```

### 1.4. `/conversations/{conversationId}` (1:1 Conversation Room)
```typescript
interface Conversation {
  memberIds: [string, string]; // Exactly two user UIDs
  updatedAt: number;           // Timestamp of latest activity
  pinnedMessageId?: string;    // ID of pinned message in chat
  pinnedBy?: string;           // UID of user who pinned the message
  pinnedAt?: Timestamp;        // Firestore Timestamp when pinned
}
```

### 1.5. `/conversations/{conversationId}/messages/{messageId}` (Encrypted Message)
```typescript
interface MessageDocument {
  ciphertext: string;          // Base64(IV) + "." + Base64(Ciphertext)
  senderId: string;            // UID of message sender
  createdAt: Timestamp;        // Firestore server Timestamp
  status: 'sent' | 'delivered' | 'read';
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'contact' | 'call';
  edited?: boolean;
  editedAt?: Timestamp;
  deletedForEveryone?: boolean;
  deletedAt?: Timestamp;
  deletedBy?: string;
  deletedFor?: string[];       // Array of UIDs who hid message locally
}
```

### Plaintext Message Payload (Inside Decrypted Ciphertext)
When decrypted using the conversation AES-GCM key, the string contains JSON conforming to:
```typescript
interface DecryptedMessagePayload {
  kind: 'text' | 'media' | 'document' | 'call';
  text?: string;
  file?: {
    storagePath: string;       // "conversations/.../payload.bin" or "inline:..."
    fileName: string;
    fileSize: number;
    contentType: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
  };
  call?: {
    kind: 'voice' | 'video';
    outcome: 'completed' | 'declined' | 'missed' | 'busy';
    durationSeconds: number;
    initiatedAt: number;
    callerId: string;
  };
  replyTo?: {
    messageId: string;
    senderId: string;
    previewText: string;
  };
}
```

---

## 2. Realtime Database Signaling Schema

### 2.1. `/calls/{callId}`
```typescript
interface RTDBCallNode {
  callerId: string;
  calleeId: string;
  kind: 'voice' | 'video';
  callerProfile: {
    name: string;
    initials: string;
    color: string;
    photoURL?: string;
  };
  state: 'ringing' | 'accepted' | 'declined' | 'ended';
  createdAt: number;
  endedAt?: number;
  offer?: {
    type: 'offer';
    sdp: string;
  };
  answer?: {
    type: 'answer';
    sdp: string;
  };
  callerCandidates?: Record<string, RTCIceCandidateInit>;
  calleeCandidates?: Record<string, RTCIceCandidateInit>;
}
```

### 2.2. `/incomingCalls/{calleeId}/{callId}`
```typescript
interface RTDBIncomingCall {
  callId: string;
  callerId: string;
  calleeId: string;
  kind: 'voice' | 'video';
  callerProfile: {
    name: string;
    initials: string;
    color: string;
  };
  createdAt: number;
  state: 'ringing';
}
```

### 2.3. `/presence/{uid}`
```typescript
interface RTDBPresence {
  online: boolean;
  lastSeen: number;
}
```
