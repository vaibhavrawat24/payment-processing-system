'use strict';

const express = require('express');
const { getDb } = require('./db/database');
const GatewaySimulator = require('./services/GatewaySimulator');
const CircuitBreaker = require('./services/CircuitBreaker');
const RetryQueue = require('./services/RetryQueue');
const PaymentService = require('./services/PaymentService');
const WebhookHandler = require('./services/WebhookHandler');
const createRouter = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const { globalLimiter } = require('./middleware/rateLimiter');
const config = require('./config');

function createApp(overrides = {}) {
  const db = overrides.db || getDb();

  const gateway = overrides.gateway || new GatewaySimulator(config.gateway);
  const circuitBreaker = overrides.circuitBreaker || new CircuitBreaker(config.circuitBreaker);
  const retryQueue = overrides.retryQueue || new RetryQueue(db, config.retry);

  const paymentService = overrides.paymentService ||
    new PaymentService(db, gateway, circuitBreaker, retryQueue);

  const webhookHandler = overrides.webhookHandler || new WebhookHandler(db);

  // Wire up the circular dependency
  retryQueue.setPaymentService(paymentService);

  if (!overrides.skipWorker) {
    retryQueue.start();
  }

  const app = express();

  app.use(express.json());
  app.use(requestLogger);
  app.use(globalLimiter);

  app.use('/api/v1', createRouter({ paymentService, webhookHandler }));

  app.use(errorHandler);

  app.retryQueue = retryQueue;
  app.paymentService = paymentService;
  app.circuitBreaker = circuitBreaker;

  return app;
}

module.exports = createApp;
