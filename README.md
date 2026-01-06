# MCProxy

Remote headless browser sessions via MCP (Model Context Protocol) for SaladCloud.

This project enables AI agents to control browsers running on geographically distributed SaladCloud containers. Use cases include regional price checking, geo-targeted content verification, and web automation from specific locations.

## Architecture

```
┌─────────────────┐     ┌─────────────────────────────────────────────────────┐
│  Agent/Client   │     │              Your Machine                            │
│  (Claude, etc)  │────▶│  ┌───────────────────────────────────────────────┐  │
└─────────────────┘     │  │         MCP Server (stdio)                     │  │
      stdio             │  │  - Manages WebSocket connections               │  │
                        │  │  - 60s heartbeat keepalive                     │  │
                        │  │  - Session ID → connection mapping             │  │
                        │  └──────┬─────────────────────┬──────────────────┘  │
                        └─────────│─────────────────────│──────────────────────┘
                                  │ WSS                 │ WSS
                        ┌─────────▼─────────┐  ┌───────▼───────────┐
                        │  SaladCloud       │  │  SaladCloud       │
                        │  (US Region)      │  │  (EU Region)      │
                        │  ┌─────────────┐  │  │  ┌─────────────┐  │
                        │  │ Browser Srv │  │  │  │ Browser Srv │  │
                        │  │ + Browsers  │  │  │  │ + Browsers  │  │
                        │  └─────────────┘  │  │  └─────────────┘  │
                        └───────────────────┘  └───────────────────┘
```

## Features

- **Multi-Browser Support**: Choose between Chromium, Firefox, or WebKit (Safari) for each session
- **Mobile Device Emulation**: Emulate 100+ mobile devices (iPhone, Pixel, iPad, Galaxy, etc.) with accurate viewport, user agent, and touch support
- **Location-Aware Sessions**: Each session reports its geographic location (IP, city, state/region, country, timezone, ISP). Agents can reference sessions by location (e.g., "use the Utah session")
- **Stealth Mode**: Advanced anti-detection with WebGL spoofing, navigator overrides, and realistic browser fingerprints
- **Humanized Interactions**: Optional human-like behavior for clicks, typing, and scrolling to avoid bot detection
- **Cloudflare Auto-Wait**: Automatically wait for Cloudflare challenges to complete
- **Cookie Persistence**: Save and restore cookies for session management and authentication
- **Realistic User Agents**: Auto-generates realistic user agents using up-to-date browser fingerprint data
- **Session Affinity**: WebSocket connections pin sessions to specific container replicas
- **Heartbeat Keepalive**: 60-second pings keep connections alive (Salad gateway has 100s idle timeout)
- **Multi-Region Support**: Connect to different Salad deployments for geo-distributed browsing
- **Version Compatibility**: Capability reporting with automatic version mismatch detection
- **26 MCP Tools**: Full browser automation capabilities including CAPTCHA detection

## Prerequisites

- Node.js 20+
- Docker (for local testing)
- SaladCloud account (for deployment)

## AI-Assisted Setup

Copy and paste this prompt to your AI agent to help you get mcproxy configured:

```
Help me set up mcproxy for remote browser automation. I need you to:

1. Detect which MCP client I'm using (Claude Desktop, Claude Code, Cursor, Windsurf, or other)
2. Check if I have the mcproxy repository cloned, or if I should use Docker
3. Help me configure the MCP server with the correct JSON configuration
4. Generate a secure AUTH_TOKEN for me
5. Test that the connection works by creating a browser session

The mcproxy repo is at: https://github.com/SaladTechnologies/mcproxy
Docker image: ghcr.io/saladtechnologies/mcproxy/mcp-server:latest

If I don't have a SaladCloud endpoint yet, help me test locally with Docker Compose first.
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Local Testing

Start the browser server locally with Docker:

```bash
# Start browser server (uses default dev-secret-token)
docker compose up --build
```

The repo includes a `.mcp.json` that's pre-configured to work with the Docker Compose setup. To use with Claude Code or other MCP clients that support workspace configs, just run from this directory.

To test manually:

```bash
# Uses the same default token as docker-compose
MCPROXY_AUTH_TOKEN=dev-secret-token node mcp-server/dist/index.js
```

### 4. Test with MCP Inspector

```bash
MCPROXY_AUTH_TOKEN=dev-secret-token npx @modelcontextprotocol/inspector node mcp-server/dist/index.js
```

Then create a session at `ws://localhost:3000`.

