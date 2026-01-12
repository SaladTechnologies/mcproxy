# MCProxy - Claude Code Context

## Project Overview

MCProxy is a remote browser automation system via MCP (Model Context Protocol). It consists of two main components:

1. **Browser Server** (`browser-server/`): Runs on SaladCloud containers, provides headless browser automation via WebSocket
2. **MCP Server** (`mcp-server/`): Runs locally, exposes browser tools to AI agents via MCP stdio protocol

## Architecture

```
Agent (Claude) → MCP Server (local, stdio) → WebSocket → Browser Server (SaladCloud) → Playwright
```

- MCP Server manages multiple WebSocket connections to different browser server instances
- Each browser server can host multiple browser contexts (sessions)
- Sessions are location-aware and report geographic info (IP, city, region, country)

## Monorepo Structure

```
mcproxy/
├── shared/                 # Shared TypeScript types (@mcproxy/shared)
│   └── src/protocol.ts     # WebSocket message types, command params, capabilities
├── browser-server/         # Remote browser server (@mcproxy/browser-server)
│   ├── src/
│   │   ├── browser-manager.ts    # Playwright browser/context management, stealth
│   │   ├── capabilities.ts       # Server capability reporting
│   │   ├── captcha-detector.ts   # CAPTCHA detection logic
│   │   ├── command-handler.ts    # Command execution (navigate, click, etc.)
│   │   ├── location-service.ts   # IP geolocation detection
│   │   └── ws-server.ts          # WebSocket server with auth
│   └── Dockerfile
├── mcp-server/             # Local MCP server (@mcproxy/mcp-server)
│   ├── src/
│   │   ├── browser-client.ts     # WebSocket client with heartbeat
│   │   ├── credential-store.ts   # Secure credential storage and scrubbing
│   │   ├── session-manager.ts    # Session lifecycle management
│   │   └── tools/index.ts        # MCP tool definitions and handlers
│   └── Dockerfile
└── .github/workflows/      # CI/CD for Docker images
```

## Development Commands

```bash
# Install dependencies
npm install

# Build all packages (shared must build first)
npm run build

# Build specific package
npm run build:shared
npm run build:browser-server
npm run build:mcp-server

# Development with hot reload
npm run dev:browser-server
npm run dev:mcp-server

# Local testing with Docker
docker compose up --build
```

## Key Files to Understand

1. **`shared/src/protocol.ts`**: All TypeScript types for commands, params, and results. Start here to understand the API.

2. **`mcp-server/src/tools/index.ts`**: MCP tool definitions and handlers. This is where new tools are added.

3. **`browser-server/src/command-handler.ts`**: Command execution logic. Maps commands to Playwright actions.

4. **`browser-server/src/browser-manager.ts`**: Browser lifecycle, stealth configuration, device emulation.

## Adding New Features

### Adding a New MCP Tool

1. Add command type to `shared/src/protocol.ts` (`CommandType` union)
2. Add params interface to `shared/src/protocol.ts`
3. Add params to `CommandParams` union
4. Add tool definition in `mcp-server/src/tools/index.ts` (`getToolDefinitions()`)
5. Add handler in `mcp-server/src/tools/index.ts` (`handleToolCall()`)
6. Add command handler in `browser-server/src/command-handler.ts`
7. Update capabilities in `browser-server/src/capabilities.ts`

### Version Compatibility

- Both servers report version and protocol version via `get_capabilities`
- MCP server compares versions and warns on mismatch
- Update `BROWSER_SERVER_VERSION` and `PROTOCOL_VERSION` in `capabilities.ts`
- Update `mcpServerVersion` and `mcpProtocolVersion` in `tools/index.ts`

## Testing

```bash
# Test MCP server with inspector
MCPROXY_AUTH_TOKEN=dev-secret-token npx @modelcontextprotocol/inspector node mcp-server/dist/index.js

# Test with local browser server
docker compose up -d
# Then use inspector to connect to ws://localhost:3000
```

