# Use official Playwright image with all browser dependencies
FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy workspace files
COPY package.json ./
COPY shared/package.json ./shared/
COPY browser-server/package.json ./browser-server/

# Install dependencies
RUN npm install

# Copy source code
COPY shared/ ./shared/
COPY browser-server/ ./browser-server/

# Build shared package first, then browser-server
RUN npm run build -w shared && npm run build -w browser-server

# Set working directory to browser-server
WORKDIR /app/browser-server

# Default environment variables
ENV PORT=3000
ENV MAX_CONTEXTS=10
ENV CONTEXT_TTL_MS=1800000

# Start the server
CMD ["node", "dist/index.js"]
