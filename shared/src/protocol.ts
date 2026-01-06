// WebSocket Protocol Types

// Authentication
export interface AuthMessage {
  type: 'auth';
  token: string;
}

export interface AuthResultMessage {
  type: 'auth_result';
  success: boolean;
  error?: string;
}

// Commands
export interface CommandMessage {
  id: string;
  type: 'command';
  command: CommandType;
  params: CommandParams;
}

export interface ResponseMessage {
  id: string;
  type: 'response';
  success: true;
  result: unknown;
}

export interface ErrorMessage {
  id: string;
  type: 'error';
  error: {
    code: string;
    message: string;
  };
}

// Heartbeat
export interface PingMessage {
  type: 'ping';
}

export interface PongMessage {
  type: 'pong';
}

// Union types for message handling
export type ClientMessage = AuthMessage | CommandMessage | PingMessage;
export type ServerMessage = AuthResultMessage | ResponseMessage | ErrorMessage | PongMessage;
export type Message = ClientMessage | ServerMessage;

// Command types
export type CommandType =
  // Session
  | 'create_context'
  | 'close_context'
  | 'get_capabilities'
  // Navigation
  | 'navigate'
  | 'go_back'
  | 'go_forward'
  | 'reload'
  // Interaction (selector-based)
  | 'click'
  | 'type'
  | 'select'
  | 'hover'
  | 'scroll'
  // Interaction (coordinate-based for vision agents)
  | 'click_at'
  | 'double_click_at'
  | 'move_mouse'
  | 'drag'
  // Keyboard (human-like text entry)
  | 'keyboard_type'
  | 'keyboard_press'
  | 'keyboard_down'
  | 'keyboard_up'
  // Content
  | 'screenshot'
  | 'get_content'
  | 'get_text'
  | 'evaluate'
  // Waiting
  | 'wait_for_selector'
  | 'wait_for_navigation'
  // CAPTCHA
  | 'check_captcha'
  | 'solve_captcha'
  // Cookies
  | 'get_cookies'
  | 'set_cookies'
  | 'clear_cookies';

// Browser type options
export type BrowserType = 'chromium' | 'firefox' | 'webkit';

// Command parameters
export interface CreateContextParams {
  // Browser type (default: chromium)
  browserType?: BrowserType;
  // Optional viewport settings (ignored if device is set)
  viewport?: {
    width: number;
    height: number;
  };
  // Custom user agent (overrides default, random, and device)
  userAgent?: string;
  // Use a random realistic user agent instead of browser default
  randomUserAgent?: boolean;
  // Emulate a device from Playwright's device registry
  // See: https://playwright.dev/docs/emulation#devices
  // Examples: 'iPhone 15', 'Pixel 7', 'iPad Pro 11', 'Galaxy S23', etc.
  device?: string;
  // Emulate mobile device (alternative to device preset)
  isMobile?: boolean;
  // Enable touch events
  hasTouch?: boolean;
  // Device scale factor (default: 1)
  deviceScaleFactor?: number;
}

export interface CloseContextParams {
  contextId: string;
}

export interface NavigateParams {
  contextId: string;
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  // Auto-wait for Cloudflare/bot protection challenges to complete
  waitForCloudflare?: boolean;
  // Max time to wait for Cloudflare (default: 15000ms)
  cloudflareTimeout?: number;
}

export interface GoBackParams {
  contextId: string;
}

export interface GoForwardParams {
  contextId: string;
}

export interface ReloadParams {
  contextId: string;
}

export interface ClickParams {
  contextId: string;
  selector: string;
  // Humanize the click (random delay, natural mouse movement)
  humanize?: boolean;
}

export interface TypeParams {
  contextId: string;
  selector: string;
  text: string;
  // Delay between keystrokes in ms (default: 0 for instant)
  delay?: number;
  // Humanize typing (random delays between keystrokes)
  humanize?: boolean;
}

