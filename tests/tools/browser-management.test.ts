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
import {listBrowsers} from '../../src/tools/browser-management.js';
import type {Request, Response} from '../../src/tools/ToolDefinition.js';
import {getMockBrowser} from '../utils.js';

function getMockContext(): McpContext {
  return {
    getSelectedPage: () => ({}) as unknown,
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
    it('shows message when no browsers connected', async () => {
      const response = getMockResponse();
      await listBrowsers.handler(
        {params: {}} as Request<Record<string, never>>,
        response as unknown as Response,
        {} as McpContext,
      );

      assert.strictEqual(
        response.responseLines[0],
        'No browsers are currently connected.',
      );
    });

    it('lists single browser with correct message', async () => {
      const registry = BrowserRegistry.getInstance();
      const browser = getMockBrowser() as unknown as Browser;
      const context = getMockContext();

      registry.add(browser, context, 'http://127.0.0.1:9222');

      const response = getMockResponse();
      await listBrowsers.handler(
        {params: {}} as Request<Record<string, never>>,
        response as unknown as Response,
        {} as McpContext,
      );

      assert.strictEqual(response.responseLines[0], 'Total browsers: 1\n');
      assert.ok(
        response.responseLines[1].includes('[0] http://127.0.0.1:9222'),
      );
      assert.ok(response.responseLines[1].includes('connected'));
      assert.ok(response.responseLines[2].includes('Single browser mode'));
      assert.ok(response.responseLines[2].includes('must NOT be specified'));
    });

    it('lists multiple browsers with correct message', async () => {
      const registry = BrowserRegistry.getInstance();
      const browser1 = getMockBrowser() as unknown as Browser;
      const browser2 = getMockBrowser() as unknown as Browser;
      const context1 = getMockContext();
      const context2 = getMockContext();

      registry.add(browser1, context1, 'http://127.0.0.1:9222');
      registry.add(browser2, context2, 'http://127.0.0.1:9223');

      const response = getMockResponse();
      await listBrowsers.handler(
        {params: {}} as Request<Record<string, never>>,
        response as unknown as Response,
        {} as McpContext,
      );

      assert.strictEqual(response.responseLines[0], 'Total browsers: 2\n');
      assert.ok(
        response.responseLines[1].includes('[0] http://127.0.0.1:9222'),
      );
      assert.ok(
        response.responseLines[2].includes('[1] http://127.0.0.1:9223'),
      );
      assert.ok(
        response.responseLines[3].includes('Multiple browsers detected'),
      );
      assert.ok(
        response.responseLines[3].includes('MUST specify browserIndex'),
      );
    });

    it('shows disconnected status for disconnected browser', async () => {
      const registry = BrowserRegistry.getInstance();
      const browser = getMockBrowser() as unknown as Browser;
      const context = getMockContext();

      // Mock browser as disconnected
      (browser as {connected?: boolean}).connected = false;

      registry.add(browser, context, 'ws://127.0.0.1:9222');

      const response = getMockResponse();
      await listBrowsers.handler(
        {params: {}} as Request<Record<string, never>>,
        response as unknown as Response,
        {} as McpContext,
      );

      assert.ok(response.responseLines[1].includes('disconnected'));
    });
  });
});
