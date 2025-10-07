import * as path from 'path';
import { CodegenAction, CodegenOptions, CodegenResult, CodegenSession, PlaywrightTestCase } from './types.js';

export class PlaywrightGenerator {
  private static readonly DEFAULT_OPTIONS: Required<CodegenOptions> = {
    outputPath: 'tests',
    testNamePrefix: 'MCP',
    includeComments: true,
    language: 'typescript',
    template: 'pom',
  };

  private options: Required<CodegenOptions>;

  constructor(options: CodegenOptions = {}) {
    this.validateOptions(options);
    this.options = { ...PlaywrightGenerator.DEFAULT_OPTIONS, ...options };
  }

  private validateOptions(options: CodegenOptions): void {
    if (options.outputPath && typeof options.outputPath !== 'string') {
      throw new Error('outputPath must be a string');
    }
    if (options.testNamePrefix && typeof options.testNamePrefix !== 'string') {
      throw new Error('testNamePrefix must be a string');
    }
    if (options.includeComments !== undefined && typeof options.includeComments !== 'boolean') {
      throw new Error('includeComments must be a boolean');
    }
    if (options.language !== undefined && options.language !== 'typescript' && options.language !== 'javascript') {
      throw new Error("language must be 'typescript' or 'javascript'");
    }
    if (options.template !== undefined && options.template !== 'plain' && options.template !== 'pom') {
      throw new Error("template must be 'plain' or 'pom'");
    }
  }

  async generateTest(session: CodegenSession): Promise<CodegenResult> {
    if (!session || !Array.isArray(session.actions)) {
      throw new Error('Invalid session data');
    }

    const testCase = this.createTestCase(session);
    const isPom = this.options.template === 'pom';
    const files: { path: string; content: string }[] = [];

    if (isPom) {
      const pageObject = this.generatePageObject(session);
      files.push(pageObject);
    }

    const testCode = isPom
      ? this.generatePomTestCode(testCase)
      : this.generateTestCode(testCase);

    const filePath = this.getOutputFilePath(session);

    if (isPom) {
      const config = this.generatePlaywrightConfig();
      if (config) files.push(config);
    }

    return {
      testCode,
      filePath,
      sessionId: session.id,
      files: files.length ? files : undefined,
    };
  }

  private createTestCase(session: CodegenSession): PlaywrightTestCase {
    const testCase: PlaywrightTestCase = {
      name: `${this.options.testNamePrefix}_${new Date(session.startTime).toISOString().split('T')[0]}`,
      steps: [],
      imports: new Set(['test', 'expect']),
    };

    for (const action of session.actions) {
      const step = this.convertActionToStep(action);
      if (step) {
        testCase.steps.push(step);
      }
    }

    return testCase;
  }

  private convertActionToStep(action: CodegenAction): string | null {
    const { toolName, parameters } = action;

    switch (toolName) {
      case 'playwright_navigate':
        return this.generateNavigateStep(parameters);
      case 'playwright_fill':
        return this.generateFillStep(parameters);
      case 'playwright_click':
        return this.generateClickStep(parameters);
      case 'playwright_screenshot':
        return this.generateScreenshotStep(parameters);
      case 'playwright_expect_response':
        return this.generateExpectResponseStep(parameters);
      case 'playwright_assert_response':
        return this.generateAssertResponseStep(parameters);
      case 'playwright_hover':
        return this.generateHoverStep(parameters);
      case 'playwright_select':
        return this.generateSelectStep(parameters);
      case 'playwright_custom_user_agent':
        return this.generateCustomUserAgentStep(parameters);
      default:
        console.warn(`Unsupported tool: ${toolName}`);
        return null;
    }
  }

  private generateNavigateStep(parameters: Record<string, unknown>): string {
    const { url, waitUntil } = parameters;
    const options = waitUntil ? `, { waitUntil: '${waitUntil}' }` : '';
    return `
    // Navigate to URL
    await page.goto('${url}'${options});`;
  }

  private generateFillStep(parameters: Record<string, unknown>): string {
    const { selector, value } = parameters;
    return `
    // Fill input field
    await page.fill('${selector}', '${value}');`;
  }

  private generateClickStep(parameters: Record<string, unknown>): string {
    const { selector } = parameters;
    return `
    // Click element
    await page.click('${selector}');`;
  }

  private generateScreenshotStep(parameters: Record<string, unknown>): string {
    const { name, fullPage = false, path } = parameters;
    const options = [];
    if (fullPage) options.push('fullPage: true');
    if (path) options.push(`path: '${path}'`);
    
    const optionsStr = options.length > 0 ? `, { ${options.join(', ')} }` : '';
    return `
    // Take screenshot
    await page.screenshot({ path: '${name}.png'${optionsStr} });`;
  }

