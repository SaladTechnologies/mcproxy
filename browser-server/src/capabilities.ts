import type { BrowserServerCapabilities, BrowserType } from '@mcproxy/shared';
import { BrowserManager } from './browser-manager.js';

// Browser server version info
export const BROWSER_SERVER_VERSION = '1.2.0';
export const PROTOCOL_VERSION = '1.2';

// Build capabilities object based on current server features
export function getCapabilities(): BrowserServerCapabilities {
  const availableDevices = BrowserManager.getAvailableDevices();

  return {
    version: BROWSER_SERVER_VERSION,
    protocolVersion: PROTOCOL_VERSION,

    browserTypes: ['chromium', 'firefox', 'webkit'] as BrowserType[],

    commands: {
      // Session commands
      create_context: {
        supported: true,
        features: ['browserType', 'viewport', 'userAgent', 'randomUserAgent', 'device', 'isMobile', 'hasTouch', 'deviceScaleFactor'],
      },
      close_context: { supported: true },
      get_capabilities: { supported: true },

      // Navigation commands
      navigate: {
        supported: true,
        features: ['waitUntil', 'waitForCloudflare', 'cloudflareTimeout', 'captchaDetection'],
      },
      go_back: { supported: true },
      go_forward: { supported: true },
      reload: { supported: true },

      // Interaction commands
      click: {
        supported: true,
        features: ['humanize'],
      },
      type: {
        supported: true,
        features: ['humanize', 'delay'],
      },
      select: { supported: true },
      hover: { supported: true },
      scroll: {
        supported: true,
        features: ['humanize', 'selector'],
      },

      // Coordinate-based interaction commands (for vision agents)
      click_at: {
        supported: true,
        features: ['humanize', 'button'],
      },
      double_click_at: {
        supported: true,
        features: ['humanize'],
      },
      move_mouse: {
        supported: true,
        features: ['humanize'],
      },
      drag: {
        supported: true,
        features: ['humanize'],
      },

      // Keyboard commands (human-like text entry)
      keyboard_type: {
        supported: true,
        features: ['humanize', 'delay'],
      },
      keyboard_press: { supported: true },
      keyboard_down: { supported: true },
      keyboard_up: { supported: true },

      // Content commands
      screenshot: {
        supported: true,
        features: ['fullPage'],
      },
      get_content: {
        supported: true,
        features: ['selector'],
      },
      get_text: {
        supported: true,
        features: ['selector'],
      },
      evaluate: { supported: true },

      // Wait commands
      wait_for_selector: {
        supported: true,
        features: ['timeout'],
      },
      wait_for_navigation: {
        supported: true,
        features: ['timeout'],
      },

      // CAPTCHA commands
      check_captcha: {
        supported: true,
        features: ['screenshot', 'typeDetection'],
      },
      solve_captcha: {
        supported: true,
        features: ['inputSelector', 'submitSelector', 'skipSubmit'],
      },

      // Cookie commands
      get_cookies: {
        supported: true,
        features: ['urlFilter'],
      },
      set_cookies: { supported: true },
      clear_cookies: { supported: true },
    },

    deviceEmulation: true,
    availableDevices,

    stealth: {
      enabled: true,
      features: [
        'webdriver-override',
        'plugins-spoof',
        'languages-spoof',
        'chrome-runtime',
        'permissions-query',
        'hardware-concurrency',
        'device-memory',
        'connection-spoof',
        'webgl-vendor-spoof',
        'screen-properties',
      ],
    },
  };
}
