import { Router } from 'express';
import type { CalibrationService } from '../calibration';

const sensorOf = (v: unknown) => (v === 'soil' || v === 'light' ? v : null);

// GET /api/calibration · POST /api/calibration/capture {sensor} · POST /api/calibration/soil (manual: true = typed dry/wet)
// POST /api/calibration/light (manual: true = typed min/max)
// DELETE /api/calibration/:sensor
export function calibrationRoutes(service: CalibrationService): Router {
  const r = Router();

  r.get('/', (_req, res) => res.json(service.get()));

  r.post('/capture', async (req, res) => {
    const sensor = sensorOf(req.body?.sensor);
    if (!sensor) return res.status(400).json({ error: 'sensor must be soil or light' });
    res.json(await service.capture(sensor));
  });

  r.post('/soil', async (req, res) => {
    const { dryRaw, wetRaw, dry, wet, confirm, dryRun, manual } = req.body ?? {};
    res.json(await service.saveSoil({ dryRaw: Number(dryRaw), wetRaw: Number(wetRaw), dry, wet, confirm: !!confirm, dryRun: !!dryRun, manual: !!manual }));
  });

  r.post('/light', async (req, res) => {
    const { darkRaw, brightRaw, dark, bright, confirm, dryRun, manual } = req.body ?? {};
    res.json(await service.saveLight({ darkRaw: Number(darkRaw), brightRaw: Number(brightRaw), dark, bright, confirm: !!confirm, dryRun: !!dryRun, manual: !!manual }));
  });

  r.delete('/:sensor', (req, res) => {
    const sensor = sensorOf(req.params.sensor);
    if (!sensor) return res.status(400).json({ error: 'sensor must be soil or light' });
    res.json(service.clear(sensor));
  });

  return r;
}
