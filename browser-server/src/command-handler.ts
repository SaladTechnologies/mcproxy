import type { Page } from 'playwright';
import type {
  CommandType,
  CommandParams,
  NavigateParams,
  ClickParams,
  TypeParams,
  SelectParams,
  HoverParams,
  ScrollParams,
  ClickAtParams,
  DoubleClickAtParams,
  MoveMouseParams,
  DragParams,
  KeyboardTypeParams,
  KeyboardPressParams,
  KeyboardDownParams,
  KeyboardUpParams,
  ScreenshotParams,
  GetContentParams,
  GetTextParams,
  EvaluateParams,
  WaitForSelectorParams,
  WaitForNavigationParams,
  CreateContextParams,
  CloseContextParams,
  CheckCaptchaParams,
  SolveCaptchaParams,
  GetCookiesParams,
  SetCookiesParams,
  ClearCookiesParams,
  GetCapabilitiesParams,
  Cookie,
  CreateContextResult,
  ScreenshotResult,
  GetContentResult,
  GetTextResult,
  EvaluateResult,
  NavigateResult,
  CaptchaInfo,
  BrowserServerCapabilities,
} from '@mcproxy/shared';
import { BrowserManager } from './browser-manager.js';
import { getCaptchaDetector } from './captcha-detector.js';
import { getCapabilities } from './capabilities.js';

