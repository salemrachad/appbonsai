// Where the daily photos' images live, apart from the database (whose rows say what each one showed):
// on Cloudflare a KV namespace (worker/index.ts, binding PHOTOS: free, 1 GB), on the laptop a folder
// (server/filePhotoStore.ts, data/photos/). No Node imports here: the Durable Object runs this too.
export interface PhotoStore {
  readonly where: string; // for status pages
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

// A key per photo: its time and a random part (never guessable from the id alone)
export const photoKey = (takenAt: number) => `photo/${new Date(takenAt).toISOString().slice(0, 10)}/${takenAt}-${crypto.randomUUID().slice(0, 8)}.jpg`;
