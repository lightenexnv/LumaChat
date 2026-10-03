import Foundation
import Combine
import AVFoundation

#if canImport(WebRTC)
import WebRTC

final class NativeRTCClient: NSObject, RTCPeerConnectionDelegate {
    private let factory: RTCPeerConnectionFactory
    private var peerConnection: RTCPeerConnection?
    private var localAudioTrack: RTCAudioTrack?
    private var localVideoTrack: RTCVideoTrack?
    var onIceCandidate: ((RTCIceCandidate) -> Void)?
    
    override init() {
        RTCInitializeSSL()
        let videoEncoderFactory = RTCDefaultVideoEncoderFactory()
        let videoDecoderFactory = RTCDefaultVideoDecoderFactory()
        self.factory = RTCPeerConnectionFactory(encoderFactory: videoEncoderFactory, decoderFactory: videoDecoderFactory)
        super.init()
    }
    
    func createPeerConnection(iceServers: [String] = ["stun:stun.l.google.com:19302"]) -> RTCPeerConnection? {
        let config = RTCConfiguration()
        config.iceServers = [RTCIceServer(urlStrings: iceServers)]
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: ["DtlsSrtpKeyAgreement": "true"])
        let pc = factory.peerConnection(with: config, constraints: constraints, delegate: self)
        self.peerConnection = pc
        return pc
    }
    
    func setupMediaTracks(isVideo: Bool) {
        let audioConst = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let audioSource = factory.audioSource(with: audioConst)
        let audioTrack = factory.audioTrack(with: audioSource, trackId: "audio0")
        self.localAudioTrack = audioTrack
        peerConnection?.add(audioTrack, streamIds: ["stream0"])
        
        if isVideo {
            let videoSource = factory.videoSource()
            let videoTrack = factory.videoTrack(with: videoSource, trackId: "video0")
            self.localVideoTrack = videoTrack
            peerConnection?.add(videoTrack, streamIds: ["stream0"])
        }
    }
    
    func createOffer(completion: @escaping (String?) -> Void) {
        let constraints = RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": "true"], optionalConstraints: nil)
        peerConnection?.offer(for: constraints) { [weak self] sdp, _ in
            guard let sdp = sdp else { completion(nil); return }
            self?.peerConnection?.setLocalDescription(sdp) { _ in
                completion(sdp.sdp)
            }
        }
    }
    
    func createAnswer(remoteSdp: String, completion: @escaping (String?) -> Void) {
        let remoteDesc = RTCSessionDescription(type: .offer, sdp: remoteSdp)
        peerConnection?.setRemoteDescription(remoteDesc) { [weak self] _ in
            let constraints = RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": "true"], optionalConstraints: nil)
            self?.peerConnection?.answer(for: constraints) { sdp, _ in
                guard let sdp = sdp else { completion(nil); return }
                self?.peerConnection?.setLocalDescription(sdp) { _ in
                    completion(sdp.sdp)
                }
            }
        }
    }
    
    func addIceCandidate(_ candidate: RTCIceCandidate) {
        peerConnection?.add(candidate)
    }
    
    func close() {
        peerConnection?.close()
        peerConnection = nil
    }
    
    // RTCPeerConnectionDelegate
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        onIceCandidate?(candidate)
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
}
#endif

public enum CallQualityProfile: String, CaseIterable {
    case high = "1080p (Wi-Fi / 5G)"
    case balanced = "720p (4G / Strong LTE)"
    case adaptiveLowLatency = "360p (Weak 2-3 bar LTE)"
}

public enum CallState: String {
    case idle = "idle"
    case ringing = "ringing"
    case connected = "connected"
    case declined = "declined"
    case ended = "ended"
}

public final class WebRTCService: ObservableObject {
    public static let shared = WebRTCService()
    
    @Published public var isCallActive: Bool = false
    @Published public var callState: CallState = .idle
    @Published public var activeCallId: String = ""
    @Published public var isCaller: Bool = true
    
    @Published public var isMuted: Bool = false
    @Published public var isCameraOff: Bool = false
    @Published public var isFrontCamera: Bool = true
    @Published public var isMirrorCameraOn: Bool {
        didSet {
            UserDefaults.standard.set(isMirrorCameraOn, forKey: "luma_call_mirror_camera")
        }
    }
    @Published public var volumeBoost: Double {
        didSet {
            UserDefaults.standard.set(volumeBoost, forKey: "luma_call_volume_boost")
        }
    }
    @Published public var networkQuality: CallQualityProfile = .high
    @Published public var callDurationSeconds: Int = 0
    
