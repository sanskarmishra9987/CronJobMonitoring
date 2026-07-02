package checks

import (
	"context"
	"encoding/json"
	"time"
)

// heartbeatConfig is the expected shape of a heartbeat monitor's config JSON.
// max_age_secs: how long we'll wait without a check-in before calling it down.
// last_heartbeat_at: injected by the caller (api/monitors.go) at check time —
// it is NOT something the user types in; it comes from the database.
type heartbeatConfig struct {
	MaxAgeSecs      int        `json:"max_age_secs"`
	LastHeartbeatAt *time.Time `json:"last_heartbeat_at"`
}

// runHeartbeat doesn't make any network call at all. Unlike ping/tcp/http,
// this monitor type is "passive" — some external service is expected to call
// POST /api/monitors/{id}/heartbeat on its own, on a schedule. All this
// function does is look at when that last happened and decide if it's stale.
func runHeartbeat(ctx context.Context, config json.RawMessage) Result {
	var cfg heartbeatConfig
	if err := json.Unmarshal(config, &cfg); err != nil {
		return Result{Status: StatusUnknown, Error: "invalid config: " + err.Error()}
	}

	if cfg.MaxAgeSecs <= 0 {
		cfg.MaxAgeSecs = 120 // sensible default: allow 2 minutes of silence
	}

	if cfg.LastHeartbeatAt == nil {
		return Result{
			Status: StatusUnknown,
			Error:  "no heartbeat received yet",
		}
	}

	age := time.Since(*cfg.LastHeartbeatAt)
	maxAge := time.Duration(cfg.MaxAgeSecs) * time.Second

	if age > maxAge {
		return Result{
			Status: StatusDown,
			Error:  "no heartbeat received within expected window",
			Detail: map[string]any{
				"last_heartbeat_at": cfg.LastHeartbeatAt,
				"age_seconds":       age.Seconds(),
				"max_age_seconds":   maxAge.Seconds(),
			},
		}
	}

	latency := age.Seconds() * 1000 // ms since last check-in, reusing the latency field for visibility
	return Result{
		Status:    StatusUp,
		LatencyMs: &latency,
		Detail: map[string]any{
			"last_heartbeat_at": cfg.LastHeartbeatAt,
			"age_seconds":       age.Seconds(),
		},
	}
}