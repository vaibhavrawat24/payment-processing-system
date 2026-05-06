CREATE TABLE IF NOT EXISTS retry_queue (
  id          TEXT PRIMARY KEY,
  payment_id  TEXT NOT NULL UNIQUE,
  attempt     INTEGER NOT NULL DEFAULT 1,
  run_at      INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'scheduled'
              CHECK(status IN ('scheduled','running','done','exhausted')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(id)
);

CREATE INDEX IF NOT EXISTS idx_retry_run_at ON retry_queue(run_at, status);