    @Published public var activeParticipantId: String = ""
    @Published public var activeParticipantName: String = ""
    @Published public var activeParticipantInitials: String = ""
    @Published public var activeParticipantColor: String = "#25D366"
    @Published public var activeParticipantAvatar: String? = nil
    @Published public var isVideoCall: Bool = true
    
    @Published public var incomingCall: IncomingCallModel? = nil
    
    private var callTimer: Timer?
    private var signalingPollTimer: Timer?
    private var incomingWatchTimer: Timer?
    private var ringSecondsCounter: Int = 0
    
    private var activeConversationId: String = ""
    private var activePairingSecret: String = ""
    
    private init() {
        self.isMirrorCameraOn = UserDefaults.standard.object(forKey: "luma_call_mirror_camera") as? Bool ?? true
        self.volumeBoost = UserDefaults.standard.object(forKey: "luma_call_volume_boost") as? Double ?? 1.0
        startIncomingCallWatcher()
    }
    
    // MARK: - Outgoing Call (Caller)
    public func startCall(with friend: Friend, isVideo: Bool) {
        let auth = AuthService.shared
        guard let currentUser = auth.currentUser ?? {
            auth.restoreSession()
            return auth.currentUser
        }() else { return }
        
        let callId = "call_\(Int64(Date().timeIntervalSince1970 * 1000))_\(UUID().uuidString.prefix(6))"
        self.activeCallId = callId
        self.activeParticipantId = friend.id
        self.activeParticipantName = friend.displayName
        self.activeParticipantInitials = friend.initials
        self.activeParticipantColor = friend.color
        self.activeParticipantAvatar = friend.photoURL
        self.isVideoCall = isVideo
        self.isCaller = true
        self.callState = .ringing
        self.isCallActive = true
        self.isMuted = false
        self.isCameraOff = false
        self.callDurationSeconds = 0
        self.ringSecondsCounter = 0
        self.activeConversationId = friend.conversationId
        self.activePairingSecret = friend.pairingSecret
        
        // Start CallKit session
        CallManager.shared.startCall(handle: friend.handle, displayName: friend.displayName, hasVideo: isVideo)
        
        // Write to Firebase Realtime Database: /calls/{callId}, /incomingCalls/{calleeId}/{callId}, and /calls/{callId}/offer
        Task {
            await self.publishOutgoingCallSignaling(callId: callId, calleeId: friend.id, isVideo: isVideo, currentUser: currentUser)
        }
        
        // Start polling signaling state on /calls/{callId}/state.json
        startSignalingPoller(callId: callId)
    }
    
    private func publishOutgoingCallSignaling(callId: String, calleeId: String, isVideo: Bool, currentUser: LumaUser) async {
        let auth = AuthService.shared
        guard let token = await auth.getOrRefreshIdToken() else {
            print("[WebRTCService] No valid idToken for call signaling")
            return
        }
        let now = Date().timeIntervalSince1970 * 1000
        
        let nameStr = currentUser.displayName.isEmpty ? "Luma User" : String(currentUser.displayName.prefix(100))
        let initStr = currentUser.initials.isEmpty ? "LU" : String(currentUser.initials.prefix(8))
        let colStr = currentUser.color.isEmpty ? "#25D366" : String(currentUser.color.prefix(32))
        
        var callerProfile: [String: Any] = [
            "name": nameStr,
            "initials": initStr,
            "color": colStr
        ]
        if let photo = currentUser.photoURL, !photo.isEmpty {
            callerProfile["photoURL"] = photo
        }
        
        let callPayload: [String: Any] = [
            "callerId": currentUser.id,
            "calleeId": calleeId,
            "kind": isVideo ? "video" : "voice",
            "callerProfile": callerProfile,
            "createdAt": Int64(now),
            "state": "ringing"
        ]
        
        let incomingPayload: [String: Any] = [
            "callId": callId,
            "callerId": currentUser.id,
            "calleeId": calleeId,
            "kind": isVideo ? "video" : "voice",
            "callerProfile": callerProfile,
            "createdAt": Int64(now),
            "state": "ringing"
        ]
        
        // 1. Write /calls/{callId}.json?auth=\(token)
        if let callUrl = URL(string: "\(auth.databaseURL)/calls/\(callId).json?auth=\(token)") {
            var req = URLRequest(url: callUrl)
            req.httpMethod = "PUT"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: callPayload)
            _ = try? await URLSession.shared.data(for: req)
        }
        
