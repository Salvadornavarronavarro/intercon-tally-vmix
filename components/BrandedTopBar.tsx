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
        {/* Facebook */}
        <SocialLink
          href="https://www.facebook.com/profile.php?id=61583757137099"
          title="Facebook Alicante Paradise Studios"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24V15.563H7.078V12.073H10.125V9.413C10.125 6.388 11.916 4.71 14.658 4.71C15.97 4.71 17.344 4.945 17.344 4.945V7.915H15.83C14.34 7.915 13.875 8.845 13.875 9.799V12.073H17.203L16.671 15.563H13.875V24C19.612 23.094 24 18.1 24 12.073Z"/>
          </svg>
        </SocialLink>

        {/* TikTok */}
        <SocialLink
          href="https://www.tiktok.com/@alicante.paradise.studio"
          title="TikTok Alicante Paradise Studios"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.47 6.29 6.29 0 0 0 1.95-4.52V8.04a8.16 8.16 0 0 0 4.82 1.57v-3.48a4.85 4.85 0 0 1-1-.44Z"/>
          </svg>
        </SocialLink>

        {/* Telegram */}
        <SocialLink
          href="https://t.me/alicanteparadisestudios"
          title="Telegram Alicante Paradise Studios"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
          </svg>
        </SocialLink>

        {/* Email */}
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
