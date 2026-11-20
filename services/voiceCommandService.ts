import { Platform } from 'react-native';
import { UserRole } from '../context/IntercomContext';

export interface ParsedVoiceCommand {
  type: 'PREVIEW' | 'PROGRAM' | 'FADE';
  cameraId?: string; // e.g. 'cam1' (optional for standalone FADE)
  cameraNumber?: number; // 1 to 8
  triggerWord: string;
  rawPhrase: string;
}

export interface VoiceCommandCallbacks {
  onCommand?: (command: ParsedVoiceCommand) => void;
  onTranscript?: (transcript: string, isFinal: boolean) => void;
  onStatusChange?: (isListening: boolean, error?: string | null) => void;
  onError?: (error: string) => void;
}

/**
 * Normalizes Spanish and English spoken number words (uno, dos, tres... / one, two, three...) to digits (1-8).
 */
export function normalizeTranscript(text: string): string {
  const numberWordMap: Record<string, string> = {
    // Spanish
    un: '1',
    uno: '1',
    una: '1',
    dos: '2',
    tres: '3',
    cuatro: '4',
    cinco: '5',
    seis: '6',
    siete: '7',
    ocho: '8',
    // English
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8',
  };

  return text.replace(
    /\b(uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|one|two|three|four|five|six|seven|eight)\b/gi,
    (matched) => numberWordMap[matched.toLowerCase()] || matched
  );
}

// Backward-compatible alias
export const normalizeSpanishTranscript = normalizeTranscript;

/**
 * Parses spoken Spanish and English text for Director Tally commands:
 *
 * 1. PREVIEW COMMANDS (Strict verb match):
 *    - Explicit action verbs: "preparado", "prepara", "preparada", "previo", "preview", "standby", "ready"
 *    - Matches: ("preparado" | "prepara" | "preparada" | "previo" | "preview" | "standby" | "ready") + ("cámara" | "cam" | "camera")? + [1-8]
 *    - Or suffix: ("cámara" | "cam" | "camera") + [1-8] + ("preparado" | "prepara" | "preparada" | "previo" | "preview")
 *    - Action: Set Preview camera (Green)
 *
 * 2. PROGRAM COMMANDS (Strict verb match):
 *    - Explicit action verbs: "dentro", "aire", "al aire", "vamos con", "pincha", "va", "corte", "cut", "take", "live"
 *    - Matches: ("dentro" | "aire" | "al aire" | "vamos con" | "pincha" | "va" | "corte" | "cut" | "take" | "live") + ("cámara" | "cam" | "camera")? + [1-8]
 *    - Or suffix: ("cámara" | "cam" | "camera") + [1-8] + ("dentro" | "aire" | "al aire" | "pincha" | "va" | "corte" | "cut" | "take" | "live")
 *    - Action: Switch to Program (Cut) with 2-second overlap (Red)
 *
 * 3. STANDALONE "cámara X" WITHOUT VERB:
 *    - Explicitly returns null to prevent accidental cuts!
 */
