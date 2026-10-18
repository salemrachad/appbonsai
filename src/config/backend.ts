// Where the frontend's backend lives. The ONLY place that knows the API address: every API call
// goes through apiUrl() (see src/api/client.ts). The frontend never touches SQLite or the collector;
// it only talks HTTP to the server that served this page (same origin, /api):
// - on Cloudflare: the front Worker, which hands /api to the tree's Durable Object;
// - npm run dev (= dev:local): Vite, which proxies /api to the local development server;
// - npm run server: that server itself.

export const apiUrl = (path: string) => `/api${path.startsWith('/') ? path : `/${path}`}`;

export const BACKEND = {
  label: 'The Appbonsai server',
  displayUrl: typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api',
  devBuild: import.meta.env.DEV,
};
