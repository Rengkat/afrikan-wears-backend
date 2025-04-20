# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm ci

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy app files with correct permissions
COPY --chown=appuser:appgroup . .

# Switch to non-root user
USER appuser

# Stage 2: Runtime
FROM node:18-alpine
WORKDIR /app

# Create the same non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy only what's needed from builder
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package*.json ./
COPY --from=builder --chown=appuser:appgroup /app ./

# Environment variables
ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

# Run as non-root user
USER appuser

# Simple health check using curl (optional - can remove if not needed)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5000/ || exit 1

# Start command
CMD ["node", "app.js"]