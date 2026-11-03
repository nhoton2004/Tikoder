FROM node:24-bookworm-slim AS build

# Cài đặt build tools cần thiết để build sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Cài đặt và ép buộc build sqlite3 từ source để khớp với GLIBC của container
RUN npm ci --omit=dev && npm rebuild sqlite3 --build-from-source

# Copy mã nguồn (vẫn sẽ tuân thủ .dockerignore để không copy node_modules từ máy host)
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN mkdir -p data && chown node:node data
USER node

EXPOSE 3001

CMD ["node", "app.js"]
