# Multi-Browser Support Implementation

This document describes the implementation of parallel multi-browser support in chrome-devtools-mcp.

## Overview

The MCP server now supports connecting to multiple browser instances simultaneously. Each tool can target a specific browser using the `browserIndex` parameter.

**Key behavior:**

- **Single browser mode**: When only one browser is configured, `browserIndex` MUST NOT be specified. Tools work without the parameter, maintaining backward compatibility.
- **Multiple browser mode**: When multiple browsers are configured, `browserIndex` is REQUIRED for all tool calls. There is no default browser.

**Strict validation:**

- ❌ Single browser + `browserIndex` specified → **ERROR**
- ✅ Single browser + no `browserIndex` → **SUCCESS**
- ❌ Multiple browsers + no `browserIndex` → **ERROR**
- ✅ Multiple browsers + `browserIndex` specified → **SUCCESS**

## Key Changes

### 1. Browser Registry ([src/BrowserRegistry.ts](src/BrowserRegistry.ts))

New class to manage multiple browser instances with lazy connection model:

**Registration Methods:**
- `register(config, url)`: Register a browser configuration without connecting (lazy initialization)
- `addConnectedBrowser(browser, context, url)`: Add an already-connected browser (for testing/backward compatibility)

**Connection Management:**
- `connect(index, force?, runStartCommand?)`: Attempt connection to a browser with retry logic
- `ensureConnected(index)`: Ensure browser is connected, respecting cooldown period
- `reconnect(index, force?)`: Manually reconnect to a disconnected browser
- `connectAllInBackground()`: Start connecting all registered browsers in background

**Query Methods:**
- `get(index)`: Get a specific browser entry (1-based index)
- `getContext(index?)`: Get context for a browser. When only one browser exists, index MUST be undefined (throws error if specified). When multiple browsers exist, index is required (throws error if undefined).
- `getAll()`: List all registered browsers
- `count()`: Number of registered browsers
- `isEmpty()`: Check if no browsers are registered
- `hasMultipleBrowsers()`: Check if multiple browsers are registered
- `canRetry(index)`: Check if reconnection can be attempted (respects cooldown)

**Lifecycle:**
- `disposeAll()`: Close all browsers and clear registry

**Connection States:**
- `pending`: Browser registered but not yet connected
- `connecting`: Connection attempt in progress
- `connected`: Browser successfully connected
- `disconnected`: Connection lost or failed

**Features:**
- Mutex-protected connections (prevents concurrent connection attempts)
- Automatic retry with exponential backoff
- 60-second cooldown between reconnection attempts
- Optional startCommand execution for browser restart
- Last error and attempt timestamp tracking

### 2. CLI Changes ([src/cli.ts](src/cli.ts))

- `--browserUrl` now accepts multiple values: `--browserUrl http://127.0.0.1:9222 --browserUrl http://127.0.0.1:9223`
- `--browserUrl` supports optional start command: `--browserUrl "http://localhost:9222|chrome --remote-debugging-port=9222"`
  - The command after `|` is executed when reconnection is requested and browser is not reachable
  - ⚠️ **Security**: Command runs with server privileges via shell - only use trusted commands
- `--wsEndpoint` now accepts multiple values: `--wsEndpoint ws://...  --wsEndpoint ws://...`

### 3. Main Server Changes ([src/main.ts](src/main.ts))

- `registerBrowserConfigs()`: Registers browser configurations without connecting (lazy initialization)
- Browser registry is exported as singleton via `BrowserRegistry.getInstance()`
- Tool handler updated to:
  - Extract `browserIndex` from params
  - Call `registry.getContext(browserIndex)` to get the appropriate browser context
  - Automatically trigger connection if browser is not yet connected
  - Route tool execution to the correct browser

### 4. Tool Definition Changes

#### New Schema ([src/tools/ToolDefinition.ts](src/tools/ToolDefinition.ts))

Added `browserIndexSchema`:

```typescript
export const browserIndexSchema = {
  browserIndex: zod
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `Index of the browser to use (1-based). When multiple browsers are configured via --browserUrl or --wsEndpoint, this parameter is REQUIRED to specify which browser to target. When only one browser is configured, this parameter can be omitted. Use list_browsers to see available browser indices.`,
    ),
};
```

#### All Tools Updated

Every tool now includes `...browserIndexSchema` in its schema definition, allowing the optional `browserIndex` parameter.

**Example from pages.ts:**

