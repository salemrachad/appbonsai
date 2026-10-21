import fs from 'node:fs/promises';
import path from 'node:path';
import type { PhotoStore } from './photoStore';

// The laptop's photo store: one file per photo under a folder next to the database (data/photos/ for
// data/appbonsai.db, data/photos-dev/ for the dev database), gitignored with it.
export function filePhotoStore(dir: string): PhotoStore {
  const file = (key: string) => {
    const p = path.resolve(dir, key);
    if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error('Bad photo key');
    return p;
  };
  return {
    where: dir,
    async put(key, bytes) {
      await fs.mkdir(path.dirname(file(key)), { recursive: true });
      await fs.writeFile(file(key), bytes);
    },
    async get(key) {
      try {
        return new Uint8Array(await fs.readFile(file(key)));
      } catch {
        return null;
      }
    },
    async delete(key) {
      await fs.rm(file(key), { force: true });
    },
  };
}

// data/appbonsai.db → data/photos, data/appbonsai-dev.db → data/photos-dev, x/other.db → x/photos-other
export function photoDirFor(dbPath: string): string {
  const base = path.basename(dbPath).replace(/\.db$/, '');
  const suffix = base === 'appbonsai' ? '' : `-${base.replace(/^appbonsai-/, '')}`;
  return path.join(path.dirname(dbPath), `photos${suffix}`);
}
