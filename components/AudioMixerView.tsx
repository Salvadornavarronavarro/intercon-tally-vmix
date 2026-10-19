import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';

export interface AudioMixerViewProps {
  cameraMuteMap?: Record<string, boolean>;
  onToggleCameraMute?: (camId: string) => void;
  activeProgramCamera?: string | null;
  activePreviewCamera?: string | null;
}

interface ChannelState {
  id: string; // 'cam1' ... 'cam8'
  num: number; // 1 .. 8
  volume: number; // 0 to 1 (0 = -inf, 0.75 = 0dB, 1.0 = +10dB)
  pan: number; // -1 (full L) to +1 (full R), 0 = Center
  muted: boolean;
  solo: boolean; // PFL monitor
  meterLevel: number; // 0 to 1
  peakLevel: number;
}

const DB_MARKS = [
  { label: '+10', val: 1.0, color: '#FF1744' },
  { label: '+6', val: 0.90, color: '#FF5252' },
  { label: '0', val: 0.75, color: '#FFD600' },
  { label: '-5', val: 0.60, color: '#00E676' },
  { label: '-10', val: 0.45, color: '#00E676' },
  { label: '-20', val: 0.30, color: '#00C853' },
  { label: '-40', val: 0.15, color: '#00C853' },
  { label: '-∞', val: 0.0, color: '#6A6A80' },
];

function volumeToDbString(vol: number): string {
  if (vol <= 0.02) return '-∞ dB';
  let db: number;
  if (vol >= 0.75) {
    db = ((vol - 0.75) / 0.25) * 10;
  } else {
    db = ((vol - 0.75) / 0.75) * 50;
  }
  const sign = db > 0 ? '+' : '';
  return `${sign}${db.toFixed(1)} dB`;
}

function panToString(pan: number): string {
  if (Math.abs(pan) < 0.05) return 'C';
  if (pan < 0) return `L${Math.round(Math.abs(pan) * 100)}`;
  return `R${Math.round(pan * 100)}`;
}