## Configuration

### Browser Server (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | WebSocket server port |
| `AUTH_TOKEN` | (required) | Shared secret for authentication |
| `MAX_CONTEXTS` | `10` | Max browser contexts per container |
| `CONTEXT_TTL_MS` | `1800000` | Context timeout (30 minutes) |

### MCP Server (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `MCPROXY_AUTH_TOKEN` or `AUTH_TOKEN` | (required) | Shared secret for authentication |
| `MCPROXY_HEARTBEAT_INTERVAL_MS` | `60000` | Heartbeat interval (60s) |
| `MCPROXY_COMMAND_TIMEOUT_MS` | `30000` | Command timeout (30s) |

## MCP Tools

### Session Management

| Tool | Description |
|------|-------------|
| `browser_create_session` | Create a new browser session with optional browser type and device emulation |
| `browser_list_sessions` | List all active sessions with browser type and location |
| `browser_close_session` | Close a session and free resources |
| `browser_list_devices` | List all available device names for mobile emulation |
| `browser_get_capabilities` | Get server capabilities and check for version mismatches |

**`browser_create_session` Parameters:**
- `endpoint` (optional): WebSocket endpoint URL (uses `MCPROXY_DEFAULT_ENDPOINT` if not provided)
- `browser_type` (optional): `chromium` (default), `firefox`, or `webkit` (Safari)
- `device` (optional): Device to emulate (e.g., `"iPhone 15"`, `"Pixel 7"`, `"iPad Pro 11"`)
- `viewport` (optional): `{ width, height }` in pixels (ignored if device is set)
- `userAgent` (optional): Custom user agent string (overrides device and random)
- `randomUserAgent` (optional): Use a random realistic user agent
- `isMobile` (optional): Emulate mobile browser
- `hasTouch` (optional): Enable touch events

### Navigation

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL with optional Cloudflare auto-wait |
| `browser_go_back` | Go back in history |
| `browser_go_forward` | Go forward in history |
| `browser_reload` | Reload the current page |

**`browser_navigate` Parameters:**
- `session_id` (required): Session ID
- `url` (required): URL to navigate to
- `wait_until` (optional): `load`, `domcontentloaded`, or `networkidle`
- `wait_for_cloudflare` (optional): Auto-wait for Cloudflare challenges to complete
- `cloudflare_timeout` (optional): Max wait time in ms (default: 15000)

### Interaction

| Tool | Description |
|------|-------------|
| `browser_click` | Click an element (supports humanized clicking) |
| `browser_type` | Type text into an input (supports humanized typing) |
| `browser_select` | Select a dropdown option |
| `browser_hover` | Hover over an element |
| `browser_scroll` | Scroll the page or element (supports humanized scrolling) |

**Humanize Option:**
The `browser_click`, `browser_type`, and `browser_scroll` tools support a `humanize: true` parameter that adds natural, human-like behavior:
- **Click**: Random delay before clicking, natural mouse movement to the element
- **Type**: Random delays between keystrokes (50-150ms)
- **Scroll**: Smooth scrolling in small increments with natural timing

### Content Extraction

| Tool | Description |
|------|-------------|
| `browser_screenshot` | Take a screenshot (returns base64 PNG, can save to file) |
| `browser_get_content` | Get HTML content |
| `browser_get_text` | Get visible text |
| `browser_evaluate` | Execute JavaScript |

