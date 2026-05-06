'use strict';

const pinoHttp = require('pino-http');
const logger = require('../utils/logger');

const requestLogger = pinoHttp({
  logger,
  customLogLevel(req, res) {
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        idempotencyKey: req.headers['idempotency-key'],
      };
    },
  },
});

module.exports = requestLogger;
