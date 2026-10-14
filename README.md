<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/00f82e11-8d15-496c-9bd6-69c04b0860bd

## Run Locally

**Prerequisites:** Node.js 22.5 or newer (uses the built-in `node:sqlite`).

1. Install dependencies: `npm install`
2. Start everything: `npm run dev`
   - Frontend: http://localhost:3000
   - Local API + sensor collector: http://localhost:3001/api (proxied through the frontend at /api)
   - Database: `data/appbonsai.db` (created automatically; inspect with `npm run db:inspect`)
3. In Settings, choose **ESP32 Hardware Sensor** and enter the ESP32 address (e.g. `http://bonsai.local`).

Readings are only collected while `npm run dev` is running.
