/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {BrowserRegistry} from '../BrowserRegistry.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

export const listBrowsers = defineTool({
  name: 'list_browsers',
  description: `Get a list of all connected browsers. Use this to see which browsers are available and their indices. When multiple browsers are connected, you must use the browserIndex parameter in tools to specify which browser to target.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
    skipBrowserContext: true,
  },
  schema: {},
  handler: async (_request, response) => {
    const registry = BrowserRegistry.getInstance();
    const browsers = registry.getAll();

    if (browsers.length === 0) {
      response.appendResponseLine('No browsers are currently connected.');
      return;
    }

    response.appendResponseLine(`Total browsers: ${browsers.length}\n`);

    for (let i = 0; i < browsers.length; i++) {
      const entry = browsers[i];
      response.appendResponseLine(
        `[${i + 1}] ${entry.url} - ${entry.browser.connected ? 'connected' : 'disconnected'}`,
      );
    }

    if (browsers.length > 1) {
      response.appendResponseLine(
        `\nMultiple browsers detected. You MUST specify browserIndex parameter in all tool calls to target a specific browser.`,
      );
    } else {
      response.appendResponseLine(
        `\nSingle browser mode: browserIndex parameter must NOT be specified.`,
      );
    }
  },
});
