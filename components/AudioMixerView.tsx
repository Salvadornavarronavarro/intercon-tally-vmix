import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  mode: 'stereo' | 'split'; // Default: 'stereo'
  volume: number; // 0 to 1 (Stereo unified gain, 0.75 = 0dB)
  volumeA: number; // 0 to 1 (Split Mono Ch A / L gain)
  volumeB: number; // 0 to 1 (Split Mono Ch B / R gain)
  pan: number; // -100 (full L) to +100 (full R), 0 = Center
  muted: boolean;
  solo: boolean; // PFL monitor
  meterLevelL: number; // 0 to 1
  meterLevelR: number; // 0 to 1
  peakLevelL: number;
  peakLevelR: number;
}

// Exact dB graduation markings
const DB_GRADUATION_MARKS = [
  { label: '+10', val: 1.0, color: '#FF1744' },
  { label: '+6',  val: 0.91, color: '#FF3D00' },
  { label: '+5',  val: 0.86, color: '#FF9100' },
  { label: '0',   val: 0.75, color: '#FFD600', isUnity: true },
  { label: '-5',  val: 0.65, color: '#AEEA00' },
  { label: '-10', val: 0.55, color: '#00E676' },
  { label: '-16', val: 0.44, color: '#00E676' },
  { label: '-20', val: 0.35, color: '#00C853' },
  { label: '-25', val: 0.26, color: '#00C853' },
  { label: '-35', val: 0.17, color: '#009624' },
  { label: '-40', val: 0.09, color: '#007E33' },
  { label: '-∞',  val: 0.0,  color: '#555566' },
];

const TOTAL_LED_SEGMENTS = 18;

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
  if (Math.abs(pan) < 2) return 'C';
  if (pan < 0) return `L ${Math.abs(Math.round(pan))}`;
  return `R ${Math.round(pan)}`;
}

