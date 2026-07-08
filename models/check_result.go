//check_result.go stores the result/history of each monitor check.
package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type CheckResult struct {
	ID           int64           `json:"id"`
	MonitorID    uuid.UUID       `json:"monitor_id"`
	CheckedAt    time.Time       `json:"checked_at"`
	Status       string          `json:"status"`
	LatencyMs    *float64        `json:"latency_ms,omitempty"`
	Detail       json.RawMessage `json:"detail,omitempty"`
	ErrorMessage string          `json:"error_message,omitempty"`
}
