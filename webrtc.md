# Luma — WebRTC Architecture, Signaling & Media Specification

## 1. Overview & Protocol Standard
To guarantee 100% interoperability across Web (Chrome, Safari, Firefox), iOS (Swift native), and Android (Kotlin native), Luma uses the official **W3C WebRTC 1.0 Specification** paired with Google's native WebRTC engines:
- **Web**: Standard browser `RTCPeerConnection` API.
- **iOS**: Native `GoogleWebRTC` framework (`RTCConfiguration`, `RTCPeerConnection`, `RTCAudioTrack`, `RTCVideoTrack`, `RTCCameraVideoCapturer`).
- **Android**: Official `google-webrtc` AAR library.

---

## 2. Signaling State Machine & Realtime Database Nodes

Signaling is conducted over Firebase Realtime Database with sub-second WebSocket updates.

```
       [Idle]
          │
     Initiate Call
          │
          ▼
      [Ringing] ───────────── Timeout (60s) / Decline ─────────────► [Declined / Ended]
          │
        Accept
          │
          ▼
     [Connected] ──────────── User Hangs Up / Disconnect ──────────► [Ended]
```

### 2.1. Node Specifications
1. `/calls/{callId}`:
   - `callerId` (string, max 128 chars): UID of caller.
   - `calleeId` (string, max 128 chars): UID of callee.
   - `kind` ('voice' | 'video').
   - `callerProfile` (object with `name`, `initials`, `color`, optional `photoURL`).
   - `state` ('ringing' | 'accepted' | 'declined' | 'ended').
   - `createdAt` (epoch ms).
   - `endedAt` (epoch ms, optional until finished).
   - `offer`: `{ type: "offer", sdp: string }` (written by caller).
   - `answer`: `{ type: "answer", sdp: string }` (written by callee).
   - `callerCandidates/{key}`: Sanitized ICE candidate.
   - `calleeCandidates/{key}`: Sanitized ICE candidate.

2. `/incomingCalls/{calleeId}/{callId}`:
   - Written atomically by caller when call starts.
   - Validated by RTDB rules: must match `callId`, `callerId`, `calleeId`, and `state == "ringing"`.
   - Callee listens to `/incomingCalls/{myUid}`. When child added, triggers native incoming call banner/CallKit.
   - Removed by callee upon accepting/declining or when ring timeout expires (60s).

---

## 3. Simultaneous Calling (Glare) Resolution

When User A and User B call each other at the same moment:
1. **Rule 1 (Merge to Pending)**: If client initiates an outgoing call to Peer B while an incoming call from Peer B is already present in ringing state, client cancels outgoing attempt and automatically accepts the existing incoming call.
2. **Rule 2 (Deterministic Caller Election)**: If both offers were published simultaneously:
   - The user whose UID is lexicographically smaller (`myUid < peerUid`) is designated the canonical caller.
   - The peer with the larger UID drops its own outgoing call node and accepts the peer's call offer.

---

## 4. Codec Tuning & SDP Munging

### 4.1. Opus Audio Pipeline (Cellular & Low-Bandwidth Resilience)
In mobile environments (4G/LTE 2-3 bars), packet loss can cause severe stuttering. Luma explicitly munges the Opus SDP `a=fmtp` line on all platforms:
```sdp
a=fmtp:111 minptime=10;ptime=20;maxaveragebitrate=32000;stereo=0;sprop-stereo=0;useinbandfec=1;usedtx=1;cbr=0;maxplaybackrate=48000;sprop-maxcapturerate=48000
```
- `useinbandfec=1`: Enables Opus Forward Error Correction. When up to 20% of packets are lost, the decoder recovers audio from the redundant FEC payload inside neighboring packets.
- `usedtx=1`: Discontinuous Transmission turns off transmission during speech silence, cutting uplink bandwidth by 50%.
- `maxaveragebitrate=32000`: Caps audio bandwidth at 32 kbps, leaving maximum network headroom for video and preventing mobile carrier queue bufferbloat.

### 4.2. Video Codecs & RTCP Feedback
- Primary Codec: **H.264 (Constrained Baseline Profile)**. Hardware accelerated across iOS (VideoToolbox), Android (MediaCodec), and Web.
- Mandatory RTCP Feedback lines injected into SDP:
  - `a=rtcp-fb:* nack` (Negative Acknowledgement for packet loss recovery)
  - `a=rtcp-fb:* nack pli` (Picture Loss Indication to request new keyframes)
  - `a=rtcp-fb:* goog-remb` (Receiver Estimated Maximum Bitrate)
  - `a=rtcp-fb:* transport-cc` (Transport-wide Congestion Control)
  - `a=rtcp-fb:* ccm fir` (Full Intra Request)

---

## 5. Dynamic Adaptive Quality Profiles & Network Monitoring

Luma continually monitors WebRTC `getStats()` for RTT, packet loss, and frame drop rates:

| Profile | Mode | Target Resolution | Frame Rate | Max Bitrate | Activation Trigger |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **High** | `1080p` | 1920x1080 | 30 fps | 4.5 Mbps | Wi-Fi / 5G (RTT < 80ms, loss < 1%) |
| **Balanced** | `720p` | 1280x720 | 30 fps | 2.5 Mbps | Strong 4G/LTE (RTT < 150ms, loss < 3%) |
| **Standard** | `480p` | 854x480 | 24 fps | 1.2 Mbps | Moderate cellular |
| **Adaptive Low**| `360p` | 640x360 | 15 fps | 650 kbps | Weak cellular (RTT > 250ms, loss > 5%) |
| **Audio-Only**| `audio` | Off | 0 fps | 32 kbps | Critical packet loss (> 15% for 5s) |

When network conditions recover for > 10 seconds, video quality gradually scales back up.

---

## 6. ICE Candidate Sanitization
RTDB security rules enforce strict limits on ICE candidate nodes:
- `candidate`: string, max 20,000 characters.
- `sdpMid`: string, max 128 characters.
- `sdpMLineIndex`: number.
- `usernameFragment`: string, max 128 characters.
Candidates are sanitized before sending to prevent rules validation rejections.

---

## 7. OS-Level Native Call Integration
- **iOS CallKit**:
  - `CXProvider` handles incoming call notifications on the native lock screen.
  - Answering via CallKit activates `AVAudioSessionCategoryPlayAndRecord` with `.voiceChat` mode, configuring system noise cancellation.
- **Android ConnectionService / TelecomManager**:
  - Registers phone account and launches native full-screen incoming call UI.
