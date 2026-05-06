'use strict';

class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

class PaymentStateError extends AppError {
  constructor(message) {
    super(message, 422, 'INVALID_STATE_TRANSITION');
  }
}

class CircuitOpenError extends AppError {
  constructor() {
    super('Payment gateway is temporarily unavailable', 503, 'CIRCUIT_OPEN');
  }
}

class GatewayTimeoutError extends AppError {
  constructor() {
    super('Payment gateway timed out', 504, 'GATEWAY_TIMEOUT');
  }
}

class IdempotencyConflictError extends AppError {
  constructor() {
    super(
      'Idempotency-Key already used with a different request body',
      422,
      'IDEMPOTENCY_CONFLICT'
    );
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PaymentStateError,
  CircuitOpenError,
  GatewayTimeoutError,
  IdempotencyConflictError,
};
