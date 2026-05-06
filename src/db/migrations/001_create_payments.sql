CREATE TABLE IF NOT EXISTS payments (
  id              TEXT PRIMARY KEY,
  merchant_id     TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','processing','success','failed')),
  gateway_ref     TEXT,
  failure_reason  TEXT,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 3,
  version         INTEGER NOT NULL DEFAULT 1,
  metadata        TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  processing_at   INTEGER,
  completed_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_payments_merchant ON payments(merchant_id);
CREATE INDEX IF NOT EXISTS idx_payments_status   ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created  ON payments(created_at);
