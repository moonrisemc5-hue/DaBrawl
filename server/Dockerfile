FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js protocol.js brawlers.js client-adapter.js combat.js ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
