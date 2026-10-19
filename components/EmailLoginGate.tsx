import React, { useState } from 'react';
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
} from 'react-native';
import { authService, AuthSession } from '../services/authService';

interface EmailLoginGateProps {
  onLoginSuccess: (session: AuthSession) => void;
}

export const EmailLoginGate: React.FC<EmailLoginGateProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const handleSubmit = () => {
    const trimmed = email.trim();
    const validation = authService.validateEmail(trimmed);
    if (!validation.valid) {
      setErrorMessage(validation.reason || 'Por favor, introduce un correo electrónico válido.');
      return;
    }

    setErrorMessage(null);
    const session = authService.login(trimmed);
    onLoginSuccess(session);
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
        <View style={styles.centerContainer}>
          <View style={styles.loginCard}>
            {/* Studio Icon / Header */}
            <View style={styles.iconCircle}>
              <Text style={styles.keyIcon}>🔒</Text>
            </View>

            <Text style={styles.title}>ACCESO A PRODUCCIÓN</Text>
            <Text style={styles.subtitle}>
              Introduce tu correo electrónico para acceder
            </Text>

            {/* Input Form */}
            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>CORREO ELECTRÓNICO</Text>
              <TextInput
                style={[
                  styles.input,
                  errorMessage ? styles.inputError : null,
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
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                {...(Platform.OS === 'web'
                  ? ({
                      autoFocus: true,
                    } as any)
                  : {})}
              />

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
                isHovered && styles.submitButtonHovered,
              ]}
              onPress={handleSubmit}
              activeOpacity={0.8}
              {...(Platform.OS === 'web'
                ? ({
                    onMouseEnter: () => setIsHovered(true),
                    onMouseLeave: () => setIsHovered(false),
                    onClick: handleSubmit,
                  } as any)
                : {})}
            >
              <Text style={styles.submitButtonText}>ENTRAR AL SISTEMA</Text>
            </TouchableOpacity>

            {/* Session Expiry Info */}
            <View style={styles.securityNote}>
              <Text style={styles.securityNoteText}>
                🔐 Tu sesión se mantendrá activa durante 30 días en este navegador.
              </Text>
            </View>
          </View>
        </View>
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
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loginCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#12121A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#242436',
    padding: 32,
    alignItems: 'center',
    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
  },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#1A1A28',
    borderWidth: 1,
    borderColor: '#2E2E44',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
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
    fontSize: 13,
    marginBottom: 24,
    textAlign: 'center',
    fontWeight: '500',
  },
  formGroup: {
    width: '100%',
    marginBottom: 20,
  },
  inputLabel: {
    color: '#A0A0BC',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0A0A0F',
    borderWidth: 1,
    borderColor: '#2A2A3E',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  inputError: {
    borderColor: '#FF3B30',
    backgroundColor: '#180B0D',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
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
    backgroundColor: '#FF1744',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 15px rgba(255, 23, 68, 0.3)',
    cursor: 'pointer',
  },
  submitButtonHovered: {
    backgroundColor: '#FF3358',
    boxShadow: '0 6px 20px rgba(255, 23, 68, 0.45)',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  securityNote: {
    marginTop: 22,
    paddingTop: 16,
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
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#12121A',
  },
  footerText: {
    color: '#4B4B60',
    fontSize: 11,
  },
});
