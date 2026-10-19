import { Audio, InterruptionModeIOS, InterruptionModeAndroid, AVPlaybackStatus } from 'expo-av';

// Audio asset paths for Preview and Program tones
const PREVIEW_SOUND_ASSET = require('../assets/sounds/preview.wav');
const PROGRAM_SOUND_ASSET = require('../assets/sounds/program.wav');

export type TallyState = 'IDLE' | 'PREVIEW' | 'PROGRAM';

export interface TallyVolumeConfig {
  previewVolume: number; // 0.0 to 1.0 (subtle beep)
  programVolume: number; // 0.0 to 1.0 (non-intrusive loop)
}

const DEFAULT_VOLUMES: TallyVolumeConfig = {
  // Boosted by +1.5 dB (factor 1.1885): 0.5 -> 0.5943
  previewVolume: 0.5943,
  // Boosted by +1.5 dB (factor 1.1885): 0.15 -> 0.1783
  programVolume: 0.1783,
};

/**
 * TallySoundService
 * Dedicated audio service for acoustic tally feedback in live broadcast environments.
 * Manages background audio session, distinct Preview & Program acoustic states,
 * volume calibration, and safe native resource lifecycle.
 */
export class TallySoundService {
  private previewSound: Audio.Sound | null = null;
  private programSound: Audio.Sound | null = null;
  private isAudioSessionReady = false;
  private currentState: TallyState = 'IDLE';

  private previewVolume = DEFAULT_VOLUMES.previewVolume;
  private programVolume = DEFAULT_VOLUMES.programVolume;

  private isInitializingSession = false;
  private isProcessingProgram = false;
  private previewGeneration = 0;
  private previewSequenceTimeouts: any[] = [];

  private cancelPreviewSequence() {
    this.previewGeneration++;
    for (const t of this.previewSequenceTimeouts) {
      clearTimeout(t);
    }
    this.previewSequenceTimeouts = [];
    if (this.previewSound) {
      this.previewSound.stopAsync().catch(() => {});
    }
  }

