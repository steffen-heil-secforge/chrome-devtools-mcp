/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, describe, it, mock} from 'node:test';

import type {Browser} from 'puppeteer-core';

import {BrowserRegistry} from '../../src/BrowserRegistry.js';
import type {McpContext} from '../../src/McpContext.js';
import {
  listBrowsers,
  reconnectBrowser,
} from '../../src/tools/browser-management.js';
import type {Request, Response} from '../../src/tools/ToolDefinition.js';
import {getMockBrowser} from '../utils.js';

function getMockPage(url: string) {
  return {
    url: () => url,
  };
}

function getMockContext(pages: Array<{url: () => string}> = []): McpContext {
  const selectedPage = pages[0];
  return {
    getSelectedPage: () => ({}) as unknown,
    getPages: () => pages,
    isPageSelected: (page: unknown) => page === selectedPage,
  } as McpContext;
}

function getMockResponse() {
  const responseLines: string[] = [];
  return {
    responseLines,
    appendResponseLine: mock.fn((line: string) => {
      responseLines.push(line);
    }),
    includePages: false,
    setIncludePages: mock.fn(),
  };
}

describe('browser_management', () => {
  afterEach(async () => {
    // Clear the singleton registry after each test
    const registry = BrowserRegistry.getInstance();
    await registry.disposeAll();
  });

  describe('list_browsers', () => {
    it('shows message when no browsers registered', async () => {
      const response = getMockResponse();
      await listBrowsers.handler(
        {params: {}} as Request<Record<string, never>>,
        response as unknown as Response,
        {} as McpContext,
      );

      assert.strictEqual(
        response.responseLines[0],
        'No browsers are currently registered.',
      );
    });

    it('lists single browser with correct message', async () => {
      const registry = BrowserRegistry.getInstance();
      const browser = getMockBrowser() as unknown as Browser;
      const pages = [
        getMockPage('https://example.com/'),
        getMockPage('https://example.com/page2'),
      ];
      const context = getMockContext(pages);

      registry.addConnectedBrowser(browser, context, 'http://127.0.0.1:9222');

      const response = getMockResponse();
      await listBrowsers.handler(
        {params: {}} as Request<Record<string, never>>,
        response as unknown as Response,
        {} as McpContext,
      );

      assert.strictEqual(response.responseLines[0], 'Total browsers: 1\n');
      assert.ok(
        response.responseLines[1].includes('[1] http://127.0.0.1:9222'),
      );
      assert.ok(response.responseLines[1].includes('connected'));
      // Check pages are listed
      assert.ok(response.responseLines[2].includes('0: https://example.com/'));
      assert.ok(response.responseLines[2].includes('[selected]'));
      assert.ok(
        response.responseLines[3].includes('1: https://example.com/page2'),
      );
      assert.ok(response.responseLines[4].includes('Single browser mode'));
      assert.ok(response.responseLines[4].includes('must NOT be specified'));
    });

    it('lists multiple browsers with correct message', async () => {
      const registry = BrowserRegistry.getInstance();
      const browser1 = getMockBrowser() as unknown as Browser;
      const browser2 = getMockBrowser() as unknown as Browser;
      const pages1 = [getMockPage('https://example.com/')];
      const pages2 = [getMockPage('https://other.com/')];
      const context1 = getMockContext(pages1);
      const context2 = getMockContext(pages2);

      registry.addConnectedBrowser(browser1, context1, 'http://127.0.0.1:9222');
      registry.addConnectedBrowser(browser2, context2, 'http://127.0.0.1:9223');

      const response = getMockResponse();
      await listBrowsers.handler(
        {params: {}} as Request<Record<string, never>>,
        response as unknown as Response,
        {} as McpContext,
      );

      assert.strictEqual(response.responseLines[0], 'Total browsers: 2\n');
      assert.ok(
        response.responseLines[1].includes('[1] http://127.0.0.1:9222'),
      );
      // Browser 1 pages
      assert.ok(response.responseLines[2].includes('0: https://example.com/'));
      assert.ok(
        response.responseLines[3].includes('[2] http://127.0.0.1:9223'),
      );
      // Browser 2 pages
      assert.ok(response.responseLines[4].includes('0: https://other.com/'));
      assert.ok(
        response.responseLines[5].includes('Multiple browsers detected'),
      );
      assert.ok(
        response.responseLines[5].includes('MUST specify browserIndex'),
      );
    });

    it('shows disconnected status for disconnected browser', async () => {
      const registry = BrowserRegistry.getInstance();
      const browser = getMockBrowser() as unknown as Browser;
      const context = getMockContext();

      // Mock browser as disconnected
      (browser as {connected?: boolean}).connected = false;

      registry.addConnectedBrowser(browser, context, 'ws://127.0.0.1:9222');

      const response = getMockResponse();
      await listBrowsers.handler(
        {params: {}} as Request<Record<string, never>>,
        response as unknown as Response,
        {} as McpContext,
      );

      assert.ok(response.responseLines[1].includes('disconnected'));
    });
  });

  describe('reconnect_browser', () => {
    it('throws error when browserIndex specified in single browser mode', async () => {
      const registry = BrowserRegistry.getInstance();
      const browser = getMockBrowser() as unknown as Browser;
      const context = getMockContext();

      registry.addConnectedBrowser(browser, context, 'http://127.0.0.1:9222');

      const response = getMockResponse();

      await assert.rejects(
        () =>
          reconnectBrowser.handler(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {params: {browserIndex: 1}} as any,
            response as unknown as Response,
            {} as McpContext,
          ),
        /browserIndex must NOT be specified in single-browser mode/,
      );
    });

    it('throws error when browserIndex not specified in multi browser mode', async () => {
      const registry = BrowserRegistry.getInstance();
      const browser1 = getMockBrowser() as unknown as Browser;
      const browser2 = getMockBrowser() as unknown as Browser;
      const context1 = getMockContext();
      const context2 = getMockContext();

      registry.addConnectedBrowser(browser1, context1, 'http://127.0.0.1:9222');
      registry.addConnectedBrowser(browser2, context2, 'http://127.0.0.1:9223');

      const response = getMockResponse();

      await assert.rejects(
        () =>
          reconnectBrowser.handler(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {params: {}} as any,
            response as unknown as Response,
            {} as McpContext,
          ),
        /browserIndex is required in multi-browser mode/,
      );
    });
  });
});