export function parseVoiceCommand(rawText: string): ParsedVoiceCommand | null {
  if (!rawText || typeof rawText !== 'string') return null;

  const normalized = normalizeTranscript(rawText.trim());

  // 1. FADE TRIGGERS WITH CAMERA NUMBER (e.g. "fundido cámara 1", "fundido a cámara 2", "hacer fundido cámara 3", "haz fundido a cámara 4")
  const fadeMatch1 = normalized.match(
    /\b(?:hacer\s+|haz\s+)?(fundido|fundir|disoluci[óo]n|fade)\s*(?:a\s+)?(?:de\s+)?(?:la\s+)?(?:c[áa]mara|camera|cam)?\s*([1-8])\b/i
  );
  if (fadeMatch1 && fadeMatch1[2]) {
    const num = parseInt(fadeMatch1[2], 10);
    if (num >= 1 && num <= 8) {
      return {
        type: 'FADE',
        cameraId: `cam${num}`,
        cameraNumber: num,
        triggerWord: fadeMatch1[1].toLowerCase(),
        rawPhrase: fadeMatch1[0].trim(),
      };
    }
  }

  // Suffix: e.g. "cámara 2 fundido", "cam 3 a fundido", "camera 4 fade"
  const fadeMatch2 = normalized.match(
    /\b(?:c[áa]mara|camera|cam)\s*([1-8])\s*(?:a\s+)?(fundido|fundir|disoluci[óo]n|fade)\b/i
  );
  if (fadeMatch2 && fadeMatch2[1]) {
    const num = parseInt(fadeMatch2[1], 10);
    if (num >= 1 && num <= 8) {
      return {
        type: 'FADE',
        cameraId: `cam${num}`,
        cameraNumber: num,
        triggerWord: fadeMatch2[2].toLowerCase(),
        rawPhrase: fadeMatch2[0].trim(),
      };
    }
  }

  // 2. PREVIEW TRIGGERS (Strict regex matching: preparado, prevenido, previo, preview...)
  // Prefix: e.g. "preparado cámara 1", "prevenido cámara 2", "prepara cam dos", "previo 3", "preview cam 4"
  const previewMatch1 = normalized.match(
    /\b(preparad[oa]|prepara|prevenid[oa]|previene|previo|preview|standby|ready)\s*(?:a\s+)?(?:la\s+)?(?:c[áa]mara|camera|cam)?\s*([1-8])\b/i
  );
  if (previewMatch1 && previewMatch1[2]) {
    const num = parseInt(previewMatch1[2], 10);
    if (num >= 1 && num <= 8) {
      return {
        type: 'PREVIEW',
        cameraId: `cam${num}`,
        cameraNumber: num,
        triggerWord: previewMatch1[1].toLowerCase(),
        rawPhrase: previewMatch1[0].trim(),
      };
    }
  }

  // Suffix: e.g. "cámara 2 preparada", "cámara 3 prevenida", "cam 3 previo", "camera 4 preview"
  const previewMatch2 = normalized.match(
    /\b(?:c[áa]mara|camera|cam)\s*([1-8])\s*(?:en\s+)?(preparad[oa]|prepara|prevenid[oa]|previene|previo|preview|standby|ready)\b/i
  );
  if (previewMatch2 && previewMatch2[1]) {
    const num = parseInt(previewMatch2[1], 10);
    if (num >= 1 && num <= 8) {
      return {
        type: 'PREVIEW',
        cameraId: `cam${num}`,
        cameraNumber: num,
        triggerWord: previewMatch2[2].toLowerCase(),
        rawPhrase: previewMatch2[0].trim(),
      };
    }
  }

  // 3. PROGRAM TRIGGERS (Strict regex matching: dentro, aire, vamos con, pincha, va, corte...)
  // Prefix: e.g. "dentro cámara 1", "aire cámara 2", "vamos con cámara 3", "pincha cámara 4", "corte 5"
  const programMatch1 = normalized.match(
    /\b(dentro|aire|al\s+aire|vamos\s+con|pincha|va|corte|cut|take|live)\s*(?:de\s+)?(?:la\s+)?(?:c[áa]mara|camera|cam)?\s*([1-8])\b/i
  );
  if (programMatch1 && programMatch1[2]) {
    const num = parseInt(programMatch1[2], 10);
    if (num >= 1 && num <= 8) {
      return {
        type: 'PROGRAM',
        cameraId: `cam${num}`,
        cameraNumber: num,
        triggerWord: programMatch1[1].toLowerCase(),
        rawPhrase: programMatch1[0].trim(),
      };
    }
  }

  // Suffix: e.g. "cámara 1 dentro", "cámara 2 al aire", "cámara 3 aire", "cam 4 pincha", "cam 5 va"
  const programMatch2 = normalized.match(
    /\b(?:c[áa]mara|camera|cam)\s*([1-8])\s*(?:a\s+)?(dentro|aire|al\s+aire|pincha|va|corte|cut|take|live)\b/i
  );
  if (programMatch2 && programMatch2[1]) {
    const num = parseInt(programMatch2[1], 10);
    if (num >= 1 && num <= 8) {
      return {
        type: 'PROGRAM',
        cameraId: `cam${num}`,
        cameraNumber: num,
        triggerWord: programMatch2[2].toLowerCase(),
        rawPhrase: programMatch2[0].trim(),
      };
    }
  }

  // 4. STANDALONE FADE TRIGGER (No camera number specified: "fundido", "hacer fundido", "haz fundido", "fade", "disolución")
  const standaloneFadeMatch = normalized.match(
    /\b(?:hacer\s+|haz\s+)?(fundido|fundir|disoluci[óo]n|fade)\b/i
  );
  if (standaloneFadeMatch) {
    return {
      type: 'FADE',
      triggerWord: standaloneFadeMatch[1].toLowerCase(),
      rawPhrase: standaloneFadeMatch[0].trim(),
    };
  }

  // Standalone "cámara X" without an explicit action verb: MUST NOT trigger cut or preview
  return null;
}

