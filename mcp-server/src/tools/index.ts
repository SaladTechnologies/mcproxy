import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, resolve, isAbsolute } from 'path';
import type { SessionManager } from '../session-manager.js';

// Tool schemas
export const createSessionSchema = z.object({
  endpoint: z.string().url().describe('WebSocket endpoint URL of the browser server'),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional().describe('Browser viewport size'),
  userAgent: z.string().optional().describe('Custom user agent string'),
});

export const sessionIdSchema = z.object({
  session_id: z.string().uuid().describe('Session ID from browser_create_session'),
});

export const navigateSchema = sessionIdSchema.extend({
  url: z.string().url().describe('URL to navigate to'),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional()
    .describe('When to consider navigation complete'),
});

export const clickSchema = sessionIdSchema.extend({
  selector: z.string().describe('CSS selector of element to click'),
});

export const typeSchema = sessionIdSchema.extend({
  selector: z.string().describe('CSS selector of input element'),
  text: z.string().describe('Text to type'),
});

export const selectSchema = sessionIdSchema.extend({
  selector: z.string().describe('CSS selector of select element'),
  value: z.string().describe('Value to select'),
});

export const hoverSchema = sessionIdSchema.extend({
  selector: z.string().describe('CSS selector of element to hover'),
});

export const scrollSchema = sessionIdSchema.extend({
  x: z.number().optional().describe('Horizontal scroll amount in pixels'),
  y: z.number().optional().describe('Vertical scroll amount in pixels'),
  selector: z.string().optional().describe('CSS selector to scroll into view'),
});

export const screenshotSchema = sessionIdSchema.extend({
  full_page: z.boolean().optional().describe('Capture full page screenshot'),
});

export const getContentSchema = sessionIdSchema.extend({
  selector: z.string().optional().describe('CSS selector to get content from (default: entire page)'),
});

export const getTextSchema = sessionIdSchema.extend({
  selector: z.string().optional().describe('CSS selector to get text from (default: body)'),
});

export const evaluateSchema = sessionIdSchema.extend({
  script: z.string().describe('JavaScript code to execute'),
});

export const waitForSelectorSchema = sessionIdSchema.extend({
  selector: z.string().describe('CSS selector to wait for'),
  timeout: z.number().int().positive().optional().describe('Timeout in milliseconds'),
});

export const waitForNavigationSchema = sessionIdSchema.extend({
  timeout: z.number().int().positive().optional().describe('Timeout in milliseconds'),
});

