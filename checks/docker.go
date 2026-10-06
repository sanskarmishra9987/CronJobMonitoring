package checks

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"
	"time"
)

// dockerConfig: which container to inspect, identified by name or ID
// (whatever you'd normally pass to `docker inspect`).
type dockerConfig struct {
	Container string `json:"container"`
}

// dockerState mirrors the subset of `docker inspect`'s State object we care about.
// Docker's own JSON field names are capitalized, hence the matching tags.
type dockerState struct {
	Status   string `json:"Status"` // "running", "exited", "paused", "restarting", ...
	Running  bool   `json:"Running"`
	ExitCode int    `json:"ExitCode"`
	Health   *struct {
		Status string `json:"Status"` // "healthy", "unhealthy", "starting" — only present if the container defines a HEALTHCHECK
	} `json:"Health,omitempty"`
}

// runDocker asks the Docker Engine (via the `docker` CLI, same way you would
// by hand in a terminal) for a container's current state and translates it
// into this app's up/down/degraded vocabulary. This requires Docker Desktop
// (or the Docker daemon) to be installed and running on the same machine
// as this Go backend — it does NOT reach into a remote Docker host.
func runDocker(ctx context.Context, raw json.RawMessage) Result {
	var cfg dockerConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Result{Status: StatusUnknown, Error: "invalid config: " + err.Error()}
	}
	if cfg.Container == "" {
		return Result{Status: StatusUnknown, Error: "container is required"}
	}

	cmd := exec.CommandContext(ctx, "docker", "inspect", "--format", "{{json .State}}", cfg.Container)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err := cmd.Run()
	latency := float64(time.Since(start).Milliseconds())

	if err != nil {
		// Most commonly: container name/ID doesn't exist, or Docker isn't running.
		errMsg := stderr.String()
		if errMsg == "" {
			errMsg = err.Error()
		}
		return Result{Status: StatusDown, LatencyMs: &latency, Error: "docker inspect failed: " + errMsg}
	}

	var state dockerState
	if err := json.Unmarshal(stdout.Bytes(), &state); err != nil {
		return Result{Status: StatusUnknown, LatencyMs: &latency, Error: "could not parse docker state: " + err.Error()}
	}

	detail := map[string]any{
		"docker_status": state.Status,
		"exit_code":     state.ExitCode,
	}
	if state.Health != nil {
		detail["health"] = state.Health.Status
	}

	// If the container defines a HEALTHCHECK, trust that over the raw running flag —
	// a container can be "running" but its application inside could be unhealthy.
	if state.Health != nil {
		switch state.Health.Status {
		case "healthy":
			return Result{Status: StatusUp, LatencyMs: &latency, Detail: detail}
		case "starting":
			return Result{Status: StatusDegraded, LatencyMs: &latency, Detail: detail, Error: "health check still starting"}
		default: // "unhealthy"
			return Result{Status: StatusDown, LatencyMs: &latency, Detail: detail, Error: "container reported unhealthy"}
		}
	}

	if state.Running {
		return Result{Status: StatusUp, LatencyMs: &latency, Detail: detail}
	}

	return Result{Status: StatusDown, LatencyMs: &latency, Detail: detail, Error: "container is not running (status: " + state.Status + ")"}
}