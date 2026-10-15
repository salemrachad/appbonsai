/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Base URL of the Appbonsai API server, e.g. http://ender3.local:3001 (npm run dev:remote).
  // Empty = same origin. See src/config/backend.ts.
  readonly VITE_API_BASE_URL?: string;
}