// Tool definitions for MCP
export function getToolDefinitions() {
  return [
    {
      name: 'browser_create_session',
      description: 'Create a new remote browser session. Returns session_id, browser type, and location info (IP, city, region, country, timezone, ISP) of the browser server. Use this to establish sessions in specific geographic locations with different browser engines. Supports mobile device emulation.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          endpoint: {
            type: 'string',
            description: 'WebSocket endpoint URL of the browser server (e.g., wss://your-salad-endpoint.com). Optional if MCPROXY_DEFAULT_ENDPOINT is configured.',
          },
          browser_type: {
            type: 'string',
            enum: ['chromium', 'firefox', 'webkit'],
            description: 'Browser engine to use (default: chromium). Use firefox or webkit (Safari) for different fingerprints or compatibility testing.',
          },
          device: {
            type: 'string',
            description: 'Emulate a mobile device (e.g., "iPhone 15", "Pixel 7", "iPad Pro 11"). Sets viewport, user agent, touch support, etc. Use browser_list_devices to see all options.',
          },
          viewport: {
            type: 'object',
            properties: {
              width: { type: 'number', description: 'Viewport width in pixels' },
              height: { type: 'number', description: 'Viewport height in pixels' },
            },
            description: 'Browser viewport size (ignored if device is set)',
          },
          userAgent: {
            type: 'string',
            description: 'Custom user agent string (overrides browser default and device)',
          },
          randomUserAgent: {
            type: 'boolean',
            description: 'Use a random realistic user agent instead of browser default. Useful for avoiding fingerprinting.',
          },
          isMobile: {
            type: 'boolean',
            description: 'Emulate mobile browser (sets mobile viewport meta tag)',
          },
          hasTouch: {
            type: 'boolean',
            description: 'Enable touch events',
          },
        },
        required: [],
      },
    },
    {
      name: 'browser_list_devices',
      description: 'List all available device names for mobile emulation. Returns device names that can be used with browser_create_session device parameter.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          filter: {
            type: 'string',
            description: 'Optional filter string to search device names (case-insensitive)',
          },
        },
      },
    },
    {
      name: 'browser_list_sessions',
      description: 'List all active browser sessions with their browser type and location info (IP, city, region/state, country, timezone). Use this to find sessions by geographic location (e.g., "the one in Utah") or browser type (e.g., "the Firefox session").',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'browser_close_session',
      description: 'Close a browser session and free resources.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID to close',
          },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'browser_navigate',
      description: 'Navigate to a URL in the browser session. Automatically detects CAPTCHAs and can wait for Cloudflare challenges to complete.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          url: { type: 'string', description: 'URL to navigate to' },
          wait_until: {
            type: 'string',
            enum: ['load', 'domcontentloaded', 'networkidle'],
            description: 'When to consider navigation complete',
          },
          wait_for_cloudflare: {
            type: 'boolean',
            description: 'Auto-wait for Cloudflare/bot protection challenges to complete (polls until challenge clears or timeout)',
          },
          cloudflare_timeout: {
            type: 'number',
            description: 'Max time in ms to wait for Cloudflare challenge (default: 15000)',
          },
        },
        required: ['session_id', 'url'],
      },
    },
    {
      name: 'browser_go_back',
      description: 'Go back in browser history.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'browser_go_forward',
      description: 'Go forward in browser history.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'browser_reload',
      description: 'Reload the current page.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'browser_click',
      description: 'Click an element on the page. Supports humanized clicking with natural mouse movement.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          selector: { type: 'string', description: 'CSS selector of element to click' },
          humanize: { type: 'boolean', description: 'Humanize the click with random delay and natural mouse movement' },
        },
        required: ['session_id', 'selector'],
      },
    },
    {
      name: 'browser_type',
      description: 'Type text into an input element. Supports humanized typing with random keystroke delays.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          selector: { type: 'string', description: 'CSS selector of input element' },
          text: { type: 'string', description: 'Text to type' },
          humanize: { type: 'boolean', description: 'Humanize typing with random delays between keystrokes (50-150ms)' },
          delay: { type: 'number', description: 'Fixed delay between keystrokes in ms (ignored if humanize is true)' },
        },
        required: ['session_id', 'selector', 'text'],
      },
    },
    {
      name: 'browser_select',
      description: 'Select an option from a dropdown.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          selector: { type: 'string', description: 'CSS selector of select element' },
          value: { type: 'string', description: 'Value to select' },
        },
        required: ['session_id', 'selector', 'value'],
      },
    },
    {
      name: 'browser_hover',
      description: 'Hover over an element.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          selector: { type: 'string', description: 'CSS selector of element to hover' },
        },
        required: ['session_id', 'selector'],
      },
    },
    {
      name: 'browser_scroll',
      description: 'Scroll the page or scroll an element into view. Supports humanized smooth scrolling.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          x: { type: 'number', description: 'Horizontal scroll amount in pixels' },
          y: { type: 'number', description: 'Vertical scroll amount in pixels' },
          selector: { type: 'string', description: 'CSS selector to scroll into view' },
          humanize: { type: 'boolean', description: 'Smooth scroll in small increments with natural timing' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current page. Returns base64-encoded PNG image. Optionally saves to a local file.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          full_page: { type: 'boolean', description: 'Capture full page screenshot' },
          file_path: { type: 'string', description: 'Optional path to save the screenshot locally (e.g., ./screenshot.png or /absolute/path/screenshot.png)' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'browser_get_content',
      description: 'Get HTML content of the page or an element.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          selector: { type: 'string', description: 'CSS selector (default: entire page)' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'browser_get_text',
      description: 'Get visible text content of the page or an element.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          selector: { type: 'string', description: 'CSS selector (default: body)' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'browser_evaluate',
      description: 'Execute JavaScript code in the browser and return the result.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          script: { type: 'string', description: 'JavaScript code to execute' },
        },
        required: ['session_id', 'script'],
      },
    },
    {
      name: 'browser_wait_for_selector',
      description: 'Wait for an element to appear on the page.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          selector: { type: 'string', description: 'CSS selector to wait for' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
        },
        required: ['session_id', 'selector'],
      },
    },
    {
      name: 'browser_wait_for_navigation',
      description: 'Wait for page navigation to complete.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'browser_check_captcha',
      description: 'Check if a CAPTCHA is present on the current page. Returns detection info and screenshots of any CAPTCHA found. The screenshot can be analyzed to solve image-based CAPTCHAs.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'browser_solve_captcha',
      description: 'Submit a CAPTCHA solution. For image CAPTCHAs, analyze the screenshot from browser_check_captcha or browser_navigate, then provide the solution text here.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          solution: { type: 'string', description: 'The CAPTCHA solution (text/characters from the image)' },
          input_selector: { type: 'string', description: 'CSS selector for the CAPTCHA input field (auto-detected if not provided)' },
          submit_selector: { type: 'string', description: 'CSS selector for the submit button (auto-detected if not provided)' },
          skip_submit: { type: 'boolean', description: 'If true, only type the solution without clicking submit' },
        },
        required: ['session_id', 'solution'],
      },
    },
    {
      name: 'browser_get_cookies',
      description: 'Get cookies from the browser session. Useful for saving authentication state.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of URLs to filter cookies by',
          },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'browser_set_cookies',
      description: 'Set cookies in the browser session. Useful for restoring authentication state.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
          cookies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Cookie name' },
                value: { type: 'string', description: 'Cookie value' },
                domain: { type: 'string', description: 'Cookie domain' },
                path: { type: 'string', description: 'Cookie path' },
                expires: { type: 'number', description: 'Expiration timestamp' },
                httpOnly: { type: 'boolean', description: 'HTTP only flag' },
                secure: { type: 'boolean', description: 'Secure flag' },
                sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'], description: 'SameSite policy' },
              },
              required: ['name', 'value'],
            },
            description: 'Array of cookies to set',
          },
        },
        required: ['session_id', 'cookies'],
      },
    },
    {
      name: 'browser_clear_cookies',
      description: 'Clear all cookies from the browser session.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'browser_get_capabilities',
      description: 'Get the capabilities of a browser server session. Returns version info, supported commands, features, and device emulation support. Use this to check for version mismatches or feature availability.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID' },
        },
        required: ['session_id'],
      },
    },
  ];
}

