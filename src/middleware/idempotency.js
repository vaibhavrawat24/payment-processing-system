'use strict';

const crypto = require('crypto');
const { ValidationError } = require('../utils/errors');

function idempotencyMiddleware(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key) {
    return next(new ValidationError('Idempotency-Key header is required'));
  }
  if (key.length < 8 || key.length > 255) {
    return next(new ValidationError('Idempotency-Key must be between 8 and 255 characters'));
  }

  req.idempotencyKey = key;
  req.requestHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(req.body))
    .digest('hex');

  next();
}

module.exports = idempotencyMiddleware;