### Waiting

| Tool | Description |
|------|-------------|
| `browser_wait_for_selector` | Wait for an element to appear |
| `browser_wait_for_navigation` | Wait for navigation to complete |

### Cookie Management

| Tool | Description |
|------|-------------|
| `browser_get_cookies` | Get cookies from the session (optionally filtered by URLs) |
| `browser_set_cookies` | Set cookies in the session (for restoring auth state) |
| `browser_clear_cookies` | Clear all cookies from the session |

**Cookie Persistence Example:**
```
# Save cookies after login
cookies = browser_get_cookies(session_id)
# Store cookies somewhere...

# Later, restore session
browser_set_cookies(session_id, cookies)
browser_navigate(session_id, "https://example.com/dashboard")
```

### CAPTCHA Handling

| Tool | Description |
|------|-------------|
| `browser_check_captcha` | Check for CAPTCHAs on the page, returns screenshots for agent analysis |
| `browser_solve_captcha` | Submit a CAPTCHA solution after analyzing the image |

**CAPTCHA Flow:**
1. `browser_navigate` automatically detects CAPTCHAs and returns screenshots
2. Agent analyzes the CAPTCHA image using vision capabilities
3. Agent calls `browser_solve_captcha` with the solution
4. If needed, `browser_check_captcha` can re-check the page

Supported CAPTCHA types: reCAPTCHA, hCaptcha, Cloudflare Turnstile, FunCaptcha, and generic image/text CAPTCHAs.

## MCP Client Configuration

The MCP server can be run from source, via Docker, or using npx. Choose the method that works best for your setup.

### Option 1: From Source

```bash
# Clone and build
git clone https://github.com/SaladTechnologies/mcproxy.git
cd mcproxy
npm install
npm run build
```

### Option 2: Docker (Multi-Architecture)

```bash
# Pull the multi-arch image (works on Mac M-series and Linux)
docker pull ghcr.io/saladtechnologies/mcproxy/mcp-server:latest
```

### Option 3: npx (Coming Soon)

```bash
# Once published to npm
npx @mcproxy/mcp-server
```

---

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

**From Source:**
```json
{
  "mcpServers": {
    "mcproxy": {
      "command": "node",
      "args": ["/path/to/mcproxy/mcp-server/dist/index.js"],
      "env": {
        "MCPROXY_AUTH_TOKEN": "your-secret-token",
        "MCPROXY_DEFAULT_ENDPOINT": "wss://your-salad-endpoint.salad.cloud"
      }
    }
  }
}
```

**From Docker:**
```json
{
  "mcpServers": {
    "mcproxy": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCPROXY_AUTH_TOKEN=your-secret-token",
        "-e", "MCPROXY_DEFAULT_ENDPOINT=wss://your-salad-endpoint.salad.cloud",
        "ghcr.io/saladtechnologies/mcproxy/mcp-server:latest"
      ]
    }
  }
}
```

---

### Claude Code (VS Code Extension)

Add to your workspace `.mcp.json` or global settings:

**From Source:**
```json
{
  "mcpServers": {
    "mcproxy": {
      "command": "node",
      "args": ["./mcp-server/dist/index.js"],
      "env": {
        "MCPROXY_AUTH_TOKEN": "your-secret-token",
        "MCPROXY_DEFAULT_ENDPOINT": "wss://your-salad-endpoint.salad.cloud"
      }
    }
  }
}
```

**From Docker:**
```json
{
  "mcpServers": {
    "mcproxy": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCPROXY_AUTH_TOKEN=your-secret-token",
        "-e", "MCPROXY_DEFAULT_ENDPOINT=wss://your-salad-endpoint.salad.cloud",
        "ghcr.io/saladtechnologies/mcproxy/mcp-server:latest"
      ]
    }
  }
}
```

---

### Cursor

Add to Cursor's MCP settings (`~/.cursor/mcp.json`):

