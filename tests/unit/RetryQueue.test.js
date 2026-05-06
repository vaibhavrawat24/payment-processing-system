'use strict';

const RetryQueue = require('../../src/services/RetryQueue');
const { createTestDb } = require('../helpers/testDb');

describe('RetryQueue', () => {
  let db;
  let queue;

  beforeEach(() => {
    db = createTestDb();
    queue = new RetryQueue(db, { baseDelayMs: 1000, maxDelayMs: 30000, tickIntervalMs: 50 });
  });

  afterEach(() => {
    queue.stop();
    db.close();
  });

  test('calcDelay returns exponential backoff', () => {
    expect(queue.calcDelay(1)).toBe(1000);
    expect(queue.calcDelay(2)).toBe(2000);
    expect(queue.calcDelay(3)).toBe(4000);
    expect(queue.calcDelay(10)).toBe(30000); // capped at maxDelayMs
  });

  test('enqueue creates a scheduled item', () => {
    // Insert a payment first to satisfy FK
    db.prepare(`INSERT INTO payments (id, merchant_id, amount, currency, status, retry_count, max_retries, version, created_at, updated_at)
      VALUES ('pay_1', 'merch_1', 1000, 'USD', 'pending', 0, 3, 1, ?, ?)`).run(Date.now(), Date.now());

    queue.enqueue('pay_1', Date.now(), 1);
    const row = queue.model.findByPaymentId('pay_1');
    expect(row).not.toBeNull();
    expect(row.status).toBe('scheduled');
    expect(row.attempt).toBe(1);
  });

  test('duplicate enqueue replaces existing item (UNIQUE on payment_id)', () => {
    db.prepare(`INSERT INTO payments (id, merchant_id, amount, currency, status, retry_count, max_retries, version, created_at, updated_at)
      VALUES ('pay_2', 'merch_1', 1000, 'USD', 'pending', 0, 3, 1, ?, ?)`).run(Date.now(), Date.now());

    queue.enqueue('pay_2', Date.now(), 1);
    queue.enqueue('pay_2', Date.now() + 5000, 2);

    const rows = db.prepare("SELECT * FROM retry_queue WHERE payment_id = 'pay_2'").all();
    expect(rows.length).toBe(1);
    expect(rows[0].attempt).toBe(2);
  });

  test('worker processes due items and calls paymentService.processPayment', async () => {
    db.prepare(`INSERT INTO payments (id, merchant_id, amount, currency, status, retry_count, max_retries, version, created_at, updated_at)
      VALUES ('pay_3', 'merch_1', 1000, 'USD', 'pending', 0, 3, 1, ?, ?)`).run(Date.now(), Date.now());

    const mockService = { processPayment: jest.fn().mockResolvedValue(true) };
    queue.setPaymentService(mockService);
    queue.enqueue('pay_3', Date.now() - 100, 1);
    queue.start();

    await new Promise((r) => setTimeout(r, 200));
    queue.stop();

    expect(mockService.processPayment).toHaveBeenCalledWith('pay_3', 1);
  });

  test('worker does not process future items', async () => {
    db.prepare(`INSERT INTO payments (id, merchant_id, amount, currency, status, retry_count, max_retries, version, created_at, updated_at)
      VALUES ('pay_4', 'merch_1', 1000, 'USD', 'pending', 0, 3, 1, ?, ?)`).run(Date.now(), Date.now());

    const mockService = { processPayment: jest.fn().mockResolvedValue(true) };
    queue.setPaymentService(mockService);
    queue.enqueue('pay_4', Date.now() + 60000, 1); // 60 seconds in the future
    queue.start();

    await new Promise((r) => setTimeout(r, 150));
    queue.stop();

    expect(mockService.processPayment).not.toHaveBeenCalled();
  });
});
