import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppDatabase, DeviceRecord } from './database';

// Devices allowed to push readings (POST /api/ingest). Each has a secret token, shown once when it is added
// and stored only as its SHA-256. Later the factory does this per box and the token rides with the barcode.

const DEVICE_ID = /^[A-Za-z0-9_-]{4,64}$/;

export const isDeviceId = (id: unknown): id is string => typeof id === 'string' && DEVICE_ID.test(id);

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const newToken = () => randomBytes(24).toString('base64url');

// Returns the token (the only time it exists in clear), or null if the id is taken or invalid
export function addDevice(db: AppDatabase, id: string, label: string | null, now = Date.now()): string | null {
  if (!isDeviceId(id)) return null;
  const token = newToken();
  return db.insertDevice({ id, tokenHash: hashToken(token), label, createdAt: now }) ? token : null;
}

// A new token for a device (the old one stops working at once)
export function rotateDeviceToken(db: AppDatabase, id: string): string | null {
  const token = newToken();
  return db.setDeviceToken(id, hashToken(token)) ? token : null;
}

// "Authorization: Bearer <token>" for this device id. Unknown device and wrong token look the same.
export function authenticateDevice(db: AppDatabase, id: unknown, authorization: string | undefined): DeviceRecord | null {
  if (!isDeviceId(id)) return null;
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
  const device = db.getDevice(id);
  if (!token || !device) return null;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(device.tokenHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? device : null;
}
