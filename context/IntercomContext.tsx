import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import {
  playPreviewTone,
  startProgramTone,
  stopAllTones,
  initAudioSession,
} from '../services/tallySoundService';
import {
  signalingService,
  normalizeRoomId,
  ConnectionStatus,
  TallyUpdatePayload,
  MuteRemoteOperatorPayload,
  UserJoinedPayload,
  UserLeftPayload,
} from '../services/signalingService';
import { webrtcAudioService } from '../services/webrtcAudioService';
import { authService, AuthSession } from '../services/authService';

export type UserRole = 'director' | 'camera';
export type CameraId = string;
export type TallyState = 'idle' | 'preview' | 'program';

export interface Participant {
  id: string;
  name: string;
  role: UserRole;
  cameraId?: CameraId;
  isMuted: boolean;
}

export interface IntercomContextType {
  // State
  currentUser: Participant | null;
  currentRoomId: string | null;
  activePreviewCamera: string | null;
  activeProgramCamera: string | null;
  participantsList: Participant[];
  currentTallyState: TallyState;
  isProgramOverlap: boolean;
  connectionStatus: ConnectionStatus;

  // Convenience computed helpers
  isMuted: boolean;
  isMutedByDirector: boolean;
  isDirector: boolean;
  isCamera: boolean;

  // Actions
  joinRoom: (roomId: string, user: Participant, signalingUrl?: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  setPreviewCamera: (cameraId: string | null) => void;
  setProgramCamera: (cameraId: string | null) => void;
  muteRemoteOperator: (targetUserId: string, targetCameraId?: string, mute?: boolean) => void;
  toggleMute: () => void;
  setParticipantsList: React.Dispatch<React.SetStateAction<Participant[]>>;

  // WebRTC Audio Calls
  startAudioCall: (roomId: string, userId: string) => Promise<boolean>;
  endAudioCall: () => Promise<void>;
  setMicEnabled: (enabled: boolean) => void;

  // 30-Day Email Authentication
  authSession: AuthSession | null;
  loginWithEmail: (email: string) => AuthSession;
  logoutEmail: () => void;
}

const IntercomContext = createContext<IntercomContextType | undefined>(undefined);

interface IntercomProviderProps {
  children: ReactNode;
}

export const IntercomProvider: React.FC<IntercomProviderProps> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<Participant | null>(null);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [activePreviewCamera, setActivePreviewCamera] = useState<string | null>(null);
  const [activeProgramCamera, setActiveProgramCamera] = useState<string | null>(null);
  const [participantsList, setParticipantsList] = useState<Participant[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [isMutedByDirector, setIsMutedByDirector] = useState<boolean>(false);
  const [isProgramOverlap, setIsProgramOverlap] = useState<boolean>(false);
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => authService.getSession());

  const currentUserRef = useRef<Participant | null>(currentUser);
  currentUserRef.current = currentUser;

  const activeProgramCameraRef = useRef<string | null>(activeProgramCamera);
  activeProgramCameraRef.current = activeProgramCamera;

  const activePreviewCameraRef = useRef<string | null>(activePreviewCamera);
  activePreviewCameraRef.current = activePreviewCamera;

  const overlapTimerRef = useRef<any>(null);
  const previousProgramCameraRef = useRef<string | null>(null);

  // Calculate current device's tally status (active program camera or in 2-second cut overlap)
  const currentTallyState: TallyState = useMemo(() => {
    if (!currentUser || currentUser.role !== 'camera' || !currentUser.cameraId) {
      return 'idle';
    }
    if (currentUser.cameraId === activeProgramCamera || isProgramOverlap) {
      return 'program';
    }
    if (currentUser.cameraId === activePreviewCamera) {
      return 'preview';
    }
    return 'idle';
  }, [currentUser, activeProgramCamera, activePreviewCamera, isProgramOverlap]);

