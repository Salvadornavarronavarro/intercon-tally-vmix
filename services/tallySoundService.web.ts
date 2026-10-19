export type TallyState = 'IDLE' | 'PREVIEW' | 'PROGRAM';

export interface TallyVolumeConfig {
  previewVolume: number; // 0.0 to 1.0 (subtle beep)
  programVolume: number; // 0.0 to 1.0 (non-intrusive loop)
}

const DEFAULT_VOLUMES: TallyVolumeConfig = {
  // Boosted by +1.5 dB (linear factor 10^(1.5 / 20) ≈ 1.1885): 0.45 -> ~0.5348
  previewVolume: 0.5348,
  // Boosted by +1.5 dB (linear factor 10^(1.5 / 20) ≈ 1.1885): 0.15 -> ~0.1783
  programVolume: 0.1783,
};

/**
 * WebTallySoundService (Web Platform Implementation)
 * Uses high-performance, zero-latency Web Audio API (OscillatorNode & GainNode)
 * to synthesize pristine preview beeps and continuous program on-air loops.
 */
export class WebTallySoundService {
  private audioCtx: AudioContext | null = null;
  private programOscillator: OscillatorNode | null = null;
  private programGainNode: GainNode | null = null;

  // Dedicated preview sequence references
  private previewOscillator: OscillatorNode | null = null;
  private previewGainNode: GainNode | null = null;
  private previewTimeoutId: any = null;

  private currentState: TallyState = 'IDLE';

  private previewVolume = DEFAULT_VOLUMES.previewVolume;
  private programVolume = DEFAULT_VOLUMES.programVolume;

  private isAudioSessionReady = false;

