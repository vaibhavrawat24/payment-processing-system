'use strict';

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  db: {
    path: process.env.DB_PATH || './payments.db',
  },

  gateway: {
    failureRate: parseFloat(process.env.GATEWAY_FAILURE_RATE || '0.2'),
    timeoutRate: parseFloat(process.env.GATEWAY_TIMEOUT_RATE || '0.05'),
    timeoutMs: parseInt(process.env.GATEWAY_TIMEOUT_MS || '5000', 10),
    delayMaxMs: parseInt(process.env.GATEWAY_DELAY_MAX_MS || '500', 10),
  },

  retry: {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || '3', 10),
    baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS || '1000', 10),
    maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS || '30000', 10),
    tickIntervalMs: parseInt(process.env.RETRY_TICK_INTERVAL_MS || '1000', 10),
  },

  circuitBreaker: {
    failureThreshold: parseInt(process.env.CB_FAILURE_THRESHOLD || '5', 10),
    halfOpenAfterMs: parseInt(process.env.CB_HALF_OPEN_AFTER_MS || '30000', 10),
    successThreshold: parseInt(process.env.CB_SUCCESS_THRESHOLD || '2', 10),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    merchantWindowMs: parseInt(process.env.MERCHANT_RATE_LIMIT_WINDOW_MS || '60000', 10),
    merchantMax: parseInt(process.env.MERCHANT_RATE_LIMIT_MAX || '20', 10),
  },

  idempotency: {
    ttlMs: parseInt(process.env.IDEMPOTENCY_TTL_MS || '86400000', 10),
  },
};

module.exports = config;
