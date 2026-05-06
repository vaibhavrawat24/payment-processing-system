CREATE TABLE IF NOT EXISTS webhook_events (
  id              TEXT PRIMARY KEY,
  payment_id      TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','processed','ignored','conflict')),
  processed_at    INTEGER,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_payment ON webhook_events(payment_id);
CREATE INDEX IF NOT EXISTS idx_webhook_status  ON webhook_events(status);
