/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {Browser} from 'puppeteer-core';

import {BrowserRegistry} from '../src/BrowserRegistry.js';
import type {McpContext} from '../src/McpContext.js';

import {getMockBrowser} from './utils.js';

function getMockContext(): McpContext {
  return {
    getSelectedPage: () => ({}) as unknown,
  } as McpContext;
}

describe('BrowserRegistry', () => {
  it('can add and retrieve browsers', () => {
    const registry = new BrowserRegistry();
    const browser1 = getMockBrowser() as unknown as Browser;
    const browser2 = getMockBrowser() as unknown as Browser;
    const context1 = getMockContext();
    const context2 = getMockContext();

    const index1 = registry.addConnectedBrowser(
      browser1,
      context1,
      'http://localhost:9222',
    );
    const index2 = registry.addConnectedBrowser(
      browser2,
      context2,
      'http://localhost:9223',
    );

    assert.strictEqual(index1, 1);
    assert.strictEqual(index2, 2);
    assert.strictEqual(registry.count(), 2);

    const entry1 = registry.get(1);
    const entry2 = registry.get(2);

    assert.strictEqual(entry1.browser, browser1);
    assert.strictEqual(entry1.context, context1);
    assert.strictEqual(entry1.url, 'http://localhost:9222');

    assert.strictEqual(entry2.browser, browser2);
    assert.strictEqual(entry2.context, context2);
    assert.strictEqual(entry2.url, 'http://localhost:9223');
  });

  it('getAll returns all browsers', () => {
    const registry = new BrowserRegistry();
    const browser1 = getMockBrowser() as unknown as Browser;
    const browser2 = getMockBrowser() as unknown as Browser;
    const context1 = getMockContext();
    const context2 = getMockContext();

    registry.addConnectedBrowser(browser1, context1, 'http://localhost:9222');
    registry.addConnectedBrowser(browser2, context2, 'http://localhost:9223');

    const all = registry.getAll();
    assert.strictEqual(all.length, 2);
    assert.strictEqual(all[0].browser, browser1);
    assert.strictEqual(all[1].browser, browser2);
  });

  it('throws error for out of bounds index', () => {
    const registry = new BrowserRegistry();
    const browser = getMockBrowser() as unknown as Browser;
    const context = getMockContext();

    registry.addConnectedBrowser(browser, context, 'http://localhost:9222');

    assert.throws(() => registry.get(5), /Browser index 5 is out of bounds/);

    assert.throws(() => registry.get(0), /Browser index 0 is out of bounds/);
  });

  it('single browser: getContext works without index', async () => {
    const registry = new BrowserRegistry();
    const browser = getMockBrowser() as unknown as Browser;
    const context = getMockContext();

    registry.addConnectedBrowser(browser, context, 'http://localhost:9222');

    const retrievedContext = await registry.getContext();
    assert.strictEqual(retrievedContext, context);
  });

  it('single browser: getContext throws error when index is specified', async () => {
    const registry = new BrowserRegistry();
    const browser = getMockBrowser() as unknown as Browser;
    const context = getMockContext();

    registry.addConnectedBrowser(browser, context, 'http://localhost:9222');

    await assert.rejects(
      () => registry.getContext(1),
      /browserIndex parameter must NOT be specified when only one browser is connected/,
    );
  });

  it('multiple browsers: getContext requires index', async () => {
    const registry = new BrowserRegistry();
    const browser1 = getMockBrowser() as unknown as Browser;
    const browser2 = getMockBrowser() as unknown as Browser;
    const context1 = getMockContext();
    const context2 = getMockContext();

    registry.addConnectedBrowser(browser1, context1, 'http://localhost:9222');
    registry.addConnectedBrowser(browser2, context2, 'http://localhost:9223');

    await assert.rejects(
      () => registry.getContext(),
      /browserIndex parameter is required when multiple browsers are connected/,
    );
  });

  it('multiple browsers: getContext works with valid index', async () => {
    const registry = new BrowserRegistry();
    const browser1 = getMockBrowser() as unknown as Browser;
    const browser2 = getMockBrowser() as unknown as Browser;
    const context1 = getMockContext();
    const context2 = getMockContext();

    registry.addConnectedBrowser(browser1, context1, 'http://localhost:9222');
    registry.addConnectedBrowser(browser2, context2, 'http://localhost:9223');

    const retrieved1 = await registry.getContext(1);
    const retrieved2 = await registry.getContext(2);

    assert.strictEqual(retrieved1, context1);
    assert.strictEqual(retrieved2, context2);
  });

  it('isEmpty returns correct value', () => {
    const registry = new BrowserRegistry();
    assert.strictEqual(registry.isEmpty(), true);

    const browser = getMockBrowser() as unknown as Browser;
    const context = getMockContext();
    registry.addConnectedBrowser(browser, context, 'http://localhost:9222');

    assert.strictEqual(registry.isEmpty(), false);
  });

  it('hasMultipleBrowsers returns correct value', () => {
    const registry = new BrowserRegistry();
    assert.strictEqual(registry.hasMultipleBrowsers(), false);

    const browser1 = getMockBrowser() as unknown as Browser;
    const context1 = getMockContext();
    registry.addConnectedBrowser(browser1, context1, 'http://localhost:9222');
    assert.strictEqual(registry.hasMultipleBrowsers(), false);

    const browser2 = getMockBrowser() as unknown as Browser;
    const context2 = getMockContext();
    registry.addConnectedBrowser(browser2, context2, 'http://localhost:9223');
    assert.strictEqual(registry.hasMultipleBrowsers(), true);
  });

  it('disposeAll clears registry', async () => {
    const registry = new BrowserRegistry();
    const browser1 = getMockBrowser() as unknown as Browser;
    const browser2 = getMockBrowser() as unknown as Browser;
    const context1 = getMockContext();
    const context2 = getMockContext();

    // Mock dispose and close methods
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    (context1 as {dispose?: () => void}).dispose = () => {};
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    (context2 as {dispose?: () => void}).dispose = () => {};

    registry.addConnectedBrowser(browser1, context1, 'http://localhost:9222');
    registry.addConnectedBrowser(browser2, context2, 'http://localhost:9223');

    assert.strictEqual(registry.count(), 2);

    await registry.disposeAll();

    assert.strictEqual(registry.count(), 0);
    assert.strictEqual(registry.isEmpty(), true);
  });
});