export const AudioMixerView: React.FC<AudioMixerViewProps> = ({
  cameraMuteMap = {},
  onToggleCameraMute,
  activeProgramCamera,
  activePreviewCamera,
}) => {
  // 8 Channels initialized
  const [channels, setChannels] = useState<ChannelState[]>(() =>
    Array.from({ length: 8 }, (_, i) => {
      const camId = `cam${i + 1}`;
      return {
        id: camId,
        num: i + 1,
        volume: 0.75, // Unity gain (0 dB)
        pan: 0, // Center
        muted: !!cameraMuteMap[camId],
        solo: false,
        meterLevel: 0.15,
        peakLevel: 0.25,
      };
    })
  );

  // Master Section State
  const [masterVolume, setMasterVolume] = useState<number>(0.75); // 0 dB unity
  const [masterMuted, setMasterMuted] = useState<boolean>(false);
  const [masterMeterL, setMasterMeterL] = useState<number>(0.2);
  const [masterMeterR, setMasterMeterR] = useState<number>(0.2);
  const [masterPeakL, setMasterPeakL] = useState<number>(0.3);
  const [masterPeakR, setMasterPeakR] = useState<number>(0.3);

  // Utility states
  const [activeAux, setActiveAux] = useState<boolean>(false);
  const [activeGroups, setActiveGroups] = useState<boolean>(false);

  // Dragging interaction state
  const draggingTargetRef = useRef<string | null>(null);

  // Sync external mute map if changed
  useEffect(() => {
    setChannels((prev) =>
      prev.map((ch) => ({
        ...ch,
        muted: cameraMuteMap[ch.id] !== undefined ? cameraMuteMap[ch.id] : ch.muted,
      }))
    );
  }, [cameraMuteMap]);

  // Real-time Audio Meter Simulation & Ballistics
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setChannels((prev) => {
        let activeSum = 0;
        let count = 0;

        const updated = prev.map((ch, idx) => {
          if (ch.muted || masterMuted) {
            return {
              ...ch,
              meterLevel: Math.max(0, ch.meterLevel * 0.7),
              peakLevel: Math.max(0, ch.peakLevel * 0.85),
            };
          }

          // Generate realistic voice/intercom modulation
          const isPgm = activeProgramCamera === ch.id;
          const isPvw = activePreviewCamera === ch.id;
          const boost = isPgm ? 0.35 : isPvw ? 0.18 : 0.05;

          const wave =
            Math.sin(now / (240 + idx * 60)) * 0.22 +
            Math.cos(now / (170 + idx * 40)) * 0.14 +
            (Math.random() - 0.5) * 0.12;

          const baseSignal = Math.max(0.04, Math.min(0.96, 0.45 + boost + wave));
          const effectiveLevel = baseSignal * ch.volume;

          activeSum += effectiveLevel;
          count++;

          const peak = Math.max(effectiveLevel, ch.peakLevel * 0.95);

          return {
            ...ch,
            meterLevel: effectiveLevel,
            peakLevel: peak,
          };
        });

        // Compute Master L & R
        if (masterMuted || count === 0) {
          setMasterMeterL((prev) => Math.max(0, prev * 0.65));
          setMasterMeterR((prev) => Math.max(0, prev * 0.65));
          setMasterPeakL((prev) => Math.max(0, prev * 0.8));
          setMasterPeakR((prev) => Math.max(0, prev * 0.8));
        } else {
          const avgLevel = (activeSum / Math.max(1, count)) * masterVolume;
          const stereoPanVariance = (Math.random() - 0.5) * 0.07;
          const targetL = Math.max(0.04, Math.min(1.0, avgLevel + stereoPanVariance));
          const targetR = Math.max(0.04, Math.min(1.0, avgLevel - stereoPanVariance));

          setMasterMeterL(targetL);
          setMasterMeterR(targetR);
          setMasterPeakL((prev) => Math.max(targetL, prev * 0.96));
          setMasterPeakR((prev) => Math.max(targetR, prev * 0.96));
        }

        return updated;
      });
    }, 80);

    return () => clearInterval(timer);
  }, [activeProgramCamera, activePreviewCamera, masterMuted, masterVolume]);

  // Channel Actions
  const handleToggleMute = (camId: string) => {
    setChannels((prev) =>
      prev.map((ch) => (ch.id === camId ? { ...ch, muted: !ch.muted } : ch))
    );
    if (onToggleCameraMute) {
      onToggleCameraMute(camId);
    }
  };

  const handleToggleSolo = (camId: string) => {
    setChannels((prev) =>
      prev.map((ch) => (ch.id === camId ? { ...ch, solo: !ch.solo } : ch))
    );
  };

  const handleSetVolume = (camId: string, newVol: number) => {
    const clamped = Math.max(0, Math.min(1, newVol));
    setChannels((prev) =>
      prev.map((ch) => (ch.id === camId ? { ...ch, volume: clamped } : ch))
    );
  };

  const handleStepPan = (camId: string, direction: -1 | 1 | 0) => {
    setChannels((prev) =>
      prev.map((ch) => {
        if (ch.id !== camId) return ch;
        if (direction === 0) return { ...ch, pan: 0 };
        const next = Math.max(-1, Math.min(1, ch.pan + direction * 0.25));
        return { ...ch, pan: Math.round(next * 100) / 100 };
      })
    );
  };

  // Master Actions
  const handleToggleMasterMute = () => {
    setMasterMuted((prev) => !prev);
  };

  const handleSetMasterVolume = (newVol: number) => {
    setMasterVolume(Math.max(0, Math.min(1, newVol)));
  };

  const handleAllMute = () => {
    const allCurrentlyMuted = channels.every((ch) => ch.muted);
    const targetState = !allCurrentlyMuted;

    setChannels((prev) =>
      prev.map((ch) => {
        if (ch.muted !== targetState && onToggleCameraMute) {
          onToggleCameraMute(ch.id);
        }
        return { ...ch, muted: targetState };
      })
    );
  };

  // Pointer / Touch Fader Interactions
  const updateFaderFromPointer = (e: any, camId?: string) => {
    if (Platform.OS === 'web' && e) {
      const nativeEvent = e.nativeEvent || e;
      const targetElement = e.currentTarget || e.target;
      if (targetElement && targetElement.getBoundingClientRect) {
        const rect = targetElement.getBoundingClientRect();
        const clientY = nativeEvent.clientY !== undefined ? nativeEvent.clientY : nativeEvent.pageY;
        const relativeY = clientY - rect.top;
        const ratio = 1 - Math.max(0, Math.min(1, relativeY / rect.height));
        if (camId) {
          handleSetVolume(camId, ratio);
        } else {
          handleSetMasterVolume(ratio);
        }
      }
    }
  };

  // Render LED Ladder Bar
  const renderLedMeter = (level: number, peak: number) => {
    const totalSegments = 14;
    const activeSegments = Math.round(level * totalSegments);
    const peakSegment = Math.min(totalSegments - 1, Math.round(peak * totalSegments));

    return (
      <View style={styles.meterTrack}>
        {Array.from({ length: totalSegments }).map((_, i) => {
          const segIdx = totalSegments - 1 - i; // Top to bottom
          const isLit = segIdx < activeSegments;
          const isPeak = segIdx === peakSegment && peak > 0.05;

          let segColor = '#00E676'; // Normal Green
          if (segIdx >= 12) {
            segColor = '#FF1744'; // Clip / Red (+10dB, +6dB)
          } else if (segIdx >= 9) {
            segColor = '#FFD600'; // Amber / Headroom (0dB to -5dB)
          }

          return (
            <View
              key={segIdx}
              style={[
                styles.meterLed,
                isLit && { backgroundColor: segColor },
                !isLit && isPeak && { backgroundColor: segColor, opacity: 0.9 },
                !isLit && !isPeak && styles.meterLedOff,
              ]}
            />
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.consoleContainer}>
      {/* Top Console Status Ribbon */}
      <View style={styles.consoleTopRibbon}>
        <View style={styles.ribbonLeft}>
          <Text style={styles.ribbonTitle}>CONTROL DE SONIDO</Text>
          <Text style={styles.ribbonSubtitle}>8 CANALES DE CÁMARA • MASTER ESTÉREO DUAL</Text>
        </View>

        <View style={styles.ribbonRight}>
          <View style={styles.badgePfl}>
            <Text style={styles.badgePflText}>PFL AUDIO MATRIX</Text>
          </View>
          <View style={styles.badgeSampleRate}>
            <Text style={styles.badgeSampleRateText}>48 kHz / 24-BIT DIGITAL BUS</Text>
          </View>
        </View>
      </View>

      {/* Main Console Workspace: 8 Channels + 1 Master */}
      <View style={styles.consoleBody}>
        {/* ================================================================== */}
        {/* CHANNELS 1 TO 8                                                    */}
        {/* ================================================================== */}
        <View style={styles.channelsRack}>
          {channels.map((ch) => {
            const isPgm = activeProgramCamera === ch.id;
            const isPvw = activePreviewCamera === ch.id;

            return (
              <View
                key={ch.id}
                style={[
                  styles.stripCard,
                  isPgm && styles.stripCardPgm,
                  isPvw && styles.stripCardPvw,
                ]}
              >
                {/* 1. TOP HEADER: strictly consecutive numbers 1 to 8 */}
                <View style={styles.stripHeader}>
                  <View
                    style={[
                      styles.chNumberBadge,
                      isPgm && styles.chBadgePgm,
                      isPvw && styles.chBadgePvw,
                    ]}
                  >
                    <Text style={styles.chNumberText}>{ch.num}</Text>
                  </View>
                  {isPgm ? (
                    <View style={styles.liveTag}>
                      <Text style={styles.liveTagText}>ON AIR</Text>
                    </View>
                  ) : null}
                </View>

                {/* 2. PANORAMA ROTARY KNOB: marked with 'L' and 'R' */}
                <View style={styles.panSection}>
                  <View style={styles.panLabelRow}>
                    <TouchableOpacity
                      onPress={() => handleStepPan(ch.id, -1)}
                      style={styles.panStepBtn}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.panMarkerL}>L</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleStepPan(ch.id, 0)}
                      style={styles.panKnobDial}
                      activeOpacity={0.8}
                    >
                      {/* Rotary tick indicator rotating based on pan */}
                      <View
                        style={[
                          styles.panKnobIndicator,
                          {
                            transform: [{ rotate: `${ch.pan * 65}deg` }],
                          },
                        ]}
                      />
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleStepPan(ch.id, 1)}
                      style={styles.panStepBtn}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.panMarkerR}>R</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.panValueText}>{panToString(ch.pan)}</Text>
                </View>

                {/* 3. MUTE BUTTON: bright red toggle when active */}
                <TouchableOpacity
                  style={[
                    styles.muteButton,
                    ch.muted ? styles.muteButtonActive : styles.muteButtonIdle,
                  ]}
                  onPress={() => handleToggleMute(ch.id)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.muteButtonText,
                      ch.muted ? styles.muteTextActive : styles.muteTextIdle,
                    ]}
                  >
                    {ch.muted ? 'MUTED' : 'MUTE'}
                  </Text>
                </TouchableOpacity>

                {/* 4. VERTICAL FADER + 5. REALTIME AUDIO METER LED LADDER */}
                <View style={styles.faderAndMeterArea}>
                  {/* dB Scale Markings */}
                  <View style={styles.dbScaleColumn}>
                    {DB_MARKS.map((m) => (
                      <Text key={m.label} style={[styles.dbLabelText, { color: m.color }]}>
                        {m.label}
                      </Text>
                    ))}
                  </View>

                  {/* Fader Track & Thumb */}
                  <View
                    style={styles.faderTrackContainer}
                    // @ts-ignore: React Native Web pointer event
                    onPointerDown={(e: any) => {
                      draggingTargetRef.current = ch.id;
                      updateFaderFromPointer(e, ch.id);
                    }}
                    // @ts-ignore: React Native Web pointer event
                    onPointerMove={(e: any) => {
                      if (draggingTargetRef.current === ch.id) {
                        updateFaderFromPointer(e, ch.id);
                      }
                    }}
                    // @ts-ignore: React Native Web pointer event
                    onPointerUp={() => {
                      draggingTargetRef.current = null;
                    }}
                  >
                    <View style={styles.faderSlotTrack}>
                      {/* Unity gain mark (0dB) */}
                      <View style={styles.faderUnityLine} />
                    </View>

                    {/* Draggable/Interactive Fader Cap */}
                    <View
                      style={[
                        styles.faderCap,
                        {
                          bottom: `${ch.volume * 82}%`,
                        },
                      ]}
                    >
                      <View style={styles.faderCapRidgeTop} />
                      <View style={styles.faderCapCenterLine} />
                      <View style={styles.faderCapRidgeBottom} />
                    </View>
                  </View>

                  {/* Realtime Audio Meter LED Ladder */}
                  <View style={styles.meterColumn}>
                    {renderLedMeter(ch.meterLevel, ch.peakLevel)}
                  </View>
                </View>

                {/* Fader dB Readout */}
                <View style={styles.dbReadoutBox}>
                  <Text style={styles.dbReadoutText}>{volumeToDbString(ch.volume)}</Text>
                </View>

                {/* 6. BOTTOM MONITORING BUTTON: strictly 'CAM 1' to 'CAM 8' (zero intercom references) */}
                <TouchableOpacity
                  style={[
                    styles.monitorButton,
                    ch.solo && styles.monitorButtonActive,
                  ]}
                  onPress={() => handleToggleSolo(ch.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.monitorHeadphoneIcon}>🎧</Text>
                  <Text
                    style={[
                      styles.monitorButtonText,
                      ch.solo && styles.monitorTextActive,
                    ]}
                  >
                    {`CAM ${ch.num}`}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        {/* ================================================================== */}
        {/* DEDICATED MASTER SECTION (Red accent border)                       */}
        {/* ================================================================== */}
        <View style={styles.masterContainer}>
          {/* Master Section Header */}
          <View style={styles.masterHeader}>
            <View style={styles.masterTitlePill}>
              <Text style={styles.masterHeaderText}>MASTER</Text>
            </View>
            <View style={styles.masterSubRow}>
              <Text style={styles.masterSubText}>MAIN STEREO DUAL OUT</Text>
            </View>
          </View>

          {/* Master VU & Faders Row */}
          <View style={styles.masterMixArea}>
            {/* Left VU Meter */}
            <View style={styles.masterMeterBlock}>
              <Text style={styles.channelLRHeader}>L</Text>
              {renderLedMeter(masterMeterL, masterPeakL)}
            </View>

            {/* Central dB Scale */}
            <View style={styles.masterDbScaleColumn}>
              {DB_MARKS.map((m) => (
                <Text key={m.label} style={[styles.masterDbText, { color: m.color }]}>
                  {m.label}
                </Text>
              ))}
            </View>

            {/* Right VU Meter */}
            <View style={styles.masterMeterBlock}>
              <Text style={styles.channelLRHeader}>R</Text>
              {renderLedMeter(masterMeterR, masterPeakR)}
            </View>

            {/* Dual Stereo Faders (Ganged Together) */}
            <View
              style={styles.masterDualFadersColumn}
              // @ts-ignore: React Native Web pointer event
              onPointerDown={(e: any) => {
                draggingTargetRef.current = 'master';
                updateFaderFromPointer(e);
              }}
              // @ts-ignore: React Native Web pointer event
              onPointerMove={(e: any) => {
                if (draggingTargetRef.current === 'master') {
                  updateFaderFromPointer(e);
                }
              }}
              // @ts-ignore: React Native Web pointer event
              onPointerUp={() => {
                draggingTargetRef.current = null;
              }}
            >
              <View style={styles.faderTrackContainer}>
                {/* Dual Track Slots for L & R */}
                <View style={styles.masterDualTrackSlot}>
                  <View style={styles.faderSlotTrack} />
                  <View style={styles.faderSlotTrack} />
                </View>

                {/* Ganged Stereo Fader Handle */}
                <View
                  style={[
                    styles.masterFaderCapGanged,
                    {
                      bottom: `${masterVolume * 82}%`,
                    },
                  ]}
                >
                  <View style={styles.masterCapStripe} />
                  <Text style={styles.masterCapText}>STEREO</Text>
                  <View style={styles.masterCapStripe} />
                </View>
              </View>
            </View>
          </View>

          {/* Master Level Readout */}
          <View style={styles.masterDbReadout}>
            <Text style={styles.masterDbReadoutText}>
              {volumeToDbString(masterVolume)}
            </Text>
          </View>

          {/* Big MASTER MUTE Button */}
          <TouchableOpacity
            style={[
              styles.masterMuteBtn,
              masterMuted ? styles.masterMuteBtnActive : styles.masterMuteBtnIdle,
            ]}
            onPress={handleToggleMasterMute}
            activeOpacity={0.8}
          >
            <Text style={styles.masterMuteIcon}>{masterMuted ? '🔇' : '🔊'}</Text>
            <Text
              style={[
                styles.masterMuteBtnText,
                masterMuted && styles.masterMuteTextActive,
              ]}
            >
              {masterMuted ? 'MASTER MUTED' : 'MASTER MUTE'}
            </Text>
          </TouchableOpacity>

          {/* Right-Side Utility Buttons: 'GRUPOS', 'AUX', 'ALL MUTE' */}
          <View style={styles.masterUtilityGrid}>
            <TouchableOpacity
              style={[
                styles.utilityBtn,
                activeGroups && styles.utilityBtnActive,
              ]}
              onPress={() => setActiveGroups((prev) => !prev)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.utilityBtnText,
                  activeGroups && styles.utilityTextActive,
                ]}
              >
                GRUPOS
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.utilityBtn,
                activeAux && styles.utilityBtnActive,
              ]}
              onPress={() => setActiveAux((prev) => !prev)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.utilityBtnText,
                  activeAux && styles.utilityTextActive,
                ]}
              >
                AUX
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.utilityBtn,
                styles.utilityAllMuteBtn,
                channels.some((c) => c.muted) && styles.utilityAllMuteActive,
              ]}
              onPress={handleAllMute}
              activeOpacity={0.8}
            >
              <Text style={styles.allMuteBtnText}>ALL MUTE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  consoleContainer: {
    flex: 1,
    backgroundColor: '#0A0A0E',
    padding: 8,
    justifyContent: 'space-between',
  },
  consoleTopRibbon: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#111118',
    borderWidth: 1,
    borderColor: '#1E1E2C',
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 6,
  },
  ribbonLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ribbonTitle: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  ribbonSubtitle: {
    color: '#84849A',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  ribbonRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badgePfl: {
    backgroundColor: 'rgba(255, 214, 0, 0.15)',
    borderWidth: 1,
    borderColor: '#FFD600',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgePflText: {
    color: '#FFD600',
    fontSize: 8.5,
    fontWeight: '800',
  },
  badgeSampleRate: {
    backgroundColor: '#191924',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeSampleRateText: {
    color: '#9E9EB2',
    fontSize: 8.5,
    fontWeight: '700',
  },
  consoleBody: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'stretch',
  },
  /* Channels Rack */
  channelsRack: {
    flex: 1,
    flexDirection: 'row',
    gap: 5,
  },
  stripCard: {
    flex: 1,
    backgroundColor: '#12121A',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#212130',
    padding: 5,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stripCardPgm: {
    borderColor: '#FF1744',
    backgroundColor: '#180E12',
  },
  stripCardPvw: {
    borderColor: '#00E676',
    backgroundColor: '#0D1612',
  },
  stripHeader: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 3,
  },
  chNumberBadge: {
    width: '100%',
    backgroundColor: '#1C1C28',
    borderRadius: 4,
    paddingVertical: 3,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  chBadgePgm: {
    backgroundColor: '#D50000',
    borderColor: '#FF1744',
  },
  chBadgePvw: {
    backgroundColor: '#007E33',
    borderColor: '#00E676',
  },
  chNumberText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  liveTag: {
    marginTop: 2,
    backgroundColor: '#FF1744',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  liveTagText: {
    color: '#FFFFFF',
    fontSize: 7,
    fontWeight: '900',
  },
  /* Pan Rotary Section */
  panSection: {
    width: '100%',
    alignItems: 'center',
    marginVertical: 3,
  },
  panLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  panStepBtn: {
    padding: 2,
  },
  panMarkerL: {
    color: '#7C7C94',
    fontSize: 8.5,
    fontWeight: '900',
  },
  panMarkerR: {
    color: '#7C7C94',
    fontSize: 8.5,
    fontWeight: '900',
  },
  panKnobDial: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#232332',
    borderWidth: 2,
    borderColor: '#39394E',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  panKnobIndicator: {
    width: 2.5,
    height: 8,
    backgroundColor: '#00E676',
    borderRadius: 1.5,
  },
  panValueText: {
    color: '#A0A0BA',
    fontSize: 8,
    fontWeight: '700',
    marginTop: 1,
  },
  /* Mute Button */
  muteButton: {
    width: '100%',
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 3,
  },
  muteButtonIdle: {
    backgroundColor: '#1B1B26',
    borderColor: '#2E2E40',
  },
  muteButtonActive: {
    backgroundColor: '#D50000',
    borderColor: '#FF1744',
  },
  muteButtonText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  muteTextIdle: {
    color: '#A8A8C0',
  },
  muteTextActive: {
    color: '#FFFFFF',
  },
  /* Fader & Meter Area */
  faderAndMeterArea: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    marginVertical: 4,
    gap: 3,
  },
  dbScaleColumn: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingVertical: 2,
    width: 18,
  },
  dbLabelText: {
    fontSize: 7,
    fontWeight: '800',
  },
  faderTrackContainer: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 22,
    cursor: 'pointer' as any,
  },
  faderSlotTrack: {
    width: 4,
    height: '100%',
    backgroundColor: '#09090D',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#1D1D28',
    position: 'relative',
  },
  faderUnityLine: {
    position: 'absolute',
    bottom: '75%',
    left: -4,
    right: -4,
    height: 2,
    backgroundColor: '#FFD600',
    opacity: 0.6,
  },
  faderCap: {
    position: 'absolute',
    width: 24,
    height: 34,
    backgroundColor: '#2A2A3A',
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: '#4A4A62',
    justifyContent: 'center',
    alignItems: 'center',
  },
  faderCapRidgeTop: {
    width: 12,
    height: 1.5,
    backgroundColor: '#3D3D52',
    marginBottom: 2,
  },
  faderCapCenterLine: {
    width: 16,
    height: 2,
    backgroundColor: '#FFFFFF',
  },
  faderCapRidgeBottom: {
    width: 12,
    height: 1.5,
    backgroundColor: '#3D3D52',
    marginTop: 2,
  },
  meterColumn: {
    width: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meterTrack: {
    width: 6,
    flex: 1,
    height: '100%',
    backgroundColor: '#08080C',
    borderRadius: 2,
    padding: 0.5,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#181822',
  },
  meterLed: {
    width: '100%',
    flex: 1,
    borderRadius: 1,
    marginVertical: 0.5,
  },
  meterLedOff: {
    backgroundColor: '#13131D',
  },
  /* dB Readout */
  dbReadoutBox: {
    width: '100%',
    backgroundColor: '#0D0D14',
    borderWidth: 1,
    borderColor: '#1D1D28',
    borderRadius: 3,
    paddingVertical: 2,
    alignItems: 'center',
    marginBottom: 3,
  },
  dbReadoutText: {
    color: '#00E676',
    fontSize: 8,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  /* Bottom Monitoring Button */
  monitorButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#191924',
    borderWidth: 1,
    borderColor: '#29293C',
    borderRadius: 4,
    paddingVertical: 4,
    gap: 3,
  },
  monitorButtonActive: {
    backgroundColor: '#004D40',
    borderColor: '#00E676',
  },
  monitorHeadphoneIcon: {
    fontSize: 8.5,
  },
  monitorButtonText: {
    color: '#D2D2E4',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  monitorTextActive: {
    color: '#00E676',
  },
  /* ================================================================== */
  /* MASTER SECTION (Red Accent Border)                                  */
  /* ================================================================== */
  masterContainer: {
    width: 175,
    backgroundColor: '#120E12',
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#FF1744',
    padding: 6,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  masterHeader: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 4,
  },
  masterTitlePill: {
    width: '100%',
    backgroundColor: '#D50000',
    borderRadius: 4,
    paddingVertical: 3,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FF1744',
  },
  masterHeaderText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  masterSubRow: {
    marginTop: 2,
  },
  masterSubText: {
    color: '#FF5252',
    fontSize: 7.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  masterMixArea: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 5,
    marginVertical: 4,
  },
  masterMeterBlock: {
    alignItems: 'center',
    width: 14,
  },
  channelLRHeader: {
    color: '#FF8A80',
    fontSize: 8.5,
    fontWeight: '900',
    marginBottom: 2,
  },
  masterDbScaleColumn: {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    width: 20,
  },
  masterDbText: {
    fontSize: 7.5,
    fontWeight: '800',
  },
  masterDualFadersColumn: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer' as any,
  },
  masterDualTrackSlot: {
    flexDirection: 'row',
    gap: 7,
    height: '100%',
    alignItems: 'center',
  },
  masterFaderCapGanged: {
    position: 'absolute',
    width: 44,
    height: 38,
    backgroundColor: '#B71C1C',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#FF5252',
    justifyContent: 'center',
    alignItems: 'center',
  },
  masterCapStripe: {
    width: 24,
    height: 1.5,
    backgroundColor: '#FF8A80',
    marginVertical: 2,
  },
  masterCapText: {
    color: '#FFFFFF',
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  masterDbReadout: {
    width: '100%',
    backgroundColor: '#0D080A',
    borderWidth: 1,
    borderColor: '#38161A',
    borderRadius: 4,
    paddingVertical: 2,
    alignItems: 'center',
    marginBottom: 5,
  },
  masterDbReadoutText: {
    color: '#FF5252',
    fontSize: 9.5,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  masterMuteBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1.5,
    gap: 5,
    marginBottom: 5,
  },
  masterMuteBtnIdle: {
    backgroundColor: '#1F1418',
    borderColor: '#4A2328',
  },
  masterMuteBtnActive: {
    backgroundColor: '#D50000',
    borderColor: '#FF1744',
  },
  masterMuteIcon: {
    fontSize: 11,
  },
  masterMuteBtnText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  masterMuteTextActive: {
    color: '#FFFFFF',
  },
  /* Right-Side Utility Buttons: 'GRUPOS', 'AUX', 'ALL MUTE' */
  masterUtilityGrid: {
    width: '100%',
    flexDirection: 'row',
    gap: 3,
  },
  utilityBtn: {
    flex: 1,
    backgroundColor: '#1D1D28',
    borderWidth: 1,
    borderColor: '#303042',
    borderRadius: 4,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityBtnActive: {
    backgroundColor: '#3700B3',
    borderColor: '#6200EE',
  },
  utilityBtnText: {
    color: '#A0A0BA',
    fontSize: 8,
    fontWeight: '800',
  },
  utilityTextActive: {
    color: '#FFFFFF',
  },
  utilityAllMuteBtn: {
    backgroundColor: '#2E1114',
    borderColor: '#541F25',
  },
  utilityAllMuteActive: {
    backgroundColor: '#D50000',
    borderColor: '#FF1744',
  },
  allMuteBtnText: {
    color: '#FF5252',
    fontSize: 8,
    fontWeight: '900',
  },
});

export default AudioMixerView;
