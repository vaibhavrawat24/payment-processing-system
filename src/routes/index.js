'use strict';

const { Router } = require('express');
const createPaymentsRouter = require('./payments');
const createWebhooksRouter = require('./webhooks');

function createRouter({ paymentService, webhookHandler }) {
  const router = Router();

  router.use('/payments', createPaymentsRouter(paymentService));
  router.use('/webhooks', createWebhooksRouter(webhookHandler));

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return router;
}

module.exports = createRouter;
