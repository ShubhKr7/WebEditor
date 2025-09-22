# Use official Node image
FROM node:22

# Install bash
RUN apt-get update && apt-get install -y bash

# Set working directory
WORKDIR /app

# Copy package.json & install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your project
COPY . .

# Expose port (Render sets this automatically via $PORT)
EXPOSE 3001

# Start your app
CMD ["node", "index.js"]