// Available devices from Playwright (lazy-loaded)
let availableDevices: string[] | null = null;

function getAvailableDevices(): string[] {
  if (!availableDevices) {
    // Import playwright devices dynamically
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { devices } = require('playwright');
    availableDevices = Object.keys(devices).sort();
  }
  return availableDevices;
}

// Tool handler
export async function handleToolCall(
  sessionManager: SessionManager,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'browser_create_session': {
      const { endpoint, browser_type, device, viewport, userAgent, randomUserAgent, isMobile, hasTouch } = args as {
        endpoint?: string;
        browser_type?: 'chromium' | 'firefox' | 'webkit';
        device?: string;
        viewport?: { width: number; height: number };
        userAgent?: string;
        randomUserAgent?: boolean;
        isMobile?: boolean;
        hasTouch?: boolean;
      };
      const resolvedEndpoint = endpoint ?? process.env.MCPROXY_DEFAULT_ENDPOINT;
      if (!resolvedEndpoint) {
        throw new Error('No endpoint provided and MCPROXY_DEFAULT_ENDPOINT not configured');
      }
      return sessionManager.createSession(resolvedEndpoint, {
        browserType: browser_type,
        device,
        viewport,
        userAgent,
        randomUserAgent,
        isMobile,
        hasTouch,
      });
    }

    case 'browser_list_devices': {
      const { filter } = args as { filter?: string };
      let devices = getAvailableDevices();
      if (filter) {
        const lowerFilter = filter.toLowerCase();
        devices = devices.filter(d => d.toLowerCase().includes(lowerFilter));
      }
      return { devices, count: devices.length };
    }

    case 'browser_list_sessions': {
      return sessionManager.listSessions();
    }

    case 'browser_close_session': {
      const { session_id } = args as { session_id: string };
      await sessionManager.closeSession(session_id);
      return { success: true };
    }

    case 'browser_navigate': {
      const { session_id, url, wait_until, wait_for_cloudflare, cloudflare_timeout } = args as {
        session_id: string;
        url: string;
        wait_until?: 'load' | 'domcontentloaded' | 'networkidle';
        wait_for_cloudflare?: boolean;
        cloudflare_timeout?: number;
      };
      return sessionManager.sendCommand(session_id, 'navigate', {
        url,
        waitUntil: wait_until,
        waitForCloudflare: wait_for_cloudflare,
        cloudflareTimeout: cloudflare_timeout,
      });
    }

    case 'browser_go_back': {
      const { session_id } = args as { session_id: string };
      return sessionManager.sendCommand(session_id, 'go_back', {});
    }

    case 'browser_go_forward': {
      const { session_id } = args as { session_id: string };
      return sessionManager.sendCommand(session_id, 'go_forward', {});
    }

    case 'browser_reload': {
      const { session_id } = args as { session_id: string };
      return sessionManager.sendCommand(session_id, 'reload', {});
    }

    case 'browser_click': {
      const { session_id, selector, humanize } = args as {
        session_id: string;
        selector: string;
        humanize?: boolean;
      };
      return sessionManager.sendCommand(session_id, 'click', { selector, humanize });
    }

    case 'browser_type': {
      const { session_id, selector, text, humanize, delay } = args as {
        session_id: string;
        selector: string;
        text: string;
        humanize?: boolean;
        delay?: number;
      };
      return sessionManager.sendCommand(session_id, 'type', { selector, text, humanize, delay });
    }

    case 'browser_select': {
      const { session_id, selector, value } = args as {
        session_id: string;
        selector: string;
        value: string;
      };
      return sessionManager.sendCommand(session_id, 'select', { selector, value });
    }

    case 'browser_hover': {
      const { session_id, selector } = args as { session_id: string; selector: string };
      return sessionManager.sendCommand(session_id, 'hover', { selector });
    }

    case 'browser_scroll': {
      const { session_id, x, y, selector, humanize } = args as {
        session_id: string;
        x?: number;
        y?: number;
        selector?: string;
        humanize?: boolean;
      };
      return sessionManager.sendCommand(session_id, 'scroll', { x, y, selector, humanize });
    }

    case 'browser_screenshot': {
      const { session_id, full_page, file_path } = args as {
        session_id: string;
        full_page?: boolean;
        file_path?: string;
      };

      // Take the screenshot
      const result = await sessionManager.sendCommand(session_id, 'screenshot', { fullPage: full_page }) as {
        data: string;
        mimeType: string;
      };

      // If file_path provided, save to file
      if (file_path) {
        const absolutePath = isAbsolute(file_path) ? file_path : resolve(process.cwd(), file_path);
        await mkdir(dirname(absolutePath), { recursive: true });
        const buffer = Buffer.from(result.data, 'base64');
        await writeFile(absolutePath, buffer);

        return {
          saved_to: absolutePath,
          data: result.data,
          mimeType: result.mimeType,
        };
      }

      return result;
    }

    case 'browser_get_content': {
      const { session_id, selector } = args as { session_id: string; selector?: string };
      return sessionManager.sendCommand(session_id, 'get_content', { selector });
    }

    case 'browser_get_text': {
      const { session_id, selector } = args as { session_id: string; selector?: string };
      return sessionManager.sendCommand(session_id, 'get_text', { selector });
    }

    case 'browser_evaluate': {
      const { session_id, script } = args as { session_id: string; script: string };
      return sessionManager.sendCommand(session_id, 'evaluate', { script });
    }

    case 'browser_wait_for_selector': {
      const { session_id, selector, timeout } = args as {
        session_id: string;
        selector: string;
        timeout?: number;
      };
      return sessionManager.sendCommand(session_id, 'wait_for_selector', { selector, timeout });
    }

    case 'browser_wait_for_navigation': {
      const { session_id, timeout } = args as { session_id: string; timeout?: number };
      return sessionManager.sendCommand(session_id, 'wait_for_navigation', { timeout });
    }

    case 'browser_check_captcha': {
      const { session_id } = args as { session_id: string };
      return sessionManager.sendCommand(session_id, 'check_captcha', {});
    }

    case 'browser_solve_captcha': {
      const { session_id, solution, input_selector, submit_selector, skip_submit } = args as {
        session_id: string;
        solution: string;
        input_selector?: string;
        submit_selector?: string;
        skip_submit?: boolean;
      };
      return sessionManager.sendCommand(session_id, 'solve_captcha', {
        solution,
        inputSelector: input_selector,
        submitSelector: submit_selector,
        skipSubmit: skip_submit,
      });
    }

    case 'browser_get_cookies': {
      const { session_id, urls } = args as {
        session_id: string;
        urls?: string[];
      };
      return sessionManager.sendCommand(session_id, 'get_cookies', { urls });
    }

    case 'browser_set_cookies': {
      const { session_id, cookies } = args as {
        session_id: string;
        cookies: Array<{
          name: string;
          value: string;
          domain?: string;
          path?: string;
          expires?: number;
          httpOnly?: boolean;
          secure?: boolean;
          sameSite?: 'Strict' | 'Lax' | 'None';
        }>;
      };
      return sessionManager.sendCommand(session_id, 'set_cookies', { cookies });
    }

    case 'browser_clear_cookies': {
      const { session_id } = args as { session_id: string };
      return sessionManager.sendCommand(session_id, 'clear_cookies', {});
    }

    case 'browser_get_capabilities': {
      const { session_id } = args as { session_id: string };
      const capabilities = await sessionManager.sendCommand(session_id, 'get_capabilities', {}) as {
        version: string;
        protocolVersion: string;
      };

      // Add version comparison and recommendations
      const mcpServerVersion = '1.1.0';
      const mcpProtocolVersion = '1.1';

      const result: Record<string, unknown> = { ...capabilities };

      // Check for version mismatches
      if (capabilities.protocolVersion !== mcpProtocolVersion) {
        const serverProtocol = parseFloat(capabilities.protocolVersion);
        const clientProtocol = parseFloat(mcpProtocolVersion);

        if (serverProtocol > clientProtocol) {
          result.versionMismatch = {
            type: 'mcp_server_behind',
            message: `MCP server (protocol ${mcpProtocolVersion}) is behind browser server (protocol ${capabilities.protocolVersion}). Consider updating the MCP server to access new features.`,
            recommendation: 'Update @mcproxy/mcp-server to the latest version.',
          };
        } else {
          result.versionMismatch = {
            type: 'browser_server_behind',
            message: `Browser server (protocol ${capabilities.protocolVersion}) is behind MCP server (protocol ${mcpProtocolVersion}). Some features may not be available.`,
            recommendation: 'Update @mcproxy/browser-server to the latest version.',
          };
        }
      }

      result.mcpServer = {
        version: mcpServerVersion,
        protocolVersion: mcpProtocolVersion,
      };

      return result;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
