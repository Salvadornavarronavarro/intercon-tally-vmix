import AsyncStorage from '@react-native-async-storage/async-storage';

export interface VmixConfig {
  enabled: boolean;
  host: string;
  port: string;
  cameraMap: Record<string, string>;
}

export interface VmixInputInfo {
  number: string;
  title: string;
  type: string;
  muted?: boolean;
  volume?: number;
}

export interface VmixStatus {
  connected: boolean;
  version?: string;
  activeInput?: string;
  previewInput?: string;
  inputs?: VmixInputInfo[];
  lastChecked?: number;
  error?: string;
}

const STORAGE_KEY = '@intercon_vmix_config_v2';

export const DEFAULT_VMIX_CONFIG: VmixConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: '8088',
  cameraMap: Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [`cam${i + 1}`, `${i + 1}`])
  ),
};

type StatusListener = (status: VmixStatus) => void;

class VmixService {
  private config: VmixConfig = { ...DEFAULT_VMIX_CONFIG };
  private status: VmixStatus = { connected: false };
  private statusListeners = new Set<StatusListener>();
  private pollTimer: any = null;
  private isLoaded = false;
  private isPolling = false;

  constructor() {
    this.loadConfig().catch((err) => {
      console.warn('[VmixService] Error initializing config:', err);
    });
  }

