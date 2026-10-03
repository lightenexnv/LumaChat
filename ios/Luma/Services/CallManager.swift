import Foundation
import CallKit
import AVFoundation
import UIKit

public final class CallManager: NSObject, ObservableObject {
    public static let shared = CallManager()
    
    private let callController = CXCallController()
    private var provider: CXProvider?
    
    @Published public var activeCallUUID: UUID?
    @Published public var isCallActive = false
    @Published public var isCallMuted = false
    @Published public var activePeerName = ""
    @Published public var isVideoCall = true
    
    public var onAnswerCall: ((UUID) -> Void)?
    public var onEndCall: ((UUID) -> Void)?
    public var onMuteCall: ((Bool) -> Void)?
    
    override private init() {
        super.init()
        setupProvider()
    }
    
    private func setupProvider() {
        let configuration = CXProviderConfiguration()
        configuration.supportsVideo = true
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.generic]
        
        if let iconImage = UIImage(named: "AppIcon") {
            configuration.iconTemplateImageData = iconImage.pngData()
        }
        
        provider = CXProvider(configuration: configuration)
        provider?.setDelegate(self, queue: nil)
    }
    
    // MARK: - Incoming Call Handling
    public func reportIncomingCall(handle: String, hasVideo: Bool, completion: ((Error?) -> Void)? = nil) {
        reportIncomingCall(uuid: UUID(), callerName: handle, hasVideo: hasVideo, completion: completion)
    }
    
    public func reportIncomingCall(uuid: UUID = UUID(), callerName: String, hasVideo: Bool, completion: ((Error?) -> Void)? = nil) {
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerName)
        update.localizedCallerName = callerName
        update.hasVideo = hasVideo
        update.supportsDTMF = false
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        
        self.activeCallUUID = uuid
        self.activePeerName = callerName
        self.isVideoCall = hasVideo
        
        provider?.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if error == nil {
                self?.isCallActive = true
                self?.configureAudioSession()
            }
            completion?(error)
        }
    }
    
    // MARK: - Outgoing Call Handling
    public func startCall(handle: String, displayName: String = "", hasVideo: Bool) {
        startOutgoingCall(handle: displayName.isEmpty ? handle : displayName, isVideo: hasVideo)
    }
    
    public func startOutgoingCall(handle: String, isVideo: Bool) {
        let uuid = UUID()
        self.activeCallUUID = uuid
        self.activePeerName = handle
        self.isVideoCall = isVideo
        
        let handleObj = CXHandle(type: .generic, value: handle)
        let startCallAction = CXStartCallAction(call: uuid, handle: handleObj)
        startCallAction.isVideo = isVideo
        
        let transaction = CXTransaction(action: startCallAction)
        callController.request(transaction) { [weak self] error in
            if error == nil {
                self?.isCallActive = true
                self?.configureAudioSession()
            }
        }
    }
    
    // MARK: - End Call
    public func endCall() {
        guard let uuid = activeCallUUID else { return }
        let endCallAction = CXEndCallAction(call: uuid)
        let transaction = CXTransaction(action: endCallAction)
        callController.request(transaction) { [weak self] _ in
            self?.isCallActive = false
            self?.activeCallUUID = nil
            self?.deactivateAudioSession()
        }
    }
    
    // MARK: - Toggle Mute
    public func setMuted(_ muted: Bool) {
        guard let uuid = activeCallUUID else { return }
        let muteAction = CXSetMutedCallAction(call: uuid, muted: muted)
        let transaction = CXTransaction(action: muteAction)
        callController.request(transaction) { [weak self] error in
            if error == nil {
                self?.isCallMuted = muted
                self?.onMuteCall?(muted)
            }
        }
    }
    
    // MARK: - Audio Session Management
    public func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker])
            try session.setActive(true)
        } catch {
            print("Failed to configure audio session for CallKit: \(error)")
        }
    }
    
    public func deactivateAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("Failed to deactivate audio session: \(error)")
        }
    }
}

// MARK: - CXProviderDelegate
extension CallManager: CXProviderDelegate {
    public func providerDidReset(_ provider: CXProvider) {
        isCallActive = false
        activeCallUUID = nil
        deactivateAudioSession()
    }
    
    public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        configureAudioSession()
        isCallActive = true
        onAnswerCall?(action.callUUID)
        action.fulfill()
    }
    
    public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        isCallActive = false
        activeCallUUID = nil
        onEndCall?(action.callUUID)
        deactivateAudioSession()
        action.fulfill()
    }
    
    public func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        isCallMuted = action.isMuted
        onMuteCall?(action.isMuted)
        action.fulfill()
    }
    
    public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        configureAudioSession()
    }
    
    public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        deactivateAudioSession()
    }
}
