import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { useIntercom, UserRole, CameraId, Participant } from '../context/IntercomContext';
import { normalizeRoomId } from '../services/signalingService';
import { authService } from '../services/authService';

interface CrewAuthModalProps {
  visible: boolean;
  onClose: () => void;
}

const AVAILABLE_CAMERAS: CameraId[] = [
  'cam1',
  'cam2',
  'cam3',
  'cam4',
  'cam5',
  'cam6',
  'cam7',
  'cam8',
];

export const CrewAuthModal: React.FC<CrewAuthModalProps> = ({ visible, onClose }) => {
  const { currentUser, currentRoomId, joinRoom, leaveRoom, authSession } = useIntercom();

  const [role, setRole] = useState<UserRole>(currentUser?.role || 'director');
  const [selectedCam, setSelectedCam] = useState<CameraId>(
    (currentUser?.cameraId as CameraId) || 'cam1'
  );
  const [name, setName] = useState<string>(currentUser?.name || 'Director 1');
  const [roomId, setRoomId] = useState<string>(currentRoomId || '');

  // Smooth blinking / pulsing animation for Room placeholder
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.22,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  // Sync state when modal opens or user changes
  useEffect(() => {
    if (visible) {
      if (currentUser) {
        setRole(currentUser.role);
        if (currentUser.cameraId) setSelectedCam(currentUser.cameraId as CameraId);
        setName(currentUser.name);
      }
      if (currentRoomId) {
        setRoomId(currentRoomId);
      }
    }
  }, [visible, currentUser, currentRoomId]);

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    if (!currentUser) {
      if (newRole === 'director') {
        setName('Director 1');
      } else {
        setName(`Cam ${selectedCam.replace('cam', '')} Operator`);
      }
    }
  };

  const handleCameraChange = (cam: CameraId) => {
    setSelectedCam(cam);
    if (role === 'camera' && !currentUser) {
      setName(`Cam ${cam.replace('cam', '')} Operator`);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || !roomId.trim()) return;

    const cleanRoomId = normalizeRoomId(roomId);
    const userProfile: Participant = {
      id: currentUser?.id || `user-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: name.trim(),
      role,
      cameraId: role === 'camera' ? selectedCam : undefined,
      isMuted: currentUser ? currentUser.isMuted : false,
    };

    try {
      if (authSession?.email) {
        authService.registerSubscriberLead(authSession.email, role, cleanRoomId).catch(() => {});
      }
      await joinRoom(cleanRoomId, userProfile);
      onClose();
    } catch (err) {
      console.warn('[CrewAuthModal] Error identifying crew member:', err);
    }
  };

  const handleExitRoom = async () => {
    try {
      await leaveRoom();
      onClose();
    } catch (err) {
      console.warn('[CrewAuthModal] Error leaving room:', err);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>IDENTIFICACIÓN DE EQUIPO</Text>
              <Text style={styles.modalSubtitle}>
                Alicante Paradise Studios · Control de Acceso
              </Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Role Selection */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>ROL DE PRODUCCIÓN</Text>
            <View style={styles.roleRow}>
              <TouchableOpacity
                style={[styles.roleBtn, role === 'director' && styles.roleBtnActive]}
                onPress={() => handleRoleChange('director')}
                activeOpacity={0.8}
              >
                <Text style={styles.roleIcon}>🎬</Text>
                <Text
                  style={[
                    styles.roleBtnText,
                    role === 'director' && styles.roleBtnTextActive,
                  ]}
                >
                  DIRECTOR
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.roleBtn, role === 'camera' && styles.roleBtnActive]}
                onPress={() => handleRoleChange('camera')}
                activeOpacity={0.8}
              >
                <Text style={styles.roleIcon}>🎥</Text>
                <Text
                  style={[
                    styles.roleBtnText,
                    role === 'camera' && styles.roleBtnTextActive,
                  ]}
                >
                  CÁMARA
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Camera Selection (if camera role) */}
          {role === 'camera' && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>ASIGNAR CÁMARA</Text>
              <View style={styles.cameraGrid}>
                {AVAILABLE_CAMERAS.map((cam, idx) => (
                  <TouchableOpacity
                    key={cam}
                    style={[
                      styles.camChip,
                      selectedCam === cam && styles.camChipActive,
                    ]}
                    onPress={() => handleCameraChange(cam)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.camChipText,
                        selectedCam === cam && styles.camChipTextActive,
                      ]}
                    >
                      CAM {idx + 1}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Name Input */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>NOMBRE DE OPERADOR</Text>
            <TextInput
              style={styles.textInput}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Director 1, Juan Pérez"
              placeholderTextColor="#666678"
            />
          </View>

          {/* Room ID Input */}
          <View style={styles.fieldGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.fieldLabel}>SALA DE PRODUCCIÓN</Text>
              <View style={styles.requiredBadge}>
                <Text style={styles.requiredBadgeText}>OBLIGATORIO</Text>
              </View>
            </View>
            <View style={styles.roomInputWrapper}>
              <TextInput
                style={[styles.textInput, styles.roomTextInput]}
                value={roomId}
                onChangeText={setRoomId}
                placeholder=""
                placeholderTextColor="transparent"
                autoCapitalize="characters"
                autoCorrect={false}
              />
              {!roomId && (
                <Animated.View
                  style={[styles.blinkingPlaceholderContainer, { opacity: pulseAnim }]}
                  pointerEvents="none"
                >
                  <Text
                    style={styles.blinkingPlaceholderText}
                    numberOfLines={1}
                    // @ts-ignore
                    className="blinking-room-placeholder"
                  >
                    Escribe el nombre de tu grupo o sala (ej: ALICANTE, EVENTO-1)...
                  </Text>
                </Animated.View>
              )}
            </View>
            <Text style={styles.roomHelpNote}>
              ⚠️ Define un nombre único para que tu equipo se comunique en su propio canal privado.
            </Text>
          </View>

          {/* Actions */}
          <View style={styles.actionsGroup}>
            <TouchableOpacity
              style={[
                styles.submitBtn,
                !roomId.trim() && styles.submitBtnDisabled,
              ]}
              onPress={handleSubmit}
              activeOpacity={roomId.trim() ? 0.8 : 1}
              disabled={!roomId.trim()}
            >
              <Text style={styles.submitBtnText}>
                {!roomId.trim()
                  ? 'INDICA TU SALA O GRUPO'
                  : currentUser
                  ? 'ACTUALIZAR IDENTIDAD / ENTRAR'
                  : 'CONECTAR E IDENTIFICAR'}
              </Text>
            </TouchableOpacity>

            {currentUser && (
              <TouchableOpacity
                style={styles.exitBtn}
                onPress={handleExitRoom}
                activeOpacity={0.8}
              >
                <Text style={styles.exitBtnText}>CERRAR SESIÓN (EXIT)</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(4px)' } as any) : {}),
  },
  modalCard: {
    backgroundColor: '#16161F',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#29293C',
    width: '100%',
    maxWidth: 460,
    padding: 22,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#232332',
    paddingBottom: 14,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  modalSubtitle: {
    color: '#8A8A9E',
    fontSize: 11,
    marginTop: 2,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#222230',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#333346',
  },
  closeBtnText: {
    color: '#A0A0B0',
    fontSize: 13,
    fontWeight: '700',
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    color: '#7D7D92',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  roleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1C1C26',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 8,
    paddingVertical: 10,
  },
  roleBtnActive: {
    backgroundColor: '#1A2942',
    borderColor: '#3B82F6',
  },
  roleIcon: {
    fontSize: 16,
  },
  roleBtnText: {
    color: '#8A8A9E',
    fontSize: 12,
    fontWeight: '800',
  },
  roleBtnTextActive: {
    color: '#3B82F6',
  },
  cameraGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  camChip: {
    flexBasis: '22%',
    flexGrow: 1,
    backgroundColor: '#1A1A24',
    borderWidth: 1,
    borderColor: '#282838',
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
  },
  camChipActive: {
    backgroundColor: '#0F2618',
    borderColor: '#00C853',
  },
  camChipText: {
    color: '#8A8A9E',
    fontSize: 11,
    fontWeight: '700',
  },
  camChipTextActive: {
    color: '#00E676',
    fontWeight: '900',
  },
  textInput: {
    backgroundColor: '#111118',
    borderWidth: 1,
    borderColor: '#2B2B3C',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  actionsGroup: {
    gap: 8,
    marginTop: 6,
  },
  submitBtn: {
    backgroundColor: '#00C853',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#00E676',
  },
  submitBtnDisabled: {
    backgroundColor: '#1A1A24',
    borderColor: '#282838',
    opacity: 0.55,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  requiredBadge: {
    backgroundColor: 'rgba(255, 23, 68, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 23, 68, 0.4)',
  },
  requiredBadgeText: {
    color: '#FF5252',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  roomInputWrapper: {
    position: 'relative',
    width: '100%',
    justifyContent: 'center',
  },
  roomTextInput: {
    color: '#00E676',
    fontWeight: '800',
    letterSpacing: 1.2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  blinkingPlaceholderContainer: {
    position: 'absolute',
    left: 12,
    right: 12,
    pointerEvents: 'none',
  },
  blinkingPlaceholderText: {
    color: '#00E676',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  roomHelpNote: {
    color: '#71718A',
    fontSize: 10.5,
    marginTop: 5,
    lineHeight: 14,
  },
  exitBtn: {
    backgroundColor: '#261214',
    borderWidth: 1,
    borderColor: '#FF1744',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitBtnText: {
    color: '#FF5252',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.5,
  },
});

export default CrewAuthModal;