  /**
   * Resolves direct client-to-vMix Web Controller URL (http://<HOST>:<PORT>/api).
   * Executed directly from the client browser on the local PC/LAN rather than proxied through cloud backends.
   */
  public getDirectVmixUrl(queryString = ''): string {
    const { host, port } = this.config;
    let targetHost = (host || '127.0.0.1').trim();
    const targetPort = (port || '8088').trim();

    let protocol = 'http://';
    if (targetHost.startsWith('https://')) {
      protocol = 'https://';
      targetHost = targetHost.replace(/^https?:\/\//i, '');
    } else if (targetHost.startsWith('http://')) {
      protocol = 'http://';
      targetHost = targetHost.replace(/^http:\/\//i, '');
    }

    if (targetHost.includes(':')) {
      const parts = targetHost.split(':');
      targetHost = parts[0];
    }

    const baseUrl = `${protocol}${targetHost}:${targetPort}/api`;
    if (!queryString) return baseUrl;
    const cleanQuery = queryString.startsWith('?') ? queryString.slice(1) : queryString;
    return `${baseUrl}?${cleanQuery}`;
  }

  /**
   * Fallback server proxy URL if needed
   */
  private getProxyUrl(queryString: string): string {
    if (typeof window !== 'undefined' && window.location) {
      const hostname = window.location.hostname || 'localhost';
      const port = window.location.port;
      if (port === '8081' || port === '19006') {
        return `http://${hostname}:3000/api/vmix${queryString}`;
      }
      return `/api/vmix${queryString}`;
    }
    return `http://localhost:3000/api/vmix${queryString}`;
  }

  /**
   * Load stored vMix configuration
   */
  public async loadConfig(): Promise<VmixConfig> {
    if (this.isLoaded) return this.config;
    try {
      const json = await AsyncStorage.getItem(STORAGE_KEY);
      if (json) {
        const parsed = JSON.parse(json);
        this.config = {
          ...DEFAULT_VMIX_CONFIG,
          ...parsed,
          cameraMap: {
            ...DEFAULT_VMIX_CONFIG.cameraMap,
            ...(parsed.cameraMap || {}),
          },
        };
      }
    } catch (err) {
      console.warn('[VmixService] Failed to load config from storage:', err);
    }
    this.isLoaded = true;
    return this.config;
  }

  /**
   * Get current in-memory config
   */
  public getConfig(): VmixConfig {
    return { ...this.config };
  }

  /**
   * Update and persist vMix configuration
   */
  public async updateConfig(newConfig: Partial<VmixConfig>): Promise<VmixConfig> {
    this.config = {
      ...this.config,
      ...newConfig,
      cameraMap: {
        ...this.config.cameraMap,
        ...(newConfig.cameraMap || {}),
      },
    };
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch (err) {
      console.warn('[VmixService] Failed to save config to storage:', err);
    }
    return this.getConfig();
  }

  /**
   * Subscribe to vMix connection status updates
   */
  public onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private notifyStatus(newStatus: VmixStatus) {
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      try {
        listener(newStatus);
      } catch (err) {
        console.warn('[VmixService] Listener notification error:', err);
      }
    }
  }

  /**
   * Polls the vMix instance status directly from the client browser.
   * Uses AbortController with a 3-second timeout for snappy, non-blocking responsiveness.
   */
  public async checkStatus(): Promise<VmixStatus> {
    const url = this.getDirectVmixUrl();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 3000) : null;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'text/xml, application/xml, text/plain, */*' },
        signal: controller ? controller.signal : undefined,
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!res.ok) {
        const newStatus: VmixStatus = {
          connected: false,
          lastChecked: Date.now(),
          error: `vMix HTTP ${res.status}`,
        };
        this.notifyStatus(newStatus);
        return newStatus;
      }

      const xml = await res.text();

      let version: string | undefined;
      let activeInput: string | undefined;
      let previewInput: string | undefined;

      const verMatch = xml.match(/<version>(.*?)<\/version>/i);
      if (verMatch) version = verMatch[1]?.trim();

      const actMatch = xml.match(/<active>(.*?)<\/active>/i);
      if (actMatch) activeInput = actMatch[1]?.trim();

      const prevMatch = xml.match(/<preview>(.*?)<\/preview>/i);
      if (prevMatch) previewInput = prevMatch[1]?.trim();

      // Parse inputs array from XML
      const inputs: VmixInputInfo[] = [];
      const inputRegex = /<input\s+([^>]*?)>(.*?)<\/input>/gis;
      let match: RegExpExecArray | null;
      while ((match = inputRegex.exec(xml)) !== null) {
        const attrs = match[1];
        const numMatch = attrs.match(/number="([^"]+)"/i);
        const titleMatch = attrs.match(/title="([^"]+)"/i);
        const typeMatch = attrs.match(/type="([^"]+)"/i);
        const mutedMatch = attrs.match(/muted="([^"]+)"/i);
        const volMatch = attrs.match(/volume="([^"]+)"/i);
        if (numMatch) {
          inputs.push({
            number: numMatch[1],
            title: titleMatch ? titleMatch[1] : `Input ${numMatch[1]}`,
            type: typeMatch ? typeMatch[1] : 'Unknown',
            muted: mutedMatch ? mutedMatch[1].toLowerCase() === 'true' : undefined,
            volume: volMatch ? parseFloat(volMatch[1]) : undefined,
          });
        }
      }

      const newStatus: VmixStatus = {
        connected: true,
        version,
        activeInput,
        previewInput,
        inputs,
        lastChecked: Date.now(),
      };
      this.notifyStatus(newStatus);
      return newStatus;
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);

      let descriptiveError = 'vMix not responding on local IP';
      if (err.name === 'AbortError') {
        descriptiveError = 'vMix not responding on local IP (Timeout 3s)';
      } else if (
        typeof window !== 'undefined' &&
        window.location &&
        window.location.protocol === 'https:' &&
        (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost') || url.startsWith('http://192.168'))
      ) {
        descriptiveError = 'vMix not responding on local IP (Check Mixed-Content or browse via HTTP)';
      } else if (err.message && err.message !== 'Failed to fetch') {
        descriptiveError = `vMix not responding on local IP (${err.message})`;
      }

      const newStatus: VmixStatus = {
        connected: false,
        lastChecked: Date.now(),
        error: descriptiveError,
      };
      this.notifyStatus(newStatus);
      return newStatus;
    }
  }

  /**
   * Start 3-second background polling
   */
  public startPolling(intervalMs = 3000): void {
    if (this.isPolling) return;
    this.isPolling = true;

    // Check immediately
    this.checkStatus().catch(() => {});

    this.pollTimer = setInterval(() => {
      this.checkStatus().catch(() => {});
    }, intervalMs);
  }

  /**
   * Stop background polling
   */
  public stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
  }

  /**
   * Generic dispatch command directly to vMix Web Controller from client.
   * Completely non-blocking and safe against network delays.
   */
  public async dispatchCommand(
    functionName: string,
    inputParam?: string | number,
    extraParams?: Record<string, string>
  ): Promise<{ success: boolean; data?: string; error?: string }> {
    if (!this.config.enabled) {
      console.log(`[VmixService] vMix integration disabled; skipping command "${functionName}"`);
      return { success: false, error: 'VMIX_DISABLED' };
    }

    const params = new URLSearchParams();
    params.set('Function', functionName);

    if (inputParam !== undefined && inputParam !== '') {
      params.set('Input', inputParam.toString());
    }

    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, v);
        }
      }
    }

    const url = this.getDirectVmixUrl(`?${params.toString()}`);
    console.log(`[VmixService] Direct dispatch: ${functionName} (Input: ${inputParam}) -> ${url}`);

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 3000) : null;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'text/xml, application/xml, text/plain, */*' },
        signal: controller ? controller.signal : undefined,
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[VmixService] vMix response error (${res.status}):`, errText);
        return { success: false, error: `vMix HTTP ${res.status}: ${errText}` };
      }

      const responseText = await res.text();
      console.log(`[VmixService] Command "${functionName}" executed successfully.`);
      return { success: true, data: responseText };
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      const msg = err.name === 'AbortError' ? 'Timeout 3s' : (err.message || 'vMix not responding on local IP');
      console.warn(`[VmixService] Non-blocking direct fetch error for "${functionName}":`, msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Send PREVIEW command to vMix:
   * Strict 1-to-1 default index correlation (Cam N -> Input N, left-to-right in vMix)
   * Function=PreviewInput&Input=[Mapped_Input]
   */
  public async sendPreview(cameraId: string): Promise<boolean> {
    try {
      const defaultIndex = cameraId.replace(/\D/g, '') || '1';
      const mappedInput = this.config.cameraMap[cameraId] || defaultIndex;
      const result = await this.dispatchCommand('PreviewInput', mappedInput);
      if (result.success) {
        this.checkStatus().catch(() => {});
      }
      return result.success;
    } catch (err: any) {
      console.warn('[VmixService] sendPreview caught error:', err.message);
      return false;
    }
  }

  /**
   * Send PROGRAM CUT command to vMix:
   * Strict 1-to-1 default index correlation (Cam N -> Input N, left-to-right in vMix)
   * Function=CutDirect&Input=[Mapped_Input]
   */
  public async sendCut(cameraId: string): Promise<boolean> {
    try {
      const defaultIndex = cameraId.replace(/\D/g, '') || '1';
      const mappedInput = this.config.cameraMap[cameraId] || defaultIndex;
      const result = await this.dispatchCommand('CutDirect', mappedInput);
      if (result.success) {
        this.checkStatus().catch(() => {});
      }
      return result.success;
    } catch (err: any) {
      console.warn('[VmixService] sendCut caught error:', err.message);
      return false;
    }
  }

  /**
   * Send FADE transition command to vMix:
   * Function=Fade (transitions Preview to Program using vMix's natively configured fade duration)
   */
  public async sendFade(): Promise<boolean> {
    try {
      const result = await this.dispatchCommand('Fade');
      if (result.success) {
        this.checkStatus().catch(() => {});
      }
      return result.success;
    } catch (err: any) {
      console.warn('[VmixService] sendFade caught error:', err.message);
      return false;
    }
  }

  /**
   * Set Master Audio Volume in vMix:
   * Function=SetMasterVolume&Value=[0-100]
   */
  public async setMasterVolume(percentage: number): Promise<boolean> {
    try {
      const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
      const result = await this.dispatchCommand('SetMasterVolume', undefined, { Value: clamped.toString() });
      return result.success;
    } catch (err: any) {
      console.warn('[VmixService] setMasterVolume caught error:', err.message);
      return false;
    }
  }

  /**
   * Set Audio Auto (Audio-Follows-Video / AFV) for a specific camera in vMix.
   * afvEnabled = false -> Function=AudioAutoOff (Audio Fijo / unlinked from video switching)
   * afvEnabled = true  -> Function=AudioAutoOn  (Audio automatically follows camera switching)
   */
  public async setCameraAudioAuto(cameraId: string, afvEnabled: boolean): Promise<boolean> {
    try {
      const defaultIndex = cameraId.replace(/\D/g, '') || '1';
      const mappedInput = this.config.cameraMap[cameraId] || defaultIndex;
      const fn = afvEnabled ? 'AudioAutoOn' : 'AudioAutoOff';
      const result = await this.dispatchCommand(fn, mappedInput);
      return result.success;
    } catch (err: any) {
      console.warn(`[VmixService] setCameraAudioAuto(${cameraId}, ${afvEnabled}) caught error:`, err.message);
      return false;
    }
  }

  /**
   * Set Audio Auto for all cameras in vMix simultaneously.
   * afvEnabled = false -> AudioAutoOff (Audio Fijo / Desvincular Cámaras)
   * afvEnabled = true  -> AudioAutoOn  (AFV Cámaras)
   */
  public async setAllCamerasAudioAuto(cameraCount: number, afvEnabled: boolean): Promise<boolean> {
    try {
      const fn = afvEnabled ? 'AudioAutoOn' : 'AudioAutoOff';
      console.log(`[VmixService] Setting Audio Auto (${fn}) for ${cameraCount} cameras...`);
      const promises = Array.from({ length: cameraCount }, async (_, i) => {
        const camId = `cam${i + 1}`;
        const defaultIndex = `${i + 1}`;
        const mappedInput = this.config.cameraMap[camId] || defaultIndex;
        return this.dispatchCommand(fn, mappedInput);
      });
      await Promise.allSettled(promises);
      return true;
    } catch (err: any) {
      console.warn(`[VmixService] setAllCamerasAudioAuto(${afvEnabled}) caught error:`, err.message);
      return false;
    }
  }
}

export const vmixService = new VmixService();
