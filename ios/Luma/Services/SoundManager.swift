import Foundation
import AVFoundation
import AudioToolbox
import UIKit
import Combine

public enum RingtoneOption: String, CaseIterable, Identifiable {
    case marimba = "Marimba"
    case aurora = "Aurora"
    case celestial = "Celestial"
    case silk = "Silk"
    case ripples = "Ripples"
    
    public var id: String { rawValue }
    
    public var description: String {
        switch self {
        case .marimba: return "Classic cheerful wooden resonance"
        case .aurora: return "Gentle cascading ambient chimes"
        case .celestial: return "Soft ethereal harmonic bells"
        case .silk: return "Warm smooth acoustic chords"
        case .ripples: return "Pulsing liquid melody"
        }
    }
}

public enum MessageToneOption: String, CaseIterable, Identifiable {
    case lumaPop = "Luma Pop"
    case droplet = "Droplet"
    case glassChime = "Glass Chime"
    case subtleClick = "Subtle Click"
    case pulse = "Pulse"
    
    public var id: String { rawValue }
    
    public var description: String {
        switch self {
        case .lumaPop: return "Signature bubbly glass pop"
        case .droplet: return "Clean resonant water droplet"
        case .glassChime: return "Crisp bright crystal tap"
        case .subtleClick: return "Haptic-weighted tactile snap"
        case .pulse: return "Low harmonic confirmation tone"
        }
    }
}

public final class SoundManager: ObservableObject {
    public static let shared = SoundManager()
    
    @Published public var selectedRingtone: RingtoneOption {
        didSet {
            UserDefaults.standard.set(selectedRingtone.rawValue, forKey: "luma_selected_ringtone")
        }
    }
    
    @Published public var selectedMessageTone: MessageToneOption {
        didSet {
            UserDefaults.standard.set(selectedMessageTone.rawValue, forKey: "luma_selected_msg_tone")
        }
    }
    
    @Published public var vibrateOnRing: Bool {
        didSet {
            UserDefaults.standard.set(vibrateOnRing, forKey: "luma_vibrate_on_ring")
        }
    }
    
    @Published public var vibrateOnMessage: Bool {
        didSet {
            UserDefaults.standard.set(vibrateOnMessage, forKey: "luma_vibrate_on_message")
        }
    }
    
    @Published public var inAppSoundAlerts: Bool {
        didSet {
            UserDefaults.standard.set(inAppSoundAlerts, forKey: "luma_in_app_sound_alerts")
        }
    }
    
    @Published public var isPreviewPlaying: Bool = false
    
    private var audioEngine: AVAudioEngine?
    private var tonePlayerNode: AVAudioPlayerNode?
    private var ringTimer: Timer?
    private let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
    private let notificationFeedback = UINotificationFeedbackGenerator()
    
    private init() {
        let savedRingtone = UserDefaults.standard.string(forKey: "luma_selected_ringtone") ?? RingtoneOption.aurora.rawValue
        self.selectedRingtone = RingtoneOption(rawValue: savedRingtone) ?? .aurora
        
        let savedMsgTone = UserDefaults.standard.string(forKey: "luma_selected_msg_tone") ?? MessageToneOption.lumaPop.rawValue
        self.selectedMessageTone = MessageToneOption(rawValue: savedMsgTone) ?? .lumaPop
        
        self.vibrateOnRing = UserDefaults.standard.object(forKey: "luma_vibrate_on_ring") as? Bool ?? true
        self.vibrateOnMessage = UserDefaults.standard.object(forKey: "luma_vibrate_on_message") as? Bool ?? true
        self.inAppSoundAlerts = UserDefaults.standard.object(forKey: "luma_in_app_sound_alerts") as? Bool ?? true
    }
    
    // MARK: - Sound Synthesis & Playback
    
    public func previewRingtone(_ ringtone: RingtoneOption) {
        stopPreview()
        isPreviewPlaying = true
        
        if vibrateOnRing {
            impactFeedback.impactOccurred()
        }
        
        synthesizeMelody(for: ringtone, isLooping: true)
    }
    
    public func previewMessageTone(_ tone: MessageToneOption) {
        stopPreview()
        isPreviewPlaying = true
        
        if vibrateOnMessage {
            notificationFeedback.notificationOccurred(.success)
        }
        
        synthesizeChime(for: tone)
    }
    
    public func stopPreview() {
        ringTimer?.invalidate()
        ringTimer = nil
        tonePlayerNode?.stop()
        audioEngine?.stop()
        tonePlayerNode = nil
        audioEngine = nil
        isPreviewPlaying = false
    }
    