## Docker Images

- **Browser Server**: `ghcr.io/saladtechnologies/mcproxy/browser-server` (linux/amd64 only - uses Playwright)
- **MCP Server**: `ghcr.io/saladtechnologies/mcproxy/mcp-server` (linux/amd64 + linux/arm64)

Build and push manually:
```bash
# Browser server (pushed to Docker Hub for Salad deployment)
docker build -t saladtechnologies/misc:mcproxy-browser-server -f browser-server/Dockerfile .
docker push saladtechnologies/misc:mcproxy-browser-server
```

## Environment Variables

### Browser Server
- `AUTH_TOKEN`: Required. Shared secret for WebSocket auth.
- `PORT`: Default 3000. WebSocket server port.
- `MAX_CONTEXTS`: Default 10. Max browser contexts per container.
- `CONTEXT_TTL_MS`: Default 1800000 (30min). Context idle timeout.

### MCP Server
- `MCPROXY_AUTH_TOKEN` or `AUTH_TOKEN`: Required. Must match browser server.
- `MCPROXY_DEFAULT_ENDPOINT`: Optional. Default WebSocket endpoint.
- `MCPROXY_HEARTBEAT_INTERVAL_MS`: Default 30000. Keepalive interval.
- `MCPROXY_COMMAND_TIMEOUT_MS`: Default 30000. Command timeout.
- `MCPROXY_CREDENTIAL_<NAME>`: Store credentials as env vars (e.g., `MCPROXY_CREDENTIAL_GITHUB_PASSWORD`).

## Secure Credential Handling

MCProxy supports secure credential handling so the AI model can use credentials (passwords, API keys, etc.) without ever seeing the actual values.

### How It Works

```
Model: browser_type_credential(session_id, '#password', 'github_password')
         ↓
MCP Server: Resolves 'github_password' → actual value from local store
         ↓
Browser Server: Types actual value into the form field
         ↓
Model: Gets success confirmation (never sees the actual password)
```

### Setting Up Credentials

**Option 1: Environment Variables (Recommended for production)**
```bash
export MCPROXY_CREDENTIAL_GITHUB_PASSWORD="my-secret-password"
export MCPROXY_CREDENTIAL_API_KEY="sk-123..."
```

**Option 2: Credentials File**
Create `~/.mcproxy/credentials.json`:
```json
{
  "github_password": "my-secret-password",
  "api_key": "sk-123..."
}
```

### Credential Tools

- `browser_list_credentials`: List available credential names (not values)
- `browser_type_credential`: Type a credential into an input by selector
- `browser_keyboard_type_credential`: Type a credential at focused element
- `browser_set_credential`: Store a credential (for initial setup)
- `browser_delete_credential`: Remove a credential

### Security Features

1. **Reference-Only Access**: Model only sees credential names, never values
2. **Response Scrubbing**: All browser responses are automatically filtered to remove any credential values that might appear (e.g., in error messages or HTML)
3. **Local Storage**: Credentials are stored locally on the MCP server machine, never sent to AI providers
4. **File Permissions**: Credentials file is created with 600 permissions (owner-only read/write)

## Important Conventions

1. **Stealth First**: All browser automation uses stealth plugin and anti-detection measures
2. **Location Aware**: Sessions always report geographic location for agent context
3. **Humanize Option**: Interaction commands support `humanize: true` for human-like behavior
4. **Relative Coordinates**: Coordinate-based tools (click_at, drag, etc.) use 0-1 range so vision agents work at any resolution
5. **Keyboard Tools**: Prefer keyboard_type/keyboard_press over selector-based type for human-like behavior
6. **Capability Reporting**: Always update capabilities when adding features
7. **Error Handling**: Commands should return success/error objects, not throw

## Deployment Notes

- Browser server deployed to SaladCloud via Container Gateway
- Each container replica is a separate geographic location
- WebSocket connections have session affinity to specific replicas
- 30s heartbeat keeps connections alive (Salad gateway has 100s idle timeout)