  // Acoustic Tally Feedback Synchronization & 2-Second PROGRAM Overlap
  useEffect(() => {
    // 1. Strict Director acoustic isolation: Director device NEVER plays tally tones
    if (!currentUser || currentUser.role !== 'camera' || !currentUser.cameraId) {
      if (overlapTimerRef.current) {
        clearTimeout(overlapTimerRef.current);
        overlapTimerRef.current = null;
      }
      setIsProgramOverlap(false);
      previousProgramCameraRef.current = null;
      stopAllTones();
      return;
    }

    const myCamId = currentUser.cameraId;
    const prevProgramCam = previousProgramCameraRef.current;
    previousProgramCameraRef.current = activeProgramCamera;

    // 2. 2-Second Cut Overlap: If this camera was ON AIR and just got cut
    if (prevProgramCam === myCamId && activeProgramCamera !== myCamId) {
      console.log(`[IntercomContext] Camera ${myCamId} cut from Program -> initiating 2000ms overlap tone`);
      setIsProgramOverlap(true);

      if (overlapTimerRef.current) {
        clearTimeout(overlapTimerRef.current);
      }

      overlapTimerRef.current = setTimeout(() => {
        overlapTimerRef.current = null;
        setIsProgramOverlap(false);
        console.log(`[IntercomContext] Camera ${myCamId} 2000ms overlap ended`);

        // After 2000ms overlap, transition to preview or idle
        const currentPgm = activeProgramCameraRef.current;
        const currentPvw = activePreviewCameraRef.current;
        if (currentPgm === myCamId) {
          startProgramTone();
        } else if (currentPvw === myCamId) {
          playPreviewTone();
        } else {
          stopAllTones();
        }
      }, 2000);
      return;
    }

    // 3. Camera is ON AIR / PROGRAM
    if (activeProgramCamera === myCamId) {
      if (overlapTimerRef.current) {
        clearTimeout(overlapTimerRef.current);
        overlapTimerRef.current = null;
      }
      setIsProgramOverlap(false);
      console.log(`[IntercomContext] Camera ${myCamId} is ON AIR -> startProgramTone()`);
      startProgramTone();
      return;
    }

    // 4. If currently in 2-second overlap, keep sounding program tone until timer completes
    if (overlapTimerRef.current) {
      return;
    }

    // 5. Camera is in STANDBY / PREVIEW
    if (activePreviewCamera === myCamId) {
      console.log(`[IntercomContext] Camera ${myCamId} is on PREVIEW -> playPreviewTone()`);
      playPreviewTone();
      return;
    }

    // 6. Camera is IDLE / OFF-AIR
    stopAllTones();
  }, [currentUser, activeProgramCamera, activePreviewCamera]);

  // Clean up any playing tones and connections when provider unmounts
  useEffect(() => {
    return () => {
      if (overlapTimerRef.current) {
        clearTimeout(overlapTimerRef.current);
        overlapTimerRef.current = null;
      }
      stopAllTones();
      signalingService.disconnect();
      webrtcAudioService.endAudioCall();
    };
  }, []);

