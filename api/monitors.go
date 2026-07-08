package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"monitoring/checks"
	"monitoring/models"
	vaultpkg "monitoring/vault"
)

// RunnerNotifier is satisfied by *runner.Runner without importing that package.
type RunnerNotifier interface {
	Reload(id uuid.UUID)
	Remove(id uuid.UUID)
}

// AlertBroadcaster is satisfied by *runner.Hub without importing that package,
// avoiding an import cycle (runner already imports things api depends on indirectly).
type AlertBroadcaster interface {
	BroadcastStatusChange(monitorID uuid.UUID, name, oldStatus, newStatus, errMsg string)
}

type monitorHandlers struct {
	pool   *pgxpool.Pool
	vault  *vaultpkg.Client
	runner RunnerNotifier
	hub    AlertBroadcaster
}

// safeVault converts a nil *vaultpkg.Client to a nil checks.VaultReader interface,
// preventing a non-nil interface wrapping a nil pointer.
func safeVault(c *vaultpkg.Client) checks.VaultReader {
	if c == nil {
		return nil
	}
	return c
}

func (h *monitorHandlers) list(w http.ResponseWriter, r *http.Request) {
	rows, err := h.pool.Query(r.Context(), `
		SELECT id, name, description, monitor_type, enabled,
		       interval_secs, timeout_secs, config, created_at, updated_at, last_heartbeat_at
		FROM monitors ORDER BY name
	`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	monitors := make([]models.Monitor, 0)
	for rows.Next() {
		var m models.Monitor
		if err := rows.Scan(&m.ID, &m.Name, &m.Description, &m.MonitorType, &m.Enabled,
			&m.IntervalSecs, &m.TimeoutSecs, &m.Config, &m.CreatedAt, &m.UpdatedAt, &m.LastHeartbeatAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		monitors = append(monitors, m)
	}
	writeJSON(w, http.StatusOK, monitors)
}

func (h *monitorHandlers) get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}

	var m models.Monitor
	err = h.pool.QueryRow(r.Context(), `
		SELECT id, name, description, monitor_type, enabled,
		       interval_secs, timeout_secs, config, created_at, updated_at, last_heartbeat_at
		FROM monitors WHERE id = $1
	`, id).Scan(&m.ID, &m.Name, &m.Description, &m.MonitorType, &m.Enabled,
		&m.IntervalSecs, &m.TimeoutSecs, &m.Config, &m.CreatedAt, &m.UpdatedAt, &m.LastHeartbeatAt)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (h *monitorHandlers) create(w http.ResponseWriter, r *http.Request) {
	var m models.Monitor
	if err := readJSON(r, &m); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if m.Name == "" || m.MonitorType == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and monitor_type are required"})
		return
	}
	if m.Config == nil {
		m.Config = json.RawMessage("{}")
	}
	if m.IntervalSecs == 0 {
		m.IntervalSecs = 60
	}
	if m.TimeoutSecs == 0 {
		m.TimeoutSecs = 10
	}
	m.ID = uuid.New()
	now := time.Now()
	m.CreatedAt = now
	m.UpdatedAt = now
	m.Enabled = true

	_, err := h.pool.Exec(r.Context(), `
		INSERT INTO monitors (id, name, description, monitor_type, enabled,
		                      interval_secs, timeout_secs, config, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	`, m.ID, m.Name, m.Description, m.MonitorType, m.Enabled,
		m.IntervalSecs, m.TimeoutSecs, m.Config, m.CreatedAt, m.UpdatedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	h.runner.Reload(m.ID)
	writeJSON(w, http.StatusCreated, m)
}

func (h *monitorHandlers) update(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}

	var m models.Monitor
	if err := readJSON(r, &m); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if m.Config == nil {
		m.Config = json.RawMessage("{}")
	}
	m.ID = id
	m.UpdatedAt = time.Now()

	tag, err := h.pool.Exec(r.Context(), `
		UPDATE monitors
		SET name=$1, description=$2, monitor_type=$3, enabled=$4,
		    interval_secs=$5, timeout_secs=$6, config=$7, updated_at=$8
		WHERE id=$9
	`, m.Name, m.Description, m.MonitorType, m.Enabled,
		m.IntervalSecs, m.TimeoutSecs, m.Config, m.UpdatedAt, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	h.runner.Reload(id)
	writeJSON(w, http.StatusOK, m)
}

func (h *monitorHandlers) delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}

	tag, err := h.pool.Exec(r.Context(), `DELETE FROM monitors WHERE id = $1`, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	h.runner.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

// heartbeat is the "check-in" endpoint. An external service (cron job, worker,
// agent — anything that can't be reached directly) calls this on its own
// schedule to say "I'm still alive." We just stamp the current time.
// The actual up/down decision happens later, in runHeartbeat, by comparing
// this timestamp against how much time has passed.
func (h *monitorHandlers) heartbeat(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}

	tag, err := h.pool.Exec(r.Context(), `
		UPDATE monitors SET last_heartbeat_at = now() WHERE id = $1
	`, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "received"})
}

