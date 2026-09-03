CREATE TABLE IF NOT EXISTS activity (
  account TEXT NOT NULL,
  id TEXT NOT NULL,
  at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (account, id)
);
CREATE INDEX IF NOT EXISTS activity_by_account_time ON activity(account, at DESC);