  // Real-time signaling synchronization: bind listeners once
  useEffect(() => {
    const unsubStatus = signalingService.onConnectionChange((status) => {
      setConnectionStatus(status);
    });

    // Handle remote peer tally updates with STRICT DIRECTOR AUTHORIZATION
    const unsubTally = signalingService.on<TallyUpdatePayload>('TALLY_UPDATE', (payload, message) => {
      // Ignore echoing our own local broadcast
      const current = currentUserRef.current;
      if (current && message.senderId === current.id) return;

      // STRICT DIRECTOR AUTHORIZATION:
      // Verify that this tally update was emitted by an authorized Director
      const isAuthorizedDirector =
        message.senderRole === 'director' ||
        payload.senderRole === 'director';

      if (!isAuthorizedDirector) {
        console.warn(
          `[IntercomContext] REJECTED unauthorized TALLY_UPDATE from ${message.senderName || message.senderId} (${message.senderRole || 'unknown'})`
        );
        return;
      }

      console.log(
        `[IntercomContext] Authoritative TALLY_UPDATE received from Director (${message.senderName || message.senderId}): PGM=${payload.activeProgramCamera}, PVW=${payload.activePreviewCamera}`
      );

      if (payload.activeProgramCamera !== undefined) {
        setActiveProgramCamera(payload.activeProgramCamera);
      }
      if (payload.activePreviewCamera !== undefined) {
        setActivePreviewCamera(payload.activePreviewCamera);
      }
    });

    // Handle new peer arrival in the room
    const unsubJoined = signalingService.on<UserJoinedPayload>('USER_JOINED', (payload, message) => {
      if (!payload.user) return;
      const newUser = payload.user;

      setParticipantsList((prevList) => {
        const exists = prevList.some((p) => p.id === newUser.id);
        if (exists) {
          return prevList.map((p) => (p.id === newUser.id ? newUser : p));
        }
        return [...prevList, newUser];
      });

      // Reciprocal sync: Announce our presence back to newly joined tab
      const current = currentUserRef.current;
      if (!payload.isSyncReply && current && message.senderId !== current.id) {
        signalingService.send<UserJoinedPayload>('USER_JOINED', {
          user: current,
          isSyncReply: true,
        });

        // If this device is the Director, synchronize current tally state immediately
        if (current.role === 'director') {
          const pgm = activeProgramCameraRef.current;
          const pvw = activePreviewCameraRef.current;
          signalingService.send<TallyUpdatePayload>('TALLY_UPDATE', {
            cameraId: pgm || pvw || '',
            state: pgm ? 'PROGRAM' : pvw ? 'PREVIEW' : 'IDLE',
            activeProgramCamera: pgm,
            activePreviewCamera: pvw,
            senderRole: 'director',
            directorId: current.id,
          });
        }
      }
    });

    // Handle peer departure
    const unsubLeft = signalingService.on<UserLeftPayload>('USER_LEFT', (payload) => {
      setParticipantsList((prevList) => prevList.filter((p) => p.id !== payload.userId));

      if (payload.cameraId) {
        setActiveProgramCamera((prev) => (prev === payload.cameraId ? null : prev));
        setActivePreviewCamera((prev) => (prev === payload.cameraId ? null : prev));
      }
    });

    // Handle remote mute command from Director (supports MUTE_REMOTE_OPERATOR and REMOTE_MUTE_TOGGLE)
    const handleRemoteMuteEvent = (payload: any, message: any) => {
      const isAuthorizedDirector =
        message.senderRole === 'director' ||
        payload?.senderRole === 'director';

      if (!isAuthorizedDirector) {
        console.warn(
          `[IntercomContext] REJECTED unauthorized remote mute from ${message.senderName || message.senderId}`
        );
        return;
      }

      const targetId = payload?.targetUserId || payload?.targetId;
      const rawCam = payload?.targetCameraId || payload?.targetCamera || payload?.cameraId;
      const targetCam = rawCam !== undefined && rawCam !== null
        ? (rawCam.toString().startsWith('cam') ? rawCam.toString() : `cam${rawCam}`)
        : undefined;
      const shouldMute = payload?.forceMute !== undefined
        ? Boolean(payload.forceMute)
        : (payload?.mute !== undefined ? Boolean(payload.mute) : true);

      console.log(
        `[IntercomContext] Authoritative remote mute event received: target=${targetId || targetCam}, forceMute=${shouldMute}`
      );

      // Update in local roster immediately
      setParticipantsList((prevList) =>
        prevList.map((p) => {
          if ((targetId && p.id === targetId) || (targetCam && p.cameraId === targetCam)) {
            return { ...p, isMuted: shouldMute };
          }
          return p;
        })
      );

      // If targeted to this camera device
      const current = currentUserRef.current;
      if (
        current &&
        ((targetId && current.id === targetId) ||
         (targetCam && current.cameraId === targetCam))
      ) {
        if (shouldMute) {
          setIsMutedByDirector(true);
          setCurrentUser((prev) => (prev ? { ...prev, isMuted: true } : null));
          webrtcAudioService.setMicEnabled(false);
        } else {
          setIsMutedByDirector(false);
          setCurrentUser((prev) => (prev ? { ...prev, isMuted: false } : null));
          webrtcAudioService.setMicEnabled(true);
        }
      }
    };

    const unsubMute = signalingService.on('MUTE_REMOTE_OPERATOR', handleRemoteMuteEvent);
    const unsubMuteToggle = signalingService.on('REMOTE_MUTE_TOGGLE', handleRemoteMuteEvent);

    return () => {
      unsubStatus();
      unsubTally();
      unsubJoined();
      unsubLeft();
      unsubMute();
      unsubMuteToggle();
    };
  }, []);

  /**
   * Starts WebRTC audio call manually
   */
  const startAudioCall = useCallback(async (rId: string, uId: string) => {
    return await webrtcAudioService.startAudioCall(rId, uId);
  }, []);

  /**
   * Ends WebRTC audio call and releases hardware
   */
  const endAudioCall = useCallback(async () => {
    await webrtcAudioService.endAudioCall();
  }, []);

  /**
   * Toggles microphone transmission state
   */
  const setMicEnabled = useCallback((enabled: boolean) => {
    webrtcAudioService.setMicEnabled(enabled);
  }, []);

