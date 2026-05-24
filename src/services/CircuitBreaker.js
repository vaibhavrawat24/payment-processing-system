'use strict';

const { CircuitOpenError } = require('../utils/errors');
const logger = require('../utils/logger');

const STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

class CircuitBreaker {
  constructor(config = {}) {
    this.failureThreshold = config.failureThreshold || 5;
    this.halfOpenAfterMs = config.halfOpenAfterMs || 30000;
    this.successThreshold = config.successThreshold || 2;

    this._state = STATES.CLOSED;
    this._failureCount = 0;
    this._successCount = 0;
    this._openedAt = null;
    this._probeInFlight = false;
  }

  get state() {
    return this._state;
  }

  async execute(fn) {
    if (this._state === STATES.OPEN) {
      const elapsed = Date.now() - this._openedAt;
      if (elapsed < this.halfOpenAfterMs) {
        throw new CircuitOpenError();
      }
      // Transition to HALF_OPEN for a single probe
      if (this._probeInFlight) {
        throw new CircuitOpenError();
      }
      this._transitionTo(STATES.HALF_OPEN);
    }

    if (this._state === STATES.HALF_OPEN) {
      this._probeInFlight = true;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    } finally {
      if (this._state === STATES.HALF_OPEN) {
        this._probeInFlight = false;
      }
    }
  }

  _onSuccess() {
    if (this._state === STATES.HALF_OPEN) {
      this._successCount++;
      if (this._successCount >= this.successThreshold) {
        this._transitionTo(STATES.CLOSED);
      }
    } else {
      this._failureCount = 0;
    }
  }

  _onFailure() {
    if (this._state === STATES.HALF_OPEN) {
      this._transitionTo(STATES.OPEN);
      return;
    }
    this._failureCount++;
    if (this._failureCount >= this.failureThreshold) {
      this._transitionTo(STATES.OPEN);
    }
  }

  _transitionTo(newState) {
    const prev = this._state;
    this._state = newState;

    if (newState === STATES.OPEN) {
      this._openedAt = Date.now();
      this._successCount = 0;
      this._probeInFlight = false;
      logger.warn(
        { event: 'circuit.opened', previousState: prev, failureCount: this._failureCount },
        'Circuit breaker opened'
      );
    } else if (newState === STATES.HALF_OPEN) {
      logger.info({ event: 'circuit.half_open' }, 'Circuit breaker half-open — probing');
    } else if (newState === STATES.CLOSED) {
      this._failureCount = 0;
      this._openedAt = null;
      this._probeInFlight = false;
      logger.info({ event: 'circuit.closed' }, 'Circuit breaker closed — gateway recovered');
    }
  }

  reset() {
    this._state = STATES.CLOSED;
    this._failureCount = 0;
    this._successCount = 0;
    this._openedAt = null;
    this._probeInFlight = false;
  }

  getStatus() {
    return {
      state: this._state,
      failureCount: this._failureCount,
      openedAt: this._openedAt,
    };
  }
}

module.exports = CircuitBreaker;
