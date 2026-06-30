FROM node:20-slim

# Cài đặt công cụ build cho better-sqlite3 (g++ make python3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files và cài đặt dependencies
COPY package*.json ./
RUN npm install --production

# Copy toàn bộ mã nguồn
COPY . .

# Expose port 3000
EXPOSE 3000

# Khởi chạy ứng dụng
CMD ["npm", "start"]
