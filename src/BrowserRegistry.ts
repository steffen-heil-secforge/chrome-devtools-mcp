/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {logger} from './logger.js';
import type {McpContext} from './McpContext.js';
import type {Browser} from './third_party/index.js';

export interface BrowserEntry {
  browser: Browser;
  context: McpContext;
  url: string;
}

/**
 * Registry for managing multiple browser instances in parallel.
 */
export class BrowserRegistry {
  private browsers: BrowserEntry[] = [];

  private static instance: BrowserRegistry | null = null;

  /**
   * Get the singleton instance of BrowserRegistry.
   * Used by tools to access the registry without creating circular dependencies.
   */
  static getInstance(): BrowserRegistry {
    if (!BrowserRegistry.instance) {
      BrowserRegistry.instance = new BrowserRegistry();
    }
    return BrowserRegistry.instance;
  }

  /**
   * Add a browser to the registry.
   * @returns The index of the added browser
   */
  add(browser: Browser, context: McpContext, url: string): number {
    const index = this.browsers.length;
    this.browsers.push({browser, context, url});
    logger(`Browser registered at index ${index}: ${url}`);
    return index;
  }

  /**
   * Get a browser entry by index.
   * @throws Error if index is out of bounds
   */
  get(index: number): BrowserEntry {
    if (index < 0 || index >= this.browsers.length) {
      throw new Error(
        `Browser index ${index} is out of bounds. Valid range: 0-${this.browsers.length - 1}`,
      );
    }
    return this.browsers[index];
  }

  /**
   * Get the context for a specific browser by index.
   * If there is only one browser, index MUST be undefined.
   * If there are multiple browsers, index MUST be specified.
   * @throws Error if index is specified when only one browser exists
   * @throws Error if index is undefined when multiple browsers exist
   * @throws Error if index is out of bounds
   */
  getContext(index?: number): McpContext {
    // Single browser case: index must NOT be specified
    if (this.browsers.length === 1) {
      if (index !== undefined) {
        throw new Error(
          `browserIndex parameter must NOT be specified when only one browser is connected. ` +
            `Remove the browserIndex parameter from your tool call.`,
        );
      }
      return this.browsers[0].context;
    }

    // Multiple browsers case: index is required
    if (index === undefined) {
      throw new Error(
        `browserIndex parameter is required when multiple browsers are connected. ` +
          `Use list_browsers to see available browsers (0-${this.browsers.length - 1}).`,
      );
    }

    const entry = this.get(index);
    logger(`getContext(${index}) returning context for browser: ${entry.url}`);
    return entry.context;
  }

  /**
   * Get all browser entries.
   */
  getAll(): BrowserEntry[] {
    return [...this.browsers];
  }

  /**
   * Get the number of registered browsers.
   */
  count(): number {
    return this.browsers.length;
  }

  /**
   * Check if the registry is empty.
   */
  isEmpty(): boolean {
    return this.browsers.length === 0;
  }

  /**
   * Check if there are multiple browsers registered.
   */
  hasMultipleBrowsers(): boolean {
    return this.browsers.length > 1;
  }

  /**
   * Dispose all browsers and clear the registry.
   */
  async disposeAll(): Promise<void> {
    logger(`Disposing ${this.browsers.length} browsers`);
    for (const entry of this.browsers) {
      try {
        entry.context.dispose();
        if (entry.browser.connected) {
          await entry.browser.close();
        }
      } catch (error) {
        logger(
          `Error disposing browser: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.browsers = [];
  }
}