  private getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * Initializes / unlocks the browser Web Audio context
   */
  async initAudioSession(): Promise<boolean> {
    try {
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume().catch((err) => {
          console.warn('[WebTallySoundService] Note: AudioContext resume waiting for user interaction:', err);
        });
      }
      this.isAudioSessionReady = ctx.state === 'running';
      return this.isAudioSessionReady;
    } catch (error) {
      console.warn('[WebTallySoundService] Error initializing Web Audio Context:', error);
      return false;
    }
  }

  /**
   * Unlocks Web Audio API explicitly on direct user interaction (e.g. Enter Intercom button).
   * Fully satisfies iPadOS / iOS / macOS Safari autoplay policies by playing a 1-sample silent buffer.
   */
  async unlockAudioSession(): Promise<boolean> {
    try {
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume().catch((err) => {
          console.warn('[WebTallySoundService] AudioContext resume failed:', err);
        });
      }
      try {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch {}
      this.isAudioSessionReady = ctx.state === 'running';
      return this.isAudioSessionReady;
    } catch (error) {
      console.warn('[WebTallySoundService] Error unlocking audio session:', error);
      return false;
    }
  }

  /**
   * Plays the Preview Tone (PREVIEW).
   * Plays an acoustic sequence of exactly three subtle, distinct pulses ("pip - pip - pip"):
   * - 80ms tone, 120ms silence, repeated 3 times, then stops completely.
   * - 960Hz sine frequency stands out cleanly from the 441Hz program drone.
   * - Smooth anti-click attack/decay envelopes.
   * - Immediately cancels any previous ongoing preview sequence to prevent overlap.
   */
  async playPreviewTone(): Promise<void> {
    try {
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // If program tone is looping, stop it when transitioning to preview
      if (this.currentState === 'PROGRAM') {
        await this.stopProgramTone();
      }

      // Cancel any ongoing preview sequence before scheduling a new one
      await this.stopPreviewTone();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(960, ctx.currentTime);

      const t0 = ctx.currentTime + 0.005; // 5ms audio thread buffer
      const toneDuration = 0.080; // 80ms tone
      const silenceDuration = 0.120; // 120ms silence
      const cycle = toneDuration + silenceDuration; // 200ms per pip cycle

      // Baseline silence before sequence starts
      gain.gain.setValueAtTime(0.0001, t0);

      // Schedule exactly three "pip" pulses
      for (let i = 0; i < 3; i++) {
        const pStart = t0 + i * cycle;
        const pAttack = pStart + 0.008; // 8ms linear attack to prevent clicks
        const pSustainEnd = pStart + 0.068;
        const pDecayEnd = pStart + 0.080; // 12ms exponential decay to silence

        gain.gain.setValueAtTime(0.0001, pStart);
        gain.gain.linearRampToValueAtTime(this.previewVolume, pAttack);
        gain.gain.setValueAtTime(this.previewVolume, pSustainEnd);
        gain.gain.exponentialRampToValueAtTime(0.0001, pDecayEnd);
        gain.gain.setValueAtTime(0.0001, pDecayEnd);
      }

      osc.connect(gain);
      gain.connect(ctx.destination);

      const totalSequenceDuration = 2 * cycle + toneDuration + 0.010; // ~490ms total
      osc.start(t0);
      osc.stop(t0 + totalSequenceDuration);

      this.previewOscillator = osc;
      this.previewGainNode = gain;
      this.currentState = 'PREVIEW';

      // Automatically clean up after the 3-pulse sequence completes
      this.previewTimeoutId = setTimeout(() => {
        if (this.previewOscillator === osc) {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch {}
          this.previewOscillator = null;
          this.previewGainNode = null;
        }
        if (this.currentState === 'PREVIEW') {
          this.currentState = 'IDLE';
        }
        this.previewTimeoutId = null;
      }, Math.ceil(totalSequenceDuration * 1000) + 30);
    } catch (error) {
      console.warn('[WebTallySoundService] Error playing preview tone:', error);
    }
  }

  /**
   * Starts the Live/Program Tone (PROGRAM).
   * A continuous, low-volume, non-intrusive 441Hz sine wave loop.
   */
  async startProgramTone(): Promise<void> {
    try {
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Stop any preview tone sequence immediately
      await this.stopPreviewTone();

      if (this.programOscillator && this.programGainNode) {
        // Already running, ensure volume is updated
        this.programGainNode.gain.setValueAtTime(this.programVolume, ctx.currentTime);
        this.currentState = 'PROGRAM';
        return;
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(441, ctx.currentTime);

      const now = ctx.currentTime;
      // Smooth 50ms fade-in to prevent clicks
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(this.programVolume, now + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);

      this.programOscillator = osc;
      this.programGainNode = gain;
      this.currentState = 'PROGRAM';
    } catch (error) {
      console.warn('[WebTallySoundService] Error starting program tone:', error);
    }
  }

  /**
   * Stops the continuous Program tone loop with a smooth 40ms fade-out.
   */
  async stopProgramTone(): Promise<void> {
    try {
      if (this.programOscillator && this.programGainNode && this.audioCtx) {
        const now = this.audioCtx.currentTime;
        this.programGainNode.gain.cancelScheduledValues(now);
        this.programGainNode.gain.setValueAtTime(this.programVolume, now);
        this.programGainNode.gain.linearRampToValueAtTime(0.0001, now + 0.04);
        
        const osc = this.programOscillator;
        const gain = this.programGainNode;
        this.programOscillator = null;
        this.programGainNode = null;

        setTimeout(() => {
          try {
            osc.stop();
          } catch {}
          try {
            osc.disconnect();
          } catch {}
          try {
            gain.disconnect();
          } catch {}
        }, 50);
      }
      if (this.currentState === 'PROGRAM') {
        this.currentState = 'IDLE';
      }
    } catch (error) {
      console.warn('[WebTallySoundService] Error stopping program tone:', error);
    }
  }

  /**
   * Stops the Preview tone if active and cleans up scheduled audio automations.
   */
  async stopPreviewTone(): Promise<void> {
    if (this.previewTimeoutId) {
      clearTimeout(this.previewTimeoutId);
      this.previewTimeoutId = null;
    }

    if (this.previewOscillator && this.audioCtx) {
      try {
        const now = this.audioCtx.currentTime;
        if (this.previewGainNode) {
          this.previewGainNode.gain.cancelScheduledValues(now);
          this.previewGainNode.gain.setValueAtTime(0.0001, now);
          this.previewGainNode.disconnect();
        }
        this.previewOscillator.stop(now);
        this.previewOscillator.disconnect();
      } catch {}
      this.previewOscillator = null;
      this.previewGainNode = null;
    }

    if (this.currentState === 'PREVIEW') {
      this.currentState = 'IDLE';
    }
  }

  /**
   * Stops all active tally tones immediately.
   */
  async stopAllTones(): Promise<void> {
    await Promise.allSettled([this.stopProgramTone(), this.stopPreviewTone()]);
    this.currentState = 'IDLE';
  }

  /**
   * Calibrates Preview Tone volume (0.0 to 1.0).
   */
  async setPreviewVolume(volume: number): Promise<void> {
    this.previewVolume = Math.max(0.0, Math.min(1.0, volume));
  }

  /**
   * Calibrates Program Tone volume (0.0 to 1.0) with immediate live gain update.
   */
  async setProgramVolume(volume: number): Promise<void> {
    this.programVolume = Math.max(0.0, Math.min(1.0, volume));
    if (this.programGainNode && this.audioCtx) {
      this.programGainNode.gain.setValueAtTime(this.programVolume, this.audioCtx.currentTime);
    }
  }

  getVolumeSettings(): TallyVolumeConfig {
    return {
      previewVolume: this.previewVolume,
      programVolume: this.programVolume,
    };
  }

  getCurrentState(): TallyState {
    return this.currentState;
  }

  async dispose(): Promise<void> {
    await this.stopAllTones();
    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {}
      this.audioCtx = null;
    }
    this.isAudioSessionReady = false;
    this.currentState = 'IDLE';
  }
}

// Global service instance for Web
export const tallySoundService = new WebTallySoundService();

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
