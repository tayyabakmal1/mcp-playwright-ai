import * as path from 'path';
export class PlaywrightGenerator {
    constructor(options = {}) {
        this.validateOptions(options);
        this.options = { ...PlaywrightGenerator.DEFAULT_OPTIONS, ...options };
    }
    validateOptions(options) {
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
    async generateTest(session) {
        if (!session || !Array.isArray(session.actions)) {
            throw new Error('Invalid session data');
        }
        const testCase = this.createTestCase(session);
        const isPom = this.options.template === 'pom';
        const files = [];
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
            if (config)
                files.push(config);
        }
        return {
            testCode,
            filePath,
            sessionId: session.id,
            files: files.length ? files : undefined,
        };
    }
    createTestCase(session) {
        const testCase = {
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
    convertActionToStep(action) {
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
    generateNavigateStep(parameters) {
        const { url, waitUntil } = parameters;
        const options = waitUntil ? `, { waitUntil: '${waitUntil}' }` : '';
        return `
    // Navigate to URL
    await page.goto('${url}'${options});`;
    }
    generateFillStep(parameters) {
        const { selector, value } = parameters;
        return `
    // Fill input field
    await page.fill('${selector}', '${value}');`;
    }
    generateClickStep(parameters) {
        const { selector } = parameters;
        return `
    // Click element
    await page.click('${selector}');`;
    }
    generateScreenshotStep(parameters) {
        const { name, fullPage = false, path } = parameters;
        const options = [];
        if (fullPage)
            options.push('fullPage: true');
        if (path)
            options.push(`path: '${path}'`);
        const optionsStr = options.length > 0 ? `, { ${options.join(', ')} }` : '';
        return `
    // Take screenshot
    await page.screenshot({ path: '${name}.png'${optionsStr} });`;
    }
    generateExpectResponseStep(parameters) {
        const { url, id } = parameters;
        return `
    // Wait for response
    const ${id}Response = page.waitForResponse('${url}');`;
    }
    generateAssertResponseStep(parameters) {
        const { id, value } = parameters;
        const assertion = value
            ? `\n    const responseText = await ${id}Response.text();\n    expect(responseText).toContain('${value}');`
            : `\n    expect(${id}Response.ok()).toBeTruthy();`;
        return `
    // Assert response${assertion}`;
    }
    generateHoverStep(parameters) {
        const { selector } = parameters;
        return `
    // Hover over element
    await page.hover('${selector}');`;
    }
    generateSelectStep(parameters) {
        const { selector, value } = parameters;
        return `
    // Select option
    await page.selectOption('${selector}', '${value}');`;
    }
    generateCustomUserAgentStep(parameters) {
        const { userAgent } = parameters;
        return `
    // Set custom user agent
    await context.setUserAgent('${userAgent}');`;
    }
    generateTestCode(testCase) {
        const imports = Array.from(testCase.imports)
            .map(imp => `import { ${imp} } from '@playwright/test';`)
            .join('\n');
        return `
${imports}

test('${testCase.name}', async ({ page, context }) => {
  ${testCase.steps.join('\n')}
});`;
    }
    generatePomTestCode(testCase) {
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
    generatePageObject(session) {
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
        const selectors = new Map();
        for (const action of session.actions) {
            const params = action.parameters;
            const selector = typeof params.selector === 'string' ? params.selector : undefined;
            if (selector) {
                const key = this.deriveLocatorName(selector);
                if (!selectors.has(key))
                    selectors.set(key, selector);
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
    generatePlaywrightConfig() {
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
    deriveLocatorName(selector) {
        const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
        if (idMatch)
            return `${idMatch[1]}Locator`;
        const dataTest = selector.match(/\[data-[^=]+=['"]?([^'"\]]+)['"]?\]/);
        if (dataTest)
            return `${dataTest[1]}Locator`;
        const cls = selector.match(/\.([a-zA-Z0-9_-]+)/);
        if (cls)
            return `${cls[1]}Locator`;
        return 'elementLocator';
    }
    getOutputFilePath(session) {
        if (!session.id) {
            throw new Error('Session ID is required');
        }
        const sanitizedPrefix = this.options.testNamePrefix.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const fileName = `${sanitizedPrefix}_${session.id}.spec.ts`;
        return path.resolve(this.options.outputPath, fileName);
    }
}
PlaywrightGenerator.DEFAULT_OPTIONS = {
    outputPath: 'tests',
    testNamePrefix: 'MCP',
    includeComments: true,
    language: 'typescript',
    template: 'pom',
};
