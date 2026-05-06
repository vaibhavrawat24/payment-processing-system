'use strict';

const GatewaySimulator = require('../../src/services/GatewaySimulator');

describe('GatewaySimulator', () => {
  test('returns success when failure rate is 0', async () => {
    const gw = new GatewaySimulator({ failureRate: 0, timeoutRate: 0, delayMaxMs: 0 });
    const result = await gw.charge({ paymentId: 'pay_1', amount: 1000, currency: 'USD' });
    expect(result.success).toBe(true);
    expect(result.code).toBe('APPROVED');
    expect(result.ref).toMatch(/^gw_/);
  });

  test('returns failure when failure rate is 1', async () => {
    const gw = new GatewaySimulator({ failureRate: 1, timeoutRate: 0, delayMaxMs: 0 });
    const result = await gw.charge({ paymentId: 'pay_1', amount: 1000, currency: 'USD' });
    expect(result.success).toBe(false);
    expect(result.ref).toBeNull();
    expect(['CARD_DECLINED', 'INSUFFICIENT_FUNDS', 'CARD_EXPIRED', 'DO_NOT_HONOR']).toContain(result.code);
  });

  test('throws GatewayTimeoutError when timeout rate is 1', async () => {
    const gw = new GatewaySimulator({ failureRate: 0, timeoutRate: 1, delayMaxMs: 0, timeoutMs: 1 });
    await expect(gw.charge({ paymentId: 'pay_1', amount: 1000, currency: 'USD' }))
      .rejects.toThrow('Payment gateway timed out');
  }, 5000);

  test('returns a ref string on success', async () => {
    const gw = new GatewaySimulator({ failureRate: 0, timeoutRate: 0, delayMaxMs: 0 });
    const result = await gw.charge({ paymentId: 'pay_abc', amount: 500, currency: 'EUR' });
    expect(typeof result.ref).toBe('string');
    expect(result.ref.length).toBeGreaterThan(0);
  });
});
