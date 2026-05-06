'use strict';

const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AppError) {
    logger.warn(
      { event: 'request.error', code: err.code, statusCode: err.statusCode, path: req.path },
      err.message
    );
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
  }

  // Unexpected error
  logger.error({ event: 'request.unhandled_error', err: err.message, stack: err.stack, path: req.path }, 'Unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}

module.exports = errorHandler;
