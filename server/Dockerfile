FROM node:22-alpine
WORKDIR /app
COPY server/package.json ./package.json
RUN npm install --omit=dev
COPY server/index.js server/protocol.js server/brawlers.js server/client-adapter.js server/combat.js server/abilities.js server/charge.js server/bot-ai.js server/world.js server/maps.js server/match-results.js ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
