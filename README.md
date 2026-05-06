# Payment Processing System

A production-grade payment processing simulation built with Node.js, demonstrating real-world backend engineering patterns: idempotency, optimistic concurrency control, exponential backoff retries, circuit breaker, and webhook handling.

---

## Architecture Overview

```
Client
  │
  ▼
Express API  ──────────────────────────────────┐
  │                                            │
  ├── POST /api/v1/payments                    │
  │     └── IdempotencyMiddleware              │
  │           └── PaymentService.createPayment │
  │                 └── RetryQueue.enqueue ────┤
  │                                            │
  ├── GET  /api/v1/payments/:id               │
  ├── POST /api/v1/payments/:id/retry          │
  └── POST /api/v1/webhooks/gateway            │
        └── WebhookHandler.handleEvent         │
                                               │
RetryQueue Worker (polling)  ◄─────────────────┘
  └── PaymentService.processPayment
        └── CircuitBreaker.execute
              └── GatewaySimulator.charge
```

### State Machine

```
                    ┌─────────────┐
    [created]       │   PENDING   │
────────────────────►             │
                    └──────┬──────┘
                           │ retry queue picks up
                           ▼
                    ┌─────────────┐
                    │ PROCESSING  │
                    └──────┬──────┘
               ┌───────────┴──────────────┐
               │                          │
               ▼                          ▼
        ┌─────────────┐           ┌──────────────┐
        │   SUCCESS   │           │    FAILED    │
        └─────────────┘           └──────────────┘
                                         │
                           retryable?    │
                      ┌──────────────────┘
                      │
                      ▼ (back to PENDING with attempt++)
```

---

## Key Design Decisions

### Idempotency
Every `POST /payments` request requires an `Idempotency-Key` header. The system stores a SHA-256 hash of the request body alongside the cached response. Duplicate requests return the cached response immediately. Body mismatches (same key, different payload) return `422`.

