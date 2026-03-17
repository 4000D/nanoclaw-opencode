# NanoClaw Agent Container
# Runs OpenCode in isolated Linux VM with browser automation

FROM node:22-slim

# Install system dependencies for Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install Bun runtime and OpenCode CLI
RUN curl -fsSL https://bun.sh/install | bash && cp /root/.bun/bin/bun /usr/local/bin/bun
RUN npm install -g agent-browser opencode-ai

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint script
# Container input (prompt, group info) is passed via stdin JSON.
# Credentials are injected by the host's credential proxy — never passed here.
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
RUN printf 'import("@opencode-ai/sdk").then(sdk=>{globalThis.__opencodeSdk=sdk;return import("./dist/index.js")}).catch(e=>{console.error(e);process.exit(1)});\n' > /app/loader.cjs \
 && printf '#!/bin/bash\nset -e\ncat > /tmp/input.json\ncd /app && exec node loader.cjs < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

RUN mkdir -p /home/node/.local/share/opencode /home/node/.local/state/opencode /home/node/.cache/opencode && chmod -R 777 /home/node/.local /home/node/.cache

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace /app && chmod 777 /home/node

# Switch to non-root user (required for --yolo)
USER node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
