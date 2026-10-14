-- Existing encrypted persistence schema. Startup applies this idempotently.
CREATE TABLE IF NOT EXISTS launchguard_state (
  id integer PRIMARY KEY CHECK (id = 1),
  payload text NOT NULL,
  revision integer NOT NULL DEFAULT 0
);