        // 2. Write /incomingCalls/{calleeId}/{callId}.json?auth=\(token)
        if let incUrl = URL(string: "\(auth.databaseURL)/incomingCalls/\(calleeId)/\(callId).json?auth=\(token)") {
            var req = URLRequest(url: incUrl)
            req.httpMethod = "PUT"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: incomingPayload)
            _ = try? await URLSession.shared.data(for: req)
        }
        
        // 3. Write /calls/{callId}/offer.json?auth=\(token)
        let offerPayload: [String: Any] = [
            "type": "offer",
            "sdp": Self.generateStandardSdp(isVideo: isVideo, isAnswer: false)
        ]
        if let offerUrl = URL(string: "\(auth.databaseURL)/calls/\(callId)/offer.json?auth=\(token)") {
            var req = URLRequest(url: offerUrl)
            req.httpMethod = "PUT"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: offerPayload)
            _ = try? await URLSession.shared.data(for: req)
        }
    }
    
    // MARK: - Signaling State Poller (Watches for answer/accept/decline from other peer)
    private func startSignalingPoller(callId: String) {
        signalingPollTimer?.invalidate()
        signalingPollTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self, self.isCallActive else { return }
            Task {
                await self.checkCallSignalingState(callId: callId)
            }
        }
    }
    
    private func checkCallSignalingState(callId: String) async {
        let auth = AuthService.shared
        guard let token = await auth.getOrRefreshIdToken() else { return }
        guard let url = URL(string: "\(auth.databaseURL)/calls/\(callId)/state.json?auth=\(token)") else { return }
        
        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let rawString = String(data: data, encoding: .utf8)?.trimmingCharacters(in: CharacterSet(charactersIn: "\" \n\r\t")) else {
            return
        }
        
        await MainActor.run {
            if rawString == "accepted" && self.callState != .connected {
                // Call was answered by peer!
                self.callState = .connected
                self.startDurationTimer()
                SoundManager.shared.playOutgoingMessageSound()
            } else if rawString == "declined" {
                // Call was declined
                self.callState = .declined
                SoundManager.shared.playDeclinedSound()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    self.endCallLocally(outcome: "declined")
                }
            } else if rawString == "ended" {
                // Call was hung up
                self.callState = .ended
                self.endCallLocally(outcome: "completed")
            } else if self.callState == .ringing {
                self.ringSecondsCounter += 1
                if self.ringSecondsCounter >= 60 {
                    // Ring timeout
                    self.endCallLocally(outcome: "missed")
                }
            }
        }
    }
    
    private func startDurationTimer() {
        callTimer?.invalidate()
        callTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.callDurationSeconds += 1
        }
    }
    
    // MARK: - Incoming Call Watcher (iOS listening for calls from Web peer)
    public func startIncomingCallWatcher() {
        incomingWatchTimer?.invalidate()
        incomingWatchTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            guard let self = self, !self.isCallActive else { return }
            Task {
                await self.pollIncomingCalls()
            }
        }
    }
    
    private func pollIncomingCalls() async {
        let auth = AuthService.shared
        guard let user = auth.currentUser else { return }
        guard let token = await auth.getOrRefreshIdToken() else { return }
        guard let url = URL(string: "\(auth.databaseURL)/incomingCalls/\(user.id).json?auth=\(token)") else { return }
        
        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Any]] else {
            await MainActor.run {
                if self.incomingCall != nil && !self.isCallActive {
                    self.incomingCall = nil
                }
            }
            return
        }
        
        let now = Date().timeIntervalSince1970 * 1000
        var activeCall: IncomingCallModel? = nil
        
        for (callId, callData) in dict {
            let state = callData["state"] as? String ?? ""
            let createdAt = callData["createdAt"] as? Double ?? 0
            
            if state == "ringing" && (now - createdAt) <= 60000 && (createdAt - now) <= 60000 {
                let callerId = callData["callerId"] as? String ?? ""
                let calleeId = callData["calleeId"] as? String ?? user.id
                let kind = callData["kind"] as? String ?? "voice"
                let callerProf = callData["callerProfile"] as? [String: Any] ?? [:]
                let name = callerProf["name"] as? String ?? "Luma User"
                let initials = callerProf["initials"] as? String ?? String(name.prefix(1)).uppercased()
                let color = callerProf["color"] as? String ?? "#25D366"
                let photo = callerProf["photoURL"] as? String
                
                activeCall = IncomingCallModel(
                    id: callId,
                    callerId: callerId,
                    calleeId: calleeId,
                    kind: kind,
                    callerName: name,
                    callerInitials: initials,
                    callerColor: color,
                    callerPhotoURL: photo,
                    createdAt: createdAt
                )
                break
            } else if state != "ringing" || (now - createdAt) > 60000 {
                // Clean up stale entry
                if let delUrl = URL(string: "\(auth.databaseURL)/incomingCalls/\(user.id)/\(callId).json?auth=\(token)") {
                    var delReq = URLRequest(url: delUrl)
                    delReq.httpMethod = "DELETE"
                    _ = try? await URLSession.shared.data(for: delReq)
                }
            }
        }
        
        let callToUpdate = activeCall
        await MainActor.run {
            if let call = callToUpdate {
                if self.incomingCall?.id != call.id {
                    self.incomingCall = call
                    SoundManager.shared.playIncomingRing()
                    CallManager.shared.reportIncomingCall(callerName: call.callerName, hasVideo: call.kind == "video")
                }
            } else {
                if self.incomingCall != nil && !self.isCallActive {
                    self.incomingCall = nil
                }
            }
        }
    }
    
    // MARK: - Answer / Decline Incoming Call
    public func acceptIncomingCall(_ call: IncomingCallModel) {
        let auth = AuthService.shared
        guard let user = auth.currentUser else { return }
        
        SoundManager.shared.stopIncomingRing()
        self.activeCallId = call.id
        self.activeParticipantId = call.callerId
        self.activeParticipantName = call.callerName
        self.activeParticipantInitials = call.callerInitials
        self.activeParticipantColor = call.callerColor
        self.activeParticipantAvatar = call.callerPhotoURL
        self.isVideoCall = (call.kind == "video")
        self.isCaller = false
        self.callState = .connected
        self.isCallActive = true
        self.incomingCall = nil
        self.callDurationSeconds = 0
        
        // Find friend record to get conversationId and pairingSecret
        if let friend = DatabaseService.shared.friends.first(where: { $0.id == call.callerId }) {
            self.activeConversationId = friend.conversationId
            self.activePairingSecret = friend.pairingSecret
        }
        
        Task {
            guard let token = await auth.getOrRefreshIdToken() else { return }
            
            // 1. Update /calls/{callId}/state to "accepted"
            if let url = URL(string: "\(auth.databaseURL)/calls/\(call.id)/state.json?auth=\(token)") {
                var req = URLRequest(url: url)
                req.httpMethod = "PUT"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try? JSONSerialization.data(withJSONObject: "accepted")
                _ = try? await URLSession.shared.data(for: req)
            }
            
            // 2. Write /calls/{callId}/answer.json
            let answerSdp = Self.generateStandardSdp(isVideo: call.kind == "video", isAnswer: true)
            let answerPayload: [String: Any] = [
                "type": "answer",
                "sdp": answerSdp
            ]
            if let ansUrl = URL(string: "\(auth.databaseURL)/calls/\(call.id)/answer.json?auth=\(token)") {
                var ansReq = URLRequest(url: ansUrl)
                ansReq.httpMethod = "PUT"
                ansReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
                ansReq.httpBody = try? JSONSerialization.data(withJSONObject: answerPayload)
                _ = try? await URLSession.shared.data(for: ansReq)
            }
            
            // 3. Remove /incomingCalls/{user.id}/{call.id}.json
            if let delUrl = URL(string: "\(auth.databaseURL)/incomingCalls/\(user.id)/\(call.id).json?auth=\(token)") {
                var delReq = URLRequest(url: delUrl)
                delReq.httpMethod = "DELETE"
                _ = try? await URLSession.shared.data(for: delReq)
            }
        }
        
        startDurationTimer()
        startSignalingPoller(callId: call.id)
    }
    
    public func declineIncomingCall(_ callId: String) {
        let auth = AuthService.shared
        guard let user = auth.currentUser else { return }
        SoundManager.shared.stopIncomingRing()
        self.incomingCall = nil
        
        Task {
            guard let token = await auth.getOrRefreshIdToken() else { return }
            
            if let url = URL(string: "\(auth.databaseURL)/calls/\(callId)/state.json?auth=\(token)") {
                var req = URLRequest(url: url)
                req.httpMethod = "PUT"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try? JSONSerialization.data(withJSONObject: "declined")
                _ = try? await URLSession.shared.data(for: req)
            }
            if let endUrl = URL(string: "\(auth.databaseURL)/calls/\(callId)/endedAt.json?auth=\(token)") {
                var endReq = URLRequest(url: endUrl)
                endReq.httpMethod = "PUT"
                endReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
                endReq.httpBody = try? JSONSerialization.data(withJSONObject: Int64(Date().timeIntervalSince1970 * 1000))
                _ = try? await URLSession.shared.data(for: endReq)
            }
            if let delUrl = URL(string: "\(auth.databaseURL)/incomingCalls/\(user.id)/\(callId).json?auth=\(token)") {
                var delReq = URLRequest(url: delUrl)
                delReq.httpMethod = "DELETE"
                _ = try? await URLSession.shared.data(for: delReq)
            }
        }
        CallManager.shared.endCall()
    }
    
    // MARK: - End Active Call
    public func endCall() {
        let auth = AuthService.shared
        let callId = activeCallId
        let participantId = activeParticipantId
        
        Task {
            guard let token = await auth.getOrRefreshIdToken() else { return }
            if !callId.isEmpty {
                if let url = URL(string: "\(auth.databaseURL)/calls/\(callId)/state.json?auth=\(token)") {
                    var req = URLRequest(url: url)
                    req.httpMethod = "PUT"
                    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    req.httpBody = try? JSONSerialization.data(withJSONObject: "ended")
                    _ = try? await URLSession.shared.data(for: req)
                }
                if let endUrl = URL(string: "\(auth.databaseURL)/calls/\(callId)/endedAt.json?auth=\(token)") {
                    var endReq = URLRequest(url: endUrl)
                    endReq.httpMethod = "PUT"
                    endReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    endReq.httpBody = try? JSONSerialization.data(withJSONObject: Int64(Date().timeIntervalSince1970 * 1000))
                    _ = try? await URLSession.shared.data(for: endReq)
                }
                if !participantId.isEmpty, let delUrl = URL(string: "\(auth.databaseURL)/incomingCalls/\(participantId)/\(callId).json?auth=\(token)") {
                    var delReq = URLRequest(url: delUrl)
                    delReq.httpMethod = "DELETE"
                    _ = try? await URLSession.shared.data(for: delReq)
                }
            }
        }
        
        endCallLocally(outcome: "completed")
    }
    
    // MARK: - Standard WebRTC SDP Offer / Answer Generator
    private static func generateStandardSdp(isVideo: Bool, isAnswer: Bool = false) -> String {
        let timestamp = Int64(Date().timeIntervalSince1970)
        let setupAttr = isAnswer ? "active" : "actpass"
        var sdp = "v=0\r\no=- \(timestamp) 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"
        if isVideo {
            sdp += "a=group:BUNDLE 0 1\r\n"
        } else {
            sdp += "a=group:BUNDLE 0\r\n"
        }
        sdp += "a=msid-semantic: WMS\r\n"
        
        // Audio Media Section (mid 0)
        sdp += "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
        sdp += "c=IN IP4 0.0.0.0\r\n"
        sdp += "a=rtcp:9 IN IP4 0.0.0.0\r\n"
        sdp += "a=mid:0\r\n"
        sdp += "a=sendrecv\r\n"
        sdp += "a=rtcp-mux\r\n"
        sdp += "a=setup:\(setupAttr)\r\n"
        sdp += "a=rtpmap:111 opus/48000/2\r\n"
        sdp += "a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=32000\r\n"
        sdp += "b=AS:32\r\n"
        
        if isVideo {
            // Video Media Section (mid 1)
            sdp += "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n"
            sdp += "c=IN IP4 0.0.0.0\r\n"
            sdp += "a=rtcp:9 IN IP4 0.0.0.0\r\n"
            sdp += "a=mid:1\r\n"
            sdp += "a=sendrecv\r\n"
            sdp += "a=rtcp-mux\r\n"
            sdp += "a=setup:\(setupAttr)\r\n"
            sdp += "a=rtpmap:96 H264/90000\r\n"
            sdp += "a=rtcp-fb:96 nack pli\r\n"
            sdp += "a=rtcp-fb:96 transport-cc\r\n"
            sdp += "b=AS:2500\r\n"
            sdp += "b=TIAS:2500000\r\n"
        }
        return sdp
    }
    
    private func endCallLocally(outcome: String = "completed") {
        callTimer?.invalidate()
        callTimer = nil
        signalingPollTimer?.invalidate()
        signalingPollTimer = nil
        
        if isCallActive {
            let duration = callDurationSeconds
            let startTime = Date().timeIntervalSince1970 * 1000 - Double(duration * 1000)
            
            // Log to local call history
            let record = CallRecord(
                id: UUID().uuidString,
                friendId: activeParticipantId.isEmpty ? "unknown" : activeParticipantId,
                friendName: activeParticipantName,
                friendInitials: activeParticipantInitials.isEmpty ? String(activeParticipantName.prefix(1)).uppercased() : activeParticipantInitials,
                friendColor: activeParticipantColor,
                friendPhotoURL: activeParticipantAvatar,
                direction: isCaller ? "outgoing" : "incoming",
                kind: isVideoCall ? "video" : "voice",
                outcome: outcome,
                durationSeconds: duration,
                initiatedAt: startTime,
                endedAt: Date().timeIntervalSince1970 * 1000
            )
            DatabaseService.shared.logCall(record)
            
            // Send encrypted Call Summary message bubble to the chat conversation
            if !activeConversationId.isEmpty && !activePairingSecret.isEmpty {
                let callSummaryDict: [String: Any] = [
                    "kind": "call",
                    "call": [
                        "kind": isVideoCall ? "video" : "voice",
                        "outcome": outcome,
                        "durationSeconds": duration,
                        "initiatedAt": startTime,
                        "callerId": isCaller ? (AuthService.shared.currentUser?.id ?? "") : activeParticipantId
                    ]
                ]
                let convId = activeConversationId
                let secret = activePairingSecret
                Task {
                    if let ciphertext = try? DatabaseService.shared.encryptPayload(conversationId: convId, pairingSecret: secret, payload: callSummaryDict),
                       let token = AuthService.shared.idToken,
                       let user = AuthService.shared.currentUser {
                        let endpoint = "https://firestore.googleapis.com/v1/projects/\(AuthService.shared.projectId)/databases/(default)/documents/conversations/\(convId)/messages"
                        if let url = URL(string: endpoint) {
                            var req = URLRequest(url: url)
                            req.httpMethod = "POST"
                            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                            let body: [String: Any] = [
                                "fields": [
                                    "ciphertext": ["stringValue": ciphertext],
                                    "senderId": ["stringValue": user.id],
                                    "status": ["stringValue": "sent"],
                                    "type": ["stringValue": "call"],
                                    "createdAt": ["timestampValue": ISO8601DateFormatter().string(from: Date())]
                                ]
                            ]
                            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
                            _ = try? await URLSession.shared.data(for: req)
                        }
                    }
                }
            }
        }
        
        CallManager.shared.endCall()
        isCallActive = false
        callState = .idle
        callDurationSeconds = 0
        activeCallId = ""
    }
    
    public func toggleMute() {
        isMuted.toggle()
        CallManager.shared.setMuted(isMuted)
    }
    
    public func toggleCamera() {
        isCameraOff.toggle()
    }
    
    public func switchCamera() {
        isFrontCamera.toggle()
    }
    
    public func toggleMirrorCamera() {
        isMirrorCameraOn.toggle()
    }
    
    public func formatDuration(_ seconds: Int) -> String {
        let mins = seconds / 60
        let secs = seconds % 60
        return String(format: "%02d:%02d", mins, secs)
    }
}
