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
  private pollTimeout: any = null;
  private pollIntervalMs = 3000;
  private minBackoffMs = 1500;
  private isLoaded = false;
  private isPolling = false;
  private isChecking = false;

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
   * Performs an ultra-clean HTTP GET request to the local vMix API.
   * Avoids complex preflight headers (no custom auth, no json) that cause vMix's built-in web server to 500.
   * If fetch returns 500 or network fails, automatically attempts clean XMLHttpRequest fallback.
   */
  private async requestVmixXml(url: string, timeoutMs = 3000): Promise<{ ok: boolean; status: number; text: string }> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        headers: {
          // Do NOT send custom Authorization or custom application/json headers.
          'Accept': 'text/xml, application/xml, */*',
        },
        signal: controller ? controller.signal : undefined,
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (res.status === 200) {
        const text = await res.text();
        return { ok: true, status: 200, text };
      }

      console.warn(`[VmixService] fetch returned status ${res.status}, attempting XMLHttpRequest fallback...`);
    } catch (fetchErr: any) {
      if (timeoutId) clearTimeout(timeoutId);
      console.warn('[VmixService] fetch error, attempting XMLHttpRequest fallback:', fetchErr?.message || fetchErr);
    }

    // Fallback: Clean XMLHttpRequest without custom headers or complex options
    if (typeof XMLHttpRequest !== 'undefined') {
      return new Promise((resolve, reject) => {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          xhr.timeout = timeoutMs;
          xhr.setRequestHeader('Accept', 'text/xml, application/xml, */*');

          xhr.onload = () => {
            if (xhr.status === 200) {
              resolve({ ok: true, status: 200, text: xhr.responseText });
            } else {
              resolve({ ok: false, status: xhr.status, text: xhr.responseText || `HTTP ${xhr.status}` });
            }
          };

          xhr.onerror = () => {
            reject(new Error('XMLHttpRequest network error'));
          };

          xhr.ontimeout = () => {
            reject(new Error('XMLHttpRequest timeout 3s'));
          };

          xhr.send();
        } catch (xhrErr) {
          reject(xhrErr);
        }
      });
    }

    throw new Error('vMix not responding on local IP');
  }

  /**
   * Polls the vMix instance status directly from the client browser.
   * LAYER A: Instant Browser Connection & Reachability Check
   * 1. Attempts standard XML fetch (works when browsing via HTTP or when CORS is present).
   * 2. If blocked by CORS or network, immediately falls back to a no-cors reachability probe.
   *    If no-cors succeeds (resolves with opaque response), it proves vMix Web Controller is running on that port!
   *    Immediately switches status to ONLINE ('Direct Local Control Active').
   */
  public async checkStatus(): Promise<VmixStatus> {
    if (this.isChecking) {
      return this.status;
    }
    this.isChecking = true;
    const url = this.getDirectVmixUrl();

    // 1. Try standard XML fetch
    try {
      const response = await this.requestVmixXml(url, 2000);

      if (response.ok && response.status === 200) {
        const xmlText = response.text;
        let version: string | undefined;
        let activeInput: string | undefined;
        let previewInput: string | undefined;
        const inputs: VmixInputInfo[] = [];

        let isValidVmixXml = false;

        // Parse with standard DOMParser
        if (typeof DOMParser !== 'undefined') {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlText, 'text/xml');
            const parserErrors = doc.getElementsByTagName('parsererror');
            if (parserErrors.length === 0) {
              const root = doc.documentElement;
              if (root && root.nodeName.toLowerCase() === 'vmix') {
                isValidVmixXml = true;
                version = doc.getElementsByTagName('version')[0]?.textContent?.trim();
                activeInput = doc.getElementsByTagName('active')[0]?.textContent?.trim();
                previewInput = doc.getElementsByTagName('preview')[0]?.textContent?.trim();

                const inputEls = doc.getElementsByTagName('input');
                for (let i = 0; i < inputEls.length; i++) {
                  const el = inputEls[i];
                  const num = el.getAttribute('number');
                  if (num) {
                    inputs.push({
                      number: num,
                      title: el.getAttribute('title') || el.textContent || `Input ${num}`,
                      type: el.getAttribute('type') || 'Unknown',
                      muted: el.getAttribute('muted')?.toLowerCase() === 'true',
                      volume: el.getAttribute('volume') ? parseFloat(el.getAttribute('volume')!) : undefined,
                    });
                  }
                }
              }
            }
          } catch (domErr) {
            console.warn('[VmixService] DOMParser error, using regex fallback:', domErr);
          }
        }

        // Fallback regex parser
        if (!isValidVmixXml && /<vmix[\s>]/i.test(xmlText)) {
          isValidVmixXml = true;
          const verMatch = xmlText.match(/<version>(.*?)<\/version>/i);
          if (verMatch) version = verMatch[1]?.trim();
          const actMatch = xmlText.match(/<active>(.*?)<\/active>/i);
          if (actMatch) activeInput = actMatch[1]?.trim();
          const prevMatch = xmlText.match(/<preview>(.*?)<\/preview>/i);
          if (prevMatch) previewInput = prevMatch[1]?.trim();

          const inputRegex = /<input\s+([^>]*?)>(.*?)<\/input>/gis;
          let match: RegExpExecArray | null;
          while ((match = inputRegex.exec(xmlText)) !== null) {
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
        }

        if (isValidVmixXml) {
          const newStatus: VmixStatus = {
            connected: true,
            version,
            activeInput,
            previewInput,
            inputs,
            lastChecked: Date.now(),
            error: undefined,
          };
          this.notifyStatus(newStatus);
          return newStatus;
        }
      }
    } catch {
      // Standard fetch failed or was blocked by CORS
    }

    // 2. LAYER A Fallback: no-cors reachability probe
    // Since vMix lacks CORS headers, fetch with mode: 'no-cors' succeeds if the server is up and listening.
    // If the server is offline / closed, fetch will reject / throw TypeError (Failed to fetch).
    try {
      const probeController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const probeTimeout = probeController ? setTimeout(() => probeController.abort(), 2000) : null;

      await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        signal: probeController ? probeController.signal : undefined,
      });

      if (probeTimeout) clearTimeout(probeTimeout);

      // no-cors fetch resolved! vMix Web Controller is actively listening on this port.
      const newStatus: VmixStatus = {
        connected: true,
        version: this.status.version && this.status.version !== 'Direct Local Control'
          ? this.status.version
          : 'Direct Local Control',
        activeInput: this.status.activeInput,
        previewInput: this.status.previewInput,
        inputs: this.status.inputs,
        lastChecked: Date.now(),
        error: undefined,
      };
      this.notifyStatus(newStatus);
      return newStatus;
    } catch (probeErr: any) {
      const isTimeout = probeErr.name === 'AbortError' || probeErr.message?.includes('timeout');
      const descriptiveError = isTimeout
        ? `vMix not responding on ${this.config.host}:${this.config.port} (Timeout 2s)`
        : `Cannot reach vMix on ${this.config.host}:${this.config.port}. Verify vMix Web Controller is enabled.`;

      const newStatus: VmixStatus = {
        connected: false,
        lastChecked: Date.now(),
        error: descriptiveError,
      };
      this.notifyStatus(newStatus);
      return newStatus;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Updates status from an external sync source (e.g. Layer B local relay via WebSocket)
   */
  public applySyncData(syncPayload: Partial<VmixStatus>): void {
    this.status = {
      ...this.status,
      ...syncPayload,
      connected: syncPayload.connected !== undefined ? syncPayload.connected : true,
      lastChecked: Date.now(),
      error: undefined,
    };
    this.notifyStatus(this.status);
  }

  /**
   * Start background polling with safe backoff (>= 1.5s) to prevent tight failing loops
   */
  public startPolling(intervalMs = 3000): void {
    this.pollIntervalMs = Math.max(intervalMs, this.minBackoffMs);
    if (this.isPolling) return;
    this.isPolling = true;

    this.runPollLoop();
  }

  private async runPollLoop(): Promise<void> {
    if (!this.isPolling) return;

    let delay = this.pollIntervalMs;
    try {
      const res = await this.checkStatus();
      if (!res.connected) {
        // Apply backoff of at least 1.5s on failure to avoid infinite tight loops
        delay = Math.max(this.pollIntervalMs, this.minBackoffMs);
      }
    } catch {
      delay = Math.max(this.pollIntervalMs, this.minBackoffMs);
    }

    if (this.isPolling) {
      this.pollTimeout = setTimeout(() => {
        this.runPollLoop();
      }, delay);
    }
  }

  /**
   * Stop background polling
   */
  public stopPolling(): void {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
  }

  /**
   * Generic dispatch command directly to vMix Web Controller from client.
   * LAYER A: Uses mode: 'no-cors' to completely bypass browser CORS preflight restrictions.
   * Commands like PreviewInput, CutDirect, Fade, AudioAuto execute instantaneously in vMix.
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
    console.log(`[VmixService] Direct dispatch (no-cors): ${functionName} (Input: ${inputParam}) -> ${url}`);

    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 3000) : null;

      await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
      });

      if (timeoutId) clearTimeout(timeoutId);

      console.log(`[VmixService] Command "${functionName}" executed successfully via direct browser fetch.`);
      return { success: true };
    } catch (err: any) {
      const msg = err.name === 'AbortError' ? 'Timeout 3s' : (err.message || 'vMix not responding on local IP');
      console.warn(`[VmixService] Direct dispatch error for "${functionName}":`, msg);
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
