'use strict';

const request = require('supertest');
const createApp = require('../../src/app');
const { createTestDb } = require('../helpers/testDb');
const { createPaymentData, createIdempotencyKey } = require('../helpers/factories');

const successGateway = { charge: jest.fn().mockResolvedValue({ success: true, code: 'APPROVED', ref: 'gw_x' }) };

function makeApp() {
  const db = createTestDb();
  return createApp({ db, gateway: successGateway, skipWorker: true });
}

describe('Idempotency', () => {
  test('duplicate requests with same key return cached response without creating duplicate payment', async () => {
    const app = makeApp();
    const key = createIdempotencyKey();
    const data = createPaymentData();

    const res1 = await request(app).post('/api/v1/payments').set('Idempotency-Key', key).send(data);
    const res2 = await request(app).post('/api/v1/payments').set('Idempotency-Key', key).send(data);

    expect(res1.status).toBe(202);
    expect(res2.status).toBe(202);
    expect(res1.body.id).toBe(res2.body.id);
  });

  test('returns 422 when same key is used with different request body', async () => {
    const app = makeApp();
    const key = createIdempotencyKey();

    await request(app)
      .post('/api/v1/payments')
      .set('Idempotency-Key', key)
      .send(createPaymentData({ amount: 1000 }));

    const res2 = await request(app)
      .post('/api/v1/payments')
      .set('Idempotency-Key', key)
      .send(createPaymentData({ amount: 9999 }));

    expect(res2.status).toBe(422);
    expect(res2.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('different keys create different payments', async () => {
    const app = makeApp();
    const data = createPaymentData();

    const res1 = await request(app).post('/api/v1/payments').set('Idempotency-Key', createIdempotencyKey()).send(data);
    const res2 = await request(app).post('/api/v1/payments').set('Idempotency-Key', createIdempotencyKey()).send(data);

    expect(res1.body.id).not.toBe(res2.body.id);
  });

  test('many concurrent requests with same key create only one payment', async () => {
    const app = makeApp();
    const key = createIdempotencyKey();
    const data = createPaymentData();

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post('/api/v1/payments').set('Idempotency-Key', key).send(data)
      )
    );

    const successRes = responses.filter((r) => r.status === 202);
    const ids = new Set(successRes.map((r) => r.body.id));
    expect(ids.size).toBe(1);
  });
});
