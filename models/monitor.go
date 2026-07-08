//monitor.go stores the monitor's configuration.

package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type Monitor struct {
	ID           uuid.UUID       `json:"id"`
	Name         string          `json:"name"`
	Description  string          `json:"description"`
	MonitorType  string          `json:"monitor_type"`
	Enabled      bool            `json:"enabled"`
	IntervalSecs int             `json:"interval_secs"`
	TimeoutSecs  int             `json:"timeout_secs"`
	Config       json.RawMessage `json:"config"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
	LastHeartbeatAt *time.Time   `json:"last_heartbeat_at,omitempty"`
}