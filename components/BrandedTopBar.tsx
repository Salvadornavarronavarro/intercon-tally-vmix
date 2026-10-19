import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Linking,
} from 'react-native';
import { useIntercom } from '../context/IntercomContext';
import { AuthSession } from '../services/authService';

interface BrandedTopBarProps {
  onOpenAuthModal?: () => void;
  currentUser?: {
    name?: string;
    role?: string;
    cameraId?: string;
  } | null;
  currentRoomId?: string | null;
  authSession?: AuthSession | null;
  onLogout?: () => void;
}

interface SocialLinkProps {
  href: string;
  title: string;
  children: React.ReactNode;
}

const SocialLink: React.FC<SocialLinkProps> = ({ href, title, children }) => {
  const [isHovered, setIsHovered] = useState(false);

  if (Platform.OS === 'web') {
    return (
      <a
        href={href}
        target={href.startsWith('mailto:') ? undefined : '_blank'}
        rel={href.startsWith('mailto:') ? undefined : 'noopener noreferrer'}
        title={title}
        aria-label={title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isHovered ? '#FFFFFF' : '#D1D5DB',
          opacity: isHovered ? 1 : 0.75,
          padding: 4,
          textDecoration: 'none',
          cursor: 'pointer',
          transition: 'opacity 0.15s ease, color 0.15s ease',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {children}
      </a>
    );
  }

  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(href).catch(() => {})}
      activeOpacity={0.7}
      accessibilityRole="link"
      accessibilityLabel={title}
      style={styles.socialIconBtn}
    >
      <View style={{ opacity: 0.85 }}>{children}</View>
    </TouchableOpacity>
  );
};

