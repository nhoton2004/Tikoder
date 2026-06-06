FROM node:20-slim

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
RUN npm install --production && npm rebuild sqlite3 --build-from-source

# Copy mã nguồn (vẫn sẽ tuân thủ .dockerignore để không copy node_modules từ máy host)
COPY . .

EXPOSE 3001

CMD ["npm", "start"]
