package checks

import (
	"context"
	"encoding/json"
)

type Status string

const (
	StatusUp       Status = "up"
	StatusDown     Status = "down"
	StatusDegraded Status = "degraded"
	StatusUnknown  Status = "unknown"
)

type Result struct {
	Status    Status         `json:"status"`
	LatencyMs *float64       `json:"latency_ms,omitempty"`
	Detail    map[string]any `json:"detail,omitempty"`
	Error     string         `json:"error,omitempty"`
}

// VaultReader is satisfied by *vault.Client. Defined here to avoid import cycles.
type VaultReader interface {
	ReadSecret(ctx context.Context, path string) (map[string]string, error)
}

func Run(ctx context.Context, monitorType string, config json.RawMessage, vault VaultReader) Result {
	switch monitorType {
	case "ping":
		return runPing(ctx, config)
	case "tcp":
		return runTCP(ctx, config)
	case "http", "https":
		return runHTTP(ctx, config)
	case "postgres", "postgresql":
		return runPostgres(ctx, config, vault)
	case "heartbeat":
		return runHeartbeat(ctx, config)
	case "script":
		return runScript(ctx, config)
	case "docker":
		return runDocker(ctx, config)
	case "zabbix":
		return runZabbix(ctx, config)
	case "custom":
		return runCustom(ctx, config)
	default:
		return Result{Status: StatusUnknown, Error: "unsupported monitor type: " + monitorType}
	}
}	