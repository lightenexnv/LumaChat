import SwiftUI

public struct SoundSettingsView: View {
    @ObservedObject var soundManager = SoundManager.shared
    @Environment(\.presentationMode) var presentationMode
    
    public init() {}
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                // Frosted Glass Navigation Bar
                HStack {
                    GlassBackButton {
                        soundManager.stopPreview()
                        presentationMode.wrappedValue.dismiss()
                    }
                    
                    Spacer()
                    
                    Text("Sounds & Haptics")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(GlassTheme.textPrimary)
                    
                    Spacer()
                    
                    // Empty spacer to balance back button
                    Color.clear
                        .frame(width: 44, height: 44)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(.ultraThinMaterial)
                .overlay(
                    Rectangle()
                        .frame(height: 0.5)
                        .foregroundColor(GlassTheme.glassBorder),
                    alignment: .bottom
                )
                
                ScrollView {
                    VStack(spacing: 24) {
                        
                        // Ringtone Section
                        VStack(alignment: .leading, spacing: 10) {
                            Text("CALL RINGTONES")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(GlassTheme.textSecondary)
                                .padding(.horizontal, 20)
                            
                            VStack(spacing: 0) {
                                ForEach(RingtoneOption.allCases) { ringtone in
                                    Button(action: {
                                        soundManager.selectedRingtone = ringtone
                                        soundManager.previewRingtone(ringtone)
                                    }) {
                                        HStack(spacing: 14) {
                                            Image(systemName: soundManager.selectedRingtone == ringtone ? "speaker.wave.3.fill" : "speaker.wave.2")
                                                .font(.system(size: 16))
                                                .foregroundColor(soundManager.selectedRingtone == ringtone ? GlassTheme.accentEmerald : GlassTheme.textSecondary)
                                                .frame(width: 24)
                                            
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(ringtone.rawValue)
                                                    .font(.system(size: 16, weight: .medium))
                                                    .foregroundColor(GlassTheme.textPrimary)
                                                Text(ringtone.description)
                                                    .font(.system(size: 12))
                                                    .foregroundColor(GlassTheme.textSecondary)
                                            }
                                            
                                            Spacer()
                                            
                                            if soundManager.selectedRingtone == ringtone {
                                                Image(systemName: "checkmark")
                                                    .font(.system(size: 14, weight: .semibold))
                                                    .foregroundColor(GlassTheme.accentEmerald)
                                            }
                                        }
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 14)
                                    }
                                    
                                    if ringtone != RingtoneOption.allCases.last {
                                        Divider()
                                            .background(GlassTheme.glassBorder)
                                            .padding(.leading, 54)
                                    }
                                }
                            }
                            .glassBackground(cornerRadius: 18)
                            .padding(.horizontal, 16)
                        }
                        
                        // Message Tone Section
                        VStack(alignment: .leading, spacing: 10) {
                            Text("MESSAGE NOTIFICATION TONES")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(GlassTheme.textSecondary)
                                .padding(.horizontal, 20)
                            
                            VStack(spacing: 0) {
                                ForEach(MessageToneOption.allCases) { tone in
                                    Button(action: {
                                        soundManager.selectedMessageTone = tone
                                        soundManager.previewMessageTone(tone)
                                    }) {
                                        HStack(spacing: 14) {
                                            Image(systemName: soundManager.selectedMessageTone == tone ? "bubble.left.and.bubble.right.fill" : "bubble.left")
                                                .font(.system(size: 16))
                                                .foregroundColor(soundManager.selectedMessageTone == tone ? GlassTheme.tickBlue : GlassTheme.textSecondary)
                                                .frame(width: 24)
                                            
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(tone.rawValue)
                                                    .font(.system(size: 16, weight: .medium))
                                                    .foregroundColor(GlassTheme.textPrimary)
                                                Text(tone.description)
                                                    .font(.system(size: 12))
                                                    .foregroundColor(GlassTheme.textSecondary)
                                            }
                                            
                                            Spacer()
                                            
                                            if soundManager.selectedMessageTone == tone {
                                                Image(systemName: "checkmark")
                                                    .font(.system(size: 14, weight: .semibold))
                                                    .foregroundColor(GlassTheme.accentEmerald)
                                            }
                                        }
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 14)
                                    }
                                    
                                    if tone != MessageToneOption.allCases.last {
                                        Divider()
                                            .background(GlassTheme.glassBorder)
                                            .padding(.leading, 54)
                                    }
                                }
                            }
                            .glassBackground(cornerRadius: 18)
                            .padding(.horizontal, 16)
                        }
                        
                        // Haptic Vibrations Section
                        VStack(alignment: .leading, spacing: 10) {
                            Text("HAPTICS & ALERTS")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(GlassTheme.textSecondary)
                                .padding(.horizontal, 20)
                            
                            VStack(spacing: 0) {
                                Toggle(isOn: $soundManager.vibrateOnRing) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Vibrate on Ring")
                                            .font(.system(size: 16, weight: .medium))
                                            .foregroundColor(GlassTheme.textPrimary)
                                        Text("Haptic pulsation when someone calls you")
                                            .font(.system(size: 12))
                                            .foregroundColor(GlassTheme.textSecondary)
                                    }
                                }
                                .toggleStyle(SwitchToggleStyle(tint: GlassTheme.accentEmerald))
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)
                                
                                Divider()
                                    .background(GlassTheme.glassBorder)
                                    .padding(.leading, 16)
                                
                                Toggle(isOn: $soundManager.vibrateOnMessage) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Vibrate on Message")
                                            .font(.system(size: 16, weight: .medium))
                                            .foregroundColor(GlassTheme.textPrimary)
                                        Text("Tactile impulse when receiving incoming texts")
                                            .font(.system(size: 12))
                                            .foregroundColor(GlassTheme.textSecondary)
                                    }
                                }
                                .toggleStyle(SwitchToggleStyle(tint: GlassTheme.accentEmerald))
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)
                                
                                Divider()
                                    .background(GlassTheme.glassBorder)
                                    .padding(.leading, 16)
                                
                                Toggle(isOn: $soundManager.inAppSoundAlerts) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("In-App Audio Chimes")
                                            .font(.system(size: 16, weight: .medium))
                                            .foregroundColor(GlassTheme.textPrimary)
                                        Text("Play gentle feedback sounds while actively chatting")
                                            .font(.system(size: 12))
                                            .foregroundColor(GlassTheme.textSecondary)
                                    }
                                }
                                .toggleStyle(SwitchToggleStyle(tint: GlassTheme.accentEmerald))
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)
                            }
                            .glassBackground(cornerRadius: 18)
                            .padding(.horizontal, 16)
                        }
                        
                        // Stop Preview Button if active
                        if soundManager.isPreviewPlaying {
                            Button(action: {
                                soundManager.stopPreview()
                            }) {
                                HStack(spacing: 8) {
                                    Image(systemName: "stop.fill")
                                    Text("Stop Sound Preview")
                                }
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(GlassTheme.dangerRed)
                                .cornerRadius(20)
                            }
                            .padding(.top, 4)
                        }
                    }
                    .padding(.vertical, 20)
                }
            }
        }
        .navigationBarHidden(true)
        .onDisappear {
            soundManager.stopPreview()
        }
    }
}
