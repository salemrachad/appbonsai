import { Router } from 'express';
import type { AppDatabase } from '../database';
import { addDevice, isDeviceId } from '../devices';

// GET /api/devices · POST /api/devices {id, label?, token?}: the ESP32s allowed to push to this tree (what
// npm run device does on the laptop, for a server you can't open a terminal on, like the Durable Object).
// token: keep the token the device already has (at least 24 characters), so moving it to another server
// only changes its address. Without one a new token is made; either way it is returned only here.
export function deviceRoutes(db: AppDatabase): Router {
  const r = Router();
  r.get('/', (_req, res) => res.json(db.devices().map(({ id, treeId, label, createdAt, lastSeenAt, firmware }) => ({ id, treeId, label, createdAt, lastSeenAt, firmware }))));
  r.post('/', (req, res) => {
    const { id, label, token } = req.body ?? {};
    if (!isDeviceId(id)) return res.status(400).json({ error: 'id must be 4–64 letters, digits, - or _' });
    if (token !== undefined && (typeof token !== 'string' || !/^[A-Za-z0-9_-]{24,128}$/.test(token))) return res.status(400).json({ error: 'token must be 24–128 letters, digits, - or _' });
    if (db.getDevice(id)) return res.status(409).json({ error: `Device ${id} already exists` });
    const added = addDevice(db, id, typeof label === 'string' ? label.slice(0, 64) : null, Date.now(), token);
    if (!added) return res.status(400).json({ error: 'Could not add the device' });
    res.status(201).json({ id, token: added });
  });
  return r;
}
