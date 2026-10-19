import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  Easing,
} from 'react-native';
import { authService, AuthSession } from '../services/authService';
import { UserRole, CameraId } from '../context/IntercomContext';
import { normalizeRoomId } from '../services/signalingService';

export interface LoginSuccessPayload {
  session: AuthSession;
  email: string;
  roomId: string;
  role: UserRole;
  selectedCam: CameraId;
  name?: string;
}

interface EmailLoginGateProps {
  initialEmail?: string;
  onLoginSuccess: (payload: LoginSuccessPayload) => void;
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

export const EmailLoginGate: React.FC<EmailLoginGateProps> = ({
  initialEmail = '',
  onLoginSuccess,
}) => {
  const [email, setEmail] = useState(initialEmail);
  const [roomId, setRoomId] = useState('');
  const [role, setRole] = useState<UserRole>('director');
  const [selectedCam, setSelectedCam] = useState<CameraId>('cam1');
  const [operatorName, setOperatorName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isRoomLocked, setIsRoomLocked] = useState(false);
  const [roomCheckStatus, setRoomCheckStatus] = useState<
    'idle' | 'checking' | 'available' | 'occupied'
  >('idle');

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

  // Inject web keyframes for glowing text pulse
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const styleId = 'blinking-room-placeholder-style';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          @keyframes roomPlaceholderPulse {
            0% { opacity: 1; text-shadow: 0 0 10px rgba(0, 230, 118, 0.75); color: #00E676; }
            50% { opacity: 0.22; text-shadow: 0 0 0px transparent; color: #3A694A; }
            100% { opacity: 1; text-shadow: 0 0 10px rgba(0, 230, 118, 0.75); color: #00E676; }
          }
          .blinking-room-placeholder {
            animation: roomPlaceholderPulse 1.8s infinite ease-in-out !important;
          }
        `;
        document.head.appendChild(style);
      }
    }
  }, []);

  // Detect URL query parameters (?room=...&role=...&cam=...) on mount
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
      try {
        const searchParams = new URLSearchParams(window.location.search);
        const queryRoom = searchParams.get('room') || searchParams.get('sala');
        const queryRole = searchParams.get('role') || searchParams.get('rol');
        const queryCam = searchParams.get('cam') || searchParams.get('camera');

        if (queryRoom && queryRoom.trim()) {
          const cleaned = normalizeRoomId(queryRoom);
          setRoomId(cleaned);
          setIsRoomLocked(true);
        }

        if (queryRole) {
          const roleUpper = queryRole.trim().toUpperCase();
          if (
            roleUpper === 'CAM' ||
            roleUpper === 'CAMERA' ||
            roleUpper === 'CAMARA' ||
            roleUpper === 'CÁMARA'
          ) {
            setRole('camera');
          } else if (roleUpper === 'DIRECTOR') {
            setRole('director');
          }
        } else if (queryRoom) {
          // Default to camera when joining through a director invite link
          setRole('camera');
        }

        if (queryCam) {
          const lowerCam = queryCam.toLowerCase().trim();
          const match = lowerCam.match(/\d+/);
          if (match) {
            const camNum = parseInt(match[0], 10);
            if (camNum >= 1 && camNum <= 8) {
              setSelectedCam(`cam${camNum}` as CameraId);
            }
          }
        }
      } catch (err) {
        console.warn('[EmailLoginGate] Error parsing URL query params:', err);
      }
    }
  }, []);

  // Real-time debounced room collision validation when role === 'director'
  useEffect(() => {
    const trimmedRoom = roomId.trim();
    if (role !== 'director' || trimmedRoom.length < 2) {
      setRoomCheckStatus('idle');
      return;
    }

    setRoomCheckStatus('checking');
    const cleanRoom = normalizeRoomId(trimmedRoom);
    let isCancelled = false;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/rooms/check/${encodeURIComponent(cleanRoom)}`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          if (!isCancelled) setRoomCheckStatus('available');
          return;
        }
        const data = await res.json();
        if (!isCancelled) {
          if (data.hasActiveDirector) {
            setRoomCheckStatus('occupied');
          } else {
            setRoomCheckStatus('available');
          }
        }
      } catch (err) {
        if (!isCancelled) {
          setRoomCheckStatus('available');
        }
      }
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [roomId, role]);

  const isEmailValid = authService.validateEmail(email.trim()).valid;
  const isRoomValid = roomId.trim().length >= 1;
  const isDirectorOccupied = role === 'director' && roomCheckStatus === 'occupied';
  const isDirectorChecking = role === 'director' && roomCheckStatus === 'checking';
  const canSubmit = isEmailValid && isRoomValid && !isDirectorOccupied && !isDirectorChecking;

  const handleSubmit = () => {
    const trimmedEmail = email.trim();
    const trimmedRoom = roomId.trim();

    const validation = authService.validateEmail(trimmedEmail);
    if (!validation.valid) {
      setErrorMessage(validation.reason || 'Por favor, introduce un correo electrónico válido.');
      return;
    }

    if (!trimmedRoom) {
      setErrorMessage('Por favor, indica el nombre de tu grupo o sala de producción.');
      return;
    }

    if (role === 'director' && roomCheckStatus === 'occupied') {
      setErrorMessage(
        '⚠️ Esta sala ya está ocupada por otra producción. Por favor, escribe un nombre diferente.'
      );
      return;
    }

    setErrorMessage(null);
    const session = authService.login(trimmedEmail);
    onLoginSuccess({
      session,
      email: trimmedEmail,
      roomId: trimmedRoom,
      role,
      selectedCam,
      name:
        operatorName.trim() ||
        (role === 'director' ? 'Director 1' : `Cam ${selectedCam.replace('cam', '')} Operator`),
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0E" />

      {/* Top Brand Tag */}
      <View style={styles.topBrandBar}>
        <View style={styles.brandBadge}>
          <View style={styles.brandDot} />
          <Text style={styles.brandBadgeText}>ALICANTE PARADISE STUDIOS</Text>
        </View>
        <Text style={styles.brandSystemTag}>INTERCON TALLY V2 • vMix</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.centerContainer}>
            <View style={styles.loginCard}>
              {/* Studio Icon / Header */}
              <View style={styles.iconCircle}>
                <Text style={styles.keyIcon}>🎬</Text>
              </View>

              <Text style={styles.title}>ACCESO A PRODUCCIÓN</Text>
              <Text style={styles.subtitle}>
                Define tu sala y credencial para conectar el intercomunicador
              </Text>

              {/* Input Form */}
              <View style={styles.formSection}>
                {/* 1. Email Field */}
                <View style={styles.formGroup}>
                  <View style={styles.labelRow}>
                    <Text style={styles.inputLabel}>CORREO ELECTRÓNICO</Text>
                    <View style={styles.requiredBadge}>
                      <Text style={styles.requiredBadgeText}>OBLIGATORIO</Text>
                    </View>
                  </View>
                  <TextInput
                    style={[
                      styles.input,
                      errorMessage && !isEmailValid ? styles.inputError : null,
                    ]}
                    placeholder="ejemplo@estudio.com"
                    placeholderTextColor="#55556A"
                    value={email}
                    onChangeText={(val) => {
                      setEmail(val);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    returnKeyType="next"
                  />
                </View>

                {/* 2. Room / Group Field with Dynamic Pulsing Placeholder */}
                <View style={styles.formGroup}>
                  <View style={styles.labelRow}>
                    <Text style={styles.inputLabel}>SALA / GRUPO DE PRODUCCIÓN</Text>
                    {isRoomLocked ? (
                      <View style={styles.lockedRoomBadge}>
                        <Text style={styles.lockedRoomBadgeText}>🔒 ENLACE CÁMARA</Text>
                      </View>
                    ) : (
                      <View style={styles.requiredBadge}>
                        <Text style={styles.requiredBadgeText}>OBLIGATORIO</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.roomInputWrapper}>
                    <TextInput
                      style={[
                        styles.input,
                        styles.roomInput,
                        isRoomLocked ? styles.roomInputLocked : null,
                        !isRoomValid && errorMessage ? styles.inputError : null,
                        role === 'director' && roomCheckStatus === 'occupied' ? styles.inputError : null,
                      ]}
                      placeholder=""
                      placeholderTextColor="transparent"
                      value={roomId}
                      editable={!isRoomLocked}
                      onChangeText={(val) => {
                        setRoomId(val);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="done"
                    />

                    {/* Smooth Animated Blinking Placeholder */}
                    {!roomId && (
                      <Animated.View
                        style={[
                          styles.blinkingPlaceholderContainer,
                          { opacity: pulseAnim },
                        ]}
                        pointerEvents="none"
                      >
                        <Text
                          style={styles.blinkingPlaceholderText}
                          numberOfLines={1}
                          // @ts-ignore: web animation class
                          className="blinking-room-placeholder"
                        >
                          Escribe el nombre de tu grupo o sala (ej: ALICANTE, EVENTO-1)...
                        </Text>
                      </Animated.View>
                    )}
                  </View>

                  {/* Real-time Status Badges & Room Feedback */}
                  {isRoomLocked ? (
                    <View style={styles.roomLockedInfoBox}>
                      <Text style={styles.roomLockedInfoText}>
                        🔒 Sala asignada por el Director mediante invitación QR.
                      </Text>
                    </View>
                  ) : null}

                  {role === 'director' && roomCheckStatus === 'checking' && (
                    <View style={styles.roomCheckingBox}>
                      <Text style={styles.roomCheckingText}>
                        🔍 Comprobando disponibilidad de sala...
                      </Text>
                    </View>
                  )}

                  {role === 'director' && roomCheckStatus === 'occupied' && (
                    <View style={styles.roomOccupiedBox}>
                      <Text style={styles.roomOccupiedText}>
                        ⚠️ Esta sala ya está ocupada por otra producción. Por favor, escribe un nombre diferente.
                      </Text>
                    </View>
                  )}

                  {role === 'director' && roomCheckStatus === 'available' && roomId.trim().length >= 2 && (
                    <View style={styles.roomAvailableBox}>
                      <Text style={styles.roomAvailableText}>
                        ✅ Nombre de sala disponible
                      </Text>
                    </View>
                  )}

                  {role === 'camera' && !isRoomLocked && (
                    <View style={styles.roomCameraNoticeBox}>
                      <Text style={styles.roomCameraNoticeText}>
                        🎥 Acceso directo para operador de cámara a la sala.
                      </Text>
                    </View>
                  )}

                  <Text style={styles.roomHelpNote}>
                    ⚡ Define un nombre único para que tu equipo se comunique en su propio canal privado.
                  </Text>
                </View>

                {/* 3. Role Selection */}
                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>ROL EN LA PRODUCCIÓN</Text>
                  <View style={styles.roleTabsRow}>
                    <TouchableOpacity
                      style={[
                        styles.roleButton,
                        role === 'director' && styles.roleButtonActive,
                      ]}
                      onPress={() => setRole('director')}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.roleButtonIcon}>🎬</Text>
                      <View style={styles.roleTextGroup}>
                        <Text
                          style={[
                            styles.roleButtonTitle,
                            role === 'director' && styles.roleButtonTitleActive,
                          ]}
                        >
                          DIRECTOR
                        </Text>
                        <Text style={styles.roleButtonDesc}>
                          Control, vMix & Tally
                        </Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.roleButton,
                        role === 'camera' && styles.roleButtonActive,
                      ]}
                      onPress={() => setRole('camera')}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.roleButtonIcon}>🎥</Text>
                      <View style={styles.roleTextGroup}>
                        <Text
                          style={[
                            styles.roleButtonTitle,
                            role === 'camera' && styles.roleButtonTitleActive,
                          ]}
                        >
                          CÁMARA
                        </Text>
                        <Text style={styles.roleButtonDesc}>
                          Tally & Retorno
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Camera Picker (If Camera Operator) */}
                {role === 'camera' && (
                  <View style={styles.formGroup}>
                    <Text style={styles.inputLabel}>NÚMERO DE CÁMARA ASIGNADA</Text>
                    <View style={styles.cameraGrid}>
                      {AVAILABLE_CAMERAS.map((cam, idx) => {
                        const isSelected = selectedCam === cam;
                        return (
                          <TouchableOpacity
                            key={cam}
                            style={[
                              styles.cameraTile,
                              isSelected && styles.cameraTileActive,
                            ]}
                            onPress={() => setSelectedCam(cam)}
                            activeOpacity={0.8}
                          >
                            <Text
                              style={[
                                styles.cameraTileText,
                                isSelected && styles.cameraTileTextActive,
                              ]}
                            >
                              CAM {idx + 1}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* Error Banner */}
                {errorMessage && (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorIcon}>⚠️</Text>
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  </View>
                )}
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  !canSubmit && styles.submitButtonDisabled,
                  isHovered && canSubmit && styles.submitButtonHovered,
                ]}
                onPress={handleSubmit}
                activeOpacity={canSubmit ? 0.8 : 1}
                disabled={!canSubmit}
                {...(Platform.OS === 'web'
                  ? ({
                      onMouseEnter: () => setIsHovered(true),
                      onMouseLeave: () => setIsHovered(false),
                    } as any)
                  : {})}
              >
                <Text style={styles.submitButtonText}>
                  {!isEmailValid
                    ? 'INTRODUCE UN CORREO VÁLIDO'
                    : !isRoomValid
                    ? 'INDICA TU SALA O GRUPO'
                    : isDirectorChecking
                    ? 'VERIFICANDO DISPONIBILIDAD...'
                    : isDirectorOccupied
                    ? 'SALA OCUPADA - CAMBIA EL NOMBRE'
                    : `ENTRAR A ${roomId.trim().toUpperCase()} COMO ${role.toUpperCase()}`}
                </Text>
              </TouchableOpacity>

              {/* Session Expiry Info */}
              <View style={styles.securityNote}>
                <Text style={styles.securityNoteText}>
                  🔐 Tu sesión se mantendrá activa durante 30 días en este navegador.
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Footer Support Info */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Contacto técnico: alicanteparadisestudios@gmail.com
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090D',
  },
  topBrandBar: {
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: '#161622',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: '#0D0D14',
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00E676',
    // @ts-ignore
    boxShadow: '0 0 8px #00E676',
  },
  brandBadgeText: {
    color: '#D1D5DB',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  brandSystemTag: {
    color: '#717188',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 20,
  },
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  loginCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#12121A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#242436',
    padding: 28,
    alignItems: 'center',
    // @ts-ignore
    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#1A1A28',
    borderWidth: 1,
    borderColor: '#2E2E44',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  keyIcon: {
    fontSize: 24,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    color: '#9090AA',
    fontSize: 12.5,
    marginBottom: 20,
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 18,
  },
  formSection: {
    width: '100%',
    marginBottom: 10,
  },
  formGroup: {
    width: '100%',
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  inputLabel: {
    color: '#A0A0BC',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 7,
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
  input: {
    backgroundColor: '#0A0A0F',
    borderWidth: 1,
    borderColor: '#2A2A3E',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  roomInputWrapper: {
    position: 'relative',
    width: '100%',
    justifyContent: 'center',
  },
  roomInput: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 1.5,
    fontWeight: '800',
    fontSize: 14,
    color: '#00E676',
  },
  blinkingPlaceholderContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    pointerEvents: 'none',
  },
  blinkingPlaceholderText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  lockedRoomBadge: {
    backgroundColor: 'rgba(0, 229, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#00E5FF',
  },
  lockedRoomBadgeText: {
    color: '#00E5FF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  roomInputLocked: {
    backgroundColor: '#12121A',
    borderColor: '#00E5FF',
    color: '#00E5FF',
    opacity: 0.95,
  },
  roomLockedInfoBox: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 229, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.3)',
  },
  roomLockedInfoText: {
    color: '#80DEEA',
    fontSize: 11,
    fontWeight: '600',
  },
  roomCheckingBox: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 214, 0, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 214, 0, 0.3)',
  },
  roomCheckingText: {
    color: '#FFD600',
    fontSize: 11,
    fontWeight: '600',
  },
  roomOccupiedBox: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 23, 68, 0.12)',
    borderWidth: 1,
    borderColor: '#FF1744',
  },
  roomOccupiedText: {
    color: '#FF5252',
    fontSize: 11.5,
    fontWeight: '700',
    lineHeight: 16,
  },
  roomAvailableBox: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 230, 118, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.4)',
  },
  roomAvailableText: {
    color: '#00E676',
    fontSize: 11.5,
    fontWeight: '700',
  },
  roomCameraNoticeBox: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 230, 118, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.25)',
  },
  roomCameraNoticeText: {
    color: '#69F0AE',
    fontSize: 11,
    fontWeight: '600',
  },
  roomHelpNote: {
    color: '#71718A',
    fontSize: 11,
    marginTop: 6,
    lineHeight: 15,
  },
  inputError: {
    borderColor: '#FF3B30',
    backgroundColor: '#180B0D',
  },
  roleTabsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  roleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A0A0F',
    borderWidth: 1.5,
    borderColor: '#262638',
    borderRadius: 10,
    padding: 12,
    gap: 10,
    cursor: 'pointer',
  },
  roleButtonActive: {
    backgroundColor: '#181C26',
    borderColor: '#00E676',
    // @ts-ignore
    boxShadow: '0 0 10px rgba(0, 230, 118, 0.25)',
  },
  roleButtonIcon: {
    fontSize: 22,
  },
  roleTextGroup: {
    flex: 1,
  },
  roleButtonTitle: {
    color: '#8E8EA8',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  roleButtonTitleActive: {
    color: '#FFFFFF',
  },
  roleButtonDesc: {
    color: '#5E5E76',
    fontSize: 9.5,
    marginTop: 2,
    fontWeight: '500',
  },
  cameraGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    width: '100%',
  },
  cameraTile: {
    width: '23%',
    flexGrow: 1,
    backgroundColor: '#0A0A0F',
    borderWidth: 1,
    borderColor: '#262638',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  cameraTileActive: {
    backgroundColor: '#1A281E',
    borderColor: '#00E676',
    // @ts-ignore
    boxShadow: '0 0 8px rgba(0, 230, 118, 0.3)',
  },
  cameraTileText: {
    color: '#8A8A9E',
    fontSize: 11,
    fontWeight: '800',
  },
  cameraTileTextActive: {
    color: '#00E676',
    fontWeight: '900',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  errorIcon: {
    fontSize: 13,
  },
  errorText: {
    color: '#FF5252',
    fontSize: 12,
    fontWeight: '600',
  },
  submitButton: {
    width: '100%',
    backgroundColor: '#00C853',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    // @ts-ignore
    boxShadow: '0 4px 15px rgba(0, 200, 83, 0.35)',
    cursor: 'pointer',
    marginTop: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#1E1E28',
    opacity: 0.55,
    // @ts-ignore
    boxShadow: 'none',
    cursor: 'not-allowed' as any,
  },
  submitButtonHovered: {
    backgroundColor: '#00E676',
    // @ts-ignore
    boxShadow: '0 6px 20px rgba(0, 230, 118, 0.5)',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '900',
    letterSpacing: 1,
  },
  securityNote: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#1C1C2A',
    width: '100%',
    alignItems: 'center',
  },
  securityNoteText: {
    color: '#656580',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
  footer: {
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#12121A',
  },
  footerText: {
    color: '#4B4B60',
    fontSize: 11,
  },
});
