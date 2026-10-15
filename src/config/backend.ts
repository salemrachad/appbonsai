// Where the frontend's backend lives. The ONLY place that knows the API address: every API call
// goes through apiUrl() (see src/api/client.ts). The frontend never touches SQLite or the collector;
// it only talks HTTP to whichever server owns them.
//
// - npm run dev:remote → VITE_API_BASE_URL (e.g. http://ender3.local:3001): the Raspberry Pi,
//   the authoritative collector and database. Set in .env.remote (see .env.example).
// - npm run dev:local / production build → empty: same origin (/api), i.e. the server that
//   served this page (dev:local's Vite proxies /api to the local development server).

const raw = (import.meta.env.VITE_API_BASE_URL ?? '').trim();
export const API_BASE_URL = raw.replace(/\/+$/, '');

export const apiUrl = (path: string) => `${API_BASE_URL}/api${path.startsWith('/') ? path : `/${path}`}`;

const remote = API_BASE_URL !== '';
export const BACKEND = {
  // true: this frontend runs on a different machine than the backend (laptop → Pi)
  remote,
  label: remote ? 'The Raspberry Pi' : 'The Appbonsai server',
  displayUrl: remote ? `${API_BASE_URL}/api` : typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api',
  devBuild: import.meta.env.DEV,
};
