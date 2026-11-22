FROM node:20-alpine

WORKDIR /app

# Install production backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy application source & static frontend
COPY backend ./backend
COPY frontend ./frontend
COPY demo_data ./demo_data
COPY package.json .env.example ./

ENV NODE_ENV=production
ENV PORT=5000
ENV HOST=0.0.0.0

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/api/health || exit 1

CMD ["node", "backend/server.js"]
