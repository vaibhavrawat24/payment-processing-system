'use strict';

const CircuitBreaker = require('../../src/services/CircuitBreaker');
const { CircuitOpenError } = require('../../src/utils/errors');

function makeBreaker(overrides = {}) {
  return new CircuitBreaker({
    failureThreshold: 3,
    halfOpenAfterMs: 100,
    successThreshold: 2,
    ...overrides,
  });
}

describe('CircuitBreaker', () => {
  test('starts CLOSED and passes calls through', async () => {
    const cb = makeBreaker();
    expect(cb.state).toBe('CLOSED');
    const result = await cb.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  test('opens after failureThreshold consecutive failures', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    const fail = () => Promise.reject(new Error('boom'));

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow('boom');
    }

    expect(cb.state).toBe('OPEN');
  });

  test('throws CircuitOpenError immediately when OPEN within halfOpenAfterMs', async () => {
    const cb = makeBreaker({ failureThreshold: 2, halfOpenAfterMs: 60000 });
    const fail = () => Promise.reject(new Error('fail'));

    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();

    expect(cb.state).toBe('OPEN');
    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitOpenError);
  });

  test('transitions to HALF_OPEN after halfOpenAfterMs', async () => {
    const cb = makeBreaker({ failureThreshold: 2, halfOpenAfterMs: 50 });
    const fail = () => Promise.reject(new Error('fail'));

    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.state).toBe('OPEN');

    await new Promise((r) => setTimeout(r, 60));

    // The next call should be allowed (HALF_OPEN probe)
    const result = await cb.execute(() => Promise.resolve('probe'));
    expect(result).toBe('probe');
    expect(cb.state).toBe('HALF_OPEN');
  });

  test('closes after successThreshold successes in HALF_OPEN', async () => {
    const cb = makeBreaker({ failureThreshold: 2, halfOpenAfterMs: 10, successThreshold: 2 });
    const fail = () => Promise.reject(new Error('fail'));

    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();

    await new Promise((r) => setTimeout(r, 20));

    // Two successful probes should close the circuit
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.state).toBe('HALF_OPEN');
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.state).toBe('CLOSED');
  });

  test('reopens from HALF_OPEN on failure', async () => {
    const cb = makeBreaker({ failureThreshold: 2, halfOpenAfterMs: 10 });
    const fail = () => Promise.reject(new Error('fail'));

    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();

    await new Promise((r) => setTimeout(r, 20));

    await expect(cb.execute(fail)).rejects.toThrow('fail');
    expect(cb.state).toBe('OPEN');
  });

  test('resets failure count on success in CLOSED state', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    const fail = () => Promise.reject(new Error('fail'));

    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getStatus().failureCount).toBe(2);

    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getStatus().failureCount).toBe(0);
    expect(cb.state).toBe('CLOSED');
  });

  test('reset() restores to CLOSED state', async () => {
    const cb = makeBreaker({ failureThreshold: 2 });
    const fail = () => Promise.reject(new Error('fail'));

    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.state).toBe('OPEN');

    cb.reset();
    expect(cb.state).toBe('CLOSED');
  });
});
