# Multi-architecture Node.js image for MCP server
FROM node:20-slim

WORKDIR /app

# Copy workspace files
COPY package.json ./
COPY shared/package.json ./shared/
COPY mcp-server/package.json ./mcp-server/

# Install dependencies (production only)
RUN npm install --omit=dev

# Copy source code
COPY shared/ ./shared/
COPY mcp-server/ ./mcp-server/

# Build shared package first, then mcp-server
RUN npm run build -w shared && npm run build -w mcp-server

# Set working directory to mcp-server
WORKDIR /app/mcp-server

# The MCP server communicates via stdio, not a port
# Environment variables should be set when running
# MCPROXY_AUTH_TOKEN - required
# MCPROXY_DEFAULT_ENDPOINT - optional default browser server endpoint

# Run the MCP server
CMD ["node", "dist/index.js"]
