'use strict';

const { Router } = require('express');

function createWebhooksRouter(webhookHandler) {
  const router = Router();

  // POST /webhooks/gateway — receive async payment status updates from gateway
  router.post('/gateway', (req, res, next) => {
    try {
      const { eventId, eventType, paymentId, payload = {} } = req.body;
      const result = webhookHandler.handleEvent({ eventId, eventType, paymentId, payload });
      // Always return 200 so the gateway does not endlessly retry
      res.json({ received: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createWebhooksRouter;
