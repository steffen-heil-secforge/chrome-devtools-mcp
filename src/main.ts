/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './polyfill.js';

import process from 'node:process';

import type {Channel} from './browser.js';
import {BrowserRegistry, type BrowserConfig} from './BrowserRegistry.js';
import {cliOptions, parseArguments} from './cli.js';
import {loadIssueDescriptions} from './issue-descriptions.js';
import {logger, saveLogsToFile} from './logger.js';
import {McpResponse} from './McpResponse.js';
import {Mutex} from './Mutex.js';
import {ClearcutLogger} from './telemetry/clearcut-logger.js';
import {computeFlagUsage} from './telemetry/flag-utils.js';
import {bucketizeLatency} from './telemetry/metric-utils.js';
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
const VERSION = '0.16.0';
// x-release-please-end

export const args = parseArguments(VERSION);

const logFile = args.logFile ? saveLogsToFile(args.logFile) : undefined;
if (
  process.env['CI'] ||
  process.env['CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS']
) {
  console.error(
    "turning off usage statistics. process.env['CI'] || process.env['CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS'] is set.",
  );
  args.usageStatistics = false;
}

let clearcutLogger: ClearcutLogger | undefined;
if (args.usageStatistics) {
  clearcutLogger = new ClearcutLogger({
    logFile: args.logFile,
    appVersion: VERSION,
    clearcutEndpoint: args.clearcutEndpoint,
    clearcutForceFlushIntervalMs: args.clearcutForceFlushIntervalMs,
    clearcutIncludePidHeader: args.clearcutIncludePidHeader,
  });
}

process.on('unhandledRejection', (reason, promise) => {
  logger('Unhandled promise rejection', promise, reason);
});

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

/**
 * Register browser configurations without connecting.
 * This allows the MCP server to start immediately without blocking on browser connections.
 */
function registerBrowserConfigs(): void {
  const extraArgs: string[] = (args.chromeArg ?? []).map(String);
  if (args.proxyServer) {
    extraArgs.push(`--proxy-server=${args.proxyServer}`);
  }
  const devtools = args.experimentalDevtools ?? false;
  const mcpContextOptions = {
    experimentalDevToolsDebugging: devtools,
    experimentalIncludeAllPages: args.experimentalIncludeAllPages,
    performanceCrux: args.performanceCrux,
  };

  // Handle multiple browser URLs or WebSocket endpoints
  if (args.browserUrl && args.browserUrl.length > 0) {
    for (const browserUrlConfig of args.browserUrl) {
      const config: BrowserConfig = {
        browserURL: browserUrlConfig.url,
        wsHeaders: args.wsHeaders,
        devtools,
        mcpContextOptions,
        startCommand: browserUrlConfig.startCommand,
      };
      browserRegistry.register(config, browserUrlConfig.url);
    }
  } else if (args.wsEndpoint && args.wsEndpoint.length > 0) {
    for (const endpoint of args.wsEndpoint) {
      const config: BrowserConfig = {
        wsEndpoint: endpoint,
        wsHeaders: args.wsHeaders,
        devtools,
        mcpContextOptions,
      };
      browserRegistry.register(config, endpoint);
    }
  } else if (args.autoConnect) {
    // Auto-connect to browser using channel/userDataDir
    const label = args.userDataDir
      ? `user-data-dir:${args.userDataDir}`
      : `channel:${args.channel}`;
    const config: BrowserConfig = {
      channel: args.channel as Channel,
      userDataDir: args.userDataDir,
      devtools,
      mcpContextOptions,
    };
    browserRegistry.register(config, label);
  } else {
    // Default: register a single browser for launch
    const ignoreDefaultChromeArgs: string[] = (
      args.ignoreDefaultChromeArg ?? []
    ).map(String);
    const config: BrowserConfig = {
      launchOptions: {
        headless: args.headless,
        executablePath: args.executablePath,
        channel: args.channel as Channel,
        isolated: args.isolated ?? false,
        userDataDir: args.userDataDir,
        logFile,
        viewport: args.viewport,
        chromeArgs: extraArgs,
        ignoreDefaultChromeArgs,
        acceptInsecureCerts: args.acceptInsecureCerts,
        devtools,
        enableExtensions: args.categoryExtensions,
      },
      devtools,
      mcpContextOptions,
    };
    browserRegistry.register(config, 'launched');
  }

  logger(
    `Registered ${browserRegistry.count()} browser${browserRegistry.count() > 1 ? 's' : ''} (connections pending)`,
  );
}

