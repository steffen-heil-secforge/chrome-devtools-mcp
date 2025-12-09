/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './polyfill.js';

import type {Channel} from './browser.js';
import {ensureBrowserConnected, ensureBrowserLaunched} from './browser.js';
import {BrowserRegistry} from './BrowserRegistry.js';
import {parseArguments} from './cli.js';
import {loadIssueDescriptions} from './issue-descriptions.js';
import {logger, saveLogsToFile} from './logger.js';
import {McpContext} from './McpContext.js';
import {McpResponse} from './McpResponse.js';
import {Mutex} from './Mutex.js';
import {
  McpServer,
  StdioServerTransport,
  type CallToolResult,
  SetLevelRequestSchema,
} from './third_party/index.js';
import {ToolCategory} from './tools/categories.js';
import type {ToolDefinition} from './tools/ToolDefinition.js';
import {tools} from './tools/tools.js';

// If moved update release-please config
// x-release-please-start-version
const VERSION = '0.11.0';
// x-release-please-end

export const args = parseArguments(VERSION);

const logFile = args.logFile ? saveLogsToFile(args.logFile) : undefined;

logger(`Starting Chrome DevTools MCP Server v${VERSION}`);
const server = new McpServer(
  {
    name: 'chrome_devtools',
    title: 'Chrome DevTools MCP server',
    version: VERSION,
  },
  {capabilities: {logging: {}}},
);
server.server.setRequestHandler(SetLevelRequestSchema, () => {
  return {};
});

const browserRegistry = BrowserRegistry.getInstance();

async function initializeBrowsers(): Promise<void> {
  const extraArgs: string[] = (args.chromeArg ?? []).map(String);
  if (args.proxyServer) {
    extraArgs.push(`--proxy-server=${args.proxyServer}`);
  }
  const devtools = args.experimentalDevtools ?? false;

  // Handle multiple browser URLs or WebSocket endpoints
  if (args.browserUrl && args.browserUrl.length > 0) {
    for (const url of args.browserUrl) {
      const browser = await ensureBrowserConnected({
        browserURL: url,
        wsEndpoint: undefined,
        wsHeaders: args.wsHeaders,
        devtools,
      });
      const context = await McpContext.from(browser, logger, {
        experimentalDevToolsDebugging: devtools,
        experimentalIncludeAllPages: args.experimentalIncludeAllPages,
      });
      browserRegistry.add(browser, context, url);
    }
  } else if (args.wsEndpoint && args.wsEndpoint.length > 0) {
    for (const endpoint of args.wsEndpoint) {
      const browser = await ensureBrowserConnected({
        browserURL: undefined,
        wsEndpoint: endpoint,
        wsHeaders: args.wsHeaders,
        devtools,
      });
      const context = await McpContext.from(browser, logger, {
        experimentalDevToolsDebugging: devtools,
        experimentalIncludeAllPages: args.experimentalIncludeAllPages,
      });
      browserRegistry.add(browser, context, endpoint);
    }
  } else {
    // Default: launch a single browser
    const browser = await ensureBrowserLaunched({
      headless: args.headless,
      executablePath: args.executablePath,
      channel: args.channel as Channel,
      isolated: args.isolated ?? false,
      userDataDir: args.userDataDir,
      logFile,
      viewport: args.viewport,
      args: extraArgs,
      acceptInsecureCerts: args.acceptInsecureCerts,
      devtools,
    });
    const context = await McpContext.from(browser, logger, {
      experimentalDevToolsDebugging: devtools,
      experimentalIncludeAllPages: args.experimentalIncludeAllPages,
    });
    browserRegistry.add(browser, context, 'launched');
  }

  logger(
    `Initialized ${browserRegistry.count()} browser${browserRegistry.count() > 1 ? 's' : ''}`,
  );
}

const logDisclaimers = () => {
  console.error(
    `chrome-devtools-mcp exposes content of the browser instance to the MCP clients allowing them to inspect,
debug, and modify any data in the browser or DevTools.
Avoid sharing sensitive or personal information that you do not want to share with MCP clients.`,
  );
};

const toolMutex = new Mutex();

function registerTool(tool: ToolDefinition): void {
  if (
    tool.annotations.category === ToolCategory.EMULATION &&
    args.categoryEmulation === false
  ) {
    return;
  }
  if (
    tool.annotations.category === ToolCategory.PERFORMANCE &&
    args.categoryPerformance === false
  ) {
    return;
  }
  if (
    tool.annotations.category === ToolCategory.NETWORK &&
    args.categoryNetwork === false
  ) {
    return;
  }
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema,
      annotations: tool.annotations,
    },
    async (params): Promise<CallToolResult> => {
      const guard = await toolMutex.acquire();
      try {
        logger(`${tool.name} request: ${JSON.stringify(params, null, '  ')}`);

        // Some tools (like list_browsers) don't need a specific browser context
        let context: McpContext;
        if (tool.annotations.skipBrowserContext) {
          logger(`${tool.name} skipping browser context (doesn't need one)`);
          // For tools that don't need browser context, provide a placeholder
          // The tool handler will use BrowserRegistry directly instead
          context = {} as McpContext;
        } else {
          // Extract browserIndex from params if present
          const browserIndex = (params as {browserIndex?: number}).browserIndex;
          context = browserRegistry.getContext(browserIndex);

          if (browserIndex !== undefined) {
            logger(`${tool.name} using browser index: ${browserIndex}`);
          } else {
            logger(`${tool.name} using single browser (no index needed)`);
          }

          await context.detectOpenDevToolsWindows();
        }

        const response = new McpResponse();
        await tool.handler(
          {
            params,
          },
          response,
          context,
        );

        // For tools that skip browser context, handle response without context
        let content;
        if (tool.annotations.skipBrowserContext) {
          content = await response.handleWithoutContext(tool.name);
        } else {
          content = await response.handle(tool.name, context);
        }

        return {
          content,
        };
      } catch (err) {
        logger(`${tool.name} error:`, err, err?.stack);
        const errorText = err && 'message' in err ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: errorText,
            },
          ],
          isError: true,
        };
      } finally {
        guard.dispose();
      }
    },
  );
}

await initializeBrowsers();

for (const tool of tools) {
  registerTool(tool);
}

await loadIssueDescriptions();
const transport = new StdioServerTransport();
await server.connect(transport);
logger('Chrome DevTools MCP Server connected');
logDisclaimers();