export interface VoiceRecognitionEngine {
  isSupported(): boolean;
  start(callbacks: VoiceCommandCallbacks): Promise<boolean>;
  stop(): Promise<void>;
}

/**
 * Web Speech API Engine (SpeechRecognition / webkitSpeechRecognition)
 * Configured for continuous recognition in Spanish ('es-ES').
 */
class WebSpeechEngine implements VoiceRecognitionEngine {
  private recognition: any = null;
  private isListening = false;
  private shouldBeListening = false;
  private restartTimeout: any = null;
  private pendingFadeTimeout: any = null;
  private callbacks: VoiceCommandCallbacks = {};
  private lastTriggeredKey = '';
  private lastTriggeredTime = 0;
  private visibilityListener: (() => void) | null = null;
  private focusListener: (() => void) | null = null;

  isSupported(): boolean {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    return !!SpeechRecognition;
  }

  private executeCommand(command: ParsedVoiceCommand): void {
    const commandKey = `${command.type}_${command.cameraId || 'standalone'}`;
    const now = Date.now();

    // Deduplicate identical triggers within 1200ms
    if (
      commandKey !== this.lastTriggeredKey ||
      now - this.lastTriggeredTime > 1200
    ) {
      this.lastTriggeredKey = commandKey;
      this.lastTriggeredTime = now;
      this.callbacks.onCommand?.(command);
    }
  }

  async start(callbacks: VoiceCommandCallbacks): Promise<boolean> {
    if (!this.isSupported()) {
      callbacks.onError?.('Web Speech API is not supported in this browser. Please use Chrome, Edge, or Safari.');
      callbacks.onStatusChange?.(false, 'Speech Recognition Unsupported');
      return false;
    }

    this.callbacks = callbacks;
    this.shouldBeListening = true;

    // Attach visibility and focus listeners for robust auto-recovery on iOS Safari
    if (typeof document !== 'undefined' && !this.visibilityListener) {
      this.visibilityListener = () => {
        if (document.visibilityState === 'visible' && this.shouldBeListening && !this.isListening) {
          try {
            this.recognition?.start();
          } catch {}
        }
      };
      document.addEventListener('visibilitychange', this.visibilityListener);
    }

    if (typeof window !== 'undefined' && !this.focusListener) {
      this.focusListener = () => {
        if (this.shouldBeListening && !this.isListening) {
          try {
            this.recognition?.start();
          } catch {}
        }
      };
      window.addEventListener('focus', this.focusListener);
    }

    try {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (!this.recognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = (typeof navigator !== 'undefined' && navigator.language && navigator.language.startsWith('en')) ? navigator.language : 'es-ES';
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
          this.isListening = true;
          this.callbacks.onStatusChange?.(true);
        };

        this.recognition.onresult = (event: any) => {
          let latestTranscript = '';
          let isFinal = false;

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            latestTranscript = transcript;
            if (event.results[i].isFinal) {
              isFinal = true;
            }
          }

          if (!latestTranscript) return;

          this.callbacks.onTranscript?.(latestTranscript, isFinal);

          // Evaluate command
          const command = parseVoiceCommand(latestTranscript);
          if (command) {
            // Defense against interim transcript overlap:
            // When saying "fundido cámara 2", the engine first emits an interim "fundido".
            // A standalone FADE must NOT fire immediately on partial interim speech if a camera number might follow.
            if (command.type === 'FADE' && !command.cameraId) {
              if (this.pendingFadeTimeout) {
                clearTimeout(this.pendingFadeTimeout);
              }
              if (isFinal) {
                this.executeCommand(command);
              } else {
                // Wait 400ms: if the user continues with "cámara X", this timer is canceled!
                this.pendingFadeTimeout = setTimeout(() => {
                  this.executeCommand(command);
                }, 400);
              }
            } else {
              // Camera-specific command arrived (PREVIEW, PROGRAM, or FADE with cameraId):
              // Cancel any pending standalone FADE and execute immediately
              if (this.pendingFadeTimeout) {
                clearTimeout(this.pendingFadeTimeout);
                this.pendingFadeTimeout = null;
              }
              this.executeCommand(command);
            }
          }
        };

        this.recognition.onerror = (event: any) => {
          if (event.error === 'no-speech') {
            // Normal silence timeout; ignore and keep listening
            return;
          }

          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            this.shouldBeListening = false;
            this.isListening = false;
            this.callbacks.onStatusChange?.(false, 'Microphone permission denied');
            this.callbacks.onError?.('Permiso de micrófono denegado para reconocimiento de voz.');
            return;
          }

          console.warn('[WebSpeechEngine] Speech recognition error:', event.error);
        };

