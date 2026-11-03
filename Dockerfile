FROM node:24-bookworm-slim
ENV NODE_ENV=production

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