const logDisclaimers = () => {
  console.error(
    `chrome-devtools-mcp exposes content of the browser instance to the MCP clients allowing them to inspect,
debug, and modify any data in the browser or DevTools.
Avoid sharing sensitive or personal information that you do not want to share with MCP clients.`,
  );

  if (args.performanceCrux) {
    console.error(
      `Performance tools may send trace URLs to the Google CrUX API to fetch real-user experience data. To disable, run with --no-performance-crux.`,
    );
  }

  if (args.usageStatistics) {
    console.error(
      `
Google collects usage statistics to improve Chrome DevTools MCP. To opt-out, run with --no-usage-statistics.
For more details, visit: https://github.com/ChromeDevTools/chrome-devtools-mcp#usage-statistics`,
    );
  }
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
  if (
    tool.annotations.category === ToolCategory.EXTENSIONS &&
    args.categoryExtensions === false
  ) {
    return;
  }
  if (
    tool.annotations.conditions?.includes('computerVision') &&
    !args.experimentalVision
  ) {
    return;
  }
  if (
    tool.annotations.conditions?.includes('experimentalInteropTools') &&
    !args.experimentalInteropTools
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
      const startTime = Date.now();
      let success = false;
      try {
        logger(`${tool.name} request: ${JSON.stringify(params, null, '  ')}`);

        // Some tools (like list_browsers, reconnect_browser) don't need a specific browser context
        let context: Awaited<ReturnType<typeof browserRegistry.getContext>>;
        if (tool.annotations.skipBrowserContext) {
          logger(`${tool.name} skipping browser context (doesn't need one)`);
          // For tools that don't need browser context, provide a placeholder
          // The tool handler will use BrowserRegistry directly instead
          context = {} as typeof context;
        } else {
          // Extract browserIndex from params if present
          const browserIndex = (params as {browserIndex?: number}).browserIndex;
          context = await browserRegistry.getContext(browserIndex);

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
        let content, structuredContent;
        if (tool.annotations.skipBrowserContext) {
          content = await response.handleWithoutContext(tool.name);
        } else {
          const result = await response.handle(tool.name, context);
          content = result.content;
          structuredContent = result.structuredContent;
        }

        success = true;
        const result: CallToolResult & {
          structuredContent?: Record<string, unknown>;
        } = {
          content,
        };
        if (args.experimentalStructuredContent) {
          result.structuredContent = structuredContent as Record<
            string,
            unknown
          >;
        }
        return result;
      } catch (err) {
        logger(`${tool.name} error:`, err, err?.stack);
        let errorText = err && 'message' in err ? err.message : String(err);
        if ('cause' in err && err.cause) {
          errorText += `\nCause: ${err.cause.message}`;
        }
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
        void clearcutLogger?.logToolInvocation({
          toolName: tool.name,
          success,
          latencyMs: bucketizeLatency(Date.now() - startTime),
        });
        guard.dispose();
      }
    },
  );
}

// Register browser configs without connecting (non-blocking)
registerBrowserConfigs();

for (const tool of tools) {
  registerTool(tool);
}

await loadIssueDescriptions();
const transport = new StdioServerTransport();
await server.connect(transport);
logger('Chrome DevTools MCP Server connected');
logDisclaimers();
void clearcutLogger?.logDailyActiveIfNeeded();
void clearcutLogger?.logServerStart(computeFlagUsage(args, cliOptions));

// Start browser connections in the background (fire-and-forget)
browserRegistry.connectAllInBackground();