        this.recognition.onend = () => {
          this.isListening = false;
          if (this.shouldBeListening) {
            // Hands-free continuous auto-restart with backoff guard
            if (this.restartTimeout) clearTimeout(this.restartTimeout);
            this.restartTimeout = setTimeout(() => {
              if (this.shouldBeListening) {
                try {
                  this.recognition.start();
                } catch {
                  // Ignore if already active
                }
              }
            }, 250);
          } else {
            this.callbacks.onStatusChange?.(false);
          }
        };
      }

      this.recognition.start();
      return true;
    } catch (err: any) {
      console.warn('[WebSpeechEngine] Start error:', err);
      // If already started or transitioning, handle gracefully
      if (err.name === 'InvalidStateError') {
        try {
          this.recognition?.abort();
        } catch {}
        setTimeout(() => {
          if (this.shouldBeListening) {
            try { this.recognition?.start(); } catch {}
          }
        }, 150);
        this.isListening = true;
        this.callbacks.onStatusChange?.(true);
        return true;
      }
      this.callbacks.onError?.(`Error al iniciar reconocimiento: ${err.message || err}`);
      return false;
    }
  }

  async stop(): Promise<void> {
    this.shouldBeListening = false;
    this.isListening = false;
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.pendingFadeTimeout) {
      clearTimeout(this.pendingFadeTimeout);
      this.pendingFadeTimeout = null;
    }
    if (this.visibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
    if (this.focusListener && typeof window !== 'undefined') {
      window.removeEventListener('focus', this.focusListener);
      this.focusListener = null;
    }
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        try {
          this.recognition.stop();
        } catch {}
      }
    }
    this.callbacks.onStatusChange?.(false);
  }
}

/**
 * Native Voice Recognition Engine Stub
 * Ready for @react-native-voice/voice integration on iOS and Android builds.
 */
class NativeVoiceEngine implements VoiceRecognitionEngine {
  isSupported(): boolean {
    return false; // Ready for react-native-voice on native builds
  }

  async start(callbacks: VoiceCommandCallbacks): Promise<boolean> {
    callbacks.onError?.(
      'Reconocimiento nativo: requiere módulo react-native-voice configurado en el build de producción.'
    );
    return false;
  }

  async stop(): Promise<void> {
    // Native stop placeholder
  }
}

/**
 * Dedicated Voice Command Service for the Director role.
 * Strictly isolates command execution to the Director role.
 */
export class VoiceCommandService {
  private engine: VoiceRecognitionEngine;
  private isListeningActive = false;

  constructor() {
    if (Platform.OS === 'web') {
      this.engine = new WebSpeechEngine();
    } else {
      this.engine = new NativeVoiceEngine();
    }
  }

  public isSupported(): boolean {
    return this.engine.isSupported();
  }

  public isListening(): boolean {
    return this.isListeningActive;
  }

  /**
   * Starts hands-free voice command recognition.
   * STRICT SECURITY: Only participants with role === 'director' are permitted.
   */
  public async startListening(
    role: UserRole | undefined,
    callbacks: VoiceCommandCallbacks
  ): Promise<boolean> {
    if (role !== 'director') {
      const err = '[VoiceCommandService] Security violation: Voice commands are strictly restricted to the Director.';
      console.warn(err);
      callbacks.onError?.(err);
      callbacks.onStatusChange?.(false, 'Unauthorized: Director role required');
      return false;
    }

    const wrappedCallbacks: VoiceCommandCallbacks = {
      ...callbacks,
      onStatusChange: (listening, error) => {
        this.isListeningActive = listening;
        callbacks.onStatusChange?.(listening, error);
      },
    };

    const success = await this.engine.start(wrappedCallbacks);
    if (success) {
      this.isListeningActive = true;
    }
    return success;
  }

  /**
   * Stops voice command recognition.
   */
  public async stopListening(): Promise<void> {
    this.isListeningActive = false;
    await this.engine.stop();
  }
}

export const voiceCommandService = new VoiceCommandService();
