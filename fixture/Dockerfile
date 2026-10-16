# Reproducible image handed to Belal for Daytona fan-out. Each candidate forks from this
# identical baseline. Vulnerable by default; recovery agents patch src/server.ts and rebuild.
FROM node:22-alpine
WORKDIR /app

# tsx runs the TS directly — no build step, fewer moving parts for a 2-hour sprint.
COPY fixture/package.json ./fixture/package.json
RUN cd fixture && npm install --omit=dev --no-package-lock && npm install tsx typescript

COPY fixture/ ./fixture/
COPY redteam/ ./redteam/

ENV PORT=3000
EXPOSE 3000
WORKDIR /app/fixture
CMD ["npm", "start"]
