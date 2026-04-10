FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Create persistent directories (overridden by volume mounts in production)
RUN mkdir -p data uploads/reports uploads/photos

EXPOSE 3000

CMD ["node", "server.js"]
