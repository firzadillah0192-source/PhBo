import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
export class NativeRateLimitService {
  private readonly local = new Map<string, { count: number; expires: number }>();
  constructor(private readonly store: { window(key: string, seconds: number): Promise<number> }) {}
  middleware(bucket: string, maximum: number): RequestHandler {
    return async (req, res, next) => {
      const key = `photobooth:ratelimit:${bucket}:${createHash('sha256').update(req.ip || 'unknown').digest('hex').slice(0, 24)}`;
      let count: number;
      try { count = await this.store.window(key, 60); }
      catch {
        const now = Date.now();
        for (const [id, value] of this.local) if (value.expires <= now) this.local.delete(id);
        const value = this.local.get(key) || { count: 0, expires: now + 60000 };
        count = ++value.count; this.local.set(key, value);
      }
      if (count > maximum) { res.status(429).json({ detail: { error_code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' } }); return; }
      next();
    };
  }
}