```typescript
export const listPages = defineTool({
  name: 'list_pages',
  description: `Get a list of pages open in the browser.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {
    ...browserIndexSchema, // ← Added
  },
  handler: async (_request, response) => {
    response.setIncludePages(true);
  },
});
```

### 5. New Browser Management Tools ([src/tools/browser_management.ts](src/tools/browser_management.ts))

#### `list_browsers`

Lists all connected browsers with their indices and connection status.

**Example output (single browser):**

```
Total browsers: 1

[1] http://127.0.0.1:9222 - connected

Single browser mode: browserIndex parameter must NOT be specified.
```

**Example output (multiple browsers):**

```
Total browsers: 2

[1] http://127.0.0.1:9222 - connected
[2] http://127.0.0.1:9223 - connected

Multiple browsers detected. You MUST specify browserIndex parameter in all tool calls to target a specific browser.
```

## Usage Examples

### Starting with Multiple Browsers

```bash
# Connect to two existing browsers
npx chrome-devtools-mcp@latest \
  --browserUrl http://127.0.0.1:9222 \
  --browserUrl http://127.0.0.1:9223

# Or with WebSocket endpoints
npx chrome-devtools-mcp@latest \
  --wsEndpoint ws://127.0.0.1:9222/devtools/browser/abc \
  --wsEndpoint ws://127.0.0.1:9223/devtools/browser/def
```

### Using Tools with Specific Browsers

```typescript
// List browsers to see what's available
await client.callTool('list_browsers', {});

// SINGLE BROWSER MODE (browserIndex must NOT be specified)
// Take screenshot when only one browser is running
await client.callTool('take_screenshot', {
  format: 'png',
});

// This would be an ERROR in single browser mode:
await client.callTool('take_screenshot', {
  browserIndex: 1, // ❌ Error: browserIndex must NOT be specified
  format: 'png',
});

// MULTIPLE BROWSER MODE (browserIndex REQUIRED)
// Take screenshot from browser 1
await client.callTool('take_screenshot', {
  browserIndex: 1,
  format: 'png',
});

// Take screenshot from browser 2
await client.callTool('take_screenshot', {
  browserIndex: 2,
  format: 'png',
});

// List pages from browser 2
await client.callTool('list_pages', {
  browserIndex: 2,
});

// Navigate page in browser 1
await client.callTool('navigate_page', {
  browserIndex: 1,
  type: 'url',
  url: 'https://example.com',
});

// If you forget browserIndex with multiple browsers, you'll get an error:
// Error: browserIndex parameter is required when multiple browsers are connected.
```

## Architecture

### Browser Selection Flow

```
User calls tool with/without browserIndex
         ↓
main.ts tool handler extracts browserIndex from params
         ↓
browserRegistry.getContext(browserIndex)
         ↓
  Single browser?
    Yes → browserIndex specified?
            Yes → Throw error: "browserIndex must NOT be specified"
            No  → Return that browser's context
    No  → browserIndex specified?
            Yes → Return specified browser's context
            No  → Throw error: "browserIndex parameter is required"
         ↓
Tool handler executes with that context
```

### Browser Initialization Flow

```
main.ts initialization
         ↓
initializeBrowsers() called
         ↓
For each browserUrl/wsEndpoint:
  - ensureBrowserConnected()
  - McpContext.from(browser)
  - browserRegistry.add(browser, context, url)