  private generateExpectResponseStep(parameters: Record<string, unknown>): string {
    const { url, id } = parameters;
    return `
    // Wait for response
    const ${id}Response = page.waitForResponse('${url}');`;
  }

  private generateAssertResponseStep(parameters: Record<string, unknown>): string {
    const { id, value } = parameters;
    const assertion = value 
      ? `\n    const responseText = await ${id}Response.text();\n    expect(responseText).toContain('${value}');`
      : `\n    expect(${id}Response.ok()).toBeTruthy();`;
    return `
    // Assert response${assertion}`;
  }

  private generateHoverStep(parameters: Record<string, unknown>): string {
    const { selector } = parameters;
    return `
    // Hover over element
    await page.hover('${selector}');`;
  }

  private generateSelectStep(parameters: Record<string, unknown>): string {
    const { selector, value } = parameters;
    return `
    // Select option
    await page.selectOption('${selector}', '${value}');`;
  }

  private generateCustomUserAgentStep(parameters: Record<string, unknown>): string {
    const { userAgent } = parameters;
    return `
    // Set custom user agent
    await context.setUserAgent('${userAgent}');`;
  }

  private generateTestCode(testCase: PlaywrightTestCase): string {
    const imports = Array.from(testCase.imports)
      .map(imp => `import { ${imp} } from '@playwright/test';`)
      .join('\n');

    return `
${imports}

test('${testCase.name}', async ({ page, context }) => {
  ${testCase.steps.join('\n')}
});`;
  }

  private generatePomTestCode(testCase: PlaywrightTestCase): string {
    const ext = this.options.language === 'typescript' ? 'ts' : 'js';
    return `
import { test, expect } from '@playwright/test';
import { AppPage } from './pages/AppPage.${ext}';

test('${testCase.name}', async ({ page }) => {
  const app = new AppPage(page);
  await app.goto();
${testCase.steps.map(s => '  ' + s.replace(/^\s+/g, '')).join('\n')}
});`;
  }

  private generatePageObject(session: CodegenSession): { path: string; content: string } {
    const ext = this.options.language === 'typescript' ? 'ts' : 'js';
    const pageClassHeader = this.options.language === 'typescript'
      ? `import type { Page } from '@playwright/test';

export class AppPage {
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }
`
      : `export class AppPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
  }
`;

    // Build a simple DOM map from recorded selectors
    const selectors = new Map<string, string>();
    for (const action of session.actions) {
      const params = action.parameters as Record<string, unknown>;
      const selector = typeof params.selector === 'string' ? params.selector : undefined;
      if (selector) {
        const key = this.deriveLocatorName(selector);
        if (!selectors.has(key)) selectors.set(key, selector);
      }
    }

    const locators = Array.from(selectors.entries())
      .map(([key, selector]) => `  ${key} = '${selector}';`)
      .join('\n');

    const methods = `
  async goto(url) {
    if (url) {
      await this.page.goto(url);
    }
  }

  async click(selector) {
    const target = selector ?? this.safe('primaryButton');
    await this.page.locator(target).click({ timeout: 10000 });
  }

  async fill(selector, value) {
    const target = selector ?? this.safe('input');
    await this.page.locator(target).fill(String(value ?? ''));
  }

  async expectVisible(selector) {
    await this.page.locator(selector).waitFor({ state: 'visible', timeout: 10000 });
  }

  safe(name) {
    if (!this[name]) throw new Error('Unknown locator: ' + name);
    return this[name];
  }
`;

    const content = `${pageClassHeader}
${locators}
${methods}
}
`;

    const filePath = path.resolve(this.options.outputPath, 'pages', `AppPage.${ext}`);
    return { path: filePath, content };
  }

  private generatePlaywrightConfig(): { path: string; content: string } | null {
    const isTs = this.options.language === 'typescript';
    const filename = isTs ? 'playwright.config.ts' : 'playwright.config.js';
    const base = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '${this.options.outputPath.replace(/\\/g, '/')}',
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry'
  },
});
`;
    return { path: path.resolve(filename), content: base };
  }

  private deriveLocatorName(selector: string): string {
    const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) return `${idMatch[1]}Locator`;
    const dataTest = selector.match(/\[data-[^=]+=['"]?([^'"\]]+)['"]?\]/);
    if (dataTest) return `${dataTest[1]}Locator`;
    const cls = selector.match(/\.([a-zA-Z0-9_-]+)/);
    if (cls) return `${cls[1]}Locator`;
    return 'elementLocator';
  }

  private getOutputFilePath(session: CodegenSession): string {
    if (!session.id) {
      throw new Error('Session ID is required');
    }

    const sanitizedPrefix = this.options.testNamePrefix.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const fileName = `${sanitizedPrefix}_${session.id}.spec.ts`;
    return path.resolve(this.options.outputPath, fileName);
  }
} 