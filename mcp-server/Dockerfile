# Multi-architecture Node.js image for MCP server
# Multi-stage build: build with dev deps, run with production only

# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy workspace files
COPY package.json ./
COPY shared/package.json ./shared/
COPY mcp-server/package.json ./mcp-server/

# Install all dependencies (including dev for TypeScript)
RUN npm install

# Copy source code
COPY shared/ ./shared/
COPY mcp-server/ ./mcp-server/

# Build shared package first, then mcp-server
RUN npm run build -w shared && npm run build -w mcp-server

# Production stage
FROM node:20-slim

WORKDIR /app

# Copy workspace files
COPY package.json ./
COPY shared/package.json ./shared/
COPY mcp-server/package.json ./mcp-server/

# Install production dependencies only
RUN npm install --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/mcp-server/dist ./mcp-server/dist

# Set working directory to mcp-server
WORKDIR /app/mcp-server

# The MCP server communicates via stdio, not a port
# Environment variables should be set when running
# MCPROXY_AUTH_TOKEN - required
# MCPROXY_DEFAULT_ENDPOINT - optional default browser server endpoint

# Run the MCP server
CMD ["node", "dist/index.js"]
