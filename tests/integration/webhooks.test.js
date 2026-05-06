'use strict';

const request = require('supertest');
const createApp = require('../../src/app');
const { createTestDb } = require('../helpers/testDb');
const Payment = require('../../src/models/Payment');
const { createIdempotencyKey, createPaymentData } = require('../helpers/factories');
const { v4: uuidv4 } = require('uuid');

const gateway = { charge: jest.fn().mockResolvedValue({ success: true, code: 'APPROVED', ref: 'gw_x' }) };

describe('Webhooks', () => {
  let app, db;

  beforeEach(() => {
    db = createTestDb();
    app = createApp({ db, gateway, skipWorker: true });
  });

  afterEach(() => db.close());

  async function createPaymentViaApi() {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Idempotency-Key', createIdempotencyKey())
      .send(createPaymentData());
    return res.body;
  }

  function moveToProcessing(paymentId) {
    const model = new Payment(db);
    const p = model.findById(paymentId);
    model.transitionStatus(paymentId, 'pending', 'processing', {}, p.version);
  }

  test('applies success webhook to processing payment', async () => {
    const payment = await createPaymentViaApi();
    moveToProcessing(payment.id);

    const res = await request(app)
      .post('/api/v1/webhooks/gateway')
      .send({ eventId: `evt_${uuidv4()}`, eventType: 'payment.success', paymentId: payment.id, payload: { gatewayRef: 'gw_123' } });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('processed');
    expect(res.body.newStatus).toBe('success');

    const getRes = await request(app).get(`/api/v1/payments/${payment.id}`);
    expect(getRes.body.status).toBe('success');
    expect(getRes.body.gatewayRef).toBe('gw_123');
  });

  test('duplicate webhook returns 200 with ignored action', async () => {
    const payment = await createPaymentViaApi();
    moveToProcessing(payment.id);

    const eventId = `evt_${uuidv4()}`;
    const body = { eventId, eventType: 'payment.success', paymentId: payment.id, payload: {} };

    const res1 = await request(app).post('/api/v1/webhooks/gateway').send(body);
    const res2 = await request(app).post('/api/v1/webhooks/gateway').send(body);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res2.body.action).toBe('ignored');
    expect(res2.body.reason).toBe('duplicate');
  });

  test('conflicting webhook (success after failed) is marked conflict', async () => {
    const payment = await createPaymentViaApi();
    const model = new Payment(db);
    const p = model.findById(payment.id);
    model.transitionStatus(payment.id, 'pending', 'processing', {}, p.version);
    model.transitionStatus(payment.id, 'processing', 'failed', { failure_reason: 'declined' }, p.version + 1);

    const res = await request(app)
      .post('/api/v1/webhooks/gateway')
      .send({ eventId: `evt_${uuidv4()}`, eventType: 'payment.success', paymentId: payment.id, payload: {} });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('conflict');

    // Payment must still be failed
    const getRes = await request(app).get(`/api/v1/payments/${payment.id}`);
    expect(getRes.body.status).toBe('failed');
  });

  test('returns 400 when eventId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/gateway')
      .send({ eventType: 'payment.success', paymentId: 'pay_x', payload: {} });

    expect(res.status).toBe(400);
  });

  test('handles concurrent duplicate webhooks safely', async () => {
    const payment = await createPaymentViaApi();
    moveToProcessing(payment.id);

    const eventId = `evt_${uuidv4()}`;
    const body = { eventId, eventType: 'payment.success', paymentId: payment.id, payload: {} };

    // Fire 5 simultaneous webhook deliveries with the same eventId
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/api/v1/webhooks/gateway').send(body)
      )
    );

    expect(responses.every((r) => r.status === 200)).toBe(true);

    const getRes = await request(app).get(`/api/v1/payments/${payment.id}`);
    expect(getRes.body.status).toBe('success');
  });
});