  /**
   * Joins an intercom room with the given participant profile.
   * Initializes audio session for background playback, connects signaling, and starts mesh WebRTC voice call.
   */
  const joinRoom = useCallback(async (roomId: string, user: Participant, signalingUrl?: string) => {
    const cleanRoomId = normalizeRoomId(roomId);

    // 1. Enter room immediately: synchronously set room & user so screen transitions without delay
    setCurrentRoomId(cleanRoomId);
    setCurrentUser(user);

    setParticipantsList((prevList) => {
      const exists = prevList.some((p) => p.id === user.id);
      if (exists) {
        return prevList.map((p) => (p.id === user.id ? user : p));
      }
      return [...prevList, user];
    });

    // 2. Non-blocking audio session initialization
    try {
      initAudioSession().catch(() => {});
    } catch {}

    // 3. Connect to real-time pub/sub signaling server & BroadcastChannel
    try {
      await signalingService.connect(cleanRoomId, user, signalingUrl);
    } catch (sigErr) {
      console.warn('[IntercomContext] Signaling connection error during join:', sigErr);
    }

    // 4. Background WebRTC audio initialization (NEVER blocks screen transition or Tally UI)
    (async () => {
      try {
        console.log(`[IntercomContext] Starting background WebRTC audio initialization for room "${cleanRoomId}"...`);
        await webrtcAudioService.startAudioCall(cleanRoomId, user.id);
        webrtcAudioService.setMicEnabled(!user.isMuted);
      } catch (audioErr) {
        console.warn('[IntercomContext] WebRTC background start warning:', audioErr);
      }
    })();
  }, []);

  /**
   * Leaves the current room, clears active tally assignments, broadcasts departure, and disconnects voice & signaling.
   */
  const leaveRoom = useCallback(async () => {
    const user = currentUserRef.current;
    if (user) {
      signalingService.send<UserLeftPayload>('USER_LEFT', {
        userId: user.id,
        cameraId: user.cameraId,
      });
    }

    signalingService.disconnect();
    await webrtcAudioService.endAudioCall();
    await stopAllTones();

    if (overlapTimerRef.current) {
      clearTimeout(overlapTimerRef.current);
      overlapTimerRef.current = null;
    }
    setIsProgramOverlap(false);
    previousProgramCameraRef.current = null;

    setCurrentUser(null);
    setCurrentRoomId(null);
    setActivePreviewCamera(null);
    setActiveProgramCamera(null);
    setParticipantsList([]);
    setConnectionStatus('disconnected');
    setIsMutedByDirector(false);
  }, []);

  /**
   * Log in user with email for 30-day persistent session.
   */
  const loginWithEmail = useCallback((email: string) => {
    const session = authService.login(email);
    setAuthSession(session);
    return session;
  }, []);

  /**
   * Clear session from localStorage, leave room, and return to login gate.
   */
  const logoutEmail = useCallback(() => {
    authService.logout();
    setAuthSession(null);
    leaveRoom().catch(() => {});
  }, [leaveRoom]);

  /**
   * Sets the active preview camera (only one camera can be in preview at a time).
   * STRICT DIRECTOR AUTHORITY: Only Director role can set preview camera.
   * Immediately broadcasts TALLY_UPDATE event to all connected peers.
   */
  const setPreviewCamera = useCallback(
    (cameraId: string | null) => {
      const user = currentUserRef.current;
      if (user?.role !== 'director') {
        console.warn('[IntercomContext] Unauthorized: Only director can set preview camera');
        return;
      }

      setActivePreviewCamera(cameraId);

      signalingService.send<TallyUpdatePayload>('TALLY_UPDATE', {
        cameraId: cameraId || '',
        state: cameraId ? 'PREVIEW' : 'IDLE',
        activePreviewCamera: cameraId,
        activeProgramCamera: activeProgramCameraRef.current,
        senderRole: 'director',
        directorId: user.id,
      });
    },
    []
  );

  /**
   * Sets the active program camera (only one camera can be on program/live at a time).
   * STRICT DIRECTOR AUTHORITY: Only Director role can cut to program.
   * Automatically cuts previous program camera, and clears preview if that camera was on preview.
   * Immediately broadcasts TALLY_UPDATE event to all connected peers.
   */
  const setProgramCamera = useCallback(
    (cameraId: string | null) => {
      const user = currentUserRef.current;
      if (user?.role !== 'director') {
        console.warn('[IntercomContext] Unauthorized: Only director can set program camera');
        return;
      }

      const currentPreview = activePreviewCameraRef.current;
      const nextPreview = currentPreview === cameraId ? null : currentPreview;

      setActiveProgramCamera(cameraId);
      if (currentPreview === cameraId) {
        setActivePreviewCamera(null);
      }

      signalingService.send<TallyUpdatePayload>('TALLY_UPDATE', {
        cameraId: cameraId || '',
        state: cameraId ? 'PROGRAM' : 'IDLE',
        activeProgramCamera: cameraId,
        activePreviewCamera: nextPreview,
        senderRole: 'director',
        directorId: user.id,
      });
    },
    []
  );