export const AudioMixerView: React.FC<AudioMixerViewProps> = ({
  cameraMuteMap = {},
  onToggleCameraMute,
  activeProgramCamera,
  activePreviewCamera,
}) => {
  // 8 Channels initialized (default: STEREO mode)
  const [channels, setChannels] = useState<ChannelState[]>(() =>
    Array.from({ length: 8 }, (_, i) => {
      const camId = `cam${i + 1}`;
      return {
        id: camId,
        num: i + 1,
        mode: 'stereo',
        volume: 0.75, // 0 dB unity gain default
        volumeA: 0.75,
        volumeB: 0.75,
        pan: 0, // Center
        muted: !!cameraMuteMap[camId],
        solo: false,
        meterLevelL: 0.15,
        meterLevelR: 0.15,
        peakLevelL: 0.25,
        peakLevelR: 0.25,
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

  // Right-side utilities
  const [activeAux, setActiveAux] = useState<boolean>(false);
  const [activeGroups, setActiveGroups] = useState<boolean>(false);

  // Pointer drag tracking
  const draggingTargetRef = useRef<{ type: 'fader' | 'pan'; id: string; startY?: number; startVal?: number } | null>(null);
  const lastKnobClickTimeRef = useRef<Record<string, number>>({});

  // Sync external mute map if changed
  useEffect(() => {
    setChannels((prev) =>
      prev.map((ch) => ({
        ...ch,
        muted: cameraMuteMap[ch.id] !== undefined ? cameraMuteMap[ch.id] : ch.muted,
      }))
    );
  }, [cameraMuteMap]);

  // Real-time Audio Meter Simulation & Ballistics (Voice/Mic dynamics)
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
              meterLevelL: Math.max(0, ch.meterLevelL * 0.65),
              meterLevelR: Math.max(0, ch.meterLevelR * 0.65),
              peakLevelL: Math.max(0, ch.peakLevelL * 0.8),
              peakLevelR: Math.max(0, ch.peakLevelR * 0.8),
            };
          }

          const isPgm = activeProgramCamera === ch.id;
          const isPvw = activePreviewCamera === ch.id;
          const boost = isPgm ? 0.38 : isPvw ? 0.18 : 0.05;

          const wave =
            Math.sin(now / (230 + idx * 60)) * 0.23 +
            Math.cos(now / (160 + idx * 35)) * 0.15 +
            (Math.random() - 0.5) * 0.12;

          const baseSignal = Math.max(0.04, Math.min(0.96, 0.45 + boost + wave));
          let levelL = 0;
          let levelR = 0;

          if (ch.mode === 'split') {
            // Distinct levels for Ch A (Left) and Ch B (Right)
            levelL = baseSignal * ch.volumeA;
            levelR = baseSignal * ch.volumeB * 0.95;
          } else {
            // Stereo unified level with pan attenuation
            const panFactorL = ch.pan > 0 ? 1 - (ch.pan / 100) * 0.35 : 1;
            const panFactorR = ch.pan < 0 ? 1 - (Math.abs(ch.pan) / 100) * 0.35 : 1;
            levelL = baseSignal * ch.volume * panFactorL;
            levelR = baseSignal * ch.volume * panFactorR;
          }

          activeSum += (levelL + levelR) / 2;
          count++;

          const peakL = Math.max(levelL, ch.peakLevelL * 0.95);
          const peakR = Math.max(levelR, ch.peakLevelR * 0.95);

          return {
            ...ch,
            meterLevelL: levelL,
            meterLevelR: levelR,
            peakLevelL: peakL,
            peakLevelR: peakR,
          };
        });

        // Compute Master L & R
        if (masterMuted || count === 0) {
          setMasterMeterL((p) => Math.max(0, p * 0.6));
          setMasterMeterR((p) => Math.max(0, p * 0.6));
          setMasterPeakL((p) => Math.max(0, p * 0.8));
          setMasterPeakR((p) => Math.max(0, p * 0.8));
        } else {
          const avgLevel = (activeSum / Math.max(1, count)) * masterVolume;
          const panVariance = (Math.random() - 0.5) * 0.06;
          const targetL = Math.max(0.04, Math.min(1.0, avgLevel + panVariance));
          const targetR = Math.max(0.04, Math.min(1.0, avgLevel - panVariance));

          setMasterMeterL(targetL);
          setMasterMeterR(targetR);
          setMasterPeakL((p) => Math.max(targetL, p * 0.96));
          setMasterPeakR((p) => Math.max(targetR, p * 0.96));
        }

        return updated;
      });
    }, 75);

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

  const handleToggleMode = useCallback((camId: string) => {
    setChannels((prev) =>
      prev.map((ch) => {
        if (ch.id !== camId) return ch;
        const nextMode = ch.mode === 'stereo' ? 'split' : 'stereo';
        return {
          ...ch,
          mode: nextMode,
          volumeA: nextMode === 'split' ? ch.volume : ch.volumeA,
          volumeB: nextMode === 'split' ? ch.volume : ch.volumeB,
        };
      })
    );
  }, []);

  const handleSetVolume = useCallback((camId: string, newVol: number) => {
    const clamped = Math.max(0, Math.min(1, newVol));
    setChannels((prev) =>
      prev.map((ch) => (ch.id === camId ? { ...ch, volume: clamped } : ch))
    );
  }, []);

  const handleSetVolumeA = useCallback((camId: string, newVol: number) => {
    const clamped = Math.max(0, Math.min(1, newVol));
    setChannels((prev) =>
      prev.map((ch) => (ch.id === camId ? { ...ch, volumeA: clamped } : ch))
    );
  }, []);

  const handleSetVolumeB = useCallback((camId: string, newVol: number) => {
    const clamped = Math.max(0, Math.min(1, newVol));
    setChannels((prev) =>
      prev.map((ch) => (ch.id === camId ? { ...ch, volumeB: clamped } : ch))
    );
  }, []);

  const handleSetPan = useCallback((camId: string, newPan: number) => {
    const clamped = Math.max(-100, Math.min(100, newPan));
    setChannels((prev) =>
      prev.map((ch) => (ch.id === camId ? { ...ch, pan: clamped } : ch))
    );
  }, []);

  // Master Actions
  const handleToggleMasterMute = () => {
    setMasterMuted((prev) => !prev);
  };

  const handleSetMasterVolume = useCallback((newVol: number) => {
    setMasterVolume(Math.max(0, Math.min(1, newVol)));
  }, []);

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
  const updateFaderFromPointer = (e: any, targetId?: string) => {
    if (Platform.OS === 'web' && e) {
      const nativeEvent = e.nativeEvent || e;
      const targetElement = e.currentTarget || e.target;
      if (targetElement && targetElement.getBoundingClientRect) {
        const rect = targetElement.getBoundingClientRect();
        const clientY = nativeEvent.clientY !== undefined ? nativeEvent.clientY : nativeEvent.pageY;
        const relativeY = clientY - rect.top;
        const ratio = 1 - Math.max(0, Math.min(1, relativeY / rect.height));

        if (!targetId || targetId === 'master') {
          handleSetMasterVolume(ratio);
        } else if (targetId.endsWith('_A')) {
          const camId = targetId.replace('_A', '');
          handleSetVolumeA(camId, ratio);
        } else if (targetId.endsWith('_B')) {
          const camId = targetId.replace('_B', '');
          handleSetVolumeB(camId, ratio);
        } else {
          handleSetVolume(targetId, ratio);
        }
      }
    }
  };

  // Skeuomorphic Rotary Knob Interaction (Drag left/right or up/down, Double-click to center)
  const handleKnobPointerDown = (e: any, camId: string, currentPan: number) => {
    const now = Date.now();
    const lastClick = lastKnobClickTimeRef.current[camId] || 0;
    if (now - lastClick < 350) {
      handleSetPan(camId, 0);
      lastKnobClickTimeRef.current[camId] = 0;
      return;
    }
    lastKnobClickTimeRef.current[camId] = now;

    if (Platform.OS === 'web' && e) {
      const nativeEvent = e.nativeEvent || e;
      const clientX = nativeEvent.clientX !== undefined ? nativeEvent.clientX : nativeEvent.pageX;
      const clientY = nativeEvent.clientY !== undefined ? nativeEvent.clientY : nativeEvent.pageY;

      draggingTargetRef.current = {
        type: 'pan',
        id: camId,
        startY: clientY,
        startVal: currentPan,
      };

      const handleWindowPointerMove = (ev: MouseEvent | TouchEvent) => {
        if (draggingTargetRef.current?.type === 'pan' && draggingTargetRef.current.id === camId) {
          const moveY = (ev as MouseEvent).clientY ?? (ev as TouchEvent).touches?.[0]?.clientY ?? clientY;
          const moveX = (ev as MouseEvent).clientX ?? (ev as TouchEvent).touches?.[0]?.clientX ?? clientX;
          const delta = (clientX - moveX) * -1.8 + (clientY - moveY) * 1.8;
          const start = draggingTargetRef.current.startVal ?? 0;
          handleSetPan(camId, Math.max(-100, Math.min(100, Math.round(start + delta))));
        }
      };

      const handleWindowPointerUp = () => {
        draggingTargetRef.current = null;
        window.removeEventListener('pointermove', handleWindowPointerMove);
        window.removeEventListener('pointerup', handleWindowPointerUp);
        window.removeEventListener('mousemove', handleWindowPointerMove);
        window.removeEventListener('mouseup', handleWindowPointerUp);
      };

      window.addEventListener('pointermove', handleWindowPointerMove);
      window.addEventListener('pointerup', handleWindowPointerUp);
      window.addEventListener('mousemove', handleWindowPointerMove);
      window.addEventListener('mouseup', handleWindowPointerUp);
    }
  };

  // Render High-Fidelity Discrete LED Ladder
  const renderLedMeter = (level: number, peak: number, width: number = 7) => {
    const activeSegments = Math.round(level * TOTAL_LED_SEGMENTS);
    const peakSegment = Math.min(TOTAL_LED_SEGMENTS - 1, Math.round(peak * TOTAL_LED_SEGMENTS));

    return (
      <View style={[styles.meterTrack, { width }]}>
        {Array.from({ length: TOTAL_LED_SEGMENTS }).map((_, i) => {
          const segIdx = TOTAL_LED_SEGMENTS - 1 - i; // Top (17) to Bottom (0)
          const isLit = segIdx < activeSegments;
          const isPeak = segIdx === peakSegment && peak > 0.04;

          let activeColor = '#00E676';
          let offColor = '#0D2315';
          let glowShadow = '0 0 6px rgba(0, 230, 118, 0.85)';

          if (segIdx >= 14) {
            activeColor = '#FF1744';
            offColor = '#2B0E12';
            glowShadow = '0 0 8px rgba(255, 23, 68, 0.95)';
          } else if (segIdx >= 10) {
            activeColor = '#FFD600';
            offColor = '#2A2209';
            glowShadow = '0 0 7px rgba(255, 214, 0, 0.9)';
          }

          return (
            <View
              key={segIdx}
              style={[
                styles.meterLedBlock,
                {
                  backgroundColor: isLit || isPeak ? activeColor : offColor,
                  // @ts-ignore web boxShadow
                  boxShadow: isLit || isPeak ? glowShadow : 'none',
                },
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
          <Text style={styles.ribbonSubtitle}>8 CANALES DE CÁMARA • STEREO / DUAL-MONO SPLIT</Text>
        </View>

        <View style={styles.ribbonRight}>
          <View style={styles.badgePfl}>
            <Text style={styles.badgePflText}>PFL MATRIX</Text>
          </View>
          <View style={styles.badgeSampleRate}>
            <Text style={styles.badgeSampleRateText}>48 kHz / 24-BIT DIGITAL AUDIO BUS</Text>
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
            const isSplit = ch.mode === 'split';

            // Rotation angle: -100 (L) = -135deg, 0 (C) = 0deg, +100 (R) = +135deg
            const knobAngle = (ch.pan / 100) * 135;

            return (
              <View
                key={ch.id}
                style={[
                  styles.stripCard,
                  isPgm && styles.stripCardPgm,
                  isPvw && styles.stripCardPvw,
                  isSplit && styles.stripCardSplit,
                ]}
              >
                {/* 1. TOP HEADER: Channel Number + STEREO/SPLIT Mode Toggle */}
                <View style={styles.stripHeader}>
                  <View style={styles.headerTopRow}>
                    <View
                      style={[
                        styles.chNumberBadge,
                        isPgm && styles.chBadgePgm,
                        isPvw && styles.chBadgePvw,
                      ]}
                    >
                      <Text style={styles.chNumberText}>{ch.num}</Text>
                    </View>

                    {/* Mode Switcher Button: STEREO / SPLIT */}
                    <TouchableOpacity
                      style={[
                        styles.modeToggleButton,
                        isSplit ? styles.modeToggleSplit : styles.modeToggleStereo,
                      ]}
                      onPress={() => handleToggleMode(ch.id)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.modeToggleText,
                          isSplit ? styles.modeTextSplit : styles.modeTextStereo,
                        ]}
                      >
                        {isSplit ? 'SPLIT' : 'STEREO'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {isPgm ? (
                    <View style={styles.liveTag}>
                      <Text style={styles.liveTagText}>ON AIR</Text>
                    </View>
                  ) : null}
                </View>

                {/* 2. PAN SECTION / SUB-TRACK HEADERS */}
                {!isSplit ? (
                  /* STEREO: Rotary Pan Knob */
                  <View style={styles.panSection}>
                    <View style={styles.panDialSurround}>
                      <View style={styles.panCenterRefDot} />

                      <View style={styles.panKnobRow}>
                        <Text style={styles.panLabelL}>L</Text>

                        <TouchableOpacity
                          style={styles.knob3DOuter}
                          activeOpacity={0.9}
                          // @ts-ignore
                          onPointerDown={(e: any) => handleKnobPointerDown(e, ch.id, ch.pan)}
                        >
                          <View style={styles.knob3DBezel}>
                            <View
                              style={[
                                styles.knob3DFace,
                                {
                                  transform: [{ rotate: `${knobAngle}deg` }],
                                },
                              ]}
                            >
                              <View style={styles.knobPointerLine} />
                            </View>
                          </View>
                        </TouchableOpacity>

                        <Text style={styles.panLabelR}>R</Text>
                      </View>
                    </View>

                    <Text style={styles.panDigitalText}>{panToString(ch.pan)}</Text>
                  </View>
                ) : (
                  /* SPLIT: Sub-track Labels Ch A (L) & Ch B (R) */
                  <View style={styles.splitSubPillRow}>
                    <View style={styles.splitSubPillA}>
                      <Text style={styles.splitSubPillText}>CH A (L)</Text>
                    </View>
                    <View style={styles.splitSubPillB}>
                      <Text style={styles.splitSubPillText}>CH B (R)</Text>
                    </View>
                  </View>
                )}

                {/* 3. MUTE BUTTON */}
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

                {/* 4. DYNAMIC FADER & VU METER AREA (STEREO vs SPLIT DUAL-MONO) */}
                {!isSplit ? (
                  /* STEREO MODE: dB Scale + Unified Fader + Dual L/R Meters */
                  <View style={styles.faderAndMeterArea}>
                    {/* Detailed dB Graduation Markings */}
                    <View style={styles.dbScaleColumn}>
                      {DB_GRADUATION_MARKS.map((m) => (
                        <View key={m.label} style={styles.dbMarkRow}>
                          <Text
                            style={[
                              styles.dbLabelText,
                              { color: m.color },
                              m.isUnity && styles.dbLabelUnity,
                            ]}
                          >
                            {m.label}
                          </Text>
                          <View
                            style={[
                              styles.dbTickMark,
                              { backgroundColor: m.color },
                              m.isUnity && styles.dbTickUnity,
                            ]}
                          />
                        </View>
                      ))}
                    </View>

                    {/* Central Metallic Fader Track */}
                    <View
                      style={styles.faderTrackContainer}
                      // @ts-ignore
                      onPointerDown={(e: any) => {
                        draggingTargetRef.current = { type: 'fader', id: ch.id };
                        updateFaderFromPointer(e, ch.id);
                      }}
                      // @ts-ignore
                      onPointerMove={(e: any) => {
                        if (draggingTargetRef.current?.type === 'fader' && draggingTargetRef.current.id === ch.id) {
                          updateFaderFromPointer(e, ch.id);
                        }
                      }}
                      // @ts-ignore
                      onPointerUp={() => {
                        draggingTargetRef.current = null;
                      }}
                    >
                      <View style={styles.faderSlotTrack}>
                        <View style={styles.faderUnityNotch} />
                      </View>

                      {/* Silver Brushed Aluminum Fader Cap */}
                      <View
                        style={[
                          styles.faderCapMetallic,
                          {
                            bottom: `${ch.volume * 84}%`,
                          },
                        ]}
                      >
                        <View style={styles.faderCapTopBevel} />
                        <View style={styles.faderCapGripGroove} />
                        <View style={styles.faderCapCenterIndexLine} />
                        <View style={styles.faderCapGripGroove} />
                        <View style={styles.faderCapBottomBevel} />
                      </View>
                    </View>

                    {/* Dual Stereo VU Meter Bars (L / R) */}
                    <View style={styles.stereoDualMeterCol}>
                      <View style={styles.stereoSubMeter}>
                        <Text style={styles.microMeterLabel}>L</Text>
                        {renderLedMeter(ch.meterLevelL, ch.peakLevelL, 5)}
                      </View>
                      <View style={styles.stereoSubMeter}>
                        <Text style={styles.microMeterLabel}>R</Text>
                        {renderLedMeter(ch.meterLevelR, ch.peakLevelR, 5)}
                      </View>
                    </View>
                  </View>
                ) : (
                  /* SPLIT DUAL-MONO MODE: Two Discrete Sub-tracks (Ch A / L & Ch B / R) */
                  <View style={styles.splitFadersArea}>
                    {/* Sub-track A (Ch 1 / L) */}
                    <View style={styles.splitSubTrack}>
                      <View style={styles.splitSubTrackBody}>
                        {/* Fader A */}
                        <View
                          style={styles.splitFaderContainer}
                          // @ts-ignore
                          onPointerDown={(e: any) => {
                            const target = ch.id + '_A';
                            draggingTargetRef.current = { type: 'fader', id: target };
                            updateFaderFromPointer(e, target);
                          }}
                          // @ts-ignore
                          onPointerMove={(e: any) => {
                            const target = ch.id + '_A';
                            if (draggingTargetRef.current?.type === 'fader' && draggingTargetRef.current.id === target) {
                              updateFaderFromPointer(e, target);
                            }
                          }}
                          // @ts-ignore
                          onPointerUp={() => {
                            draggingTargetRef.current = null;
                          }}
                        >
                          <View style={styles.splitSlotTrack}>
                            <View style={styles.faderUnityNotch} />
                          </View>

                          <View
                            style={[
                              styles.splitFaderCapMetallic,
                              {
                                bottom: `${ch.volumeA * 84}%`,
                              },
                            ]}
                          >
                            <View style={styles.splitCapIndexLine} />
                          </View>
                        </View>

                        {/* Meter A */}
                        <View style={styles.splitMeterContainer}>
                          {renderLedMeter(ch.meterLevelL, ch.peakLevelL, 5)}
                        </View>
                      </View>
                    </View>

                    {/* Subtle Track Divider */}
                    <View style={styles.splitTrackDivider} />

                    {/* Sub-track B (Ch 2 / R) */}
                    <View style={styles.splitSubTrack}>
                      <View style={styles.splitSubTrackBody}>
                        {/* Fader B */}
                        <View
                          style={styles.splitFaderContainer}
                          // @ts-ignore
                          onPointerDown={(e: any) => {
                            const target = ch.id + '_B';
                            draggingTargetRef.current = { type: 'fader', id: target };
                            updateFaderFromPointer(e, target);
                          }}
                          // @ts-ignore
                          onPointerMove={(e: any) => {
                            const target = ch.id + '_B';
                            if (draggingTargetRef.current?.type === 'fader' && draggingTargetRef.current.id === target) {
                              updateFaderFromPointer(e, target);
                            }
                          }}
                          // @ts-ignore
                          onPointerUp={() => {
                            draggingTargetRef.current = null;
                          }}
                        >
                          <View style={styles.splitSlotTrack}>
                            <View style={styles.faderUnityNotch} />
                          </View>

                          <View
                            style={[
                              styles.splitFaderCapMetallic,
                              {
                                bottom: `${ch.volumeB * 84}%`,
                              },
                            ]}
                          >
                            <View style={styles.splitCapIndexLine} />
                          </View>
                        </View>

                        {/* Meter B */}
                        <View style={styles.splitMeterContainer}>
                          {renderLedMeter(ch.meterLevelR, ch.peakLevelR, 5)}
                        </View>
                      </View>
                    </View>
                  </View>
                )}

                {/* Digital Gain Readout */}
                <View style={styles.dbReadoutBox}>
                  <Text style={styles.dbReadoutText}>
                    {isSplit
                      ? `A:${volumeToDbString(ch.volumeA).replace(' dB', '')} B:${volumeToDbString(ch.volumeB).replace(' dB', '')}`
                      : volumeToDbString(ch.volume)}
                  </Text>
                </View>

                {/* 5. BOTTOM MONITORING BUTTON */}
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
        {/* DEDICATED MASTER SECTION (Red Accent Border)                       */}
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

          {/* Master Fader (Left) & Dual VU Meters (Right) Area */}
          <View style={styles.masterMixArea}>
            {/* LEFT SIDE: Detailed dB Scale + Master Stereo Fader */}
            <View style={styles.masterLeftFaderGroup}>
              {/* Detailed dB Scale */}
              <View style={styles.masterDbScaleColumn}>
                {DB_GRADUATION_MARKS.map((m) => (
                  <View key={m.label} style={styles.dbMarkRow}>
                    <Text
                      style={[
                        styles.masterDbText,
                        { color: m.color },
                        m.isUnity && styles.dbLabelUnity,
                      ]}
                    >
                      {m.label}
                    </Text>
                    <View
                      style={[
                        styles.dbTickMark,
                        { backgroundColor: m.color },
                        m.isUnity && styles.dbTickUnity,
                      ]}
                    />
                  </View>
                ))}
              </View>

              {/* Dual Stereo Faders (Ganged Together) */}
              <View
                style={styles.masterDualFadersColumn}
                // @ts-ignore: React Native Web pointer event
                onPointerDown={(e: any) => {
                  draggingTargetRef.current = { type: 'fader', id: 'master' };
                  updateFaderFromPointer(e);
                }}
                // @ts-ignore: React Native Web pointer event
                onPointerMove={(e: any) => {
                  if (draggingTargetRef.current?.type === 'fader' && draggingTargetRef.current.id === 'master') {
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
                    <View style={styles.faderSlotTrack}>
                      <View style={styles.faderUnityNotch} />
                    </View>
                    <View style={styles.faderSlotTrack}>
                      <View style={styles.faderUnityNotch} />
                    </View>
                  </View>

                  {/* Ganged Stereo Brushed Fader Handle with Dual Red Bridge */}
                  <View
                    style={[
                      styles.masterFaderCapGanged,
                      {
                        bottom: `${masterVolume * 84}%`,
                      },
                    ]}
                  >
                    <View style={styles.masterCapBridgeLine} />
                    <Text style={styles.masterCapText}>STEREO</Text>
                    <View style={styles.masterCapBridgeLine} />
                  </View>
                </View>
              </View>
            </View>

            {/* RIGHT SIDE: Dual Stereo VU Meters (L and R LED Ladders) */}
            <View style={styles.masterRightMetersGroup}>
              {/* Left VU Meter */}
              <View style={styles.masterMeterBlock}>
                <Text style={styles.channelLRHeader}>L</Text>
                {renderLedMeter(masterMeterL, masterPeakL, 6)}
              </View>

              {/* Right VU Meter */}
              <View style={styles.masterMeterBlock}>
                <Text style={styles.channelLRHeader}>R</Text>
                {renderLedMeter(masterMeterR, masterPeakR, 6)}
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
    paddingHorizontal: 12,
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
    backgroundColor: '#1A0E13',
  },
  stripCardPvw: {
    borderColor: '#00E676',
    backgroundColor: '#0D1713',
  },
  stripCardSplit: {
    borderColor: '#3D3422',
  },
  stripHeader: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 2,
  },
  headerTopRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  chNumberBadge: {
    flex: 1,
    backgroundColor: '#1A1A26',
    borderRadius: 4,
    paddingVertical: 2.5,
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
    fontSize: 11.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  modeToggleButton: {
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 3.5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeToggleStereo: {
    backgroundColor: '#142129',
    borderColor: '#00B0FF',
  },
  modeToggleSplit: {
    backgroundColor: '#2A1F10',
    borderColor: '#FFB300',
  },
  modeToggleText: {
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  modeTextStereo: {
    color: '#40C4FF',
  },
  modeTextSplit: {
    color: '#FFB300',
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
  /* 3D Skeuomorphic Rotary Pan Section (Stereo Mode) */
  panSection: {
    width: '100%',
    alignItems: 'center',
    marginVertical: 2,
  },
  panDialSurround: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  panCenterRefDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 1.75,
    backgroundColor: '#FFD600',
    marginBottom: 2,
    opacity: 0.9,
  },
  panKnobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  panLabelL: {
    color: '#7E8096',
    fontSize: 8.5,
    fontWeight: '900',
  },
  panLabelR: {
    color: '#7E8096',
    fontSize: 8.5,
    fontWeight: '900',
  },
  knob3DOuter: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#15161E',
    borderWidth: 1.5,
    borderColor: '#2F3242',
    alignItems: 'center',
    justifyContent: 'center',
    // @ts-ignore web shadow
    boxShadow: '0 3px 6px rgba(0,0,0,0.85), inset 0 1px 1px rgba(255,255,255,0.12)',
    cursor: 'pointer' as any,
  },
  knob3DBezel: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#20222D',
    borderWidth: 1,
    borderColor: '#3D4052',
    alignItems: 'center',
    justifyContent: 'center',
  },
  knob3DFace: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#12131A',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 1.5,
  },
  knobPointerLine: {
    width: 2,
    height: 7,
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
    // @ts-ignore web shadow
    boxShadow: '0 0 3px rgba(255, 255, 255, 0.9)',
  },
  panDigitalText: {
    color: '#9E9EB6',
    fontSize: 8,
    fontWeight: '800',
    marginTop: 2,
  },
  /* Split Mode Sub-Pills */
  splitSubPillRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 2,
    marginVertical: 4,
  },
  splitSubPillA: {
    flex: 1,
    backgroundColor: '#1E1711',
    borderWidth: 1,
    borderColor: '#FFB300',
    borderRadius: 3,
    paddingVertical: 2,
    alignItems: 'center',
  },
  splitSubPillB: {
    flex: 1,
    backgroundColor: '#1E1711',
    borderWidth: 1,
    borderColor: '#FFB300',
    borderRadius: 3,
    paddingVertical: 2,
    alignItems: 'center',
  },
  splitSubPillText: {
    color: '#FFD54F',
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  /* Mute Button */
  muteButton: {
    width: '100%',
    paddingVertical: 5,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 3,
  },
  muteButtonIdle: {
    backgroundColor: '#181924',
    borderColor: '#2D3042',
  },
  muteButtonActive: {
    backgroundColor: '#FF1744',
    borderColor: '#FF5252',
    // @ts-ignore web glow
    boxShadow: '0 0 10px rgba(255, 23, 68, 0.85)',
  },
  muteButtonText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  muteTextIdle: {
    color: '#8C8EA6',
  },
  muteTextActive: {
    color: '#FFFFFF',
  },
  /* Fader & Meter Area (Stereo) */
  faderAndMeterArea: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    marginVertical: 3,
    gap: 3,
  },
  dbScaleColumn: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingVertical: 3,
    width: 18,
  },
  dbMarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
    width: '100%',
  },
  dbLabelText: {
    fontSize: 7,
    fontWeight: '800',
  },
  dbLabelUnity: {
    fontSize: 8,
    fontWeight: '900',
  },
  dbTickMark: {
    width: 3,
    height: 1,
    opacity: 0.7,
  },
  dbTickUnity: {
    width: 5,
    height: 1.5,
    opacity: 1,
  },
  faderTrackContainer: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 24,
    cursor: 'pointer' as any,
  },
  faderSlotTrack: {
    width: 5,
    height: '100%',
    backgroundColor: '#060609',
    borderRadius: 2.5,
    borderWidth: 1,
    borderColor: '#1A1C28',
    position: 'relative',
    // @ts-ignore web shadow
    boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.9)',
  },
  faderUnityNotch: {
    position: 'absolute',
    bottom: '75%',
    left: -5,
    right: -5,
    height: 2,
    backgroundColor: '#FFD600',
    opacity: 0.75,
  },
  faderCapMetallic: {
    position: 'absolute',
    width: 26,
    height: 42,
    backgroundColor: '#B4B4BE',
    borderRadius: 3.5,
    borderWidth: 1.5,
    borderColor: '#E2E2EA',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
    // @ts-ignore web shadow
    boxShadow: '0 5px 12px rgba(0,0,0,0.9), inset 0 1px 1px rgba(255,255,255,0.8), inset 0 -1px 2px rgba(0,0,0,0.5)',
  },
  faderCapTopBevel: {
    width: '100%',
    height: 2,
    backgroundColor: '#F0F0F8',
    opacity: 0.9,
  },
  faderCapGripGroove: {
    width: 13,
    height: 1.5,
    backgroundColor: '#4E505E',
    borderRadius: 0.75,
  },
  faderCapCenterIndexLine: {
    width: 18,
    height: 2.5,
    backgroundColor: '#1E202A',
    borderRadius: 1,
  },
  faderCapBottomBevel: {
    width: '100%',
    height: 2,
    backgroundColor: '#6A6C7A',
    opacity: 0.8,
  },
  stereoDualMeterCol: {
    flexDirection: 'row',
    gap: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stereoSubMeter: {
    alignItems: 'center',
  },
  microMeterLabel: {
    color: '#8C8EA6',
    fontSize: 6.5,
    fontWeight: '900',
    marginBottom: 1,
  },
  /* Split Mode Faders & Meters */
  splitFadersArea: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    marginVertical: 3,
    gap: 3,
  },
  splitSubTrack: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  splitSubTrackBody: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 2,
  },
  splitFaderContainer: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 16,
    cursor: 'pointer' as any,
  },
  splitSlotTrack: {
    width: 4,
    height: '100%',
    backgroundColor: '#060609',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#1A1C28',
    position: 'relative',
  },
  splitFaderCapMetallic: {
    position: 'absolute',
    width: 18,
    height: 36,
    backgroundColor: '#A8A8B4',
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: '#D8D8E2',
    justifyContent: 'center',
    alignItems: 'center',
    // @ts-ignore web shadow
    boxShadow: '0 4px 10px rgba(0,0,0,0.85), inset 0 1px 1px rgba(255,255,255,0.7)',
  },
  splitCapIndexLine: {
    width: 12,
    height: 2,
    backgroundColor: '#1E202A',
    borderRadius: 1,
  },
  splitMeterContainer: {
    width: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitTrackDivider: {
    width: 1,
    height: '90%',
    alignSelf: 'center',
    backgroundColor: '#26293A',
  },
  meterTrack: {
    flex: 1,
    height: '100%',
    backgroundColor: '#07080D',
    borderRadius: 2,
    padding: 0.5,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#191B26',
    // @ts-ignore web shadow
    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8)',
  },
  meterLedBlock: {
    width: '100%',
    flex: 1,
    borderRadius: 1,
    marginVertical: 0.5,
  },
  /* Digital Gain Readout */
  dbReadoutBox: {
    width: '100%',
    backgroundColor: '#0A0B10',
    borderWidth: 1,
    borderColor: '#1C1D2A',
    borderRadius: 3,
    paddingVertical: 2,
    alignItems: 'center',
    marginBottom: 3,
  },
  dbReadoutText: {
    color: '#00E676',
    fontSize: 7.5,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  /* Bottom Monitoring Button */
  monitorButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#181924',
    borderWidth: 1,
    borderColor: '#292B3C',
    borderRadius: 4,
    paddingVertical: 5,
    gap: 3,
  },
  monitorButtonActive: {
    backgroundColor: '#004D40',
    borderColor: '#00E676',
    // @ts-ignore web glow
    boxShadow: '0 0 8px rgba(0, 230, 118, 0.6)',
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
    width: 180,
    backgroundColor: '#120D12',
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#FF1744',
    padding: 6,
    justifyContent: 'space-between',
    alignItems: 'center',
    // @ts-ignore web shadow
    boxShadow: '0 0 12px rgba(255, 23, 68, 0.25)',
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
    justifyContent: 'space-between',
    gap: 4,
    marginVertical: 4,
  },
  masterLeftFaderGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 3,
  },
  masterRightMetersGroup: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 5,
    paddingLeft: 4,
    borderLeftWidth: 1,
    borderLeftColor: '#2C1822',
  },
  masterMeterBlock: {
    alignItems: 'center',
    width: 13,
  },
  channelLRHeader: {
    color: '#FF8A80',
    fontSize: 8.5,
    fontWeight: '900',
    marginBottom: 2,
  },
  masterDbScaleColumn: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingVertical: 3,
    width: 20,
  },
  masterDbText: {
    fontSize: 7,
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
    gap: 8,
    height: '100%',
    alignItems: 'center',
  },
  masterFaderCapGanged: {
    position: 'absolute',
    width: 48,
    height: 44,
    backgroundColor: '#C5112E',
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#FF5252',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    // @ts-ignore web shadow
    boxShadow: '0 5px 14px rgba(255, 23, 68, 0.6), inset 0 1px 1px rgba(255,255,255,0.6)',
  },
  masterCapBridgeLine: {
    width: 28,
    height: 2,
    backgroundColor: '#FF8A80',
  },
  masterCapText: {
    color: '#FFFFFF',
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 0.6,
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
    backgroundColor: '#1E1317',
    borderColor: '#4A2328',
  },
  masterMuteBtnActive: {
    backgroundColor: '#FF1744',
    borderColor: '#FF5252',
    // @ts-ignore web glow
    boxShadow: '0 0 12px rgba(255, 23, 68, 0.85)',
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
    backgroundColor: '#1C1D28',
    borderWidth: 1,
    borderColor: '#303244',
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
    backgroundColor: '#FF1744',
    borderColor: '#FF5252',
    // @ts-ignore web glow
    boxShadow: '0 0 8px rgba(255, 23, 68, 0.75)',
  },
  allMuteBtnText: {
    color: '#FF5252',
    fontSize: 8,
    fontWeight: '900',
  },
});

export default AudioMixerView;
