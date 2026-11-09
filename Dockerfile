FROM node:26-slim
ENV NODE_ENV=production

# Cài đặt công cụ build cho better-sqlite3 (g++ make python3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files và cài đặt dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy toàn bộ mã nguồn
COPY --chown=node:node . .
RUN mkdir -p data history && chown node:node data history
USER node

# Expose port 3000
EXPOSE 3000

# Khởi chạy ứng dụng
CMD ["node", "server.js"]
