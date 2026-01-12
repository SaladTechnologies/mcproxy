import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, resolve, isAbsolute } from 'path';
import type { SessionManager } from '../session-manager.js';
import { getCredentialStore } from '../credential-store.js';

// MCP Server version info
export const MCP_SERVER_VERSION = '1.2.0';
export const MCP_PROTOCOL_VERSION = '1.2';

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

/**
 * Register all browser automation tools with the MCP server
 */
export function registerTools(server: McpServer, sessionManager: SessionManager): void {
  // ============================================
  // SESSION MANAGEMENT TOOLS
  // ============================================

  server.registerTool(
    'browser_create_session',
    {
      title: 'Create Browser Session',
      description:
        'Create a new remote browser session. Returns session_id, browser type, and location info (IP, city, region, country, timezone, ISP) of the browser server. Use this to establish sessions in specific geographic locations with different browser engines. Supports mobile device emulation.',
      inputSchema: {
        endpoint: z
          .string()
          .url()
          .optional()
          .describe(
            'WebSocket endpoint URL of the browser server (e.g., wss://your-salad-endpoint.com). Optional if MCPROXY_DEFAULT_ENDPOINT is configured.'
          ),
        browser_type: z
          .enum(['chromium', 'firefox', 'webkit'])
          .optional()
          .describe(
            'Browser engine to use (default: chromium). Use firefox or webkit (Safari) for different fingerprints or compatibility testing.'
          ),
        device: z
          .string()
          .optional()
          .describe(
            'Emulate a mobile device (e.g., "iPhone 15", "Pixel 7", "iPad Pro 11"). Sets viewport, user agent, touch support, etc. Use browser_list_devices to see all options.'
          ),
        viewport: z
          .object({
            width: z.number().int().positive().describe('Viewport width in pixels'),
            height: z.number().int().positive().describe('Viewport height in pixels'),
          })
          .optional()
          .describe('Browser viewport size (ignored if device is set)'),
        userAgent: z
          .string()
          .optional()
          .describe('Custom user agent string (overrides browser default and device)'),
        randomUserAgent: z
          .boolean()
          .optional()
          .describe(
            'Use a random realistic user agent instead of browser default. Useful for avoiding fingerprinting.'
          ),
        isMobile: z.boolean().optional().describe('Emulate mobile browser (sets mobile viewport meta tag)'),
        hasTouch: z.boolean().optional().describe('Enable touch events'),
      },
      annotations: {
        openWorldHint: true,
      },
    },
    async ({ endpoint, browser_type, device, viewport, userAgent, randomUserAgent, isMobile, hasTouch }) => {
      const resolvedEndpoint = endpoint ?? process.env.MCPROXY_DEFAULT_ENDPOINT;
      if (!resolvedEndpoint) {
        throw new Error('No endpoint provided and MCPROXY_DEFAULT_ENDPOINT not configured');
      }
      const result = await sessionManager.createSession(resolvedEndpoint, {
        browserType: browser_type,
        device,
        viewport,
        userAgent,
        randomUserAgent,
        isMobile,
        hasTouch,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_list_devices',
    {
      title: 'List Emulated Devices',
      description:
        'List all available device names for mobile emulation. Returns device names that can be used with browser_create_session device parameter.',
      inputSchema: {
        filter: z.string().optional().describe('Optional filter string to search device names (case-insensitive)'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ filter }) => {
      let devices = getAvailableDevices();
      if (filter) {
        const lowerFilter = filter.toLowerCase();
        devices = devices.filter((d) => d.toLowerCase().includes(lowerFilter));
      }
      const result = { devices, count: devices.length };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_list_sessions',
    {
      title: 'List Browser Sessions',
      description:
        'List all active browser sessions with their browser type and location info (IP, city, region/state, country, timezone). Use this to find sessions by geographic location (e.g., "the one in Utah") or browser type (e.g., "the Firefox session").',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
      },
    },
    async () => {
      const result = sessionManager.listSessions();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_close_session',
    {
      title: 'Close Browser Session',
      description: 'Close a browser session and free resources.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID to close'),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ session_id }) => {
      await sessionManager.closeSession(session_id);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_get_capabilities',
    {
      title: 'Get Server Capabilities',
      description:
        'Get the capabilities of a browser server session. Returns version info, supported commands, features, and device emulation support. Use this to check for version mismatches or feature availability.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ session_id }) => {
      const capabilities = (await sessionManager.sendCommand(session_id, 'get_capabilities', {})) as {
        version: string;
        protocolVersion: string;
      };

      const result: Record<string, unknown> = { ...capabilities };

      // Check for version mismatches
      if (capabilities.protocolVersion !== MCP_PROTOCOL_VERSION) {
        const serverProtocol = parseFloat(capabilities.protocolVersion);
        const clientProtocol = parseFloat(MCP_PROTOCOL_VERSION);

        if (serverProtocol > clientProtocol) {
          result.versionMismatch = {
            type: 'mcp_server_behind',
            message: `MCP server (protocol ${MCP_PROTOCOL_VERSION}) is behind browser server (protocol ${capabilities.protocolVersion}). Consider updating the MCP server to access new features.`,
            recommendation: 'Update @mcproxy/mcp-server to the latest version.',
          };
        } else {
          result.versionMismatch = {
            type: 'browser_server_behind',
            message: `Browser server (protocol ${capabilities.protocolVersion}) is behind MCP server (protocol ${MCP_PROTOCOL_VERSION}). Some features may not be available.`,
            recommendation: 'Update @mcproxy/browser-server to the latest version.',
          };
        }
      }

      result.mcpServer = {
        version: MCP_SERVER_VERSION,
        protocolVersion: MCP_PROTOCOL_VERSION,
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ============================================
  // NAVIGATION TOOLS
  // ============================================

  server.registerTool(
    'browser_navigate',
    {
      title: 'Navigate to URL',
      description:
        'Navigate to a URL in the browser session. Automatically detects CAPTCHAs and can wait for Cloudflare challenges to complete.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        url: z.string().url().describe('URL to navigate to'),
        wait_until: z
          .enum(['load', 'domcontentloaded', 'networkidle'])
          .optional()
          .describe('When to consider navigation complete'),
        wait_for_cloudflare: z
          .boolean()
          .optional()
          .describe(
            'Auto-wait for Cloudflare/bot protection challenges to complete (polls until challenge clears or timeout)'
          ),
        cloudflare_timeout: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Max time in ms to wait for Cloudflare challenge (default: 15000)'),
      },
    },
    async ({ session_id, url, wait_until, wait_for_cloudflare, cloudflare_timeout }) => {
      const result = (await sessionManager.sendCommand(session_id, 'navigate', {
        url,
        waitUntil: wait_until,
        waitForCloudflare: wait_for_cloudflare,
        cloudflareTimeout: cloudflare_timeout,
      })) as {
        url: string;
        title: string;
        captcha?: {
          detected: boolean;
          screenshot?: string;
          fullPageScreenshot?: string;
          [key: string]: unknown;
        };
      };

      // Handle navigate with CAPTCHA - include screenshot if CAPTCHA detected
      if (result.captcha?.detected) {
        // Add text summary
        const textResult = {
          ...result,
          captcha: { ...result.captcha },
        };
        delete textResult.captcha.screenshot;
        delete textResult.captcha.fullPageScreenshot;

        const content: (
          | { type: 'text'; text: string }
          | { type: 'image'; data: string; mimeType: string }
        )[] = [{ type: 'text' as const, text: JSON.stringify(textResult, null, 2) }];

        // Add CAPTCHA screenshot
        if (result.captcha.screenshot) {
          content.push({
            type: 'image' as const,
            data: result.captcha.screenshot,
            mimeType: 'image/png',
          });
        }

        // Add full page screenshot
        if (result.captcha.fullPageScreenshot) {
          content.push({
            type: 'image' as const,
            data: result.captcha.fullPageScreenshot,
            mimeType: 'image/png',
          });
        }

        return { content };
      }

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_go_back',
    {
      title: 'Go Back',
      description: 'Go back in browser history.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
      },
    },
    async ({ session_id }) => {
      const result = await sessionManager.sendCommand(session_id, 'go_back', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_go_forward',
    {
      title: 'Go Forward',
      description: 'Go forward in browser history.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
      },
    },
    async ({ session_id }) => {
      const result = await sessionManager.sendCommand(session_id, 'go_forward', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_reload',
    {
      title: 'Reload Page',
      description: 'Reload the current page.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
      },
    },
    async ({ session_id }) => {
      const result = await sessionManager.sendCommand(session_id, 'reload', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ============================================
  // SELECTOR-BASED INTERACTION TOOLS
  // ============================================

  server.registerTool(
    'browser_click',
    {
      title: 'Click Element',
      description: 'Click an element on the page. Supports humanized clicking with natural mouse movement.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        selector: z.string().describe('CSS selector of element to click'),
        humanize: z.boolean().optional().describe('Humanize the click with random delay and natural mouse movement'),
      },
    },
    async ({ session_id, selector, humanize }) => {
      const result = await sessionManager.sendCommand(session_id, 'click', { selector, humanize });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_type',
    {
      title: 'Type into Element',
      description: 'Type text into an input element. Supports humanized typing with random keystroke delays.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        selector: z.string().describe('CSS selector of input element'),
        text: z.string().describe('Text to type'),
        humanize: z.boolean().optional().describe('Humanize typing with random delays between keystrokes (50-150ms)'),
        delay: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Fixed delay between keystrokes in ms (ignored if humanize is true)'),
      },
    },
    async ({ session_id, selector, text, humanize, delay }) => {
      const result = await sessionManager.sendCommand(session_id, 'type', { selector, text, humanize, delay });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_select',
    {
      title: 'Select Option',
      description: 'Select an option from a dropdown.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        selector: z.string().describe('CSS selector of select element'),
        value: z.string().describe('Value to select'),
      },
    },
    async ({ session_id, selector, value }) => {
      const result = await sessionManager.sendCommand(session_id, 'select', { selector, value });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_hover',
    {
      title: 'Hover Element',
      description: 'Hover over an element.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        selector: z.string().describe('CSS selector of element to hover'),
      },
    },
    async ({ session_id, selector }) => {
      const result = await sessionManager.sendCommand(session_id, 'hover', { selector });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_scroll',
    {
      title: 'Scroll Page',
      description: 'Scroll the page or scroll an element into view. Supports humanized smooth scrolling.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        x: z.number().optional().describe('Horizontal scroll amount in pixels'),
        y: z.number().optional().describe('Vertical scroll amount in pixels'),
        selector: z.string().optional().describe('CSS selector to scroll into view'),
        humanize: z.boolean().optional().describe('Smooth scroll in small increments with natural timing'),
      },
    },
    async ({ session_id, x, y, selector, humanize }) => {
      const result = await sessionManager.sendCommand(session_id, 'scroll', { x, y, selector, humanize });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ============================================
  // COORDINATE-BASED INTERACTION TOOLS (for vision agents)
  // All coordinates are RELATIVE (0-1 range)
  // ============================================

  server.registerTool(
    'browser_click_at',
    {
      title: 'Click at Coordinates',
      description:
        'Click at specific coordinates on the page. Coordinates are RELATIVE (0-1 range): x=0 is left edge, x=1 is right edge, y=0 is top, y=1 is bottom. Use this when you can see a screenshot and want to click a specific location.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        x: z.number().min(0).max(1).describe('Relative X coordinate (0-1, where 0=left edge, 1=right edge)'),
        y: z.number().min(0).max(1).describe('Relative Y coordinate (0-1, where 0=top edge, 1=bottom edge)'),
        button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default: left)'),
        humanize: z.boolean().optional().describe('Move mouse naturally to position before clicking'),
      },
    },
    async ({ session_id, x, y, button, humanize }) => {
      const result = await sessionManager.sendCommand(session_id, 'click_at', { x, y, button, humanize });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_double_click_at',
    {
      title: 'Double-Click at Coordinates',
      description:
        'Double-click at specific coordinates. Coordinates are RELATIVE (0-1 range): x=0 is left edge, x=1 is right edge, y=0 is top, y=1 is bottom.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        x: z.number().min(0).max(1).describe('Relative X coordinate (0-1, where 0=left edge, 1=right edge)'),
        y: z.number().min(0).max(1).describe('Relative Y coordinate (0-1, where 0=top edge, 1=bottom edge)'),
        humanize: z.boolean().optional().describe('Move mouse naturally to position before clicking'),
      },
    },
    async ({ session_id, x, y, humanize }) => {
      const result = await sessionManager.sendCommand(session_id, 'double_click_at', { x, y, humanize });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_move_mouse',
    {
      title: 'Move Mouse',
      description:
        'Move the mouse to specific coordinates without clicking. Coordinates are RELATIVE (0-1 range). Useful for hovering or preparing for drag operations.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        x: z.number().min(0).max(1).describe('Relative X coordinate (0-1, where 0=left edge, 1=right edge)'),
        y: z.number().min(0).max(1).describe('Relative Y coordinate (0-1, where 0=top edge, 1=bottom edge)'),
        humanize: z.boolean().optional().describe('Move mouse along a natural curved path'),
      },
    },
    async ({ session_id, x, y, humanize }) => {
      const result = await sessionManager.sendCommand(session_id, 'move_mouse', { x, y, humanize });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_drag',
    {
      title: 'Drag Mouse',
      description:
        'Drag from one coordinate to another. All coordinates are RELATIVE (0-1 range). Useful for sliders, drag-and-drop, and drawing.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        from_x: z.number().min(0).max(1).describe('Starting X coordinate (0-1 relative)'),
        from_y: z.number().min(0).max(1).describe('Starting Y coordinate (0-1 relative)'),
        to_x: z.number().min(0).max(1).describe('Ending X coordinate (0-1 relative)'),
        to_y: z.number().min(0).max(1).describe('Ending Y coordinate (0-1 relative)'),
        humanize: z.boolean().optional().describe('Move mouse naturally with acceleration/deceleration'),
      },
    },
    async ({ session_id, from_x, from_y, to_x, to_y, humanize }) => {
      const result = await sessionManager.sendCommand(session_id, 'drag', {
        fromX: from_x,
        fromY: from_y,
        toX: to_x,
        toY: to_y,
        humanize,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ============================================
  // KEYBOARD TOOLS (human-like text entry)
  // ============================================

  server.registerTool(
    'browser_keyboard_type',
    {
      title: 'Type at Focus',
      description:
        'Type text at the currently focused element. Use this after clicking an input field with click_at. More human-like than browser_type which uses selectors.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        text: z.string().describe('Text to type'),
        humanize: z.boolean().optional().describe('Humanize typing with random delays between keystrokes (50-150ms)'),
        delay: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Fixed delay between keystrokes in ms (ignored if humanize is true)'),
      },
    },
    async ({ session_id, text, humanize, delay }) => {
      const result = await sessionManager.sendCommand(session_id, 'keyboard_type', { text, humanize, delay });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_keyboard_press',
    {
      title: 'Press Key',
      description:
        'Press a single key. Use for Enter, Tab, Escape, arrows, Backspace, or key combinations like Control+a, Shift+Tab.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        key: z
          .string()
          .describe(
            'Key to press (e.g., "Enter", "Tab", "Escape", "ArrowDown", "Backspace", "Control+a", "Shift+Tab")'
          ),
      },
    },
    async ({ session_id, key }) => {
      const result = await sessionManager.sendCommand(session_id, 'keyboard_press', { key });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_keyboard_down',
    {
      title: 'Hold Key Down',
      description: 'Hold down a key (for modifier keys or key combinations). Remember to release with keyboard_up.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        key: z.string().describe('Key to hold down (e.g., "Shift", "Control", "Alt", "Meta")'),
      },
    },
    async ({ session_id, key }) => {
      const result = await sessionManager.sendCommand(session_id, 'keyboard_down', { key });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_keyboard_up',
    {
      title: 'Release Key',
      description: 'Release a held key.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        key: z.string().describe('Key to release'),
      },
    },
    async ({ session_id, key }) => {
      const result = await sessionManager.sendCommand(session_id, 'keyboard_up', { key });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ============================================
  // CONTENT TOOLS
  // ============================================

  server.registerTool(
    'browser_screenshot',
    {
      title: 'Take Screenshot',
      description: 'Take a screenshot of the current page. Returns base64-encoded PNG image. Optionally saves to a local file.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        full_page: z.boolean().optional().describe('Capture full page screenshot'),
        file_path: z
          .string()
          .optional()
          .describe('Optional path to save the screenshot locally (e.g., ./screenshot.png or /absolute/path/screenshot.png)'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ session_id, full_page, file_path }) => {
      const result = (await sessionManager.sendCommand(session_id, 'screenshot', { fullPage: full_page })) as {
        data: string;
        mimeType: string;
      };

      const content: (
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string }
      )[] = [];

      // If file_path provided, save to file
      if (file_path) {
        const absolutePath = isAbsolute(file_path) ? file_path : resolve(process.cwd(), file_path);
        await mkdir(dirname(absolutePath), { recursive: true });
        const buffer = Buffer.from(result.data, 'base64');
        await writeFile(absolutePath, buffer);
        content.push({
          type: 'text' as const,
          text: `Screenshot saved to: ${absolutePath}`,
        });
      }

      content.push({
        type: 'image' as const,
        data: result.data,
        mimeType: result.mimeType,
      });

      return { content };
    }
  );

  server.registerTool(
    'browser_get_content',
    {
      title: 'Get HTML Content',
      description: 'Get HTML content of the page or an element.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        selector: z.string().optional().describe('CSS selector (default: entire page)'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ session_id, selector }) => {
      const result = await sessionManager.sendCommand(session_id, 'get_content', { selector });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_get_text',
    {
      title: 'Get Text Content',
      description: 'Get visible text content of the page or an element.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        selector: z.string().optional().describe('CSS selector (default: body)'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ session_id, selector }) => {
      const result = await sessionManager.sendCommand(session_id, 'get_text', { selector });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_evaluate',
    {
      title: 'Execute JavaScript',
      description: 'Execute JavaScript code in the browser and return the result.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        script: z.string().describe('JavaScript code to execute'),
      },
    },
    async ({ session_id, script }) => {
      const result = await sessionManager.sendCommand(session_id, 'evaluate', { script });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ============================================
  // WAIT TOOLS
  // ============================================

  server.registerTool(
    'browser_wait_for_selector',
    {
      title: 'Wait for Element',
      description: 'Wait for an element to appear on the page.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        selector: z.string().describe('CSS selector to wait for'),
        timeout: z.number().int().positive().optional().describe('Timeout in milliseconds (default: 30000)'),
      },
    },
    async ({ session_id, selector, timeout }) => {
      const result = await sessionManager.sendCommand(session_id, 'wait_for_selector', { selector, timeout });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_wait_for_navigation',
    {
      title: 'Wait for Navigation',
      description: 'Wait for page navigation to complete.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        timeout: z.number().int().positive().optional().describe('Timeout in milliseconds (default: 30000)'),
      },
    },
    async ({ session_id, timeout }) => {
      const result = await sessionManager.sendCommand(session_id, 'wait_for_navigation', { timeout });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ============================================
  // CAPTCHA TOOLS
  // ============================================

  server.registerTool(
    'browser_check_captcha',
    {
      title: 'Check for CAPTCHA',
      description:
        'Check if a CAPTCHA is present on the current page. Returns detection info and screenshots of any CAPTCHA found. The screenshot can be analyzed to solve image-based CAPTCHAs.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ session_id }) => {
      const result = (await sessionManager.sendCommand(session_id, 'check_captcha', {})) as {
        detected: boolean;
        screenshot?: string;
        fullPageScreenshot?: string;
        [key: string]: unknown;
      };

      // Add text summary (without the base64 data to keep it readable)
      const textResult = { ...result };
      delete textResult.screenshot;
      delete textResult.fullPageScreenshot;

      const content: (
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string }
      )[] = [{ type: 'text' as const, text: JSON.stringify(textResult, null, 2) }];

      // Add CAPTCHA element screenshot if present
      if (result.screenshot) {
        content.push({
          type: 'image' as const,
          data: result.screenshot,
          mimeType: 'image/png',
        });
      }

      // Add full page screenshot for context
      if (result.fullPageScreenshot) {
        content.push({
          type: 'image' as const,
          data: result.fullPageScreenshot,
          mimeType: 'image/png',
        });
      }

      return { content };
    }
  );

  server.registerTool(
    'browser_solve_captcha',
    {
      title: 'Submit CAPTCHA Solution',
      description:
        'Submit a CAPTCHA solution. For image CAPTCHAs, analyze the screenshot from browser_check_captcha or browser_navigate, then provide the solution text here.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        solution: z.string().describe('The CAPTCHA solution (text/characters from the image)'),
        input_selector: z.string().optional().describe('CSS selector for the CAPTCHA input field (auto-detected if not provided)'),
        submit_selector: z.string().optional().describe('CSS selector for the submit button (auto-detected if not provided)'),
        skip_submit: z.boolean().optional().describe('If true, only type the solution without clicking submit'),
      },
    },
    async ({ session_id, solution, input_selector, submit_selector, skip_submit }) => {
      const result = await sessionManager.sendCommand(session_id, 'solve_captcha', {
        solution,
        inputSelector: input_selector,
        submitSelector: submit_selector,
        skipSubmit: skip_submit,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ============================================
  // COOKIE TOOLS
  // ============================================

  server.registerTool(
    'browser_get_cookies',
    {
      title: 'Get Cookies',
      description: 'Get cookies from the browser session. Useful for saving authentication state.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        urls: z.array(z.string().url()).optional().describe('Optional list of URLs to filter cookies by'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ session_id, urls }) => {
      const result = await sessionManager.sendCommand(session_id, 'get_cookies', { urls });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_set_cookies',
    {
      title: 'Set Cookies',
      description: 'Set cookies in the browser session. Useful for restoring authentication state.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        cookies: z
          .array(
            z.object({
              name: z.string().describe('Cookie name'),
              value: z.string().describe('Cookie value'),
              domain: z.string().optional().describe('Cookie domain'),
              path: z.string().optional().describe('Cookie path'),
              expires: z.number().optional().describe('Expiration timestamp'),
              httpOnly: z.boolean().optional().describe('HTTP only flag'),
              secure: z.boolean().optional().describe('Secure flag'),
              sameSite: z.enum(['Strict', 'Lax', 'None']).optional().describe('SameSite policy'),
            })
          )
          .describe('Array of cookies to set'),
      },
    },
    async ({ session_id, cookies }) => {
      const result = await sessionManager.sendCommand(session_id, 'set_cookies', { cookies });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_clear_cookies',
    {
      title: 'Clear Cookies',
      description: 'Clear all cookies from the browser session.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ session_id }) => {
      const result = await sessionManager.sendCommand(session_id, 'clear_cookies', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ============================================
  // CREDENTIAL TOOLS (secure credential handling)
  // These tools allow typing credentials by reference, keeping actual values hidden from the model
  // ============================================

  const credentialStore = getCredentialStore();

  server.registerTool(
    'browser_list_credentials',
    {
      title: 'List Stored Credentials',
      description:
        'List all available credential names that can be used with browser_type_credential. Returns names and their source (env var or file), but NEVER the actual values. Credentials are stored locally and resolved by the MCP server.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
      },
    },
    async () => {
      const credentials = await credentialStore.list();
      const result = {
        credentials,
        credentialsFile: credentialStore.getCredentialsPath(),
        usage:
          'Use credential names with browser_type_credential or browser_keyboard_type_credential to type sensitive values without exposing them.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'browser_type_credential',
    {
      title: 'Type Credential into Element',
      description:
        'Type a stored credential into an input element BY REFERENCE. The actual credential value is never exposed to the model - it is resolved locally by the MCP server. Use browser_list_credentials to see available credential names.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        selector: z.string().describe('CSS selector of input element (e.g., "#password", "input[type=password]")'),
        credential_name: z
          .string()
          .describe('Name of the credential to type (e.g., "github_password"). Use browser_list_credentials to see available names.'),
        humanize: z.boolean().optional().describe('Humanize typing with random delays between keystrokes (50-150ms)'),
        delay: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Fixed delay between keystrokes in ms (ignored if humanize is true)'),
      },
    },
    async ({ session_id, selector, credential_name, humanize, delay }) => {
      // Resolve credential locally - value never returned to model
      const credentialValue = await credentialStore.get(credential_name);
      if (!credentialValue) {
        const available = await credentialStore.list();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: `Credential '${credential_name}' not found`,
                  availableCredentials: available.map((c) => c.name),
                  hint: `Set via env var MCPROXY_CREDENTIAL_${credential_name.toUpperCase().replace(/-/g, '_')} or add to ${credentialStore.getCredentialsPath()}`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Send actual value to browser server (model never sees this)
      await sessionManager.sendCommand(session_id, 'type', {
        selector,
        text: credentialValue,
        humanize,
        delay,
      });

      // Return success without revealing the value
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                credential: credential_name,
                selector,
                message: `Credential '${credential_name}' typed into ${selector}`,
                // Explicitly NOT including the actual value
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    'browser_keyboard_type_credential',
    {
      title: 'Type Credential at Focus',
      description:
        'Type a stored credential at the currently focused element BY REFERENCE. Use this after clicking an input field with click_at. The actual credential value is never exposed to the model.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID'),
        credential_name: z
          .string()
          .describe('Name of the credential to type (e.g., "github_password"). Use browser_list_credentials to see available names.'),
        humanize: z.boolean().optional().describe('Humanize typing with random delays between keystrokes (50-150ms)'),
        delay: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Fixed delay between keystrokes in ms (ignored if humanize is true)'),
      },
    },
    async ({ session_id, credential_name, humanize, delay }) => {
      // Resolve credential locally - value never returned to model
      const credentialValue = await credentialStore.get(credential_name);
      if (!credentialValue) {
        const available = await credentialStore.list();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: `Credential '${credential_name}' not found`,
                  availableCredentials: available.map((c) => c.name),
                  hint: `Set via env var MCPROXY_CREDENTIAL_${credential_name.toUpperCase().replace(/-/g, '_')} or add to ${credentialStore.getCredentialsPath()}`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Send actual value to browser server (model never sees this)
      await sessionManager.sendCommand(session_id, 'keyboard_type', {
        text: credentialValue,
        humanize,
        delay,
      });

      // Return success without revealing the value
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                credential: credential_name,
                message: `Credential '${credential_name}' typed at focused element`,
                // Explicitly NOT including the actual value
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    'browser_set_credential',
    {
      title: 'Store Credential',
      description:
        'Store a credential for later use with browser_type_credential. The credential is saved to the local credentials file (~/.mcproxy/credentials.json). WARNING: Only use this for initial setup - prefer setting credentials via environment variables for production use.',
      inputSchema: {
        name: z.string().describe('Name for the credential (e.g., "github_password", "api_key")'),
        value: z.string().describe('The credential value to store'),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ name, value }) => {
      await credentialStore.set(name, value);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                credential: name,
                storedIn: credentialStore.getCredentialsPath(),
                message: `Credential '${name}' stored. Use browser_type_credential to type it securely.`,
                // Explicitly NOT echoing back the value
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    'browser_delete_credential',
    {
      title: 'Delete Credential',
      description:
        'Delete a credential from the local credentials file. Note: Cannot delete credentials set via environment variables.',
      inputSchema: {
        name: z.string().describe('Name of the credential to delete'),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ name }) => {
      const deleted = await credentialStore.delete(name);
      if (deleted) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  credential: name,
                  message: `Credential '${name}' deleted from ${credentialStore.getCredentialsPath()}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } else {
        // Check if it exists in env
        const envName = `MCPROXY_CREDENTIAL_${name.toUpperCase().replace(/-/g, '_')}`;
        if (process.env[envName]) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    credential: name,
                    error: `Credential '${name}' is set via environment variable ${envName}. Unset the env var to remove it.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  credential: name,
                  error: `Credential '${name}' not found`,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );
}