// Helper for humanized delays
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class CommandHandler {
  constructor(private browserManager: BrowserManager) {}

  async handleCommand(command: CommandType, params: CommandParams): Promise<unknown> {
    switch (command) {
      // Session commands
      case 'create_context':
        return this.createContext(params as CreateContextParams);
      case 'close_context':
        return this.closeContext(params as CloseContextParams);
      case 'get_capabilities':
        return this.getCapabilities();

      // Navigation commands
      case 'navigate':
        return this.navigate(params as NavigateParams);
      case 'go_back':
        return this.goBack(params as { contextId: string });
      case 'go_forward':
        return this.goForward(params as { contextId: string });
      case 'reload':
        return this.reload(params as { contextId: string });

      // Interaction commands (selector-based)
      case 'click':
        return this.click(params as ClickParams);
      case 'type':
        return this.type(params as TypeParams);
      case 'select':
        return this.select(params as SelectParams);
      case 'hover':
        return this.hover(params as HoverParams);
      case 'scroll':
        return this.scroll(params as ScrollParams);

      // Interaction commands (coordinate-based for vision agents)
      case 'click_at':
        return this.clickAt(params as ClickAtParams);
      case 'double_click_at':
        return this.doubleClickAt(params as DoubleClickAtParams);
      case 'move_mouse':
        return this.moveMouse(params as MoveMouseParams);
      case 'drag':
        return this.drag(params as DragParams);

      // Keyboard commands (human-like text entry)
      case 'keyboard_type':
        return this.keyboardType(params as KeyboardTypeParams);
      case 'keyboard_press':
        return this.keyboardPress(params as KeyboardPressParams);
      case 'keyboard_down':
        return this.keyboardDown(params as KeyboardDownParams);
      case 'keyboard_up':
        return this.keyboardUp(params as KeyboardUpParams);

      // Content commands
      case 'screenshot':
        return this.screenshot(params as ScreenshotParams);
      case 'get_content':
        return this.getContent(params as GetContentParams);
      case 'get_text':
        return this.getText(params as GetTextParams);
      case 'evaluate':
        return this.evaluate(params as EvaluateParams);

      // Wait commands
      case 'wait_for_selector':
        return this.waitForSelector(params as WaitForSelectorParams);
      case 'wait_for_navigation':
        return this.waitForNavigation(params as WaitForNavigationParams);

      // CAPTCHA commands
      case 'check_captcha':
        return this.checkCaptcha(params as CheckCaptchaParams);
      case 'solve_captcha':
        return this.solveCaptcha(params as SolveCaptchaParams);

      // Cookie commands
      case 'get_cookies':
        return this.getCookies(params as GetCookiesParams);
      case 'set_cookies':
        return this.setCookies(params as SetCookiesParams);
      case 'clear_cookies':
        return this.clearCookies(params as ClearCookiesParams);

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  // Session commands
  private async createContext(params: CreateContextParams): Promise<CreateContextResult> {
    const { contextId, browserType, location } = await this.browserManager.createContext(params);
    return { contextId, browserType, location };
  }

  private async closeContext(params: CloseContextParams): Promise<void> {
    await this.browserManager.closeContext(params.contextId);
  }

  private getCapabilities(): BrowserServerCapabilities {
    return getCapabilities();
  }

  // Navigation commands
  private async navigate(params: NavigateParams): Promise<NavigateResult> {
    const page = this.browserManager.getPage(params.contextId);
    await page.goto(params.url, {
      waitUntil: params.waitUntil ?? 'domcontentloaded',
    });

    // Check for CAPTCHA/Cloudflare after navigation
    const detector = getCaptchaDetector();
    let captchaInfo = await detector.detect(page);

    // Auto-wait for Cloudflare challenges to complete
    if (params.waitForCloudflare && captchaInfo.detected && captchaInfo.type === 'cloudflare') {
      const timeout = params.cloudflareTimeout ?? 15000;
      const startTime = Date.now();

      console.log(`Waiting for Cloudflare challenge to complete (timeout: ${timeout}ms)...`);

      // Poll until Cloudflare clears or timeout
      while (Date.now() - startTime < timeout) {
        await sleep(1000); // Check every second

        // Check if page title changed from "Just a moment..."
        const title = await page.title();
        if (!title.toLowerCase().includes('just a moment') &&
            !title.toLowerCase().includes('checking your browser')) {
          // Re-check for captcha
          captchaInfo = await detector.detect(page);
          if (!captchaInfo.detected || captchaInfo.type !== 'cloudflare') {
            console.log('Cloudflare challenge completed');
            break;
          }
        }
      }

      // Final detection after wait
      captchaInfo = await detector.detect(page);
    }

    const result: NavigateResult = {
      url: page.url(),
      title: await page.title(),
    };

    // Only include captcha info if detected
    if (captchaInfo.detected) {
      result.captcha = captchaInfo;
    }

    return result;
  }

  private async goBack(params: { contextId: string }): Promise<{ url: string }> {
    const page = this.browserManager.getPage(params.contextId);
    await page.goBack();
    return { url: page.url() };
  }

  private async goForward(params: { contextId: string }): Promise<{ url: string }> {
    const page = this.browserManager.getPage(params.contextId);
    await page.goForward();
    return { url: page.url() };
  }

  private async reload(params: { contextId: string }): Promise<{ url: string }> {
    const page = this.browserManager.getPage(params.contextId);
    await page.reload();
    return { url: page.url() };
  }

  // Interaction commands
  private async click(params: ClickParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);

    if (params.humanize) {
      // Add random delay before clicking (100-500ms)
      await sleep(randomDelay(100, 500));

      // Get element position and move mouse naturally
      const element = page.locator(params.selector);
      const box = await element.boundingBox();

      if (box) {
        // Move mouse to random position within element
        const x = box.x + randomDelay(5, Math.max(5, box.width - 5));
        const y = box.y + randomDelay(5, Math.max(5, box.height - 5));
        await page.mouse.move(x, y, { steps: randomDelay(5, 15) });
        await sleep(randomDelay(50, 150));
      }
    }

    await page.click(params.selector);
    return { success: true };
  }

  private async type(params: TypeParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);

    if (params.humanize) {
      // Click the element first with small delay
      await sleep(randomDelay(100, 300));
      await page.click(params.selector);
      await sleep(randomDelay(100, 200));

      // Type character by character with random delays
      for (const char of params.text) {
        await page.keyboard.type(char, { delay: randomDelay(50, 150) });
      }
    } else if (params.delay) {
      // Use specified delay
      await page.click(params.selector);
      await page.keyboard.type(params.text, { delay: params.delay });
    } else {
      // Instant fill
      await page.fill(params.selector, params.text);
    }
    return { success: true };
  }

  private async select(params: SelectParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);
    await page.selectOption(params.selector, params.value);
    return { success: true };
  }

  private async hover(params: HoverParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);
    await page.hover(params.selector);
    return { success: true };
  }

  private async scroll(params: ScrollParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);

    if (params.selector) {
      await page.locator(params.selector).scrollIntoViewIfNeeded();
    } else if (params.humanize) {
      // Smooth scroll in smaller increments
      const x = params.x ?? 0;
      const y = params.y ?? 0;
      const steps = Math.max(Math.abs(x), Math.abs(y)) / 100;
      const stepX = x / steps;
      const stepY = y / steps;

      for (let i = 0; i < steps; i++) {
        await page.evaluate(`window.scrollBy(${stepX}, ${stepY})`);
        await sleep(randomDelay(20, 50));
      }
    } else {
      const x = params.x ?? 0;
      const y = params.y ?? 0;
      await page.evaluate(`window.scrollBy(${x}, ${y})`);
    }
    return { success: true };
  }

  // Coordinate-based interaction commands (for vision agents)
  // All coordinates are RELATIVE (0-1 range) and converted to pixels here

  // Convert relative coordinates (0-1) to absolute pixels
  private relativeToPixels(page: Page, relX: number, relY: number): { x: number; y: number } {
    const viewport = page.viewportSize();
    if (!viewport) {
      throw new Error('Viewport size not available');
    }
    return {
      x: Math.round(relX * viewport.width),
      y: Math.round(relY * viewport.height),
    };
  }

  private async clickAt(params: ClickAtParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);
    const button = params.button ?? 'left';
    const { x, y } = this.relativeToPixels(page, params.x, params.y);

    if (params.humanize) {
      // Move mouse naturally to position before clicking
      await this.humanizedMouseMove(page, x, y);
      await sleep(randomDelay(50, 150));
    } else {
      await page.mouse.move(x, y);
    }

    await page.mouse.click(x, y, { button });
    return { success: true };
  }

  private async doubleClickAt(params: DoubleClickAtParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);
    const { x, y } = this.relativeToPixels(page, params.x, params.y);

    if (params.humanize) {
      await this.humanizedMouseMove(page, x, y);
      await sleep(randomDelay(50, 150));
    } else {
      await page.mouse.move(x, y);
    }

    await page.mouse.dblclick(x, y);
    return { success: true };
  }

  private async moveMouse(params: MoveMouseParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);
    const { x, y } = this.relativeToPixels(page, params.x, params.y);

    if (params.humanize) {
      await this.humanizedMouseMove(page, x, y);
    } else {
      await page.mouse.move(x, y);
    }

    return { success: true };
  }

  private async drag(params: DragParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);
    const from = this.relativeToPixels(page, params.fromX, params.fromY);
    const to = this.relativeToPixels(page, params.toX, params.toY);

    if (params.humanize) {
      // Move to start position naturally
      await this.humanizedMouseMove(page, from.x, from.y);
      await sleep(randomDelay(50, 100));

      // Press mouse button
      await page.mouse.down();
      await sleep(randomDelay(50, 100));

      // Drag to destination with natural movement
      await this.humanizedMouseMove(page, to.x, to.y);
      await sleep(randomDelay(50, 100));

      // Release
      await page.mouse.up();
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y);
      await page.mouse.up();
    }

    return { success: true };
  }

  // Keyboard commands (human-like text entry at current focus)
  private async keyboardType(params: KeyboardTypeParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);

    if (params.humanize) {
      // Type each character with random delays (50-150ms)
      for (const char of params.text) {
        await page.keyboard.type(char);
        await sleep(randomDelay(50, 150));
      }
    } else if (params.delay) {
      // Type with fixed delay
      await page.keyboard.type(params.text, { delay: params.delay });
    } else {
      // Instant typing
      await page.keyboard.type(params.text);
    }

    return { success: true };
  }

  private async keyboardPress(params: KeyboardPressParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);
    await page.keyboard.press(params.key);
    return { success: true };
  }

  private async keyboardDown(params: KeyboardDownParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);
    await page.keyboard.down(params.key);
    return { success: true };
  }

  private async keyboardUp(params: KeyboardUpParams): Promise<{ success: boolean }> {
    const page = this.browserManager.getPage(params.contextId);
    await page.keyboard.up(params.key);
    return { success: true };
  }

  // Helper for humanized mouse movement with curved path
  private async humanizedMouseMove(page: Page, targetX: number, targetY: number): Promise<void> {
    // Get current mouse position (start from center if unknown)
    const viewport = page.viewportSize();
    const startX = viewport ? viewport.width / 2 : 0;
    const startY = viewport ? viewport.height / 2 : 0;

    // Calculate distance and number of steps
    const distance = Math.sqrt(Math.pow(targetX - startX, 2) + Math.pow(targetY - startY, 2));
    const steps = Math.max(10, Math.min(50, Math.floor(distance / 20)));

    // Generate curved path using bezier-like movement
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Ease-in-out for natural acceleration/deceleration
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      // Add slight curve by varying the path
      const curve = Math.sin(t * Math.PI) * (distance * 0.1);
      const perpX = -(targetY - startY) / distance;
      const perpY = (targetX - startX) / distance;

      const x = startX + (targetX - startX) * eased + perpX * curve * (Math.random() * 0.5 + 0.5);
      const y = startY + (targetY - startY) * eased + perpY * curve * (Math.random() * 0.5 + 0.5);

      await page.mouse.move(x, y);
      await sleep(randomDelay(5, 15));
    }

    // Final move to exact target
    await page.mouse.move(targetX, targetY);
  }

  // Content commands
  private async screenshot(params: ScreenshotParams): Promise<ScreenshotResult> {
    const page = this.browserManager.getPage(params.contextId);
    const buffer = await page.screenshot({
      fullPage: params.fullPage ?? false,
      type: 'png',
    });
    return {
      data: buffer.toString('base64'),
      mimeType: 'image/png',
    };
  }

  private async getContent(params: GetContentParams): Promise<GetContentResult> {
    const page = this.browserManager.getPage(params.contextId);
    let content: string;
    if (params.selector) {
      content = await page.locator(params.selector).innerHTML();
    } else {
      content = await page.content();
    }
    return { content };
  }

  private async getText(params: GetTextParams): Promise<GetTextResult> {
    const page = this.browserManager.getPage(params.contextId);
    let text: string;
    if (params.selector) {
      text = await page.locator(params.selector).innerText();
    } else {
      text = await page.locator('body').innerText();
    }
    return { text };
  }

  private async evaluate(params: EvaluateParams): Promise<EvaluateResult> {
    const page = this.browserManager.getPage(params.contextId);
    const result = await page.evaluate(params.script);
    return { result };
  }

  // Wait commands
  private async waitForSelector(params: WaitForSelectorParams): Promise<{ success: boolean; selector: string }> {
    const page = this.browserManager.getPage(params.contextId);
    await page.waitForSelector(params.selector, {
      timeout: params.timeout ?? 30000,
    });
    return { success: true, selector: params.selector };
  }

  private async waitForNavigation(params: WaitForNavigationParams): Promise<{ url: string }> {
    const page = this.browserManager.getPage(params.contextId);
    await page.waitForNavigation({
      timeout: params.timeout ?? 30000,
    });
    return { url: page.url() };
  }

  // CAPTCHA commands
  private async checkCaptcha(params: CheckCaptchaParams): Promise<CaptchaInfo> {
    const page = this.browserManager.getPage(params.contextId);
    const detector = getCaptchaDetector();
    return detector.detect(page);
  }

  private async solveCaptcha(params: SolveCaptchaParams): Promise<{ success: boolean; message: string; captcha?: CaptchaInfo }> {
    const page = this.browserManager.getPage(params.contextId);
    const detector = getCaptchaDetector();

    // First check if there's a CAPTCHA
    const captchaInfo = await detector.detect(page);
    if (!captchaInfo.detected) {
      return { success: true, message: 'No CAPTCHA detected on page' };
    }

    // Determine input selector
    const inputSelector = params.inputSelector ?? captchaInfo.inputSelector;
    if (!inputSelector) {
      return {
        success: false,
        message: 'Could not find CAPTCHA input field. Please provide inputSelector.',
        captcha: captchaInfo,
      };
    }

    // Type the solution
    try {
      await page.fill(inputSelector, params.solution);
      console.log(`Typed CAPTCHA solution into ${inputSelector}`);
    } catch (err) {
      return {
        success: false,
        message: `Failed to type solution: ${err instanceof Error ? err.message : 'Unknown error'}`,
        captcha: captchaInfo,
      };
    }

    // Submit if not skipped
    if (!params.skipSubmit) {
      const submitSelector = params.submitSelector ?? captchaInfo.submitSelector;
      if (submitSelector) {
        try {
          await page.click(submitSelector);
          console.log(`Clicked submit button ${submitSelector}`);

          // Wait a bit for the page to process
          await page.waitForTimeout(2000);

          // Check if CAPTCHA is still present
          const newCaptchaInfo = await detector.detect(page);
          if (newCaptchaInfo.detected) {
            return {
              success: false,
              message: 'CAPTCHA still present after submission. Solution may be incorrect.',
              captcha: newCaptchaInfo,
            };
          }
        } catch (err) {
          return {
            success: false,
            message: `Failed to submit: ${err instanceof Error ? err.message : 'Unknown error'}`,
            captcha: captchaInfo,
          };
        }
      } else {
        // Try pressing Enter as fallback
        try {
          await page.press(inputSelector, 'Enter');
          await page.waitForTimeout(2000);
        } catch {
          // Ignore enter key failure
        }
      }
    }

    // Final check
    const finalCheck = await detector.detect(page);
    if (finalCheck.detected) {
      return {
        success: false,
        message: 'CAPTCHA may not have been solved. Please check the page.',
        captcha: finalCheck,
      };
    }

    return { success: true, message: 'CAPTCHA appears to be solved' };
  }

  // Cookie commands
  private async getCookies(params: GetCookiesParams): Promise<{ cookies: Cookie[] }> {
    const context = this.browserManager.getBrowserContext(params.contextId);
    const cookies = await context.cookies(params.urls);
    return { cookies: cookies as Cookie[] };
  }

  private async setCookies(params: SetCookiesParams): Promise<{ success: boolean; count: number }> {
    const context = this.browserManager.getBrowserContext(params.contextId);
    await context.addCookies(params.cookies);
    return { success: true, count: params.cookies.length };
  }

  private async clearCookies(params: ClearCookiesParams): Promise<{ success: boolean }> {
    const context = this.browserManager.getBrowserContext(params.contextId);
    await context.clearCookies();
    return { success: true };
  }
}
