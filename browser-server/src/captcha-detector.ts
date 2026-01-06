import type { Page } from 'playwright';

export interface CaptchaInfo {
  detected: boolean;
  type?: 'recaptcha' | 'hcaptcha' | 'cloudflare' | 'funcaptcha' | 'image' | 'text' | 'unknown';
  screenshot?: string;  // base64 PNG of the CAPTCHA element
  fullPageScreenshot?: string;  // base64 PNG of full page for context
  selector?: string;    // The selector that matched
  message?: string;     // Any detected message/instructions
  solvable?: boolean;   // Whether we can attempt to solve it
  inputSelector?: string;  // Where to type the solution
  submitSelector?: string; // Button to submit the solution
}

// Common CAPTCHA selectors and patterns
const CAPTCHA_PATTERNS = {
  recaptcha: {
    selectors: [
      'iframe[src*="recaptcha"]',
      'iframe[title*="recaptcha"]',
      '.g-recaptcha',
      '#recaptcha',
      '[data-sitekey]',
    ],
    type: 'recaptcha' as const,
  },
  hcaptcha: {
    selectors: [
      'iframe[src*="hcaptcha"]',
      '.h-captcha',
      '[data-hcaptcha-sitekey]',
    ],
    type: 'hcaptcha' as const,
  },
  cloudflare: {
    selectors: [
      'iframe[src*="challenges.cloudflare.com"]',
      '#cf-turnstile',
      '.cf-turnstile',
      '#challenge-running',
      '#challenge-form',
      '.cf-im-under-attack',
    ],
    type: 'cloudflare' as const,
  },
  funcaptcha: {
    selectors: [
      'iframe[src*="funcaptcha"]',
      '#FunCaptcha',
      '.funcaptcha',
    ],
    type: 'funcaptcha' as const,
  },
  // Generic image CAPTCHAs (often custom implementations)
  image: {
    selectors: [
      'img[src*="captcha"]',
      'img[alt*="captcha" i]',
      'img[id*="captcha" i]',
      'img[class*="captcha" i]',
      '.captcha-image',
      '#captcha-image',
    ],
    type: 'image' as const,
  },
  // Text/input CAPTCHAs
  text: {
    selectors: [
      'input[name*="captcha" i]',
      'input[id*="captcha" i]',
      'input[placeholder*="captcha" i]',
    ],
    type: 'text' as const,
  },
};

// Selectors that indicate a challenge/block page
const BLOCK_PAGE_INDICATORS = [
  // Cloudflare
  'body.no-js',
  '#challenge-error-title',
  '.cf-error-details',
  // Generic
  '.captcha-container',
  '#captcha-container',
  '[class*="captcha-wrapper"]',
  '[id*="captcha-wrapper"]',
];

export class CaptchaDetector {

  async detect(page: Page): Promise<CaptchaInfo> {
    // Check each CAPTCHA type
    for (const [name, pattern] of Object.entries(CAPTCHA_PATTERNS)) {
      for (const selector of pattern.selectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            console.log(`CAPTCHA detected: ${pattern.type} (selector: ${selector})`);
            return await this.buildCaptchaInfo(page, element, pattern.type, selector);
          }
        } catch {
          // Selector didn't match, continue
        }
      }
    }

    // Check for generic block/challenge pages
    for (const selector of BLOCK_PAGE_INDICATORS) {
      try {
        const element = await page.$(selector);
        if (element) {
          console.log(`Challenge page detected (selector: ${selector})`);
          return await this.buildCaptchaInfo(page, null, 'unknown', selector);
        }
      } catch {
        // Continue
      }
    }

    // Check page title/content for CAPTCHA indicators
    const title = await page.title();
    const titleLower = title.toLowerCase();
    if (titleLower.includes('captcha') ||
        titleLower.includes('security check') ||
        titleLower.includes('verify you are human') ||
        titleLower.includes('just a moment')) {
      console.log(`CAPTCHA page detected via title: "${title}"`);
      return await this.buildCaptchaInfo(page, null, 'unknown', 'title');
    }

    return { detected: false };
  }

  private async buildCaptchaInfo(
    page: Page,
    element: any | null,
    type: CaptchaInfo['type'],
    selector: string
  ): Promise<CaptchaInfo> {
    const info: CaptchaInfo = {
      detected: true,
      type,
      selector,
      solvable: this.isSolvableByAgent(type),
    };

    // Try to screenshot the CAPTCHA element
    if (element) {
      try {
        const screenshotBuffer = await element.screenshot({ type: 'png' });
        info.screenshot = screenshotBuffer.toString('base64');
      } catch (err) {
        console.error('Failed to screenshot CAPTCHA element:', err);
      }
    }

    // Always include full page screenshot for context
    try {
      const fullScreenshot = await page.screenshot({ type: 'png', fullPage: false });
      info.fullPageScreenshot = fullScreenshot.toString('base64');
    } catch (err) {
      console.error('Failed to take full page screenshot:', err);
    }

    // Try to find input and submit selectors for solvable CAPTCHAs
    if (type === 'image' || type === 'text') {
      info.inputSelector = await this.findInputSelector(page);
      info.submitSelector = await this.findSubmitSelector(page);
    }

    // Try to get any instruction text
    info.message = await this.getInstructionText(page);

    return info;
  }

  private isSolvableByAgent(type: CaptchaInfo['type']): boolean {
    // These types can potentially be solved by a vision-capable agent
    return type === 'image' || type === 'text' || type === 'unknown';
    // recaptcha, hcaptcha, cloudflare, funcaptcha typically require
    // clicking through interactive challenges that are harder to automate
  }

  private async findInputSelector(page: Page): Promise<string | undefined> {
    const inputSelectors = [
      'input[name*="captcha" i]',
      'input[id*="captcha" i]',
      'input[placeholder*="captcha" i]',
      'input[placeholder*="enter" i][placeholder*="code" i]',
      'input[placeholder*="type" i][placeholder*="characters" i]',
      'input[type="text"][class*="captcha" i]',
      // Generic - input near a CAPTCHA image
      '.captcha-container input[type="text"]',
      '#captcha-container input[type="text"]',
    ];

    for (const selector of inputSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          return selector;
        }
      } catch {
        // Continue
      }
    }
    return undefined;
  }

  private async findSubmitSelector(page: Page): Promise<string | undefined> {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Verify")',
      'button:has-text("Continue")',
      'button[class*="captcha" i]',
      '.captcha-container button',
      '#captcha-container button',
    ];

    for (const selector of submitSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          return selector;
        }
      } catch {
        // Continue
      }
    }
    return undefined;
  }

  private async getInstructionText(page: Page): Promise<string | undefined> {
    const instructionSelectors = [
      '.captcha-instructions',
      '.captcha-message',
      '[class*="captcha"] label',
      '[class*="captcha"] p',
      'label[for*="captcha" i]',
    ];

    for (const selector of instructionSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.innerText();
          if (text && text.trim()) {
            return text.trim();
          }
        }
      } catch {
        // Continue
      }
    }
    return undefined;
  }
}

// Singleton
let detectorInstance: CaptchaDetector | null = null;

export function getCaptchaDetector(): CaptchaDetector {
  if (!detectorInstance) {
    detectorInstance = new CaptchaDetector();
  }
  return detectorInstance;
}
