'use strict';

const { v4: uuidv4 } = require('uuid');
const sleep = require('../utils/sleep');
const { GatewayTimeoutError } = require('../utils/errors');
const logger = require('../utils/logger');

class GatewaySimulator {
  constructor(config = {}) {
    this.failureRate = config.failureRate ?? 0.2;
    this.timeoutRate = config.timeoutRate ?? 0.05;
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.delayMaxMs = config.delayMaxMs ?? 500;
  }

  async charge({ paymentId, amount, currency }) {
    // Simulate variable network latency
    const delay = Math.floor(Math.random() * this.delayMaxMs) + 50;
    await sleep(delay);

    // Simulate timeout
    if (Math.random() < this.timeoutRate) {
      logger.warn({ event: 'gateway.timeout', paymentId }, 'Gateway timed out');
      await sleep(this.timeoutMs);
      throw new GatewayTimeoutError();
    }

    // Simulate decline
    if (Math.random() < this.failureRate) {
      const codes = ['CARD_DECLINED', 'INSUFFICIENT_FUNDS', 'CARD_EXPIRED', 'DO_NOT_HONOR'];
      const code = codes[Math.floor(Math.random() * codes.length)];
      logger.info({ event: 'gateway.declined', paymentId, code }, 'Gateway declined payment');
      return { success: false, code, ref: null };
    }

    const ref = `gw_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    logger.info({ event: 'gateway.approved', paymentId, ref }, 'Gateway approved payment');
    return { success: true, code: 'APPROVED', ref };
  }
}

module.exports = GatewaySimulator;