  /**
   * Remote Mute Control strictly reserved for the Director role.
   * Sends MUTE_REMOTE_OPERATOR to target participant / camera.
   */
  const muteRemoteOperator = useCallback(
    (targetUserId: string, targetCameraId?: string, mute = true) => {
      const user = currentUserRef.current;
      if (user?.role !== 'director') {
        console.warn('[IntercomContext] Unauthorized: Only director can mute remote operators');
        return;
      }

      // Update local presence roster immediately
      setParticipantsList((prevList) =>
        prevList.map((p) => {
          if (p.id === targetUserId || (targetCameraId && p.cameraId === targetCameraId)) {
            return { ...p, isMuted: mute };
          }
          return p;
        })
      );

      const num = targetCameraId ? parseInt(targetCameraId.replace(/\D/g, ''), 10) : undefined;

      // Broadcast remote mute command across signaling (REMOTE_MUTE_TOGGLE + MUTE_REMOTE_OPERATOR)
      signalingService.send('REMOTE_MUTE_TOGGLE', {
        targetCamera: num !== undefined ? num : targetCameraId,
        targetCameraId,
        targetUserId,
        forceMute: mute,
        mute,
        senderRole: 'director',
        directorId: user.id,
      });

      signalingService.send<MuteRemoteOperatorPayload>('MUTE_REMOTE_OPERATOR', {
        targetUserId,
        targetCameraId,
        mute,
        senderRole: 'director',
        directorId: user.id,
      });
    },
    []
  );

  /**
   * Toggles the current participant's microphone mute status.
   * Immediately updates WebRTC hardware audio track transmission.
   */
  const toggleMute = useCallback(() => {
    setCurrentUser((prev) => {
      if (!prev) return null;
      const nextMuted = !prev.isMuted;
      const updatedUser: Participant = {
        ...prev,
        isMuted: nextMuted,
      };

      if (!nextMuted) {
        setIsMutedByDirector(false);
      }

      // Toggle outgoing WebRTC audio track
      webrtcAudioService.setMicEnabled(!nextMuted);

      setParticipantsList((list) =>
        list.map((p) => (p.id === prev.id ? updatedUser : p))
      );

      return updatedUser;
    });
  }, []);

  const value: IntercomContextType = useMemo(
    () => ({
      currentUser,
      currentRoomId,
      activePreviewCamera,
      activeProgramCamera,
      participantsList,
      currentTallyState,
      isProgramOverlap,
      connectionStatus,
      isMuted: currentUser?.isMuted ?? false,
      isMutedByDirector,
      isDirector: currentUser?.role === 'director',
      isCamera: currentUser?.role === 'camera',
      joinRoom,
      leaveRoom,
      setPreviewCamera,
      setProgramCamera,
      muteRemoteOperator,
      toggleMute,
      setParticipantsList,
      startAudioCall,
      endAudioCall,
      setMicEnabled,
      authSession,
      loginWithEmail,
      logoutEmail,
    }),
    [
      currentUser,
      currentRoomId,
      activePreviewCamera,
      activeProgramCamera,
      participantsList,
      currentTallyState,
      isProgramOverlap,
      connectionStatus,
      isMutedByDirector,
      joinRoom,
      leaveRoom,
      setPreviewCamera,
      setProgramCamera,
      muteRemoteOperator,
      toggleMute,
      startAudioCall,
      endAudioCall,
      setMicEnabled,
      authSession,
      loginWithEmail,
      logoutEmail,
    ]
  );

  return <IntercomContext.Provider value={value}>{children}</IntercomContext.Provider>;
};

/**
 * Custom hook to access the Intercom context.
 * Throws an error if used outside an IntercomProvider.
 */
export const useIntercom = (): IntercomContextType => {
  const context = useContext(IntercomContext);
  if (!context) {
    throw new Error('useIntercom must be used within an IntercomProvider');
  }
  return context;
};

export default IntercomContext;