func (h *monitorHandlers) toggle(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}

	var enabled bool
	err = h.pool.QueryRow(r.Context(), `
		UPDATE monitors SET enabled = NOT enabled, updated_at = now()
		WHERE id = $1 RETURNING enabled
	`, id).Scan(&enabled)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	h.runner.Reload(id)
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": enabled})
}

func (h *monitorHandlers) checkNow(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}

	var m models.Monitor
	err = h.pool.QueryRow(r.Context(), `
		SELECT id, name, description, monitor_type, enabled,
		       interval_secs, timeout_secs, config, created_at, updated_at, last_heartbeat_at
		FROM monitors WHERE id = $1
	`, id).Scan(&m.ID, &m.Name, &m.Description, &m.MonitorType, &m.Enabled,
		&m.IntervalSecs, &m.TimeoutSecs, &m.Config, &m.CreatedAt, &m.UpdatedAt, &m.LastHeartbeatAt)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(m.TimeoutSecs)*time.Second)
	defer cancel()

	checkConfig := m.Config
	if m.MonitorType == "heartbeat" {
		// last_heartbeat_at lives in the monitors table (it's updated by a
		// separate, frequent endpoint), not in the user-edited config JSON.
		// We merge it in here, right before running the check, so that
		// checks.Run / runHeartbeat can stay a pure function that only
		// looks at its config argument.
		var cfgMap map[string]any
		_ = json.Unmarshal(m.Config, &cfgMap)
		if cfgMap == nil {
			cfgMap = map[string]any{}
		}
		cfgMap["last_heartbeat_at"] = m.LastHeartbeatAt
		merged, _ := json.Marshal(cfgMap)
		checkConfig = merged
	}

	// grab the last known status BEFORE we insert the new result, so we can
	// detect a real transition instead of just broadcasting every manual check.
	var lastStatus string
	_ = h.pool.QueryRow(r.Context(), `
		SELECT status FROM check_results
		WHERE monitor_id = $1
		ORDER BY checked_at DESC LIMIT 1
	`, id).Scan(&lastStatus)

	result := checks.Run(ctx, m.MonitorType, checkConfig, safeVault(h.vault))

	var detailJSON json.RawMessage
	if result.Detail != nil {
		detailJSON, _ = json.Marshal(result.Detail)
	}

	var cr models.CheckResult
	err = h.pool.QueryRow(r.Context(), `
		INSERT INTO check_results (monitor_id, status, latency_ms, detail, error_message)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, checked_at
	`, id, string(result.Status), result.LatencyMs, detailJSON, result.Error).
		Scan(&cr.ID, &cr.CheckedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	cr.MonitorID = id
	cr.Status = string(result.Status)
	cr.LatencyMs = result.LatencyMs
	cr.Detail = detailJSON
	cr.ErrorMessage = result.Error

	if h.hub != nil && lastStatus != "" && lastStatus != string(result.Status) {
		slog.Info("broadcasting alert (checkNow)", "monitor", m.Name, "from", lastStatus, "to", result.Status)
		h.hub.BroadcastStatusChange(id, m.Name, lastStatus, string(result.Status), result.Error)
	}

	writeJSON(w, http.StatusOK, cr)
}