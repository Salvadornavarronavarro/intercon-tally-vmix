import AsyncStorage from '@react-native-async-storage/async-storage';

export interface VmixConfig {
  enabled: boolean;
  host: string;
  port: string;
  cameraMap: Record<string, string>;
}

export interface VmixStatus {
  connected: boolean;
  version?: string;
  activeInput?: string;
  previewInput?: string;
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
   * Resolve the local server's /api/vmix proxy endpoint
   */
  private getProxyUrl(queryString: string): string {
    if (typeof window !== 'undefined' && window.location) {
      const hostname = window.location.hostname || 'localhost';
      const port = window.location.port;
      // If client is loaded via Expo dev server (8081/19006), point to server port 3000
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
   * Polls the vMix instance status via /api/vmix proxy
   */
  public async checkStatus(): Promise<VmixStatus> {
    const { host, port } = this.config;
    const targetHost = (host || '127.0.0.1').trim();
    const targetPort = (port || '8088').trim();

    const query = `?host=${encodeURIComponent(targetHost)}&port=${encodeURIComponent(targetPort)}`;
    const url = this.getProxyUrl(query);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'text/xml, application/xml, text/plain, */*' },
      });

      if (!res.ok) {
        const newStatus: VmixStatus = {
          connected: false,
          lastChecked: Date.now(),
          error: `HTTP ${res.status}`,
        };
        this.notifyStatus(newStatus);
        return newStatus;
      }

      const xml = await res.text();
      // Parse basic vMix attributes from XML: version, active input, preview input
      let version: string | undefined;
      let activeInput: string | undefined;
      let previewInput: string | undefined;

      const verMatch = xml.match(/<version>(.*?)<\/version>/i);
      if (verMatch) version = verMatch[1];

      const actMatch = xml.match(/<active>(.*?)<\/active>/i);
      if (actMatch) activeInput = actMatch[1];

      const prevMatch = xml.match(/<preview>(.*?)<\/preview>/i);
      if (prevMatch) previewInput = prevMatch[1];

      const newStatus: VmixStatus = {
        connected: true,
        version,
        activeInput,
        previewInput,
        lastChecked: Date.now(),
      };
      this.notifyStatus(newStatus);
      return newStatus;
    } catch (err: any) {
      const newStatus: VmixStatus = {
        connected: false,
        lastChecked: Date.now(),
        error: err.message || 'Offline',
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
   * Generic dispatch command to vMix via /api/vmix proxy.
   * Completely non-blocking and safe against network failures.
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

    const { host, port } = this.config;
    const targetHost = (host || '127.0.0.1').trim();
    const targetPort = (port || '8088').trim();

    const params = new URLSearchParams();
    params.set('host', targetHost);
    params.set('port', targetPort);
    params.set('function', functionName);

    if (inputParam !== undefined && inputParam !== '') {
      params.set('input', inputParam.toString());
    }

    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, v);
        }
      }
    }

    const url = this.getProxyUrl(`?${params.toString()}`);
    console.log(`[VmixService] Dispatching command: ${functionName} (Input: ${inputParam}) -> ${url}`);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'text/xml, application/xml, text/plain, */*' },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[VmixService] vMix response error (${res.status}):`, errText);
        return { success: false, error: `HTTP ${res.status}: ${errText}` };
      }

      const responseText = await res.text();
      console.log(`[VmixService] Command "${functionName}" executed successfully.`);
      return { success: true, data: responseText };
    } catch (err: any) {
      // Non-blocking: catch and log network errors so local intercom tally never stutters
      console.warn(`[VmixService] Non-blocking fetch error for "${functionName}":`, err.message);
      return { success: false, error: err.message };
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
      return result.success;
    } catch (err: any) {
      console.warn('[VmixService] sendFade caught error:', err.message);
      return false;
    }
  }
}

export const vmixService = new VmixService();
