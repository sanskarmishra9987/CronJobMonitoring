CREATE TABLE IF NOT EXISTS monitors (
    id            UUID PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    monitor_type  TEXT NOT NULL,
    enabled       BOOLEAN NOT NULL DEFAULT true,
    interval_secs INT NOT NULL DEFAULT 60,
    timeout_secs  INT NOT NULL DEFAULT 10,
    config        JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_heartbeat_at TIMESTAMPTZ
);

ALTER TABLE monitors ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS check_results (
    id            BIGSERIAL PRIMARY KEY,
    monitor_id    UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    status        TEXT NOT NULL,
    latency_ms    DOUBLE PRECISION,
    detail        JSONB,
    error_message TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_check_results_monitor_time
    ON check_results (monitor_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS notification_channels (
    id     UUID PRIMARY KEY,
    name   TEXT NOT NULL,
    type   TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS alert_rules (
    id          UUID PRIMARY KEY,
    monitor_id  UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    condition   TEXT NOT NULL,
    threshold   DOUBLE PRECISION,
    channel_id  UUID REFERENCES notification_channels(id),
    enabled     BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS alert_events (
    id          BIGSERIAL PRIMARY KEY,
    monitor_id  UUID NOT NULL REFERENCES monitors(id),
    rule_id     UUID REFERENCES alert_rules(id),
    fired_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    detail      JSONB
);

CREATE TABLE IF NOT EXISTS api_tokens (
    id          UUID PRIMARY KEY,
    name        TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ,
    enabled     BOOLEAN NOT NULL DEFAULT true
);