export interface SelectParams {
  contextId: string;
  selector: string;
  value: string;
}

export interface HoverParams {
  contextId: string;
  selector: string;
}

export interface ScrollParams {
  contextId: string;
  x?: number;
  y?: number;
  selector?: string;
  // Humanize scrolling (smooth scroll with natural speed)
  humanize?: boolean;
}

// Coordinate-based interactions (for vision agents)
// All coordinates are RELATIVE (0-1 range), where:
//   x: 0 = left edge, 1 = right edge
//   y: 0 = top edge, 1 = bottom edge
// This allows vision agents to work with screenshots at any resolution.
export interface ClickAtParams {
  contextId: string;
  // Relative X coordinate (0-1, where 0=left, 1=right)
  x: number;
  // Relative Y coordinate (0-1, where 0=top, 1=bottom)
  y: number;
  // Mouse button (default: 'left')
  button?: 'left' | 'right' | 'middle';
  // Humanize the click (natural mouse movement to position)
  humanize?: boolean;
}

export interface DoubleClickAtParams {
  contextId: string;
  // Relative X coordinate (0-1, where 0=left, 1=right)
  x: number;
  // Relative Y coordinate (0-1, where 0=top, 1=bottom)
  y: number;
  // Humanize the click (natural mouse movement to position)
  humanize?: boolean;
}

export interface MoveMouseParams {
  contextId: string;
  // Relative X coordinate (0-1, where 0=left, 1=right)
  x: number;
  // Relative Y coordinate (0-1, where 0=top, 1=bottom)
  y: number;
  // Humanize movement (curved path with natural speed)
  humanize?: boolean;
}

export interface DragParams {
  contextId: string;
  // Relative start X coordinate (0-1)
  fromX: number;
  // Relative start Y coordinate (0-1)
  fromY: number;
  // Relative end X coordinate (0-1)
  toX: number;
  // Relative end Y coordinate (0-1)
  toY: number;
  // Humanize dragging (natural acceleration/deceleration)
  humanize?: boolean;
}

// Keyboard interactions (human-like text entry at current focus)
export interface KeyboardTypeParams {
  contextId: string;
  // Text to type at current focus
  text: string;
  // Humanize typing (random delays between keystrokes, 50-150ms)
  humanize?: boolean;
  // Fixed delay between keystrokes in ms (ignored if humanize is true)
  delay?: number;
}

export interface KeyboardPressParams {
  contextId: string;
  // Key to press (e.g., 'Enter', 'Tab', 'Escape', 'ArrowDown', 'Backspace', 'a', 'A')
  // See: https://playwright.dev/docs/api/class-keyboard#keyboard-press
  key: string;
}

export interface KeyboardDownParams {
  contextId: string;
  // Key to hold down (e.g., 'Shift', 'Control', 'Alt', 'Meta')
  key: string;
}

export interface KeyboardUpParams {
  contextId: string;
  // Key to release
  key: string;
}

export interface ScreenshotParams {
  contextId: string;
  fullPage?: boolean;
}

export interface GetContentParams {
  contextId: string;
  selector?: string;
}

export interface GetTextParams {
  contextId: string;
  selector?: string;
}

export interface EvaluateParams {
  contextId: string;
  script: string;
}

export interface WaitForSelectorParams {
  contextId: string;
  selector: string;
  timeout?: number;
}

export interface WaitForNavigationParams {
  contextId: string;
  timeout?: number;
}

export interface CheckCaptchaParams {
  contextId: string;
}

export interface SolveCaptchaParams {
  contextId: string;
  solution: string;
  inputSelector?: string;   // Override detected input selector
  submitSelector?: string;  // Override detected submit selector
  skipSubmit?: boolean;     // Just type solution, don't click submit
}

// Cookie interfaces (matches Playwright's cookie format)
export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface GetCookiesParams {
  contextId: string;
  urls?: string[];  // Filter cookies by URLs
}