```

## Backward Compatibility

- **Single browser usage remains unchanged**: If only one browser is configured (or no `--browserUrl`/`--wsEndpoint` specified), behavior is identical to previous versions. `browserIndex` parameter can be omitted.
- **Existing configurations**: All existing single-browser `--browserUrl` and `--wsEndpoint` usage continues to work without any changes.
- **New multi-browser behavior**: When multiple browsers are configured, `browserIndex` becomes required. This is a new feature and doesn't break existing single-browser setups.

## Tool Updates Required

The following tool files have been updated to include `browserIndexSchema`:

- ✅ [src/tools/pages.ts](src/tools/pages.ts) - All page management tools
- ✅ [src/tools/screenshot.ts](src/tools/screenshot.ts) - Screenshot tool
- ✅ [src/tools/input.ts](src/tools/input.ts) - All input tools (click, fill, hover, drag, etc.)
- ✅ [src/tools/snapshot.ts](src/tools/snapshot.ts) - Snapshot and wait_for tools
- ✅ [src/tools/emulation.ts](src/tools/emulation.ts) - Emulation tool
- ✅ [src/tools/console.ts](src/tools/console.ts) - Console message tools
- ✅ [src/tools/network.ts](src/tools/network.ts) - Network request tools
- ✅ [src/tools/script.ts](src/tools/script.ts) - Script evaluation tool
- ✅ [src/tools/performance.ts](src/tools/performance.ts) - Performance tracing tools

### Pattern for Updating Tools

1. Add `browserIndexSchema` to import:

   ```typescript
   import {defineTool, browserIndexSchema} from './ToolDefinition.js';
   ```

2. Add to schema:
   ```typescript
   schema: {
     ...browserIndexSchema,  // ← Add this as first line
     // ... other schema fields
   },
   ```

## Testing

### Manual Testing Steps

1. **Start two browsers on different ports:**

   ```bash
   # Terminal 1
   google-chrome --remote-debugging-port=9222

   # Terminal 2
   google-chrome --remote-debugging-port=9223 --user-data-dir=/tmp/chrome2
   ```

2. **Start MCP server:**

   ```bash
   npx chrome-devtools-mcp@latest \
     --browserUrl http://127.0.0.1:9222 \
     --browserUrl http://127.0.0.1:9223
   ```

3. **Test browser management:**
   - Call `list_browsers` → should show 2 browsers
   - Call `select_default_browser` with `browserIndex: 1`
   - Call `list_browsers` again → browser 1 should be marked as default

4. **Test tool routing:**
   - Navigate browser 1 to `https://example.com`: `navigate_page` with `browserIndex: 1`
   - Navigate browser 2 to `https://google.com`: `navigate_page` with `browserIndex: 2`
   - Take screenshots from both
   - Verify pages are different

### Automated Tests

Tests need to be added for:

- `BrowserRegistry` class methods
- Multi-browser initialization in main.ts
- Tool routing with browserIndex parameter
- Browser management tools
- Error handling for invalid browserIndex

## Security Considerations

**Note:** The original implementation already warns users about exposing browser content to MCP clients. With multi-browser support:

- **Increased attack surface**: Multiple browsers means multiple potential targets
- **Browser isolation**: Browsers run independently; compromise of one doesn't affect others
- **Index validation**: browserIndex is validated against available browsers
- **No cross-browser operations**: Tools operate on one browser at a time

## Future Enhancements

- [ ] Add `disconnect_browser` tool to remove a browser from registry
- [ ] Add `connect_browser` tool to add browsers at runtime
- [ ] Support browser-specific wsHeaders for authentication
- [ ] Add browser labels/names instead of just indices
- [ ] Implement browser health checks and auto-reconnection
- [ ] Add metrics/telemetry per browser
- [ ] Support browser groups/tags for bulk operations

## Migration Guide

### For Users

**Before:**

```bash
npx chrome-devtools-mcp@latest --browserUrl http://127.0.0.1:9222
```

**After (same behavior):**

```bash
npx chrome-devtools-mcp@latest --browserUrl http://127.0.0.1:9222
```

**New capability:**

```bash
npx chrome-devtools-mcp@latest \
  --browserUrl http://127.0.0.1:9222 \
  --browserUrl http://127.0.0.1:9223 \
  --browserUrl http://127.0.0.1:9224
```

### For AI Agents

**Before:**

```
take_screenshot with format=png
```

**After (same behavior):**

```
take_screenshot with format=png
```

**New capability (multiple browsers):**

```
list_browsers
→ Shows: [1], [2], [3]
→ Warning: "You MUST specify browserIndex parameter in all tool calls"

take_screenshot with browserIndex=2, format=png
→ Takes screenshot from browser 2

take_screenshot with format=png (no browserIndex)
→ Error: "browserIndex parameter is required when multiple browsers are connected"
```

## Implementation Status

- ✅ BrowserRegistry class (with singleton pattern)
- ✅ CLI updates for multiple URLs
- ✅ main.ts initialization logic
- ✅ Tool routing with browserIndex
- ✅ browserIndexSchema definition
- ✅ Browser management tools (list_browsers)
- ✅ All tool schemas updated
- ✅ Tests (BrowserRegistry + browser-management)
- ✅ Documentation regenerated (tool-reference.md + README.md)
- ✅ Clean architecture (no circular dependencies)
- ✅ Consistent naming (kebab-case for multi-word files)

## Known Limitations

1. **No runtime browser addition/removal**: Browsers must be configured at startup
2. **No browser-specific configuration**: All browsers share same settings (headless, viewport, etc.)
3. **wsHeaders apply to all**: Cannot specify different headers per WebSocket endpoint
4. **No browser lifecycle management**: Cannot launch additional browsers after startup
5. **Index-based only**: No support for named browsers

These limitations can be addressed in future iterations.
