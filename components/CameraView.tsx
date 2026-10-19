import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useIntercom } from '../context/IntercomContext';
import { BrandedTopBar } from './BrandedTopBar';
import { CrewAuthModal } from './CrewAuthModal';

const CAMERA_LABELS: Record<string, string> = {
  cam1: 'CAM 1',
  cam2: 'CAM 2',
  cam3: 'CAM 3',
  cam4: 'CAM 4',
  cam5: 'CAM 5',
  cam6: 'CAM 6',
  cam7: 'CAM 7',
  cam8: 'CAM 8',
};

const KEEP_AWAKE_TAG = 'camera-rig-awake';

export const CameraView: React.FC = () => {
  const {
    currentUser,
    currentRoomId,
    currentTallyState,
    isProgramOverlap,
    connectionStatus,
    isMuted,
    isMutedByDirector,
    toggleMute,
    leaveRoom,
  } = useIntercom();

  // Screen lock persistence toggle for camera rig mounting
  const [isKeepAwake, setIsKeepAwake] = useState<boolean>(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (isKeepAwake) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch((err) => {
        console.warn('[CameraView] Could not activate keep-awake:', err);
      });
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    }

    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [isKeepAwake]);

  const toggleKeepAwake = () => {
    setIsKeepAwake((prev) => !prev);
  };

  const camId = currentUser?.cameraId || 'cam1';
  const cameraLabel = CAMERA_LABELS[camId] || camId.toUpperCase();

  const isProgram = currentTallyState === 'program';
  const isPreview = currentTallyState === 'preview';
  const isIdle = currentTallyState === 'idle';

  // Dynamic status badges
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

  const netBadge = getConnectionBadge();

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        isProgram && styles.bgProgram,
        isPreview && styles.bgPreview,
        isIdle && styles.bgIdle,
      ]}
    >
      <StatusBar
        barStyle="light-content"
        backgroundColor={isProgram ? '#B71C1C' : isPreview ? '#052614' : '#0B0B0E'}
      />

      <BrandedTopBar
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        currentUser={currentUser}
        currentRoomId={currentRoomId}
      />

      {/* Top Header Bar */}
      <View style={[styles.header, isProgram && styles.headerProgram]}>
        <View style={styles.headerLeft}>
          <View style={[styles.operatorPill, isProgram && styles.pillProgram]}>
            <Text style={styles.operatorText}>{currentUser?.name || 'OPERATOR'}</Text>
          </View>
          <Text style={[styles.roomText, isProgram && styles.textWhite]}>
            ROOM: {currentRoomId}
          </Text>
        </View>

        <View style={styles.headerRight}>
          <View
            style={[
              styles.networkPill,
              { borderColor: isProgram ? '#FFFFFF' : netBadge.color },
            ]}
          >
            <View
              style={[
                styles.networkDot,
                { backgroundColor: isProgram ? '#FFFFFF' : netBadge.dot },
              ]}
            />
            <Text
              style={[
                styles.networkText,
                { color: isProgram ? '#FFFFFF' : netBadge.color },
              ]}
            >
              {netBadge.label}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.exitButton, isProgram && styles.exitButtonProgram]}
            onPress={leaveRoom}
          >
            <Text style={[styles.exitText, isProgram && styles.textWhite]}>EXIT</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Fullscreen Tally Stage */}
      <View style={styles.tallyStage}>
        {/* Tally Banner Indicator */}
        <View
          style={[
            styles.tallyStateBanner,
            isProgram && styles.bannerProgram,
            isPreview && styles.bannerPreview,
            isIdle && styles.bannerIdle,
          ]}
        >
          <Text style={styles.tallyStateText}>
            {isProgramOverlap
              ? '● CUT OVERLAP (2S TONE)'
              : isProgram
              ? '● ON AIR / LIVE'
              : isPreview
              ? '● PREVIEW / STANDBY'
              : 'OFF AIR / IDLE'}
          </Text>
        </View>

        {/* Giant Camera Identifier */}
        <View style={[styles.cameraCircle, isPreview && styles.circlePreview, isProgram && styles.circleProgram]}>
          <Text
            style={[
              styles.cameraGiantText,
              isProgram && styles.textWhite,
              isPreview && styles.textGreen,
              isIdle && styles.textIdle,
            ]}
          >
            {cameraLabel}
          </Text>
        </View>

        {/* Acoustic Audio Tally Indicator */}
        <View style={styles.cueRow}>
          <Text style={[styles.cueIcon, (isProgram || isProgramOverlap) && styles.textWhite]}>
            {(isProgram || isProgramOverlap) ? '🔊' : isPreview ? '🔔' : '🔇'}
          </Text>
          <Text
            style={[
              styles.cueText,
              (isProgram || isProgramOverlap) && styles.textWhite,
              isPreview && styles.textGreen,
            ]}
          >
            {isProgramOverlap
              ? 'PROGRAM CUT OVERLAP (2S TONE ACTIVE)'
              : isProgram
              ? 'PROGRAM AUDIO TONE ACTIVE'
              : isPreview
              ? 'PREVIEW CHIME TRIGGERED'
              : 'TALLY AUDIO IDLE'}
          </Text>
        </View>

        {/* Keep Screen Awake Toggle (Rig Mount) */}
        <TouchableOpacity
          style={[
            styles.awakeToggle,
            isKeepAwake ? styles.awakeActive : styles.awakeInactive,
            isProgram && styles.awakeProgram,
          ]}
          onPress={toggleKeepAwake}
          activeOpacity={0.8}
        >
          <Text style={styles.awakeIcon}>{isKeepAwake ? '☀️' : '🌙'}</Text>
          <Text
            style={[
              styles.awakeText,
              !isKeepAwake && styles.awakeTextInactive,
              isProgram && styles.textWhite,
            ]}
          >
            {isKeepAwake ? 'KEEP AWAKE: ON (RIG MOUNT)' : 'KEEP AWAKE: OFF'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Push-To-Talk (PTT) / Talkback Control */}
      <View style={[styles.bottomControlArea, isProgram && styles.bottomProgram]}>
        {/* Remote Mute Indicator Badge from Director */}
        {isMutedByDirector && (
          <View style={styles.mutedByDirectorBadge}>
            <Text style={styles.mutedByDirectorBadgeIcon}>🔒</Text>
            <Text style={styles.mutedByDirectorBadgeText}>Muted by Director</Text>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.pttButton,
            isMuted ? styles.pttButtonMuted : styles.pttButtonLive,
            isMutedByDirector && styles.pttButtonMutedByDirector,
          ]}
          onPress={toggleMute}
          activeOpacity={0.8}
        >
          <Text style={styles.pttIcon}>{isMuted ? '🔇' : '🎙️'}</Text>
          <View style={styles.pttTextGroup}>
            <Text style={styles.pttTitle}>
              {isMutedByDirector
                ? 'MUTED BY DIRECTOR'
                : isMuted
                ? 'MIC MUTED'
                : 'TALK ACTIVE'}
            </Text>
            <Text style={styles.pttSub}>
              {isMutedByDirector
                ? 'DIRECTOR SILENCED YOUR MIC — TAP TO OVERRIDE & TALK'
                : isMuted
                ? 'TAP TO UNMUTE TO DIRECTOR'
                : 'TRANSMITTING LIVE — TAP TO MUTE'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <CrewAuthModal
        visible={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  bgIdle: {
    backgroundColor: '#0C0C0F',
  },
  bgPreview: {
    backgroundColor: '#041E10',
    borderWidth: 4,
    borderColor: '#00E676',
  },
  bgProgram: {
    backgroundColor: '#D50000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F1F28',
    backgroundColor: 'rgba(10, 10, 14, 0.75)',
  },
  headerProgram: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderBottomColor: 'rgba(255, 255, 255, 0.2)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  operatorPill: {
    backgroundColor: '#252532',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pillProgram: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  operatorText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  roomText: {
    color: '#A0A0B0',
    fontSize: 12,
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  networkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 5,
  },
  networkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  networkText: {
    fontSize: 10,
    fontWeight: '800',
  },
  exitButton: {
    backgroundColor: '#272730',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  exitButtonProgram: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  exitText: {
    color: '#FF5252',
    fontWeight: '800',
    fontSize: 12,
  },
  tallyStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  tallyStateBanner: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 30,
    marginBottom: 24,
  },
  bannerIdle: {
    backgroundColor: '#1C1C24',
    borderWidth: 1,
    borderColor: '#30303E',
  },
  bannerPreview: {
    backgroundColor: '#00E676',
    shadowColor: '#00E676',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 14,
    elevation: 8,
  },
  bannerProgram: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  tallyStateText: {
    color: '#000000',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  cameraCircle: {
    width: 250,
    height: 250,
    borderRadius: 125,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#14141B',
    borderWidth: 4,
    borderColor: '#262634',
    marginBottom: 24,
  },
  circlePreview: {
    borderColor: '#00E676',
    backgroundColor: '#08331A',
    shadowColor: '#00E676',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 20,
    elevation: 10,
  },
  circleProgram: {
    borderColor: '#FFFFFF',
    backgroundColor: '#B71C1C',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  cameraGiantText: {
    fontSize: 70,
    fontWeight: '900',
    letterSpacing: 2,
  },
  textWhite: {
    color: '#FFFFFF',
  },
  textGreen: {
    color: '#00E676',
  },
  textIdle: {
    color: '#D8D8E8',
  },
  cueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  cueIcon: {
    fontSize: 16,
  },
  cueText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9090A0',
    letterSpacing: 0.5,
  },
  bottomControlArea: {
    padding: 18,
    backgroundColor: '#111116',
    borderTopWidth: 1,
    borderTopColor: '#1F1F28',
  },
  bottomProgram: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
  },
  pttButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 14,
    gap: 16,
  },
  pttButtonMuted: {
    backgroundColor: '#1F1F29',
    borderWidth: 2,
    borderColor: '#373748',
  },
  pttButtonLive: {
    backgroundColor: '#00C853',
    shadowColor: '#00C853',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 8,
  },
  pttIcon: {
    fontSize: 32,
  },
  pttTextGroup: {
    alignItems: 'flex-start',
  },
  pttTitle: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 18,
    letterSpacing: 1,
  },
  pttSub: {
    color: '#D5D5E5',
    fontSize: 11,
    fontWeight: '600',
  },
  mutedByDirectorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D50000',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
    shadowColor: '#D50000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 4,
  },
  mutedByDirectorBadgeIcon: {
    fontSize: 14,
  },
  mutedByDirectorBadgeText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  pttButtonMutedByDirector: {
    borderColor: '#FF1744',
    borderWidth: 2,
    backgroundColor: '#2A1115',
  },
  awakeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  awakeActive: {
    backgroundColor: 'rgba(255, 214, 0, 0.12)',
    borderColor: '#FFD600',
  },
  awakeInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  awakeProgram: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  awakeIcon: {
    fontSize: 14,
  },
  awakeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFD600',
    letterSpacing: 0.5,
  },
  awakeTextInactive: {
    color: '#9090A0',
  },
});

export default CameraView;
