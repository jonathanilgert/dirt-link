// Simple in-memory rate limiter (no external deps)
// Tracks requests per API key within a sliding window

const buckets = new Map();

function rateLimit({ windowMs = 60 * 1000, max = 60 } = {}) {
  return (req, res, next) => {
    const identifier = req.apiKey?.id || req.ip;
    const now = Date.now();

    if (!buckets.has(identifier)) {
      buckets.set(identifier, []);
    }

    const timestamps = buckets.get(identifier);

    // Remove expired entries
    while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
      timestamps.shift();
    }

    if (timestamps.length >= max) {
      const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retry_after_seconds: retryAfter
      });
    }

    timestamps.push(now);

    // Set rate limit headers
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(max - timestamps.length));

    next();
  };
}

// Clean up stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of buckets) {
    if (timestamps.length === 0 || timestamps[timestamps.length - 1] < now - 120000) {
      buckets.delete(key);
    }
  }
}, 5 * 60 * 1000);

module.exports = { rateLimit };