    public func playIncomingMessageSound() {
        guard inAppSoundAlerts else { return }
        if vibrateOnMessage {
            impactFeedback.impactOccurred()
        }
        synthesizeChime(for: selectedMessageTone)
    }
    
    public func playOutgoingMessageSound() {
        guard inAppSoundAlerts else { return }
        impactFeedback.impactOccurred(intensity: 0.6)
        synthesizeFrequency(frequency: 880.0, duration: 0.08, type: .sine)
    }
    
    public func playIncomingRing() {
        guard inAppSoundAlerts else { return }
        previewRingtone(selectedRingtone)
    }
    
    public func stopIncomingRing() {
        stopPreview()
    }
    
    public func playDeclinedSound() {
        guard inAppSoundAlerts else { return }
        stopPreview()
        synthesizeFrequency(frequency: 330.0, duration: 0.15, type: .sine)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { [weak self] in
            self?.synthesizeFrequency(frequency: 220.0, duration: 0.25, type: .sine)
        }
    }
    
    // MARK: - Core Audio Synthesizer
    
    private func synthesizeFrequency(frequency: Double, duration: Double, type: WaveformType) {
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        let sampleRate: Double = 44100.0
        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        
        let frameCount = AVAudioFrameCount(sampleRate * duration)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return }
        buffer.frameLength = frameCount
        
        let channels = buffer.floatChannelData![0]
        let angleIncrement = 2.0 * .pi * frequency / sampleRate
        
        for i in 0..<Int(frameCount) {
            let t = Double(i) / sampleRate
            let envelope = max(0, 1.0 - (t / duration)) // Linear decay
            let rawSample: Double
            switch type {
            case .sine:
                rawSample = sin(angleIncrement * Double(i))
            case .chime:
                // Fundamental + harmonics
                rawSample = 0.6 * sin(angleIncrement * Double(i)) +
                            0.3 * sin(2.0 * angleIncrement * Double(i)) +
                            0.1 * sin(3.0 * angleIncrement * Double(i))
            }
            channels[i] = Float(rawSample * envelope * 0.4)
        }
        
        do {
            try engine.start()
            player.play()
            player.scheduleBuffer(buffer, at: nil, options: []) {
                DispatchQueue.main.async {
                    self.stopPreview()
                }
            }
            self.audioEngine = engine
            self.tonePlayerNode = player
        } catch {
            print("Audio synthesis failed: \(error)")
        }
    }
    
    private func synthesizeMelody(for ringtone: RingtoneOption, isLooping: Bool) {
        let notes: [Double]
        switch ringtone {
        case .marimba:
            notes = [523.25, 659.25, 783.99, 1046.50, 783.99, 659.25] // C5, E5, G5, C6, G5, E5
        case .aurora:
            notes = [440.0, 554.37, 659.25, 880.0, 659.25, 554.37] // A4, C#5, E5, A5, E5, C#5
        case .celestial:
            notes = [587.33, 739.99, 880.0, 1174.66, 880.0] // D5, F#5, A5, D6, A5
        case .silk:
            notes = [349.23, 440.0, 523.25, 698.46, 523.25] // F4, A4, C5, F5, C5
        case .ripples:
            notes = [392.0, 493.88, 587.33, 783.99, 987.77] // G4, B4, D5, G5, B5
        }
        
        var currentIndex = 0
        ringTimer = Timer.scheduledTimer(withTimeInterval: 0.22, repeats: true) { [weak self] timer in
            guard let self = self else { return }
            let note = notes[currentIndex]
            self.synthesizeFrequency(frequency: note, duration: 0.20, type: .chime)
            currentIndex = (currentIndex + 1) % notes.count
            if !isLooping && currentIndex == 0 {
                timer.invalidate()
                self.stopPreview()
            }
        }
    }
    
    private func synthesizeChime(for tone: MessageToneOption) {
        switch tone {
        case .lumaPop:
            synthesizeFrequency(frequency: 1046.50, duration: 0.12, type: .sine)
        case .droplet:
            synthesizeFrequency(frequency: 880.0, duration: 0.18, type: .chime)
        case .glassChime:
            synthesizeFrequency(frequency: 1318.51, duration: 0.20, type: .chime)
        case .subtleClick:
            synthesizeFrequency(frequency: 440.0, duration: 0.05, type: .sine)
        case .pulse:
            synthesizeFrequency(frequency: 523.25, duration: 0.25, type: .sine)
        }
    }
    
    private enum WaveformType {
        case sine
        case chime
    }
}