export interface SetCookiesParams {
  contextId: string;
  cookies: Cookie[];
}

export interface ClearCookiesParams {
  contextId: string;
}

export type CommandParams =
  | CreateContextParams
  | CloseContextParams
  | GetCapabilitiesParams
  | NavigateParams
  | GoBackParams
  | GoForwardParams
  | ReloadParams
  | ClickParams
  | TypeParams
  | SelectParams
  | HoverParams
  | ScrollParams
  | ClickAtParams
  | DoubleClickAtParams
  | MoveMouseParams
  | DragParams
  | KeyboardTypeParams
  | KeyboardPressParams
  | KeyboardDownParams
  | KeyboardUpParams
  | ScreenshotParams
  | GetContentParams
  | GetTextParams
  | EvaluateParams
  | WaitForSelectorParams
  | WaitForNavigationParams
  | CheckCaptchaParams
  | SolveCaptchaParams
  | GetCookiesParams
  | SetCookiesParams
  | ClearCookiesParams;

// Location information for the browser server
export interface LocationInfo {
  // IP address
  ip: string;

  // Geographic location
  city?: string;
  region?: string;        // State/province
  regionCode?: string;    // e.g., "UT" for Utah
  country?: string;       // Full country name
  countryCode?: string;   // e.g., "US"
  continent?: string;
  continentCode?: string;

  // Coordinates
  latitude?: number;
  longitude?: number;

  // Timezone
  timezone?: string;      // e.g., "America/Denver"

  // Network info
  isp?: string;
  org?: string;           // Organization
  asn?: string;           // Autonomous System Number

  // Salad-specific (if available)
  saladMachineId?: string;
  saladContainerId?: string;
}

// Command result types
export interface CreateContextResult {
  contextId: string;
  browserType: BrowserType;
  location: LocationInfo;
}

export interface ScreenshotResult {
  data: string; // base64 encoded
  mimeType: string;
}

export interface GetContentResult {
  content: string;
}

export interface GetTextResult {
  text: string;
}

export interface EvaluateResult {
  result: unknown;
}

// CAPTCHA detection result
export interface CaptchaInfo {
  detected: boolean;
  type?: 'recaptcha' | 'hcaptcha' | 'cloudflare' | 'funcaptcha' | 'image' | 'text' | 'unknown';
  screenshot?: string;       // base64 PNG of the CAPTCHA element
  fullPageScreenshot?: string; // base64 PNG of full page for context
  selector?: string;         // The selector that matched
  message?: string;          // Any detected instructions
  solvable?: boolean;        // Whether agent can attempt to solve
  inputSelector?: string;    // Where to type the solution
  submitSelector?: string;   // Button to submit
}

// Navigation result now includes CAPTCHA detection
export interface NavigateResult {
  url: string;
  title: string;
  captcha?: CaptchaInfo;     // Present if CAPTCHA detected
}

// Capabilities reporting for version compatibility
export interface GetCapabilitiesParams {
  contextId?: string;  // Optional, capabilities are server-wide
}

// Feature support details for a command
export interface CommandCapability {
  supported: boolean;
  features?: string[];  // Optional features like 'humanize', 'waitForCloudflare', etc.
}

// Browser server capabilities
export interface BrowserServerCapabilities {
  // Version info for compatibility checking
  version: string;
  protocolVersion: string;

  // Available browser engines
  browserTypes: BrowserType[];

  // Supported commands and their features
  commands: Record<string, CommandCapability>;

  // Device emulation support
  deviceEmulation: boolean;
  availableDevices?: string[];  // List of device names if emulation is supported

  // Stealth features
  stealth: {
    enabled: boolean;
    features: string[];
  };
}

// Updated CreateContextResult to optionally include capabilities
export interface CreateContextResultWithCapabilities extends CreateContextResult {
  capabilities?: BrowserServerCapabilities;
}
