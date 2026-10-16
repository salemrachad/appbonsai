import type { NextFunction, Request, Response } from 'express';

// CORS for the API, so a development frontend on the laptop (e.g. http://localhost:3000) can read
// from and talk to the Raspberry Pi. Only browser origins on this machine or the local network are
// allowed: loopback, private IPv4 ranges, and *.local mDNS names. Anything else gets no CORS headers,
// so other websites can't drive the API from a visitor's browser.
// APPBONSAI_CORS_ORIGINS adds exact origins (comma-separated), e.g. "http://my-laptop.lan:3000".

const PRIVATE_IPV4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^127\./, /^169\.254\./];

export function isLocalNetworkOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'localhost' || host === '[::1]' || host.endsWith('.local') || PRIVATE_IPV4.some((r) => r.test(host));
}

export function corsForLocalNetwork(extraOrigins: string[] = []) {
  const extra = new Set(extraOrigins.map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean));
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && (extra.has(origin) || isLocalNetworkOrigin(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, If-None-Match');
      res.setHeader('Access-Control-Expose-Headers', 'ETag'); // /api/current: the UI asks "changed since?"
      res.setHeader('Access-Control-Max-Age', '600');
      // Chrome's Private Network Access preflight (a public page is never allowed above)
      if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(origin && res.getHeader('Access-Control-Allow-Origin') ? 204 : 403);
    next();
  };
}
