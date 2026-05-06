'use strict';

const { Router } = require('express');
const idempotencyMiddleware = require('../middleware/idempotency');
const { merchantRateLimiter } = require('../middleware/rateLimiter');
const { ValidationError } = require('../utils/errors');

function createPaymentsRouter(paymentService) {
  const router = Router();

  // POST /payments — initiate a new payment
  router.post(
    '/',
    idempotencyMiddleware,
    merchantRateLimiter,
    async (req, res, next) => {
      try {
        const { statusCode, body } = await paymentService.createPayment(
          req.body,
          req.idempotencyKey,
          req.requestHash
        );
        res.status(statusCode).json(body);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /payments — list payments with optional filtering
  router.get('/', (req, res, next) => {
    try {
      const limit = parseInt(req.query.limit || '20', 10);
      const offset = parseInt(req.query.offset || '0', 10);

      if (limit < 1 || limit > 100) {
        throw new ValidationError('limit must be between 1 and 100');
      }

      const payments = paymentService.listPayments({
        status: req.query.status,
        merchantId: req.query.merchantId,
        limit,
        offset,
      });
      res.json({ payments, count: payments.length, limit, offset });
    } catch (err) {
      next(err);
    }
  });

  // GET /payments/:id — get payment status
  router.get('/:id', (req, res, next) => {
    try {
      const payment = paymentService.getPayment(req.params.id);
      res.json(payment);
    } catch (err) {
      next(err);
    }
  });

  // POST /payments/:id/retry — manually retry a failed payment
  router.post('/:id/retry', (req, res, next) => {
    try {
      const payment = paymentService.retryPayment(req.params.id);
      res.json(payment);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createPaymentsRouter;
