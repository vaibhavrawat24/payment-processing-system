'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

// Global IP-based rate limiter
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests — please try again later',
    },
  },
});

// Per-merchant sliding window rate limiter (in-memory)
const merchantWindows = new Map();

function merchantRateLimiter(req, res, next) {
  const merchantId = req.body && req.body.merchantId;
  if (!merchantId) return next();

  const now = Date.now();
  const windowMs = config.rateLimit.merchantWindowMs;
  const maxRequests = config.rateLimit.merchantMax;

  if (!merchantWindows.has(merchantId)) {
    merchantWindows.set(merchantId, []);
  }

  // Prune timestamps outside the window
  const timestamps = merchantWindows.get(merchantId).filter((t) => now - t < windowMs);
  merchantWindows.set(merchantId, timestamps);

  if (timestamps.length >= maxRequests) {
    const oldestTs = timestamps[0];
    const retryAfterMs = windowMs - (now - oldestTs);
    res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
    return res.status(429).json({
      error: {
        code: 'MERCHANT_RATE_LIMITED',
        message: `Too many payment requests for merchant — limit is ${maxRequests} per minute`,
      },
    });
  }

  timestamps.push(now);
  next();
}

// Purge stale merchant entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [merchantId, timestamps] of merchantWindows.entries()) {
    const fresh = timestamps.filter((t) => now - t < config.rateLimit.merchantWindowMs);
    if (fresh.length === 0) {
      merchantWindows.delete(merchantId);
    } else {
      merchantWindows.set(merchantId, fresh);
    }
  }
}, 300000).unref();

module.exports = { globalLimiter, merchantRateLimiter };
