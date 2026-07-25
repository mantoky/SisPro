FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY db.js server.js cli.js ./
ENV PORT=3080
EXPOSE 3080
CMD ["npm", "start"]