**From Source:**
```json
{
  "mcpServers": {
    "mcproxy": {
      "command": "node",
      "args": ["/path/to/mcproxy/mcp-server/dist/index.js"],
      "env": {
        "MCPROXY_AUTH_TOKEN": "your-secret-token",
        "MCPROXY_DEFAULT_ENDPOINT": "wss://your-salad-endpoint.salad.cloud"
      }
    }
  }
}
```

**From Docker:**
```json
{
  "mcpServers": {
    "mcproxy": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCPROXY_AUTH_TOKEN=your-secret-token",
        "-e", "MCPROXY_DEFAULT_ENDPOINT=wss://your-salad-endpoint.salad.cloud",
        "ghcr.io/saladtechnologies/mcproxy/mcp-server:latest"
      ]
    }
  }
}
```

---

### Windsurf

Add to Windsurf's MCP configuration:

```json
{
  "mcpServers": {
    "mcproxy": {
      "command": "node",
      "args": ["/path/to/mcproxy/mcp-server/dist/index.js"],
      "env": {
        "MCPROXY_AUTH_TOKEN": "your-secret-token",
        "MCPROXY_DEFAULT_ENDPOINT": "wss://your-salad-endpoint.salad.cloud"
      }
    }
  }
}
```

---

### Other MCP Clients

Any MCP-compatible client can use mcproxy. The server communicates via stdio using the standard MCP protocol. Required environment variables:

