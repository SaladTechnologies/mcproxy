import { chromium, firefox, webkit, devices } from 'playwright-extra';
import type { Browser, BrowserContext, Page } from 'playwright';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import UserAgent from 'user-agents';
import { v4 as uuidv4 } from 'uuid';
import type { CreateContextParams, LocationInfo, BrowserType } from '@mcproxy/shared';
import { getLocationService } from './location-service.js';

// Re-export devices for listing available devices
export { devices };

// Device descriptor type from Playwright
interface DeviceDescriptor {
  viewport: { width: number; height: number };
  userAgent: string;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  defaultBrowserType: 'chromium' | 'firefox' | 'webkit';
}

// Apply stealth plugin to Chromium only (it's not designed for Firefox/WebKit)
chromium.use(StealthPlugin());

// Browser launchers by type
const browserLaunchers = {
  chromium,
  firefox,
  webkit,
} as const;

interface ContextInfo {
  context: BrowserContext;
  page: Page;
  browserType: BrowserType;
  createdAt: number;
  lastUsed: number;
}

export class BrowserManager {
  private browsers: Map<BrowserType, Browser> = new Map();
  private contexts: Map<string, ContextInfo> = new Map();
  private maxContexts: number;
  private contextTtlMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: {
    maxContexts?: number;
    contextTtlMs?: number;
  } = {}) {
    this.maxContexts = options.maxContexts ?? 10;
    this.contextTtlMs = options.contextTtlMs ?? 30 * 60 * 1000; // 30 minutes
  }

  async initialize(): Promise<void> {
    console.log('Browser manager initializing (browsers launched on-demand)...');

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredContexts();
    }, 60 * 1000); // Check every minute

    console.log('Browser manager ready');
  }

  private async getBrowser(browserType: BrowserType): Promise<Browser> {
    let browser = this.browsers.get(browserType);
    if (browser) {
      return browser;
    }

    console.log(`Launching ${browserType} browser with stealth mode...`);
    const launcher = browserLaunchers[browserType];

    // Chromium-specific args for anti-detection
    const chromiumArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled',
    ];

    // Firefox and WebKit have different arg handling
    const args = browserType === 'chromium' ? chromiumArgs : [];

    browser = await launcher.launch({
      headless: true,
      args,
    });

    this.browsers.set(browserType, browser);
    console.log(`${browserType} browser launched successfully`);

    return browser;
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close all contexts
    for (const [contextId, info] of this.contexts) {
      try {
        await info.context.close();
      } catch (err: unknown) {
        console.error(`Error closing context ${contextId}:`, err);
      }
    }
    this.contexts.clear();

    // Close all browsers
    for (const [browserType, browser] of this.browsers) {
      try {
        await browser.close();
        console.log(`Closed ${browserType} browser`);
      } catch (err: unknown) {
        console.error(`Error closing ${browserType} browser:`, err);
      }
    }
    this.browsers.clear();

    console.log('Browser manager shut down');
  }

  async createContext(params: CreateContextParams = {}): Promise<{ contextId: string; browserType: BrowserType; location: LocationInfo; device?: string }> {
    if (this.contexts.size >= this.maxContexts) {
      throw new Error(`Maximum number of contexts (${this.maxContexts}) reached`);
    }

    const browserType: BrowserType = params.browserType ?? 'chromium';
    const browser = await this.getBrowser(browserType);
    const contextId = uuidv4();

    // Get device descriptor if specified
    let deviceDescriptor: DeviceDescriptor | undefined;
    if (params.device) {
      const descriptor = devices[params.device as keyof typeof devices];
      if (descriptor && typeof descriptor === 'object' && 'viewport' in descriptor) {
        deviceDescriptor = descriptor as DeviceDescriptor;
      } else {
        // Try case-insensitive match
        const deviceName = Object.keys(devices).find(
          d => d.toLowerCase() === params.device!.toLowerCase()
        );
        if (deviceName) {
          const found = devices[deviceName as keyof typeof devices];
          if (found && typeof found === 'object' && 'viewport' in found) {
            deviceDescriptor = found as DeviceDescriptor;
          }
        }
        if (!deviceDescriptor) {
          throw new Error(`Unknown device: ${params.device}. Use browser_list_devices to see available devices.`);
        }
      }
    }

    // Determine user agent: custom > device > random > browser default
    const userAgent = params.userAgent
      ?? deviceDescriptor?.userAgent
      ?? (params.randomUserAgent ? this.getRandomUserAgent(browserType, params.isMobile) : undefined);

    // Determine viewport: custom > device > default
    const viewport = params.viewport
      ?? deviceDescriptor?.viewport
      ?? { width: 1920, height: 1080 };

    // Create context with stealth-friendly options
    const context = await browser.newContext({
      viewport,
      ...(userAgent ? { userAgent } : {}),
      locale: 'en-US',
      timezoneId: 'America/New_York',
      // Emulate a real user
      javaScriptEnabled: true,
      // Mobile/touch settings from device or explicit params
      hasTouch: params.hasTouch ?? deviceDescriptor?.hasTouch ?? false,
      isMobile: params.isMobile ?? deviceDescriptor?.isMobile ?? false,
      deviceScaleFactor: params.deviceScaleFactor ?? deviceDescriptor?.deviceScaleFactor ?? 1,
      // Permissions that a normal user would have (chromium-specific)
      ...(browserType === 'chromium' ? {
        permissions: ['geolocation'],
        geolocation: { latitude: 40.7128, longitude: -74.0060 }, // NYC
      } : {}),
    });

    // Add extra stealth measures for Chromium (using string to avoid TS issues with browser globals)
    if (browserType === 'chromium') {
      await context.addInitScript(`
        // Override webdriver property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });

        // Override plugins to appear more realistic
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin' },
            { name: 'Chrome PDF Viewer' },
            { name: 'Native Client' },
          ],
        });

        // Override languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });

        // Hide automation indicators
        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {},
        };

        // Override permissions query to avoid detection
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );

        // Consistent hardware concurrency (typical desktop value)
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 8,
        });

        // Consistent device memory (typical desktop value)
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 8,
        });

        // Hide connection info that could reveal automation
        Object.defineProperty(navigator, 'connection', {
          get: () => ({
            effectiveType: '4g',
            rtt: 50,
            downlink: 10,
            saveData: false,
          }),
        });

        // WebGL vendor/renderer spoofing (common Intel GPU)
        const getParameterProxyHandler = {
          apply: function(target, thisArg, argumentsList) {
            const param = argumentsList[0];
            const gl = thisArg;
            // UNMASKED_VENDOR_WEBGL
            if (param === 37445) {
              return 'Intel Inc.';
            }
            // UNMASKED_RENDERER_WEBGL
            if (param === 37446) {
              return 'Intel Iris OpenGL Engine';
            }
            return Reflect.apply(target, thisArg, argumentsList);
          }
        };

        try {
          const canvas = document.createElement('canvas');
          const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
          if (gl) {
            const originalGetParameter = gl.getParameter.bind(gl);
            WebGLRenderingContext.prototype.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);
          }
          const gl2 = canvas.getContext('webgl2');
          if (gl2) {
            const originalGetParameter2 = gl2.getParameter.bind(gl2);
            WebGL2RenderingContext.prototype.getParameter = new Proxy(originalGetParameter2, getParameterProxyHandler);
          }
        } catch (e) {}

        // Prevent iframe detection
        try {
          Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
            get: function() {
              return window;
            }
          });
        } catch (e) {}

        // Spoof screen properties to match viewport if possible
        try {
          Object.defineProperty(screen, 'availWidth', { get: () => window.innerWidth });
          Object.defineProperty(screen, 'availHeight', { get: () => window.innerHeight });
        } catch (e) {}
      `);
    }

    // Add basic stealth for Firefox/WebKit
    if (browserType !== 'chromium') {
      await context.addInitScript(`
        // Override webdriver property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });

        // Override languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
      `);
    }

    // Create initial page
    const page = await context.newPage();

    this.contexts.set(contextId, {
      context,
      page,
      browserType,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    });

    // Get location info
    const locationService = getLocationService();
    const location = await locationService.getLocation();

    const deviceName = params.device;
    console.log(`Created ${browserType} context ${contextId}${deviceName ? ` (device: ${deviceName})` : ''} (${this.contexts.size}/${this.maxContexts})`);
    return { contextId, browserType, location, ...(deviceName ? { device: deviceName } : {}) };
  }

  async closeContext(contextId: string): Promise<void> {
    const info = this.contexts.get(contextId);
    if (!info) {
      throw new Error(`Context ${contextId} not found`);
    }

    await info.context.close();
    this.contexts.delete(contextId);
    console.log(`Closed context ${contextId} (${this.contexts.size}/${this.maxContexts})`);
  }

  getContext(contextId: string): ContextInfo {
    const info = this.contexts.get(contextId);
    if (!info) {
      throw new Error(`Context ${contextId} not found`);
    }
    info.lastUsed = Date.now();
    return info;
  }

  getPage(contextId: string): Page {
    return this.getContext(contextId).page;
  }

  private cleanupExpiredContexts(): void {
    const now = Date.now();
    for (const [contextId, info] of this.contexts) {
      if (now - info.lastUsed > this.contextTtlMs) {
        console.log(`Cleaning up expired context ${contextId}`);
        info.context.close().catch((err: unknown) => {
          console.error(`Error closing expired context ${contextId}:`, err);
        });
        this.contexts.delete(contextId);
      }
    }
  }

  getBrowserContext(contextId: string): BrowserContext {
    return this.getContext(contextId).context;
  }

  private getRandomUserAgent(browserType: BrowserType, isMobile?: boolean): string {
    // Use user-agents package for realistic, up-to-date user agents
    const deviceCategory = isMobile ? 'mobile' : 'desktop';

    // Filter by browser type
    const browserFilters: Record<BrowserType, (data: { userAgent: string }) => boolean> = {
      chromium: (data) => /Chrome/.test(data.userAgent) && !/Edg/.test(data.userAgent),
      firefox: (data) => /Firefox/.test(data.userAgent),
      webkit: (data) => /Safari/.test(data.userAgent) && !/Chrome/.test(data.userAgent),
    };

    const userAgent = new UserAgent({
      deviceCategory,
    });

    // Try to get a matching user agent, fall back to any UA of the category
    for (let i = 0; i < 10; i++) {
      const ua = new UserAgent({ deviceCategory });
      if (browserFilters[browserType](ua.data)) {
        return ua.toString();
      }
    }

    // Fallback to default if filter doesn't match
    return userAgent.toString();
  }

  // Get list of available device names for emulation
  static getAvailableDevices(): string[] {
    return Object.keys(devices).sort();
  }

  getStats(): { contextCount: number; maxContexts: number } {
    return {
      contextCount: this.contexts.size,
      maxContexts: this.maxContexts,
    };
  }
}