### Concurrency Control (Optimistic Locking)
Every payment row has a `version` integer. State transitions use:
```sql
UPDATE payments SET status=?, version=version+1 WHERE id=? AND status=? AND version=?
```
If `changes === 0`, the lock was lost to another worker. This prevents double-processing without `SELECT FOR UPDATE` (which SQLite doesn't support).

### Retry Logic
- Queue-backed (survives restarts): `retry_queue` table
- Exponential backoff with ±20% jitter: `delay = min(baseDelay × 2^attempt, maxDelay) ± 20%`
- Default: 3 attempts, starting at 1s, capping at 30s
- Only network/timeout errors are retried; card declines are permanent failures

### Circuit Breaker
Three-state machine: `CLOSED → OPEN → HALF_OPEN → CLOSED`
- Opens after 5 consecutive gateway failures
- Waits 30s before allowing a probe (HALF_OPEN)
- Closes after 2 consecutive successful probes
- While open: returns `503 Service Unavailable` with `Retry-After`

### Webhook Handling
- Deduplication via `UNIQUE` constraint on `event_id`
- **Terminal state wins**: a webhook cannot override an already-success or already-failed payment
- Conflicting states are logged and marked as `conflict` (not silently dropped)
- Always returns `200 OK` to the gateway to prevent endless retries

---

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Start server (auto-runs migrations)
npm start

# Development mode (auto-restarts on file changes)
npm run dev
```

Server starts on `http://localhost:3000`.

---

## API Reference

### Create Payment
```http
POST /api/v1/payments
Idempotency-Key: <unique-key>
Content-Type: application/json

{
  "merchantId": "merchant_abc",
  "amount": 1999,
  "currency": "USD",
  "metadata": { "orderId": "order_xyz" }
}
```

**Response `202 Accepted`:**
```json
{
  "id": "uuid",
  "merchantId": "merchant_abc",
  "amount": 1999,
  "currency": "USD",
  "status": "pending",
  "retryCount": 0,
  "maxRetries": 3,
  "createdAt": "2026-05-06T10:00:00.000Z",
  "updatedAt": "2026-05-06T10:00:00.000Z"
}
```

> **Note:** `amount` is in the smallest currency unit (cents for USD).

---

### Get Payment
```http
GET /api/v1/payments/:id
```

---

### List Payments
```http
GET /api/v1/payments?status=pending&merchantId=merchant_abc&limit=20&offset=0
```

---

### Manually Retry Failed Payment
```http
POST /api/v1/payments/:id/retry
```

---

### Receive Gateway Webhook
```http
POST /api/v1/webhooks/gateway
Content-Type: application/json

{
  "eventId": "evt_abc123",
  "eventType": "payment.success",
  "paymentId": "uuid",
  "payload": { "gatewayRef": "gw_xyz" }
}
```

Supported `eventType` values: `payment.success`, `payment.failed`

---

### Health Check
```http
GET /api/v1/health
```

---

## Manual Testing (curl)

Start the server first: `npm start`

**1. Create a payment**
```bash
curl -s -X POST http://localhost:3000/api/v1/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-abc-001" \
  -d '{"merchantId": "merchant_1", "amount": 2999, "currency": "USD", "metadata": {"orderId": "order-abc"}}' \
  | jq .
```

**2. Poll payment status**
```bash
curl -s http://localhost:3000/api/v1/payments/<id> | jq .status
```

**3. Replay the same request — should return the exact same payment ID (idempotency)**
```bash
curl -s -X POST http://localhost:3000/api/v1/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-abc-001" \
  -d '{"merchantId": "merchant_1", "amount": 2999, "currency": "USD", "metadata": {"orderId": "order-abc"}}' \
  | jq .id
```

**4. Simulate a gateway webhook callback**
```bash
curl -s -X POST http://localhost:3000/api/v1/webhooks/gateway \
  -H "Content-Type: application/json" \
  -d '{"eventId": "evt_001", "eventType": "payment.success", "paymentId": "<id>", "payload": {"gatewayRef": "gw_simulated"}}' \
  | jq .
```

**5. Manually retry a failed payment**
```bash
curl -s -X POST http://localhost:3000/api/v1/payments/<id>/retry | jq .
```

**6. List all pending payments**
```bash
curl -s "http://localhost:3000/api/v1/payments?status=pending" | jq .
```

> Tip: Set `GATEWAY_FAILURE_RATE=1` in `.env` to force all payments to fail and observe the full retry + exhaustion flow.

---

## Configuration

All settings are configurable via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `DB_PATH` | `./payments.db` | SQLite file path |
| `GATEWAY_FAILURE_RATE` | `0.2` | Fraction of gateway calls that fail (0–1) |
| `GATEWAY_TIMEOUT_RATE` | `0.05` | Fraction of calls that time out (0–1) |
| `GATEWAY_TIMEOUT_MS` | `5000` | Gateway timeout duration |
| `RETRY_MAX_ATTEMPTS` | `3` | Max retry attempts per payment |
| `RETRY_BASE_DELAY_MS` | `1000` | Base delay for exponential backoff |
| `RETRY_MAX_DELAY_MS` | `30000` | Maximum retry delay cap |
| `CB_FAILURE_THRESHOLD` | `5` | Failures to open the circuit |
| `CB_HALF_OPEN_AFTER_MS` | `30000` | Cooldown before probing |

---

## Running Tests

```bash
# All tests
npm test

# Unit tests only (fast — no I/O)
npm run test:unit

# Integration tests only
npm run test:integration

# With coverage report
npm run test:coverage
```

**Test coverage (50 tests across 9 suites):**

| Suite | What it tests |
|-------|--------------|
| `CircuitBreaker.test.js` | State transitions, timing, probe prevention |
| `GatewaySimulator.test.js` | Success/failure/timeout paths |
| `RetryQueue.test.js` | Backoff calc, dedup, worker claim atomicity |
| `WebhookHandler.test.js` | Dedup, conflict resolution, unknown types |
| `payments.test.js` | Full API flow, validation, 404/422 cases |
| `idempotency.test.js` | Duplicate requests, body mismatch, concurrent dedup |
| `concurrency.test.js` | Parallel processPayment — only one wins the lock |
| `webhooks.test.js` | Duplicate delivery, conflicting states, concurrent callbacks |
| `retryExhaustion.test.js` | Full retry lifecycle: timeout → retry → exhaustion → failed; eventual success; circuit-open retries |

---

## Project Structure

```
src/
├── config.js              # All tunables from env vars
├── app.js                 # Express app factory (testable, no listen)
├── server.js              # Entry point + graceful shutdown
├── db/
│   ├── database.js        # SQLite singleton with WAL mode
│   ├── migrate.js         # Migration runner
│   └── migrations/        # SQL migration files
├── models/                # Data access layer (no raw SQL in services)
│   ├── Payment.js
│   ├── IdempotencyKey.js
│   ├── WebhookEvent.js
│   └── RetryQueueItem.js
├── services/
│   ├── PaymentService.js  # Core orchestration logic
│   ├── GatewaySimulator.js
│   ├── CircuitBreaker.js
│   ├── RetryQueue.js      # Polling-based queue worker
│   └── WebhookHandler.js
├── middleware/
│   ├── idempotency.js
│   ├── rateLimiter.js     # Global IP + per-merchant limits
│   ├── errorHandler.js
│   └── requestLogger.js
├── routes/
│   ├── index.js
│   ├── payments.js
│   └── webhooks.js
└── utils/
    ├── logger.js          # Structured JSON logging (pino)
    ├── errors.js          # Custom error hierarchy
    └── sleep.js
```

---

## Bonus Features Implemented

- **Circuit breaker** — protects against cascading gateway failures
- **Queue-based retry** — persisted to SQLite, survives process restarts  
- **Rate limiting** — global IP limiter + per-merchant sliding window
- **Structured logging** — JSON logs with `event` fields for every lifecycle transition
- **WAL mode SQLite** — concurrent readers with single writer, no SQLITE_BUSY errors

---

## Scalability & Production Considerations

This implementation is designed for a single-node deployment, but the architecture is intentionally built to make horizontal scaling straightforward:

### What scales today
- **Stateless API layer** — the Express app holds no in-memory payment state; every request reads from the DB. Multiple API instances can sit behind a load balancer immediately.
- **Optimistic locking** — state transitions use `WHERE version = ?` instead of advisory locks, so adding more workers doesn't introduce deadlocks.
- **Persisted retry queue** — retries survive restarts because they live in the DB, not in `setTimeout` callbacks.

### What would need to change at scale

| Current | Production swap |
|---------|----------------|
| SQLite | PostgreSQL / MySQL — supports true concurrent writers and row-level locking |
| In-memory circuit breaker state | Redis atomic counters — shared across all instances so one instance's failures affect the shared circuit |
| In-memory merchant rate limiter map | Redis sliding window (e.g. `ZADD` + `ZCOUNT`) — consistent limits across instances |
| SQLite polling retry queue | Dedicated queue (BullMQ / SQS / RabbitMQ) — purpose-built for fan-out, backpressure, and visibility timeouts |
| Single DB file | Read replicas for `GET /payments` traffic — separates read load from write path |

### Other production patterns to add
- **Dead-letter queue** — payments that exceed `max_retries` move to a DLQ for manual review rather than silently staying `failed`
- **Webhook signature verification** — validate `X-Webhook-Signature` HMAC header so only the real gateway can update payment state
- **Idempotency key TTL cleanup job** — a scheduled job to purge expired rows from `idempotency_keys` (the `expires_at` index is already in place)
- **Distributed tracing** — propagate a `trace-id` header through gateway calls and webhook events for end-to-end observability