  /**
   * Initializes the native mobile audio session optimized for live intercom communication.
   * - Stays active in silent mode (iOS)
   * - Allows mixing with other apps so incoming voice communications aren't muted
   * - Enables background audio playback
   */
  async initAudioSession(): Promise<boolean> {
    if (this.isAudioSessionReady) {
      return true;
    }

    if (this.isInitializingSession) {
      return false;
    }

    this.isInitializingSession = true;

    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
        allowsRecordingIOS: false,
        shouldDuckAndroid: false, // Prevents cutting/ducking incoming intercom director speech
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        playThroughEarpieceAndroid: false,
      });

      this.isAudioSessionReady = true;
      return true;
    } catch (error) {
      console.warn('[TallySoundService] Error initializing audio session:', error);
      return false;
    } finally {
      this.isInitializingSession = false;
    }
  }

  /**
   * Initializes and unlocks the audio session on user gesture.
   */
  async unlockAudioSession(): Promise<boolean> {
    return this.initAudioSession();
  }

  /**
   * Prepares and loads the Preview sound instance if not already loaded.
   */
  private async loadPreviewSound(): Promise<Audio.Sound | null> {
    if (this.previewSound) {
      try {
        const status = await this.previewSound.getStatusAsync();
        if (status.isLoaded) {
          return this.previewSound;
        }
      } catch {
        this.previewSound = null;
      }
    }

    try {
      const { sound } = await Audio.Sound.createAsync(
        PREVIEW_SOUND_ASSET,
        {
          shouldPlay: false,
          isLooping: false,
          volume: this.previewVolume,
        },
        this.onPreviewStatusUpdate
      );
      this.previewSound = sound;
      return sound;
    } catch (error) {
      console.warn('[TallySoundService] Failed to load preview sound:', error);
      return null;
    }
  }

  /**
   * Prepares and loads the Program sound loop instance if not already loaded.
   */
  private async loadProgramSound(): Promise<Audio.Sound | null> {
    if (this.programSound) {
      try {
        const status = await this.programSound.getStatusAsync();
        if (status.isLoaded) {
          return this.programSound;
        }
      } catch {
        this.programSound = null;
      }
    }

    try {
      const { sound } = await Audio.Sound.createAsync(
        PROGRAM_SOUND_ASSET,
        {
          shouldPlay: false,
          isLooping: true,
          volume: this.programVolume,
        }
      );
      this.programSound = sound;
      return sound;
    } catch (error) {
      console.warn('[TallySoundService] Failed to load program sound:', error);
      return null;
    }
  }

  private onPreviewStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded && status.didJustFinish) {
      if (this.currentState === 'PREVIEW' && this.previewSequenceTimeouts.length === 0) {
        this.currentState = 'IDLE';
      }
    }
  };

  /**
   * Plays the Preview Tone (PREVIEW).
   * Plays an acoustic sequence of exactly three subtle, distinct pulses ("pip - pip - pip"):
   * - 80ms tone, 120ms silence, repeated 3 times, then stops completely.
   * - Gracefully cancels any ongoing preview loop to prevent overlapping or distortion.
   */
  async playPreviewTone(): Promise<void> {
    this.cancelPreviewSequence();
    const currentGen = ++this.previewGeneration;

    try {
      await this.initAudioSession();

      // If program tone is currently looping, stop it when transitioning to preview
      if (this.currentState === 'PROGRAM') {
        await this.stopProgramTone();
      }

      const sound = await this.loadPreviewSound();
      if (!sound) return;

      this.currentState = 'PREVIEW';
      await sound.setVolumeAsync(this.previewVolume);

      // Pulse 1: 0ms to 80ms
      await sound.replayAsync({
        shouldPlay: true,
        isLooping: false,
        positionMillis: 0,
      });

      const t1 = setTimeout(async () => {
        if (this.previewGeneration !== currentGen || this.currentState !== 'PREVIEW') return;
        try { await sound.stopAsync(); } catch {}
      }, 80);
      this.previewSequenceTimeouts.push(t1);

      // Pulse 2: 200ms to 280ms (120ms silence)
      const t2Start = setTimeout(async () => {
        if (this.previewGeneration !== currentGen || this.currentState !== 'PREVIEW') return;
        try {
          await sound.replayAsync({
            shouldPlay: true,
            isLooping: false,
            positionMillis: 0,
          });
        } catch {}
      }, 200);
      this.previewSequenceTimeouts.push(t2Start);

      const t2Stop = setTimeout(async () => {
        if (this.previewGeneration !== currentGen || this.currentState !== 'PREVIEW') return;
        try { await sound.stopAsync(); } catch {}
      }, 280);
      this.previewSequenceTimeouts.push(t2Stop);

      // Pulse 3: 400ms to 480ms (120ms silence)
      const t3Start = setTimeout(async () => {
        if (this.previewGeneration !== currentGen || this.currentState !== 'PREVIEW') return;
        try {
          await sound.replayAsync({
            shouldPlay: true,
            isLooping: false,
            positionMillis: 0,
          });
        } catch {}
      }, 400);
      this.previewSequenceTimeouts.push(t3Start);

      const t3Stop = setTimeout(async () => {
        if (this.previewGeneration !== currentGen || this.currentState !== 'PREVIEW') return;
        try { await sound.stopAsync(); } catch {}
      }, 480);
      this.previewSequenceTimeouts.push(t3Stop);

      // Complete sequence
      const tEnd = setTimeout(() => {
        if (this.previewGeneration !== currentGen) return;
        if (this.currentState === 'PREVIEW') {
          this.currentState = 'IDLE';
        }
        this.cancelPreviewSequence();
      }, 500);
      this.previewSequenceTimeouts.push(tEnd);

    } catch (error) {
      console.warn('[TallySoundService] Error playing preview tone sequence:', error);
    }
  }

  /**
   * Starts the Live/Program Tone (PROGRAM).
   * A continuous, low-volume, non-intrusive tone loop designed to let the camera know they are live/on air
   * without overpowering incoming director speech.
   */
  async startProgramTone(): Promise<void> {
    if (this.isProcessingProgram) return;
    this.isProcessingProgram = true;

    try {
      await this.initAudioSession();

      // Stop preview beep if it was playing
      await this.stopPreviewTone();

      const sound = await this.loadProgramSound();
      if (!sound) return;

      const status = await sound.getStatusAsync();
      if (status.isLoaded) {
        await sound.setVolumeAsync(this.programVolume);
        await sound.setIsLoopingAsync(true);

        if (!status.isPlaying) {
          await sound.playFromPositionAsync(0);
        }
      }

      this.currentState = 'PROGRAM';
    } catch (error) {
      console.warn('[TallySoundService] Error starting program tone:', error);
    } finally {
      this.isProcessingProgram = false;
    }
  }

  /**
   * Stops the continuous Program tone loop if running.
   */
  async stopProgramTone(): Promise<void> {
    try {
      if (this.programSound) {
        const status = await this.programSound.getStatusAsync();
        if (status.isLoaded && status.isPlaying) {
          await this.programSound.stopAsync();
        }
      }
      if (this.currentState === 'PROGRAM') {
        this.currentState = 'IDLE';
      }
    } catch (error) {
      console.warn('[TallySoundService] Error stopping program tone:', error);
    }
  }

  /**
   * Stops the Preview tone if active.
   */
  async stopPreviewTone(): Promise<void> {
    this.cancelPreviewSequence();
    try {
      if (this.previewSound) {
        const status = await this.previewSound.getStatusAsync();
        if (status.isLoaded && status.isPlaying) {
          await this.previewSound.stopAsync();
        }
      }
      if (this.currentState === 'PREVIEW') {
        this.currentState = 'IDLE';
      }
    } catch (error) {
      console.warn('[TallySoundService] Error stopping preview tone:', error);
    }
  }

  /**
   * Stops all active tally tones immediately (both preview pulse and program loop).
   */
  async stopAllTones(): Promise<void> {
    await Promise.allSettled([
      this.stopProgramTone(),
      this.stopPreviewTone(),
    ]);
    this.currentState = 'IDLE';
  }

  /**
   * Calibrates the Preview Tone volume.
   * @param volume Level between 0.0 (silent) and 1.0 (max)
   */
  async setPreviewVolume(volume: number): Promise<void> {
    const clamped = Math.max(0.0, Math.min(1.0, volume));
    this.previewVolume = clamped;

    if (this.previewSound) {
      try {
        const status = await this.previewSound.getStatusAsync();
        if (status.isLoaded) {
          await this.previewSound.setVolumeAsync(clamped);
        }
      } catch (error) {
        console.warn('[TallySoundService] Error setting preview volume:', error);
      }
    }
  }

  /**
   * Calibrates the Program Tone volume.
   * Immediately updates volume if the loop is currently playing live.
   * @param volume Level between 0.0 (silent) and 1.0 (max)
   */
  async setProgramVolume(volume: number): Promise<void> {
    const clamped = Math.max(0.0, Math.min(1.0, volume));
    this.programVolume = clamped;

    if (this.programSound) {
      try {
        const status = await this.programSound.getStatusAsync();
        if (status.isLoaded) {
          await this.programSound.setVolumeAsync(clamped);
        }
      } catch (error) {
        console.warn('[TallySoundService] Error setting program volume:', error);
      }
    }
  }

  /**
   * Retrieves current volume configuration.
   */
  getVolumeSettings(): TallyVolumeConfig {
    return {
      previewVolume: this.previewVolume,
      programVolume: this.programVolume,
    };
  }

  /**
   * Returns the current tally audio state.
   */
  getCurrentState(): TallyState {
    return this.currentState;
  }

  /**
   * Safely unloads and releases all native audio resources.
   * Useful when disposing the service or unmounting the screen/app.
   */
  async dispose(): Promise<void> {
    try {
      await this.stopAllTones();

      if (this.previewSound) {
        await this.previewSound.unloadAsync();
        this.previewSound = null;
      }

      if (this.programSound) {
        await this.programSound.unloadAsync();
        this.programSound = null;
      }

      this.isAudioSessionReady = false;
      this.currentState = 'IDLE';
    } catch (error) {
      console.warn('[TallySoundService] Error disposing sound resources:', error);
    }
  }
}

// Global service instance
export const tallySoundService = new TallySoundService();

// Clean, direct control exports as requested
export const initAudioSession = (): Promise<boolean> => tallySoundService.initAudioSession();
export const unlockAudioSession = (): Promise<boolean> => tallySoundService.unlockAudioSession();
export const playPreviewTone = (): Promise<void> => tallySoundService.playPreviewTone();
export const startProgramTone = (): Promise<void> => tallySoundService.startProgramTone();
export const stopAllTones = (): Promise<void> => tallySoundService.stopAllTones();
export const stopProgramTone = (): Promise<void> => tallySoundService.stopProgramTone();
export const stopPreviewTone = (): Promise<void> => tallySoundService.stopPreviewTone();
export const setPreviewVolume = (volume: number): Promise<void> => tallySoundService.setPreviewVolume(volume);
export const setProgramVolume = (volume: number): Promise<void> => tallySoundService.setProgramVolume(volume);
export const disposeTallySounds = (): Promise<void> => tallySoundService.dispose();

export default tallySoundService;