export const BrandedTopBar: React.FC<BrandedTopBarProps> = ({
  onOpenAuthModal,
  currentUser: propUser,
  currentRoomId: propRoom,
  authSession: propSession,
  onLogout: propLogout,
}) => {
  const intercom = useIntercom();
  const currentUser = propUser !== undefined ? propUser : intercom.currentUser;
  const currentRoomId = propRoom !== undefined ? propRoom : intercom.currentRoomId;
  const authSession = propSession !== undefined ? propSession : intercom.authSession;
  const handleLogout = propLogout || intercom.logoutEmail;

  const [isLogoutHovered, setIsLogoutHovered] = useState(false);
  const [isLoginHovered, setIsLoginHovered] = useState(false);

  return (
    <View style={styles.topBarContainer}>
      {/* 1. Left Section: Social & Contact Links */}
      <View style={styles.leftSection}>
        {/* WhatsApp: valid link targeting web.whatsapp.com */}
        <SocialLink
          href="https://web.whatsapp.com"
          title="WhatsApp Alicante Paradise Studios"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.05 20.15C10.57 20.15 9.12 19.76 7.85 19.01L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.8 13.47 3.8 11.91C3.8 7.37 7.5 3.67 12.05 3.67C14.25 3.67 16.32 4.53 17.88 6.09C19.44 7.65 20.29 9.72 20.29 11.92C20.28 16.46 16.58 20.15 12.05 20.15ZM16.57 14.39C16.32 14.27 15.1 13.67 14.87 13.58C14.65 13.5 14.48 13.46 14.32 13.7C14.15 13.95 13.68 14.5 13.54 14.66C13.39 14.83 13.25 14.85 13 14.73C12.75 14.6 11.95 14.34 11 13.49C10.26 12.83 9.76 12.02 9.61 11.77C9.46 11.52 9.6 11.39 9.72 11.27C9.83 11.16 9.97 10.98 10.09 10.84C10.22 10.7 10.26 10.6 10.34 10.43C10.42 10.26 10.38 10.12 10.32 10C10.26 9.88 9.76 8.65 9.55 8.15C9.35 7.66 9.15 7.73 9 7.72C8.86 7.71 8.7 7.71 8.53 7.71C8.36 7.71 8.09 7.77 7.86 8.02C7.63 8.27 7 8.86 7 10.06C7 11.26 7.88 12.42 8 12.58C8.12 12.74 9.73 15.23 12.21 16.3C12.8 16.55 13.25 16.7 13.61 16.82C14.21 17.01 14.75 16.98 15.18 16.92C15.66 16.85 16.66 16.32 16.87 15.73C17.08 15.14 17.08 14.64 17.02 14.54C16.96 14.44 16.82 14.38 16.57 14.39Z"/>
          </svg>
        </SocialLink>

        {/* Facebook: valid link targeting facebook.com */}
        <SocialLink
          href="https://www.facebook.com"
          title="Facebook Alicante Paradise Studios"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24V15.563H7.078V12.073H10.125V9.413C10.125 6.388 11.916 4.71 14.658 4.71C15.97 4.71 17.344 4.945 17.344 4.945V7.915H15.83C14.34 7.915 13.875 8.845 13.875 9.799V12.073H17.203L16.671 15.563H13.875V24C19.612 23.094 24 18.1 24 12.073Z"/>
          </svg>
        </SocialLink>

        {/* Twitter / X: valid link targeting twitter.com */}
        <SocialLink
          href="https://twitter.com"
          title="X / Twitter Alicante Paradise Studios"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M18.244 2.25H21.552L14.325 10.511L22.827 21.75H16.171L10.957 14.933L4.992 21.75H1.681L9.41 12.917L1.254 2.25H8.08L12.793 8.481L18.244 2.25ZM17.083 19.77H18.916L7.084 4.126H5.117L17.083 19.77Z"/>
          </svg>
        </SocialLink>

        {/* TikTok: valid link targeting tiktok.com */}
        <SocialLink
          href="https://www.tiktok.com"
          title="TikTok Alicante Paradise Studios"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.47 6.29 6.29 0 0 0 1.95-4.52V8.04a8.16 8.16 0 0 0 4.82 1.57v-3.48a4.85 4.85 0 0 1-1-.44Z"/>
          </svg>
        </SocialLink>

        {/* Email: mailto link to company email */}
        <SocialLink
          href="mailto:alicanteparadisestudios@gmail.com"
          title="Email alicanteparadisestudios@gmail.com"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M20 4H4C2.9 4 2.01 4.9 2.01 6L2 18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4ZM20 8L12 13L4 8V6L12 11L20 6V8Z"/>
          </svg>
        </SocialLink>
      </View>

      {/* 2. Center Section: Clean & Uncluttered */}
      <View style={styles.centerSection} />

      {/* 3. Right Section: Authenticated Email Badge + Logout */}
      <View style={styles.rightSection}>
        {authSession ? (
          <>
            {/* Logged-in User Email Badge */}
            <View
              style={styles.emailBadge}
              {...(Platform.OS === 'web'
                ? ({ title: `Sesión activa: ${authSession.email}` } as any)
                : {})}
            >
              <View style={styles.activeDot} />
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="currentColor"
                style={{ marginRight: 6, color: '#A0A0B5' }}
              >
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
              <Text style={styles.emailBadgeText} numberOfLines={1}>
                {authSession.email}
              </Text>
            </View>

            {/* Operator Role Tag / Switcher */}
            {onOpenAuthModal && (
              <TouchableOpacity
                style={styles.crewRoleTag}
                onPress={onOpenAuthModal}
                activeOpacity={0.8}
                {...(Platform.OS === 'web'
                  ? ({ title: 'Cambiar rol o sala de operador' } as any)
                  : {})}
              >
                <Text style={styles.crewRoleTagText}>
                  {currentUser?.role === 'director'
                    ? 'DIRECTOR'
                    : currentUser?.role === 'camera'
                    ? `CAM ${currentUser.cameraId?.replace('cam', '') || ''}`
                    : 'CREW'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Cerrar Sesión (Logout) Button */}
            <TouchableOpacity
              style={[
                styles.logoutBtn,
                isLogoutHovered && styles.logoutBtnHovered,
              ]}
              onPress={handleLogout}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Cerrar sesión"
              {...(Platform.OS === 'web'
                ? ({
                    title: 'Cerrar sesión y limpiar credenciales',
                    onMouseEnter: () => setIsLogoutHovered(true),
                    onMouseLeave: () => setIsLogoutHovered(false),
                    onClick: handleLogout,
                  } as any)
                : {})}
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="currentColor"
                style={{ marginRight: 5, color: isLogoutHovered ? '#FF5252' : '#B0B0C0' }}
              >
                <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
              </svg>
              <Text
                style={[
                  styles.logoutBtnText,
                  isLogoutHovered && styles.logoutBtnTextHovered,
                ]}
              >
                Cerrar sesión
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[
              styles.loginButton,
              isLoginHovered && styles.loginButtonHovered,
            ]}
            onPress={onOpenAuthModal}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Iniciar Sesión"
            {...(Platform.OS === 'web'
              ? ({
                  onMouseEnter: () => setIsLoginHovered(true),
                  onMouseLeave: () => setIsLoginHovered(false),
                } as any)
              : {})}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="currentColor"
              style={{ marginRight: 6 }}
            >
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
            <Text style={styles.loginButtonText}>Iniciar Sesión</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  topBarContainer: {
    backgroundColor: '#111116',
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E28',
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 100,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  socialIconBtn: {
    color: '#D1D5DB',
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerSection: {
    flex: 1,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#171722',
    borderWidth: 1,
    borderColor: '#262638',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    maxWidth: 220,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00E676',
    marginRight: 7,
  },
  emailBadgeText: {
    color: '#D4D4E2',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  crewRoleTag: {
    backgroundColor: '#1E1E2C',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#303046',
    paddingHorizontal: 7,
    paddingVertical: 3,
    cursor: 'pointer',
  },
  crewRoleTagText: {
    color: '#9090AA',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C161A',
    borderWidth: 1,
    borderColor: '#382228',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  logoutBtnHovered: {
    backgroundColor: '#28171E',
    borderColor: '#5A2A34',
  },
  logoutBtnText: {
    color: '#B0B0C0',
    fontSize: 11,
    fontWeight: '700',
  },
  logoutBtnTextHovered: {
    color: '#FF5252',
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#191923',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#2F2F40',
    color: '#E0E0E6',
    cursor: 'pointer',
  },
  loginButtonHovered: {
    backgroundColor: '#232332',
    borderColor: '#4A4A62',
    color: '#FFFFFF',
  },
  loginButtonText: {
    color: '#E0E0E6',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

export default BrandedTopBar;
