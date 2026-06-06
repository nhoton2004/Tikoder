FROM node:20-slim

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