- `MCPROXY_AUTH_TOKEN`: Authentication token (must match browser server's `AUTH_TOKEN`)
- `MCPROXY_DEFAULT_ENDPOINT` (optional): Default WebSocket endpoint so you don't need to specify it in every `browser_create_session` call

## Deploying to SaladCloud

### 1. Build and Push Docker Image

```bash
# Build the image
docker build -t your-registry/mcproxy-browser:latest -f browser-server/Dockerfile .

# Push to your container registry
docker push your-registry/mcproxy-browser:latest
```

### 2. Create Container Group on SaladCloud

1. Go to [SaladCloud Portal](https://portal.salad.com)
2. Create a new Container Group
3. Configure:
   - **Image**: `your-registry/mcproxy-browser:latest`
   - **Port**: `3000`
   - **Environment Variables**:
     - `AUTH_TOKEN`: Your secret token
     - `MAX_CONTEXTS`: `10` (adjust based on container resources)
   - **Resources**: Recommend at least 2GB RAM for browser automation
   - **Networking**: Enable Container Gateway
4. Deploy to your desired regions

### 3. Note Your Endpoints

Each container group will have an endpoint like:
```
wss://your-org-abc123.salad.cloud
```

Use these endpoints when creating browser sessions.

## Example Usage

Once configured, you can ask Claude to:

### Basic Session Creation
```
Create a browser session at wss://my-salad-endpoint.salad.cloud
```

Claude will see browser type and location info in the response:
```json
{
  "sessionId": "abc-123",
  "endpoint": "wss://my-salad-endpoint.salad.cloud",
  "browserType": "chromium",
  "location": {
    "ip": "203.0.113.42",
    "city": "Salt Lake City",
    "region": "Utah",
    "regionCode": "UT",
    "country": "United States",
    "countryCode": "US",
    "timezone": "America/Denver",
    "isp": "Example ISP"
  }
}
```

### Mobile Device Emulation
```
Create an iPhone 15 browser session and navigate to example.com.
Take a screenshot to see the mobile layout.
```

```
List available devices that include "iPad" in the name.
Create a session emulating an iPad Pro and check how the site renders.
```

### Humanized Browsing
```
Create a session and navigate to the login page. Use humanized typing to
enter the username and password, then humanized click to submit the form.
This helps avoid bot detection.
```

### Cloudflare-Protected Sites
```
Navigate to this Cloudflare-protected site with wait_for_cloudflare enabled.
Wait up to 20 seconds for any challenges to complete automatically.
```

### Multi-Browser Testing
```
Create a Chromium session and a Firefox session at wss://my-salad-endpoint.salad.cloud.
Navigate both to example.com and take screenshots to compare rendering.
```

### Geo-Distributed Price Comparison
```
Create 3 browser sessions at wss://my-salad-endpoint.salad.cloud (it will
connect to different replicas). List the sessions and tell me which locations
they're in.

Then use the session in California to check the price of "iPhone 15" on
apple.com, and use the session in Texas to check the same product. Compare
the prices including any tax differences.
```

### Referencing Sessions by Location
```
List all my browser sessions.

Navigate to netflix.com using the Utah session.

Take a screenshot of the one in New York.
```

### Cookie-Based Session Persistence
```
Log into the website, then save the cookies. I'll use them later to
restore the session without logging in again.
```

## Security Considerations

- **AUTH_TOKEN**: Use a strong, unique token. Rotate periodically.
- **Network Security**: The SaladCloud Container Gateway provides the first layer of access control.
- **Session Isolation**: Each browser context is isolated. Sessions cannot access each other's data.
- **Sensitive Data**: Avoid automating workflows that handle sensitive credentials through browser sessions.

## Development

### Project Structure

```
mcproxy/
├── shared/                    # Shared TypeScript types
│   └── src/
│       └── protocol.ts        # WebSocket message types + LocationInfo
├── browser-server/            # Remote browser server
│   └── src/
│       ├── browser-manager.ts # Playwright + stealth
│       ├── location-service.ts# IP geolocation detection
│       ├── ws-server.ts       # WebSocket server
│       ├── command-handler.ts # Command execution
│       └── index.ts           # Entry point
├── mcp-server/                # Local MCP server
│   └── src/
│       ├── browser-client.ts  # WebSocket client
│       ├── session-manager.ts # Session management + location tracking
│       ├── tools/             # MCP tool definitions
│       └── index.ts           # Entry point
├── docker-compose.yml         # Local development
└── package.json               # Monorepo configuration
```

### Building

```bash
# Build all packages
npm run build

# Build specific package
npm run build:shared
npm run build:browser-server
npm run build:mcp-server
```

### Running in Development

```bash
# Browser server (with hot reload)
npm run dev:browser-server

# MCP server (with hot reload)
npm run dev:mcp-server
```

## Troubleshooting

### Connection Timeouts

If sessions disconnect unexpectedly:
- Check that heartbeat interval (60s) is less than Salad's idle timeout (100s)
- Verify network connectivity to the SaladCloud endpoint
- Check container logs for errors

### Bot Detection

If sites detect automation:
- The stealth plugin handles most cases automatically
- Use `humanize: true` on click, type, and scroll actions for human-like behavior
- Try `randomUserAgent: true` when creating sessions to rotate fingerprints
- Use mobile device emulation (`device: "iPhone 15"`) - mobile browsers are often trusted more
- For Cloudflare-protected sites, use `wait_for_cloudflare: true` on navigate

### Cloudflare Challenges

If Cloudflare challenges aren't completing:
- Increase `cloudflare_timeout` (default is 15 seconds)
- Some challenges require interaction - check for interactive CAPTCHAs
- Try a different browser type (Firefox or WebKit)
- Use `browser_check_captcha` to see what type of challenge is present

### Version Mismatches

If you see unexpected behavior or missing features:
- Use `browser_get_capabilities` to check server version and supported features
- The tool will warn if browser server and MCP server versions are mismatched
- Update the component that's behind (recommendation provided in response)

### Memory Issues

If the browser server runs out of memory:
- Increase container memory allocation on SaladCloud (recommend 4GB+ for heavy automation)
- Reduce `MAX_CONTEXTS` to limit concurrent browser contexts
- Close sessions when done with `browser_close_session`
- Use `browser_clear_cookies` between different site visits in the same session

## License

MIT
