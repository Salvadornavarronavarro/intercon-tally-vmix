import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Platform,
  Modal,
  Image,
} from 'react-native';
import QRCode from 'qrcode';
import { useIntercom, Participant } from '../context/IntercomContext';
import {
  voiceCommandService,
  ParsedVoiceCommand,
  parseVoiceCommand,
} from '../services/voiceCommandService';
import {
  vmixService,
  VmixConfig,
  VmixStatus,
} from '../services/vmixService';
import { BrandedTopBar } from './BrandedTopBar';
import { CrewAuthModal } from './CrewAuthModal';
import { AudioMixerView } from './AudioMixerView';

const CAMERA_LABELS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 16 }, (_, i) => [`cam${i + 1}`, `CAM ${i + 1}`])
);

export const DirectorView: React.FC = () => {
  const [cameraCount, setCameraCount] = useState<number>(8);
  const activeCameras = Array.from({ length: cameraCount }, (_, i) => `cam${i + 1}`);
  const {
    currentUser,
    currentRoomId,
    activePreviewCamera,
    activeProgramCamera,
    participantsList,
    connectionStatus,
    isMuted,
    setPreviewCamera,
    setProgramCamera,
    muteRemoteOperator,
    toggleMute,
    leaveRoom,
  } = useIntercom();

  // Voice command state (Director only)
  const [isVoiceActive, setIsVoiceActive] = useState<boolean>(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<ParsedVoiceCommand | null>(null);
  const [interimSpeech, setInterimSpeech] = useState<string>('');
  const isVoiceSupported = voiceCommandService.isSupported();

  // vMix Direct Integration state
  const [isVmixPanelOpen, setIsVmixPanelOpen] = useState<boolean>(false);
  const [vmixConfig, setVmixConfig] = useState<VmixConfig>(vmixService.getConfig());
  const [vmixStatus, setVmixStatus] = useState<VmixStatus>({ connected: false });
  const [vmixHostInput, setVmixHostInput] = useState<string>(vmixService.getConfig().host);
  const [vmixPortInput, setVmixPortInput] = useState<string>(vmixService.getConfig().port);
  const [cameraMapState, setCameraMapState] = useState<Record<string, string>>(vmixService.getConfig().cameraMap);
  const [cameraMuteMap, setCameraMuteMap] = useState<Record<string, boolean>>({});
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'tally' | 'audio' | 'vmix'>('tally');

  // QR Code camera invite modal state
  const [isQrModalOpen, setIsQrModalOpen] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  const getCameraInviteUrl = () => {
    let baseUrl = 'https://intercon-tally-v2-vmix.onrender.com';
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      baseUrl = window.location.origin;
    }
    const cleanRoom = encodeURIComponent(currentRoomId || 'DEFAULT');
    return `${baseUrl}/?room=${cleanRoom}&role=CAM`;
  };

  useEffect(() => {
    if (isQrModalOpen) {
      const inviteUrl = getCameraInviteUrl();
      QRCode.toDataURL(inviteUrl, {
        width: 320,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
        errorCorrectionLevel: 'M',
      })
        .then((url) => {
          setQrDataUrl(url);
        })
        .catch((err) => {
          console.warn('[DirectorView] Error generating QR code:', err);
        });
    }
  }, [isQrModalOpen, currentRoomId]);

  const handleCopyInviteLink = async () => {
    const inviteUrl = getCameraInviteUrl();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(inviteUrl);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2500);
      }
    } catch (err) {
      console.warn('[DirectorView] Failed to copy invite link:', err);
    }
  };

  // Initialize vMix config and start background status polling (every 3 seconds)
  useEffect(() => {
    let unsubStatus: (() => void) | null = null;
    (async () => {
      const cfg = await vmixService.loadConfig();
      setVmixConfig(cfg);
      setVmixHostInput(cfg.host);
      setVmixPortInput(cfg.port);
      setCameraMapState(cfg.cameraMap);

      unsubStatus = vmixService.onStatusChange((status) => {
        setVmixStatus(status);
      });

      vmixService.startPolling(3000);
    })();

    return () => {
      if (unsubStatus) unsubStatus();
      vmixService.stopPolling();
    };
  }, []);

  useEffect(() => {
    return () => {
      voiceCommandService.stopListening();
    };
  }, []);

  // Initialize default broadcast tally pair (CAM 1 live, CAM 2 preview) if none active
  useEffect(() => {
    if (!activeProgramCamera && !activePreviewCamera) {
      setProgramCamera('cam1');
      setPreviewCamera('cam2');
    } else if (activeProgramCamera && !activePreviewCamera) {
      setPreviewCamera(activeProgramCamera === 'cam1' ? 'cam2' : 'cam1');
    }
  }, [activeProgramCamera, activePreviewCamera, setProgramCamera, setPreviewCamera]);

  /**
   * Dispatches PREVIEW:
   * 1. Intercom Tally preview state (green badge + intermittent beep)
   * 2. Asynchronous vMix call: Function=PreviewInput&Input=[Mapped_Input]
   */
  const triggerPreview = (camId: string) => {
    setPreviewCamera(camId);
    vmixService.sendPreview(camId).catch((err) => {
      console.warn('[DirectorView] Non-blocking vMix sendPreview notice:', err);
    });
  };

  /**
   * Dispatches PROGRAM CUT:
   * 1. Intercom Tally program cut + 2-second overlap tone on outgoing camera
   * 2. Immediate vMix call: Function=CutDirect&Input=[Mapped_Input]
   */
  const triggerProgram = (camId: string) => {
    setProgramCamera(camId);
    vmixService.sendCut(camId).catch((err) => {
      console.warn('[DirectorView] Non-blocking vMix sendCut notice:', err);
    });
  };

  const handleToggleVoice = async () => {
    if (isVoiceActive) {
      await voiceCommandService.stopListening();
      setIsVoiceActive(false);
      setInterimSpeech('');
    } else {
      setVoiceError(null);
      const success = await voiceCommandService.startListening(currentUser?.role, {
        onCommand: (command) => {
          if (command.type === 'PREVIEW') {
            triggerPreview(command.cameraId);
          } else if (command.type === 'PROGRAM') {
            triggerProgram(command.cameraId);
          }
          setLastCommand(command);
          setInterimSpeech('');
        },
        onTranscript: (transcript) => {
          setInterimSpeech(transcript);
        },
        onStatusChange: (listening, error) => {
          setIsVoiceActive(listening);
          if (error) {
            setVoiceError(error);
          }
        },
        onError: (err) => {
          setVoiceError(err);
        },
      });

      if (!success) {
        setIsVoiceActive(false);
      }
    }
  };

  const handleTestVoiceCommand = (phrase: string) => {
    const cmd = parseVoiceCommand(phrase);
    if (cmd) {
      if (cmd.type === 'PREVIEW') {
        triggerPreview(cmd.cameraId);
      } else if (cmd.type === 'PROGRAM') {
        triggerProgram(cmd.cameraId);
      }
      setLastCommand(cmd);
      setInterimSpeech('');
    }
  };

  const handleSaveVmixHost = async (host: string) => {
    setVmixHostInput(host);
    const updated = await vmixService.updateConfig({ host: host.trim() });
    setVmixConfig(updated);
    vmixService.checkStatus().catch(() => {});
  };

  const handleSaveVmixPort = async (port: string) => {
    setVmixPortInput(port);
    const updated = await vmixService.updateConfig({ port: port.trim() });
    setVmixConfig(updated);
    vmixService.checkStatus().catch(() => {});
  };

  const handleToggleVmixEnabled = async () => {
    const nextVal = !vmixConfig.enabled;
    const updated = await vmixService.updateConfig({ enabled: nextVal });
    setVmixConfig(updated);
  };

  const handleCameraMapChange = async (camId: string, inputVal: string) => {
    const updatedMap = { ...cameraMapState, [camId]: inputVal.trim() };
    setCameraMapState(updatedMap);
    const updated = await vmixService.updateConfig({ cameraMap: updatedMap });
    setVmixConfig(updated);
  };

  // Find camera operator assigned to a specific camera ID
  const getOperatorForCamera = (camId: string): Participant | undefined => {
    return participantsList.find((p) => p.role === 'camera' && p.cameraId === camId);
  };

  /**
   * Camera tile tap interaction:
   * - If idle -> Set to PREVIEW (Green)
   * - If preview -> Promote to PROGRAM (Red) and cut previous program
   * - If program -> Keep program (or tap preview to stage next)
   */
  const handleCameraTilePress = (camId: string) => {
    if (activeProgramCamera === camId) {
      // Already live on Program
      return;
    }

    if (activePreviewCamera === camId) {
      // In Preview: Execute Flip-Flop cut
      handleTakeCut();
    } else {
      // Idle or other: Stage into Preview
      triggerPreview(camId);
    }
  };

  /**
   * Broadcast Flip-Flop CUT Action:
   * Transitions active Preview into Program, and automatically assigns
   * the outgoing Program as the incoming Preview (flip-flop ping-pong switching).
   * CUT remains permanently enabled for rapid continuous switching.
   */
  const handleTakeCut = () => {
    const incomingPgm = activePreviewCamera || (activeProgramCamera === 'cam1' ? 'cam2' : 'cam1');
    const outgoingPgm = activeProgramCamera || (incomingPgm === 'cam1' ? 'cam2' : 'cam1');
    const nextPreview = outgoingPgm !== incomingPgm ? outgoingPgm : (incomingPgm === 'cam1' ? 'cam2' : 'cam1');

    setProgramCamera(incomingPgm);
    setPreviewCamera(nextPreview);

    vmixService.sendCut(incomingPgm).catch((err) => {
      console.warn('[DirectorView] Non-blocking vMix sendCut notice:', err);
    });

    vmixService.sendPreview(nextPreview).catch((err) => {
      console.warn('[DirectorView] Non-blocking vMix sendPreview notice:', err);
    });
  };

  /**
   * Broadcast Flip-Flop FADE Action:
   * Transitions active Preview into Program via vMix Fade,
   * automatically assigning outgoing Program as the incoming Preview.
   * FADE remains permanently enabled for continuous cross-fading.
   */
  const handleFade = () => {
    const incomingPgm = activePreviewCamera || (activeProgramCamera === 'cam1' ? 'cam2' : 'cam1');
    const outgoingPgm = activeProgramCamera || (incomingPgm === 'cam1' ? 'cam2' : 'cam1');
    const nextPreview = outgoingPgm !== incomingPgm ? outgoingPgm : (incomingPgm === 'cam1' ? 'cam2' : 'cam1');

    setProgramCamera(incomingPgm);
    setPreviewCamera(nextPreview);

    vmixService.sendFade().catch((err) => {
      console.warn('[DirectorView] Non-blocking vMix sendFade notice:', err);
    });

    vmixService.sendPreview(nextPreview).catch((err) => {
      console.warn('[DirectorView] Non-blocking vMix sendPreview notice:', err);
    });
  };

  /**
   * Toggles microphone mute for a specific camera operator card:
   * Dispatches REMOTE_MUTE_TOGGLE and MUTE_REMOTE_OPERATOR across WebSocket signaling.
   */
  const handleToggleCameraMute = (targetCamId: string) => {
    const targetOperator = getOperatorForCamera(targetCamId);
    const currentlyMuted = targetOperator ? targetOperator.isMuted : !!cameraMuteMap[targetCamId];
    const nextMuted = !currentlyMuted;

    // 1. Immediately update local card mute state
    setCameraMuteMap((prev) => ({ ...prev, [targetCamId]: nextMuted }));

    // 2. Dispatch authoritative remote mute command over WebSocket
    muteRemoteOperator(targetOperator?.id || '', targetCamId, nextMuted);
  };

  const getConnectionBadge = () => {
    switch (connectionStatus) {
      case 'connected':
        return { label: 'ONLINE', color: '#00E676', dot: '#00E676' };
      case 'reconnecting':
        return { label: 'RECONNECTING', color: '#FFD600', dot: '#FFD600' };
      case 'connecting':
        return { label: 'CONNECTING', color: '#29B6F6', dot: '#29B6F6' };
      default:
        return { label: 'OFFLINE', color: '#9E9E9E', dot: '#757575' };
    }
  };

  const badge = getConnectionBadge();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0C" />

      {/* Top Institutional Bar: Alicante Paradise Studios Social Links & Crew Login */}
      <BrandedTopBar
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        currentUser={currentUser}
        currentRoomId={currentRoomId}
      />

      {/* Top Director Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.roleTag}>
            <Text style={styles.roleTagText}>DIRECTOR</Text>
          </View>
          <Text style={styles.roomText}>ROOM: {currentRoomId || 'DEFAULT'}</Text>
        </View>

        <View style={styles.headerRight}>
          {/* Top Bar Button: [ 📱 QR CÁMARAS ] */}
          <TouchableOpacity
            style={styles.qrHeaderBtn}
            onPress={() => setIsQrModalOpen(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.qrHeaderBtnIcon}>📱</Text>
            <Text style={styles.qrHeaderBtnText}>QR CÁMARAS</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.headerMicBtn, isMuted ? styles.headerMicMuted : styles.headerMicActive]}
            onPress={toggleMute}
            activeOpacity={0.8}
          >
            <Text style={styles.headerMicIcon}>{isMuted ? '🔇' : '🎙️'}</Text>
            <Text style={[styles.headerMicText, isMuted ? styles.headerMicTextMuted : styles.headerMicTextActive]}>
              {isMuted ? 'MUTED' : 'MIC ON'}
            </Text>
          </TouchableOpacity>

          <View style={[styles.statusPill, { borderColor: badge.color }]}>
            <View style={[styles.statusDot, { backgroundColor: badge.dot }]} />
            <Text style={[styles.statusText, { color: badge.color }]}>{badge.label}</Text>
          </View>

          <TouchableOpacity style={styles.leaveButton} onPress={leaveRoom}>
            <Text style={styles.leaveButtonText}>EXIT</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 3 Prominent Horizontal Navigation Tabs Header */}
      <View style={styles.tabNavContainer}>
        {/* TAB 1: REALIZACIÓN / CÁMARAS */}
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'tally' && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab('tally')}
          activeOpacity={0.8}
        >
          <Text style={styles.tabIcon}>📹</Text>
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'tally' && styles.tabButtonTextActive,
            ]}
            numberOfLines={1}
          >
            REALIZACIÓN / CÁMARAS
          </Text>
          {activeProgramCamera ? (
            <View style={styles.tabBadgeLive}>
              <Text style={styles.tabBadgeLiveText}>
                {CAMERA_LABELS[activeProgramCamera] || 'LIVE'}
              </Text>
            </View>
          ) : null}
          {isVoiceActive ? (
            <View style={styles.tabVoiceListeningBadge}>
              <View style={styles.voicePulseDot} />
              <Text style={styles.tabVoiceListeningText}>VOZ ON</Text>
            </View>
          ) : null}
        </TouchableOpacity>

        {/* TAB 2: SONIDO CONTROL */}
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'audio' && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab('audio')}
          activeOpacity={0.8}
        >
          <Text style={styles.tabIcon}>🔊</Text>
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'audio' && styles.tabButtonTextActive,
            ]}
            numberOfLines={1}
          >
            SONIDO CONTROL
          </Text>
        </TouchableOpacity>

        {/* TAB 3: CONEXIÓN VMIX (Strictly anchored as the last tab on the far right) */}
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'vmix' && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab('vmix')}
          activeOpacity={0.8}
        >
          <Text style={styles.tabIcon}>⚡</Text>
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'vmix' && styles.tabButtonTextActive,
            ]}
            numberOfLines={1}
          >
            CONEXIÓN VMIX
          </Text>
          <View
            style={[
              styles.tabVmixIndicator,
              vmixStatus.connected ? styles.vmixIndOnline : styles.vmixIndOffline,
            ]}
          >
            <View
              style={[
                styles.tabStatusDot,
                vmixStatus.connected ? styles.dotGreen : styles.dotRed,
              ]}
            />
            <Text
              style={[
                styles.tabVmixText,
                vmixStatus.connected ? styles.textGreen : styles.textRed,
              ]}
              numberOfLines={1}
            >
              {vmixStatus.connected ? 'ONLINE' : 'OFFLINE'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Main Tab Panels Container (Maintains background WebRTC & vMix connections mounted) */}
      <View style={styles.mainContainer}>
        {/* ==================================================================== */}
        {/* TAB 1: REALIZACIÓN / CÁMARAS                                        */}
        {/* ==================================================================== */}
        <View style={[styles.tabPane, activeTab !== 'tally' && styles.tabPaneHidden]}>
          <ScrollView
            contentContainerStyle={styles.tabScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Top Status & Transition Bar Overhaul (Program, Preview, CUT, FADE) */}
            <View style={styles.topTransitionBar}>
              <View style={styles.tallyBannersContainer}>
                {/* PROGRAM Banner: Wider aspect, broadcast RED accent & subtle glow */}
                <View style={[styles.tallyBannerBox, styles.programBannerBox]}>
                  <View style={styles.bannerIndicatorDotRed} />
                  <Text style={styles.programBannerLabel}>PROGRAM (LIVE):</Text>
                  <Text style={styles.programBannerVal} numberOfLines={1}>
                    {activeProgramCamera ? CAMERA_LABELS[activeProgramCamera] || activeProgramCamera.toUpperCase() : 'NONE'}
                  </Text>
                </View>

                {/* PREVIEW Banner: Symmetrical wider aspect, broadcast GREEN accent & subtle glow */}
                <View style={[styles.tallyBannerBox, styles.previewBannerBox]}>
                  <View style={styles.bannerIndicatorDotGreen} />
                  <Text style={styles.previewBannerLabel}>PREVIEW (STANDBY):</Text>
                  <Text style={styles.previewBannerVal} numberOfLines={1}>
                    {activePreviewCamera ? CAMERA_LABELS[activePreviewCamera] || activePreviewCamera.toUpperCase() : 'NONE'}
                  </Text>
                </View>
              </View>

              {/* CUT & FADE Buttons: Permanently enabled for continuous flip-flop switching */}
              <View style={styles.transitionActions}>
                <TouchableOpacity
                  style={styles.largeCutBtn}
                  onPress={handleTakeCut}
                  activeOpacity={0.8}
                >
                  <Text style={styles.largeCutBtnText}>CUT</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.largeFadeBtn}
                  onPress={handleFade}
                  activeOpacity={0.8}
                >
                  <Text style={styles.largeFadeBtnText}>FADE</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Camera Matrix Header with Dynamic Stepper */}
            <View style={styles.cameraMatrixHeader}>
              <View style={styles.cameraMatrixHeaderLeft}>
                <Text style={styles.sectionTitle}>CAMERA TALLY MATRIX</Text>
                <Text style={styles.matrixHint}>Tap card to Stage Preview / Cut to Program</Text>
              </View>

              {/* Dynamic Studio Camera Count Manager (Director Only) */}
              <View style={styles.cameraStepperContainer}>
                <Text style={styles.cameraStepperLabel}>CAMERAS:</Text>
                <View style={styles.cameraStepperControls}>
                  <TouchableOpacity
                    style={[styles.cameraStepperBtn, cameraCount <= 1 && styles.cameraStepperBtnDisabled]}
                    disabled={cameraCount <= 1}
                    onPress={() => setCameraCount((prev) => Math.max(1, prev - 1))}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cameraStepperBtnText}>−</Text>
                  </TouchableOpacity>
                  <View style={styles.cameraCountPill}>
                    <Text style={styles.cameraCountPillText}>{cameraCount}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.cameraStepperBtn, cameraCount >= 16 && styles.cameraStepperBtnDisabled]}
                    disabled={cameraCount >= 16}
                    onPress={() => setCameraCount((prev) => Math.min(16, prev + 1))}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cameraStepperBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={styles.cameraGrid}>
              {activeCameras.map((camId) => {
                const isProgram = activeProgramCamera === camId;
                const isPreview = activePreviewCamera === camId;
                const operator = getOperatorForCamera(camId);
                const isOperatorMuted = operator ? operator.isMuted : !!cameraMuteMap[camId];

                let tileStyle = styles.tileIdle;
                let statusBadgeStyle = styles.badgeIdle;
                let statusText = 'IDLE';

                if (isProgram) {
                  tileStyle = styles.tileProgram;
                  statusBadgeStyle = styles.badgeProgram;
                  statusText = 'ON AIR';
                } else if (isPreview) {
                  tileStyle = styles.tilePreview;
                  statusBadgeStyle = styles.badgePreview;
                  statusText = 'PREVIEW';
                }

                return (
                  <TouchableOpacity
                    key={camId}
                    style={[styles.cameraTile, tileStyle]}
                    onPress={() => handleCameraTilePress(camId)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.tileHeader}>
                      <View>
                        <Text style={[styles.cameraNumber, isProgram && styles.textWhite]}>
                          {CAMERA_LABELS[camId]}
                        </Text>
                        <Text style={styles.tileVmixBadge}>
                          vMix In: {cameraMapState[camId] || camId.replace('cam', '')}
                        </Text>
                      </View>
                      <View style={[styles.tileBadge, statusBadgeStyle]}>
                        <Text style={styles.tileBadgeText}>{statusText}</Text>
                      </View>
                    </View>

                    {/* Direct PGM (Red) and PVW (Green) Action Buttons */}
                    <View style={styles.tileTallyActions}>
                      <TouchableOpacity
                        style={[
                          styles.tileActionBtn,
                          styles.tilePgmBtn,
                          isProgram && styles.tilePgmBtnActive,
                        ]}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          triggerProgram(camId);
                        }}
                        activeOpacity={0.8}
                        accessibilityLabel={`Program ${CAMERA_LABELS[camId]}`}
                      >
                        <Text
                          style={[
                            styles.tileActionText,
                            isProgram ? styles.tileActionTextActive : styles.textPgm,
                          ]}
                        >
                          PGM
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.tileActionBtn,
                          styles.tilePvwBtn,
                          isPreview && styles.tilePvwBtnActive,
                        ]}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          triggerPreview(camId);
                        }}
                        activeOpacity={0.8}
                        accessibilityLabel={`Preview ${CAMERA_LABELS[camId]}`}
                      >
                        <Text
                          style={[
                            styles.tileActionText,
                            isPreview ? styles.tileActionTextActive : styles.textPvw,
                          ]}
                        >
                          PVW
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Operator status row with bottom-right compact mute button */}
                    <View style={styles.tileFooter}>
                      <View style={styles.operatorRow}>
                        {operator ? (
                          <>
                            <View style={[styles.onlineIndicator, isOperatorMuted && styles.indicatorMuted]} />
                            <Text style={styles.operatorName} numberOfLines={1}>
                              {operator.name}
                            </Text>
                          </>
                        ) : (
                          <Text style={styles.noOperatorText}>NO OPERATOR</Text>
                        )}
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.tileMuteBtnCompact,
                          isOperatorMuted ? styles.tileMuteBtnCompactMuted : styles.tileMuteBtnCompactLive,
                        ]}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          handleToggleCameraMute(camId);
                        }}
                        activeOpacity={0.8}
                        accessibilityLabel={`Toggle mic for ${CAMERA_LABELS[camId]}`}
                      >
                        <Text style={styles.tileMuteCompactIcon}>
                          {isOperatorMuted ? '🔇' : '🎙️'}
                        </Text>
                        <Text
                          style={[
                            styles.tileMuteCompactText,
                            isOperatorMuted ? styles.textMutedRed : styles.textLiveGreen,
                          ]}
                        >
                          {isOperatorMuted ? 'MUTED' : 'MUTE'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Connected Participants Section (Compact Roster) */}
            <View style={styles.participantsSection}>
              <View style={styles.rosterHeader}>
                <Text style={styles.sectionTitle}>
                  CONNECTED INTERCOM OPERATORS ({participantsList.length})
                </Text>
                <Text style={styles.rosterSub}>Live full-duplex WebRTC audio mesh</Text>
              </View>

              {participantsList.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No operators connected yet to room "{currentRoomId || 'DEFAULT'}"</Text>
                </View>
              ) : (
                <View style={styles.participantsListWrap}>
                  {participantsList.map((p) => {
                    const isLocal = currentUser?.id === p.id;
                    const isOperator = p.role === 'camera';
                    return (
                      <View key={p.id} style={styles.participantChip}>
                        <View style={styles.participantRolePill}>
                          <Text style={styles.participantRoleText}>
                            {p.role === 'director' ? 'DIR' : CAMERA_LABELS[p.cameraId || ''] || 'CAM'}
                          </Text>
                        </View>
                        <Text style={styles.participantNameText} numberOfLines={1}>
                          {p.name} {isLocal && '(YOU)'}
                        </Text>

                        {isOperator ? (
                          <TouchableOpacity
                            style={[
                              styles.chipMicBtn,
                              p.isMuted ? styles.chipMicBtnMuted : styles.chipMicBtnLive,
                            ]}
                            onPress={() => muteRemoteOperator(p.id, p.cameraId, !p.isMuted)}
                            activeOpacity={0.7}
                            accessibilityLabel={`Toggle mic for ${p.name}`}
                          >
                            <Text style={styles.chipMicIcon}>
                              {p.isMuted ? '🔇' : '🎙️'}
                            </Text>
                            <Text
                              style={[
                                styles.chipMicLabel,
                                p.isMuted ? styles.textMutedRed : styles.textLiveGreen,
                              ]}
                            >
                              {p.isMuted ? 'MUTED' : 'LIVE'}
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.chipDirectorBadge}>
                            <Text style={styles.chipMicIcon}>
                              {p.isMuted ? '🔇' : '🎙️'}
                            </Text>
                            <Text style={[styles.chipMicLabel, p.isMuted ? styles.textMutedRed : styles.textLiveGreen]}>
                              {p.isMuted ? 'MUTED' : 'LIVE'}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Hands-Free Voice Command Recognition Panel (Integrated at Bottom of Tally Tab) */}
            <View style={styles.voicePanel}>
              <View style={styles.voiceHeader}>
                <View style={styles.voiceTitleGroup}>
                  <View style={[styles.voiceMicIconContainer, isVoiceActive && styles.voiceMicIconActive]}>
                    <Text style={styles.voiceMicIcon}>🎙️</Text>
                  </View>
                  <View>
                    <View style={styles.voiceBadgeRow}>
                      <Text style={styles.voiceTitle}>VOICE TALLY SWITCHER</Text>
                      <View style={[styles.langBadge, isVoiceActive && styles.langBadgeActive]}>
                        <Text style={styles.langBadgeText}>ES-ES</Text>
                      </View>
                    </View>
                    <Text style={styles.voiceSubtitle}>
                      Comandos de voz en español • Manos libres • Director
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[
                    styles.voiceToggleBtn,
                    isVoiceActive ? styles.voiceToggleBtnActive : styles.voiceToggleBtnInactive,
                  ]}
                  onPress={handleToggleVoice}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.voicePulsingDot,
                      isVoiceActive ? styles.voiceDotActive : styles.voiceDotInactive,
                    ]}
                  />
                  <Text style={styles.voiceToggleBtnText}>
                    {isVoiceActive ? 'LISTENING (TAP TO STOP)' : 'START LISTENING'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Voice Status & Last Recognized Command */}
              <View style={styles.voiceStatusBody}>
                <View style={styles.voiceStatusRow}>
                  <Text style={styles.voiceStatusLabel}>ESTADO DEL MICRO:</Text>
                  <View style={styles.voiceStatusValueRow}>
                    <View
                      style={[
                        styles.voiceStatusDot,
                        isVoiceActive ? styles.dotGreen : styles.dotGray,
                      ]}
                    />
                    <Text
                      style={[
                        styles.voiceStatusValue,
                        isVoiceActive ? styles.textGreen : styles.textGray,
                      ]}
                    >
                      {isVoiceActive
                        ? 'ESCUCHANDO CONTINUAMENTE'
                        : isVoiceSupported
                        ? 'INACTIVO / STANDBY'
                        : 'NAVEGADOR NO COMPATIBLE (USAR CHROME/SAFARI)'}
                    </Text>
                  </View>
                </View>

                {/* Last Recognized Command Banner */}
                {lastCommand ? (
                  <View style={styles.lastCommandRow}>
                    <Text style={styles.lastCommandLabel}>ÚLTIMO COMANDO:</Text>
                    <View
                      style={[
                        styles.commandBadge,
                        lastCommand.type === 'PROGRAM'
                          ? styles.commandBadgeProgram
                          : styles.commandBadgePreview,
                      ]}
                    >
                      <Text style={styles.commandBadgeText}>
                        Recognized: "{lastCommand.rawPhrase}" →{' '}
                        {lastCommand.type === 'PROGRAM' ? 'LIVE / ON AIR' : 'PREVIEW / STANDBY'}{' '}
                        ({CAMERA_LABELS[lastCommand.cameraId] || lastCommand.cameraId.toUpperCase()})
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.lastCommandRow}>
                    <Text style={styles.lastCommandLabel}>ÚLTIMO COMANDO:</Text>
                    <Text style={styles.noCommandText}>Esperando comando de voz...</Text>
                  </View>
                )}

                {/* Real-time interim feedback */}
                {isVoiceActive && interimSpeech ? (
                  <View style={styles.interimRow}>
                    <Text style={styles.interimLabel}>OYENDO:</Text>
                    <Text style={styles.interimText}>"{interimSpeech}..."</Text>
                  </View>
                ) : null}

                {/* Error banner if any */}
                {voiceError ? (
                  <View style={styles.voiceErrorBox}>
                    <Text style={styles.voiceErrorText}>⚠️ {voiceError}</Text>
                  </View>
                ) : null}

                {/* Quick Testing Voice Triggers */}
                <View style={styles.triggersHintContainer}>
                  <Text style={styles.triggersHintTitle}>COMANDOS DE VOZ Y PRUEBA RÁPIDA:</Text>
                  <View style={styles.testButtonsRow}>
                    <TouchableOpacity
                      style={[styles.testChip, styles.testChipPreview]}
                      onPress={() => handleTestVoiceCommand('preparada cámara 1')}
                    >
                      <Text style={styles.testChipText}>"Preparada Cam 1"</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.testChip, styles.testChipPreview]}
                      onPress={() => handleTestVoiceCommand('previo 2')}
                    >
                      <Text style={styles.testChipText}>"Previo 2"</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.testChip, styles.testChipProgram]}
                      onPress={() => handleTestVoiceCommand('dentro cámara 1')}
                    >
                      <Text style={styles.testChipText}>"Dentro Cam 1"</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.testChip, styles.testChipProgram]}
                      onPress={() => handleTestVoiceCommand('cámara 2 dentro')}
                    >
                      <Text style={styles.testChipText}>"Cam 2 dentro"</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.testChip, styles.testChipProgram]}
                      onPress={() => handleTestVoiceCommand('corte 3')}
                    >
                      <Text style={styles.testChipText}>"Corte 3"</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>

        {/* ==================================================================== */}
        {/* TAB 2: SONIDO CONTROL                                               */}
        {/* ==================================================================== */}
        <View style={[styles.tabPane, activeTab !== 'audio' && styles.tabPaneHidden]}>
          <AudioMixerView
            cameraCount={cameraCount}
            cameraMuteMap={cameraMuteMap}
            onToggleCameraMute={handleToggleCameraMute}
            activeProgramCamera={activeProgramCamera}
            activePreviewCamera={activePreviewCamera}
          />
        </View>

        {/* ==================================================================== */}
        {/* TAB 3: CONEXIÓN VMIX                                                */}
        {/* ==================================================================== */}
        <View style={[styles.tabPane, activeTab !== 'vmix' && styles.tabPaneHidden]}>
          <ScrollView
            contentContainerStyle={[styles.tabScrollContent, styles.vmixTabScrollCenter]}
            showsVerticalScrollIndicator={false}
          >
            {/* Dedicated Sleek Network Connection Card */}
            <View style={styles.vmixCardCentered}>
              {/* Card Header */}
              <View style={styles.vmixHeaderRow}>
                <View style={styles.vmixTitleGroup}>
                  <Text style={styles.vmixTitleIcon}>⚡</Text>
                  <View>
                    <View style={styles.vmixTitleRow}>
                      <Text style={styles.vmixTitle}>vMix NETWORK CONNECTION</Text>
                      <View
                        style={[
                          styles.vmixStatusBadge,
                          vmixStatus.connected ? styles.vmixBadgeConnected : styles.vmixBadgeOffline,
                        ]}
                      >
                        <View
                          style={[
                            styles.vmixStatusDot,
                            vmixStatus.connected ? styles.dotGreen : styles.dotRed,
                          ]}
                        />
                        <Text
                          style={[
                            styles.vmixStatusBadgeText,
                            vmixStatus.connected ? styles.textGreen : styles.textRed,
                          ]}
                        >
                          {vmixStatus.connected
                            ? `ONLINE (${vmixStatus.version ? 'v' + vmixStatus.version : 'READY'})`
                            : 'OFFLINE'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.vmixSubtitle}>
                      Direct HTTP API Bridge • Low-Latency LAN / USB Tethering Integration
                    </Text>
                  </View>
                </View>

                <View style={styles.vmixHeaderRight}>
                  <TouchableOpacity
                    style={[
                      styles.vmixToggleBtn,
                      vmixConfig.enabled ? styles.vmixToggleActive : styles.vmixToggleInactive,
                    ]}
                    onPress={handleToggleVmixEnabled}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.vmixToggleBtnText}>
                      {vmixConfig.enabled ? 'ACTIVE' : 'BYPASS'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.vmixBodyAlwaysOpen}>
                {/* Host IP & Port Inputs */}
                <View style={styles.vmixConfigRow}>
                  <View style={styles.vmixInputGroup}>
                    <Text style={styles.vmixInputLabel}>vMix HOST IP (USB / LAN):</Text>
                    <TextInput
                      style={styles.vmixTextInput}
                      value={vmixHostInput}
                      onChangeText={handleSaveVmixHost}
                      placeholder="127.0.0.1 or 172.20.10.2"
                      placeholderTextColor="#666"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {/* Quick presets for common USB / local IPs */}
                    <View style={styles.vmixPresetRow}>
                      <TouchableOpacity
                        style={[
                          styles.vmixPresetChip,
                          vmixHostInput === '127.0.0.1' && styles.vmixPresetChipActive,
                        ]}
                        onPress={() => handleSaveVmixHost('127.0.0.1')}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.vmixPresetText,
                            vmixHostInput === '127.0.0.1' && styles.vmixPresetTextActive,
                          ]}
                        >
                          Localhost
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.vmixPresetChip,
                          vmixHostInput === '172.20.10.2' && styles.vmixPresetChipActive,
                        ]}
                        onPress={() => handleSaveVmixHost('172.20.10.2')}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.vmixPresetText,
                            vmixHostInput === '172.20.10.2' && styles.vmixPresetTextActive,
                          ]}
                        >
                          USB iPad (172.20.10.2)
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.vmixPresetChip,
                          vmixHostInput === '192.168.1.49' && styles.vmixPresetChipActive,
                        ]}
                        onPress={() => handleSaveVmixHost('192.168.1.49')}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.vmixPresetText,
                            vmixHostInput === '192.168.1.49' && styles.vmixPresetTextActive,
                          ]}
                        >
                          LAN (192.168.1.49)
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.vmixPortGroup}>
                    <Text style={styles.vmixInputLabel}>API PORT:</Text>
                    <TextInput
                      style={[styles.vmixTextInput, styles.vmixPortInput]}
                      value={vmixPortInput}
                      onChangeText={handleSaveVmixPort}
                      placeholder="8088"
                      placeholderTextColor="#666"
                      keyboardType="numeric"
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={[
                        styles.vmixTestBtn,
                        vmixStatus.connected && styles.vmixTestBtnConnected,
                      ]}
                      onPress={() => vmixService.checkStatus()}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.vmixTestBtnText,
                          vmixStatus.connected && styles.vmixTestBtnTextConnected,
                        ]}
                      >
                        {vmixStatus.connected ? '✓ CONNECTED' : 'POLL NOW'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Clean Status Display Banner Showing Latency & Connectivity Feedback */}
                <View
                  style={[
                    styles.vmixStatusBannerBox,
                    vmixStatus.connected ? styles.vmixBannerConnected : styles.vmixBannerOffline,
                  ]}
                >
                  <View style={styles.vmixBannerHeader}>
                    <View style={styles.vmixBannerStatusPill}>
                      <View
                        style={[
                          styles.vmixStatusDot,
                          vmixStatus.connected ? styles.dotGreen : styles.dotRed,
                        ]}
                      />
                      <Text
                        style={[
                          styles.vmixBannerStatusText,
                          vmixStatus.connected ? styles.textGreen : styles.textRed,
                        ]}
                      >
                        {vmixStatus.connected
                          ? 'API CONNECTION ESTABLISHED'
                          : 'STANDBY / WAITING FOR VMIX'}
                      </Text>
                    </View>
                    <Text style={styles.vmixBannerTimestamp}>
                      {vmixStatus.lastChecked
                        ? `Last ping: ${new Date(vmixStatus.lastChecked).toLocaleTimeString()}`
                        : 'Checking every 3s'}
                    </Text>
                  </View>

                  <Text style={styles.vmixBannerMessage}>
                    {vmixStatus.connected
                      ? `Live vMix state: Program input is ${vmixStatus.activeInput || 'None'} • Preview input is ${vmixStatus.previewInput || 'None'}. Full-duplex tally polling active at http://${vmixConfig.host}:${vmixConfig.port}/api.`
                      : `Cannot reach vMix at http://${vmixConfig.host}:${vmixConfig.port}/api (${vmixStatus.error || 'Connection refused'}). Verify that vMix Web Controller is enabled in vMix Settings > Web Controller.`}
                  </Text>

                  {/* Background 1-to-1 Router Badge */}
                  <View style={styles.vmixRouterBadgeRow}>
                    <View style={styles.vmixRouterPill}>
                      <Text style={styles.vmixRouterPillIcon}>⚡</Text>
                      <Text style={styles.vmixRouterPillText}>
                        BACKGROUND 1-TO-1 ROUTER ACTIVE: CAM 1..{cameraCount} STRICTLY CORRELATED TO VMIX INPUTS 1..{cameraCount}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>

      {/* Crew Identification / Auth Modal */}
      <CrewAuthModal
        visible={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* Director QR Code Invite Modal for Cameras */}
      <Modal
        visible={isQrModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsQrModalOpen(false)}
      >
        <View style={styles.qrModalOverlay}>
          <View style={styles.qrModalCard}>
            {/* Modal Header */}
            <View style={styles.qrModalHeader}>
              <View style={styles.qrModalTitleCol}>
                <View style={styles.qrModalBadgeRow}>
                  <Text style={styles.qrModalBadgeIcon}>📱</Text>
                  <Text style={styles.qrModalTitle}>CÓDIGO QR PARA CÁMARAS</Text>
                </View>
                <Text style={styles.qrModalSubtitle}>
                  Acceso directo a producción sin teclear la sala
                </Text>
              </View>
              <TouchableOpacity
                style={styles.qrModalCloseBtn}
                onPress={() => setIsQrModalOpen(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.qrModalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Room Identifier Badge */}
            <View style={styles.qrRoomPillContainer}>
              <Text style={styles.qrRoomPillLabel}>SALA ACTIVA:</Text>
              <View style={styles.qrRoomPill}>
                <View style={styles.qrRoomPillDot} />
                <Text style={styles.qrRoomPillValue}>{currentRoomId || 'DEFAULT'}</Text>
              </View>
            </View>

            {/* QR Code Presentation Box */}
            <View style={styles.qrCodeBox}>
              {qrDataUrl ? (
                <Image
                  source={{ uri: qrDataUrl }}
                  style={styles.qrCodeImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.qrLoadingBox}>
                  <Text style={styles.qrLoadingText}>Generando código QR...</Text>
                </View>
              )}
            </View>

            {/* Explanatory text */}
            <Text style={styles.qrInstructionsText}>
              Apunta con la cámara del móvil o tablet para conectar directamente como operador de cámara a la sala privada de esta producción.
            </Text>

            {/* Direct URL Box */}
            <View style={styles.qrUrlBox}>
              <Text style={styles.qrUrlText} numberOfLines={1} selectable>
                {getCameraInviteUrl()}
              </Text>
            </View>

            {/* Actions: Copy Link & Close */}
            <View style={styles.qrActionsRow}>
              <TouchableOpacity
                style={[styles.qrCopyBtn, copiedLink ? styles.qrCopyBtnActive : null]}
                onPress={handleCopyInviteLink}
                activeOpacity={0.8}
              >
                <Text style={styles.qrCopyBtnIcon}>{copiedLink ? '✅' : '📋'}</Text>
                <Text style={styles.qrCopyBtnText}>
                  {copiedLink ? '¡ENLACE COPIADO!' : 'COPIAR ENLACE DIRECTO'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.qrDismissBtn}
                onPress={() => setIsQrModalOpen(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.qrDismissBtnText}>CERRAR</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0A0A0C',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F1F28',
    backgroundColor: '#111116',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roleTag: {
    backgroundColor: '#3700B3',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  roleTagText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  roomText: {
    color: '#E0E0E0',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  leaveButton: {
    backgroundColor: '#272730',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  leaveButtonText: {
    color: '#FF5252',
    fontWeight: '700',
    fontSize: 12,
  },
  headerMicBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  headerMicActive: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderColor: '#00E676',
  },
  headerMicMuted: {
    backgroundColor: 'rgba(255, 23, 68, 0.15)',
    borderColor: '#FF1744',
  },
  headerMicIcon: {
    fontSize: 12,
  },
  headerMicText: {
    fontSize: 10,
    fontWeight: '800',
  },
  headerMicTextActive: {
    color: '#00E676',
  },
  headerMicTextMuted: {
    color: '#FF1744',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  sectionTitle: {
    color: '#7D7D92',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  cameraGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
    ...(Platform.OS === 'web'
      ? {
          display: 'grid' as any,
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 8,
        }
      : {}),
  },
  cameraTile: {
    width: Platform.OS === 'web' ? '100%' : '23.5%',
    minHeight: 84,
    borderRadius: 8,
    padding: 8,
    justifyContent: 'space-between',
    borderWidth: 2,
  },
  tileIdle: {
    backgroundColor: '#16161D',
    borderColor: '#242430',
  },
  tilePreview: {
    backgroundColor: '#0A291A',
    borderColor: '#00E676',
    shadowColor: '#00E676',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  tileProgram: {
    backgroundColor: '#3E0A12',
    borderColor: '#FF1744',
    shadowColor: '#FF1744',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 6,
  },
  tileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cameraNumber: {
    fontSize: 16,
    fontWeight: '900',
    color: '#E6E6F0',
  },
  textWhite: {
    color: '#FFFFFF',
  },
  tileBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  badgeIdle: {
    backgroundColor: '#262634',
  },
  badgePreview: {
    backgroundColor: '#00E676',
  },
  badgeProgram: {
    backgroundColor: '#FF1744',
  },
  tileBadgeText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '900',
  },
  tileFooter: {
    marginTop: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 4,
  },
  operatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    overflow: 'hidden',
  },
  onlineIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00E676',
  },
  operatorName: {
    color: '#CFD2DC',
    fontSize: 10,
    fontWeight: '600',
    flexShrink: 1,
  },
  mutedIcon: {
    fontSize: 11,
  },
  tileMicBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileMicBtnLive: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderColor: '#00E676',
  },
  tileMicBtnMuted: {
    backgroundColor: 'rgba(255, 23, 68, 0.2)',
    borderColor: '#FF1744',
  },
  tileMicIcon: {
    fontSize: 12,
  },
  noOperatorText: {
    color: '#555566',
    fontSize: 11,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  participantsSection: {
    marginTop: 4,
  },
  participantsList: {
    backgroundColor: '#16161E',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#262633',
    overflow: 'hidden',
  },
  participantItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#22222E',
  },
  participantInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  participantRolePill: {
    backgroundColor: '#282838',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  participantRoleText: {
    color: '#00E5FF',
    fontWeight: '800',
    fontSize: 10,
  },
  participantName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  participantStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  micStatusText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00E676',
  },
  textMuted: {
    color: '#8A8A9E',
  },
  participantMicBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  participantMicBtnLive: {
    backgroundColor: 'rgba(0, 230, 118, 0.12)',
    borderColor: '#00E676',
  },
  participantMicBtnMuted: {
    backgroundColor: 'rgba(255, 23, 68, 0.18)',
    borderColor: '#FF1744',
  },
  participantMicIcon: {
    fontSize: 12,
  },
  participantMicText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  textLiveGreen: {
    color: '#00E676',
  },
  textMutedRed: {
    color: '#FF5252',
  },
  directorStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  directorStatusIcon: {
    fontSize: 12,
  },
  emptyCard: {
    backgroundColor: '#16161E',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#262633',
  },
  emptyText: {
    color: '#656578',
    fontSize: 13,
  },
  voicePanel: {
    backgroundColor: '#121218',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#242432',
    marginBottom: 16,
    overflow: 'hidden',
  },
  voiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#171720',
    borderBottomWidth: 1,
    borderBottomColor: '#242432',
    gap: 8,
  },
  voiceTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  voiceMicIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#20202C',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#323246',
  },
  voiceMicIconActive: {
    backgroundColor: '#003314',
    borderColor: '#00E676',
  },
  voiceMicIcon: {
    fontSize: 18,
  },
  voiceBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  voiceTitle: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  langBadge: {
    backgroundColor: '#282838',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  langBadgeActive: {
    backgroundColor: '#004D20',
  },
  langBadgeText: {
    color: '#00E676',
    fontSize: 9,
    fontWeight: '800',
  },
  voiceSubtitle: {
    color: '#8A8A9E',
    fontSize: 11,
    marginTop: 2,
  },
  voiceToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    gap: 6,
  },
  voiceToggleBtnInactive: {
    backgroundColor: '#272736',
    borderWidth: 1,
    borderColor: '#3D3D52',
  },
  voiceToggleBtnActive: {
    backgroundColor: '#B71C1C',
    borderWidth: 1,
    borderColor: '#FF1744',
  },
  voiceToggleBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  voicePulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  voiceDotActive: {
    backgroundColor: '#FFFFFF',
  },
  voiceDotInactive: {
    backgroundColor: '#7A7A90',
  },
  voiceStatusBody: {
    padding: 12,
    gap: 8,
  },
  voiceStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceStatusLabel: {
    color: '#8A8A9E',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    width: 105,
  },
  voiceStatusValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  voiceStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotGreen: {
    backgroundColor: '#00E676',
  },
  dotGray: {
    backgroundColor: '#616170',
  },
  voiceStatusValue: {
    fontSize: 11,
    fontWeight: '700',
  },
  textGreen: {
    color: '#00E676',
  },
  textGray: {
    color: '#8A8A9E',
  },
  lastCommandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  lastCommandLabel: {
    color: '#8A8A9E',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    width: 105,
  },
  noCommandText: {
    color: '#555566',
    fontSize: 11,
    fontStyle: 'italic',
  },
  commandBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  commandBadgeProgram: {
    backgroundColor: '#D50000',
  },
  commandBadgePreview: {
    backgroundColor: '#00C853',
  },
  commandBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  interimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  interimLabel: {
    color: '#FFB300',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    width: 105,
  },
  interimText: {
    color: '#FFE082',
    fontSize: 11,
    fontStyle: 'italic',
  },
  voiceErrorBox: {
    backgroundColor: '#2A1215',
    padding: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#5C1D24',
  },
  voiceErrorText: {
    color: '#FF8A80',
    fontSize: 11,
  },
  triggersHintContainer: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1E1E2A',
    gap: 6,
  },
  triggersHintTitle: {
    color: '#6F6F84',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  testButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  testChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  testChipPreview: {
    backgroundColor: '#0D2916',
    borderColor: '#1B5E20',
  },
  testChipProgram: {
    backgroundColor: '#301316',
    borderColor: '#7F1D1D',
  },
  testChipText: {
    color: '#E0E0E0',
    fontSize: 10,
    fontWeight: '700',
  },
  // vMix Direct Integration Styles
  vmixPanel: {
    backgroundColor: '#111118',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#252538',
    marginBottom: 16,
    overflow: 'hidden',
  },
  vmixHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#161622',
    borderBottomWidth: 1,
    borderBottomColor: '#222232',
  },
  vmixTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  vmixExpandIcon: {
    color: '#3B82F6',
    fontSize: 13,
    fontWeight: 'bold',
  },
  vmixTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  vmixTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  vmixSubtitle: {
    color: '#8A8A9E',
    fontSize: 11,
    marginTop: 2,
  },
  vmixStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  vmixBadgeConnected: {
    backgroundColor: '#0D2916',
    borderColor: '#00E676',
  },
  vmixBadgeOffline: {
    backgroundColor: '#261214',
    borderColor: '#FF1744',
  },
  vmixStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  vmixStatusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  vmixHeaderRight: {
    marginLeft: 8,
  },
  vmixToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  vmixToggleActive: {
    backgroundColor: '#1E3A8A',
    borderColor: '#3B82F6',
  },
  vmixToggleInactive: {
    backgroundColor: '#2A2A38',
    borderColor: '#4A4A5A',
  },
  vmixToggleBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  vmixBody: {
    padding: 14,
    backgroundColor: '#111118',
    gap: 12,
  },
  vmixConfigRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  vmixInputGroup: {
    flex: 1,
    minWidth: 200,
  },
  vmixPortGroup: {
    width: 130,
  },
  vmixInputLabel: {
    color: '#8A8A9E',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  vmixTextInput: {
    backgroundColor: '#1A1A24',
    borderWidth: 1,
    borderColor: '#2F2F44',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  vmixPortInput: {
    textAlign: 'center',
  },
  vmixPresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  vmixPresetChip: {
    backgroundColor: '#1D1D2C',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#33334A',
  },
  vmixPresetText: {
    color: '#3B82F6',
    fontSize: 10,
    fontWeight: '700',
  },
  vmixTestBtn: {
    marginTop: 6,
    backgroundColor: '#1F2937',
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  vmixTestBtnConnected: {
    backgroundColor: '#064E3B',
    borderColor: '#059669',
  },
  vmixTestBtnText: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '800',
  },
  vmixTestBtnTextConnected: {
    color: '#34D399',
  },
  vmixPresetChipActive: {
    backgroundColor: '#1E3A8A',
    borderColor: '#3B82F6',
  },
  vmixPresetTextActive: {
    color: '#FFFFFF',
  },
  vmixTabScrollCenter: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 16,
  },
  vmixCardCentered: {
    width: '100%',
    maxWidth: 700,
    backgroundColor: '#121218',
    borderRadius: 10,
    padding: 18,
    borderWidth: 1,
    borderColor: '#22222E',
    alignSelf: 'center',
  },
  vmixStatusBannerBox: {
    backgroundColor: '#151520',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#202030',
    gap: 10,
    marginTop: 4,
  },
  vmixBannerConnected: {
    borderColor: '#065F46',
    backgroundColor: '#0A1E17',
  },
  vmixBannerOffline: {
    borderColor: '#7F1D1D',
    backgroundColor: '#1C0D10',
  },
  vmixBannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  vmixBannerStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  vmixBannerStatusText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  vmixBannerTimestamp: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '600',
  },
  vmixBannerMessage: {
    color: '#D1D5DB',
    fontSize: 11.5,
    lineHeight: 17,
  },
  vmixRouterBadgeRow: {
    marginTop: 4,
    flexDirection: 'row',
  },
  vmixRouterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  vmixRouterPillIcon: {
    fontSize: 11,
  },
  vmixRouterPillText: {
    color: '#60A5FA',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  // Tile buttons & vMix badges
  tileVmixBadge: {
    color: '#8A8A9E',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  tileTallyActions: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 5,
    marginBottom: 3,
  },
  tileActionBtn: {
    flex: 1,
    paddingVertical: 3.5,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  tilePvwBtn: {
    backgroundColor: '#0E2A18',
    borderColor: '#00C853',
  },
  tilePvwBtnActive: {
    backgroundColor: '#00C853',
    borderColor: '#00E676',
  },
  tilePgmBtn: {
    backgroundColor: '#331215',
    borderColor: '#D50000',
  },
  tilePgmBtnActive: {
    backgroundColor: '#D50000',
    borderColor: '#FF1744',
  },
  tileActionText: {
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  textPvw: {
    color: '#00E676',
  },
  textPgm: {
    color: '#FF5252',
  },
  tileActionTextActive: {
    color: '#FFFFFF',
  },
  tileMuteBtnCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  tileMuteBtnCompactLive: {
    backgroundColor: '#0F2618',
    borderColor: '#00C853',
  },
  tileMuteBtnCompactMuted: {
    backgroundColor: '#2E1114',
    borderColor: '#FF1744',
  },
  tileMuteCompactIcon: {
    fontSize: 9,
  },
  tileMuteCompactText: {
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  indicatorMuted: {
    backgroundColor: '#FF1744',
  },
  dotRed: {
    backgroundColor: '#FF1744',
  },
  textRed: {
    color: '#FF5252',
  },
  // Tab Navigation Header
  tabNavContainer: {
    flexDirection: 'row',
    backgroundColor: '#111116',
    borderBottomWidth: 1,
    borderBottomColor: '#20202D',
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 6,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: '#181822',
    borderWidth: 1,
    borderColor: '#262638',
    gap: 5,
  },
  tabButtonActive: {
    backgroundColor: '#232334',
    borderColor: '#FF1744',
    borderBottomWidth: 3,
    borderBottomColor: '#FF1744',
  },
  tabIcon: {
    fontSize: 12,
  },
  tabButtonText: {
    color: '#8E8EA8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  tabButtonTextActive: {
    color: '#FFFFFF',
  },
  tabBadgeLive: {
    backgroundColor: '#FF1744',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
    marginLeft: 3,
  },
  tabBadgeLiveText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  tabVoiceListeningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 230, 118, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
    gap: 4,
    marginLeft: 3,
  },
  tabVoiceListeningText: {
    color: '#00E676',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  voicePulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00E676',
  },
  tabVmixIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
    gap: 4,
    marginLeft: 3,
  },
  vmixIndOnline: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
  },
  vmixIndOffline: {
    backgroundColor: 'rgba(255, 23, 68, 0.15)',
  },
  tabStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tabVmixText: {
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  mainContainer: {
    flex: 1,
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
  },
  tabPane: {
    flex: 1,
    height: '100%',
    minHeight: 0,
  },
  tabPaneHidden: {
    display: 'none',
  },
  tabScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
  },
  /* Top Status & Transition Bar Overhaul */
  topTransitionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  tallyBannersContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 320,
  },
  tallyBannerBox: {
    flex: 1,
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  programBannerBox: {
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
    borderWidth: 2,
    borderColor: '#DC2626',
    // @ts-ignore web shadow
    boxShadow: '0 0 16px rgba(220, 38, 38, 0.35)',
  },
  previewBannerBox: {
    backgroundColor: 'rgba(22, 163, 74, 0.15)',
    borderWidth: 2,
    borderColor: '#16A34A',
    // @ts-ignore web shadow
    boxShadow: '0 0 16px rgba(22, 163, 74, 0.35)',
  },
  bannerIndicatorDotRed: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF1744',
    // @ts-ignore web shadow
    boxShadow: '0 0 8px #FF1744',
  },
  bannerIndicatorDotGreen: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00E676',
    // @ts-ignore web shadow
    boxShadow: '0 0 8px #00E676',
  },
  programBannerLabel: {
    color: '#FCA5A5',
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  programBannerVal: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  previewBannerLabel: {
    color: '#86EFAC',
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  previewBannerVal: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  transitionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  largeCutBtn: {
    minHeight: 50,
    height: 50,
    minWidth: 105,
    backgroundColor: '#D50000',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#FF1744',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    // @ts-ignore web shadow
    boxShadow: '0 0 14px rgba(255, 23, 68, 0.45)',
  },
  largeCutBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  largeFadeBtn: {
    minHeight: 50,
    height: 50,
    minWidth: 105,
    backgroundColor: '#D97706',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    // @ts-ignore web shadow
    boxShadow: '0 0 14px rgba(245, 158, 11, 0.45)',
  },
  largeFadeBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  cameraMatrixHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cameraMatrixHeaderLeft: {
    flexDirection: 'column',
  },
  cameraStepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#151620',
    borderWidth: 1,
    borderColor: '#2A2C3C',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 8,
  },
  cameraStepperLabel: {
    color: '#8F91A8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cameraStepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cameraStepperBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#222432',
    borderWidth: 1,
    borderColor: '#3B3E54',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraStepperBtnDisabled: {
    opacity: 0.35,
  },
  cameraStepperBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 16,
  },
  cameraCountPill: {
    backgroundColor: '#0D0E15',
    borderWidth: 1,
    borderColor: '#FF1744',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 26,
    alignItems: 'center',
  },
  cameraCountPillText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '900',
  },
  matrixHint: {
    color: '#65657E',
    fontSize: 10,
    fontWeight: '600',
  },
  rosterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  rosterSub: {
    color: '#65657E',
    fontSize: 10,
    fontWeight: '600',
  },
  participantsListWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  participantChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#14141C',
    borderWidth: 1,
    borderColor: '#242434',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 6,
  },
  participantNameText: {
    color: '#D4D4E2',
    fontSize: 11,
    fontWeight: '700',
    maxWidth: 130,
  },
  chipMicBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  chipMicBtnLive: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderColor: '#00E676',
  },
  chipMicBtnMuted: {
    backgroundColor: 'rgba(255, 23, 68, 0.15)',
    borderColor: '#FF1744',
  },
  chipDirectorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#1E1E28',
  },
  chipMicIcon: {
    fontSize: 10,
  },
  chipMicLabel: {
    fontSize: 9,
    fontWeight: '800',
  },
  vmixPanelAlwaysOpen: {
    backgroundColor: '#121218',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#22222E',
  },
  vmixHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  vmixTitleIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  vmixBodyAlwaysOpen: {
    gap: 12,
  },
  qrHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 229, 255, 0.12)',
    borderWidth: 1,
    borderColor: '#00E5FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    cursor: 'pointer',
  },
  qrHeaderBtnIcon: {
    fontSize: 13,
  },
  qrHeaderBtnText: {
    color: '#00E5FF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  qrModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  qrModalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#12121A',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#26263A',
    padding: 24,
    alignItems: 'center',
    // @ts-ignore
    boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
  },
  qrModalHeader: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  qrModalTitleCol: {
    flex: 1,
  },
  qrModalBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  qrModalBadgeIcon: {
    fontSize: 16,
  },
  qrModalTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  qrModalSubtitle: {
    color: '#8E8EA8',
    fontSize: 11,
    marginTop: 3,
  },
  qrModalCloseBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#1E1E2C',
    cursor: 'pointer',
  },
  qrModalCloseText: {
    color: '#A0A0B8',
    fontSize: 14,
    fontWeight: '700',
  },
  qrRoomPillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  qrRoomPillLabel: {
    color: '#71718A',
    fontSize: 11,
    fontWeight: '700',
  },
  qrRoomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 230, 118, 0.12)',
    borderWidth: 1,
    borderColor: '#00E676',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  qrRoomPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00E676',
  },
  qrRoomPillValue: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  qrCodeBox: {
    width: 250,
    height: 250,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#00E5FF',
    // @ts-ignore
    boxShadow: '0 0 20px rgba(0, 229, 255, 0.3)',
  },
  qrCodeImage: {
    width: 230,
    height: 230,
  },
  qrLoadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrLoadingText: {
    color: '#12121A',
    fontSize: 12,
    fontWeight: '700',
  },
  qrInstructionsText: {
    color: '#A0A0B8',
    fontSize: 11.5,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 14,
    paddingHorizontal: 8,
  },
  qrUrlBox: {
    width: '100%',
    backgroundColor: '#0A0A0F',
    borderWidth: 1,
    borderColor: '#242436',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
  },
  qrUrlText: {
    color: '#00E5FF',
    fontSize: 10.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    textAlign: 'center',
  },
  qrActionsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  qrCopyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00C853',
    paddingVertical: 12,
    borderRadius: 8,
    cursor: 'pointer',
    // @ts-ignore
    boxShadow: '0 4px 12px rgba(0, 200, 83, 0.35)',
  },
  qrCopyBtnActive: {
    backgroundColor: '#00E676',
  },
  qrCopyBtnIcon: {
    fontSize: 14,
  },
  qrCopyBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  qrDismissBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#20202E',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  qrDismissBtnText: {
    color: '#D1D5DB',
    fontSize: 11,
    fontWeight: '800',
  },
});

export default DirectorView;
