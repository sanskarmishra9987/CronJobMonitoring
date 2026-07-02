package checks

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"
	"strconv"
	"time"
)

// scriptConfig describes a custom check implemented as an external script.
// Convention (same as Nagios/Zabbix-style plugin checks): the script's exit
// code decides status — 0 = up, 1 = degraded/warning, anything else = down.
// Whatever the script prints to stdout is captured as the result detail.
type scriptConfig struct {
	Interpreter string   `json:"interpreter"` // e.g. "python3", "python", "bash"
	ScriptPath  string   `json:"script_path"` // path to the script ON THE SERVER running this app
	Args        []string `json:"args"`
}

// runScript executes the configured script and interprets its exit code.
//
// SECURITY NOTE: this check type runs an arbitrary command on the host
// machine. Only people who are already trusted to configure monitors should
// ever be able to create this type — there is no sandboxing here. This
// mirrors how real tools like Nagios plugins work, but it's worth being
// explicit about the tradeoff rather than hiding it.
func runScript(ctx context.Context, raw json.RawMessage) Result {
	var cfg scriptConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Result{Status: StatusUnknown, Error: "invalid config: " + err.Error()}
	}
	if cfg.ScriptPath == "" {
		return Result{Status: StatusUnknown, Error: "script_path is required"}
	}
	if cfg.Interpreter == "" {
		cfg.Interpreter = "python3"
	}

	args := append([]string{cfg.ScriptPath}, cfg.Args...)
	cmd := exec.CommandContext(ctx, cfg.Interpreter, args...)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err := cmd.Run()
	latency := float64(time.Since(start).Milliseconds())

	detail := map[string]any{
		"stdout": stdout.String(),
	}
	if stderr.Len() > 0 {
		detail["stderr"] = stderr.String()
	}

	if ctx.Err() != nil {
		return Result{Status: StatusDown, LatencyMs: &latency, Detail: detail, Error: "script timed out"}
	}

	if err == nil {
		// Exit code 0
		return Result{Status: StatusUp, LatencyMs: &latency, Detail: detail}
	}

	if exitErr, ok := err.(*exec.ExitError); ok {
		detail["exit_code"] = exitErr.ExitCode()
		if exitErr.ExitCode() == 1 {
			return Result{Status: StatusDegraded, LatencyMs: &latency, Detail: detail, Error: "script exited with code 1 (warning)"}
		}
		return Result{Status: StatusDown, LatencyMs: &latency, Detail: detail, Error: "script exited with code " + strconv.Itoa(exitErr.ExitCode())}
	}

	// Something else went wrong (e.g. interpreter not found, permissions).
	return Result{Status: StatusUnknown, LatencyMs: &latency, Detail: detail, Error: err.Error()}
}