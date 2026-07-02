package checks

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Reserved field names that drive the HTTP check.
// Everything else the user adds becomes a literal HTTP header.
// Two extra reserved names handle the inline script section:
//
//	"script"      — the script body typed directly in the UI
//	"interpreter" — which runtime to use (python3, bash, node, etc.)
var customReservedKeys = map[string]bool{
	"url": true, "method": true, "expected_status": true,
	"body_pattern": true, "body": true,
	"script": true, "interpreter": true,
}

var customCl = &http.Client{Timeout: 30 * time.Second}

func runCustom(ctx context.Context, raw json.RawMessage) Result {
	// Use map[string]interface{} first so we can handle any JSON value type,
	// then convert everything to strings. This avoids unmarshal failures when
	// the config contains numbers or booleans alongside strings.~
	var anyFields map[string]interface{}
	if err := json.Unmarshal(raw, &anyFields); err != nil {
		return Result{Status: StatusUnknown, Error: "invalid config: " + err.Error()}
	}

	// Convert all values to strings
	fields := make(map[string]string, len(anyFields))
	for k, v := range anyFields {
		switch val := v.(type) {
		case string:
			fields[k] = val
		case float64:
			fields[k] = strconv.FormatFloat(val, 'f', -1, 64)
		case bool:
			fields[k] = strconv.FormatBool(val)
		default:
			if v != nil {
				fields[k] = fmt.Sprintf("%v", v)
			}
		}
	}

	slog.Debug("custom monitor fields", "keys", func() []string {
		ks := make([]string, 0, len(fields))
		for k := range fields {
			ks = append(ks, k)
		}
		return ks
	}(), "has_script", fields["script"] != "")

	// If the user wrote an inline script, run that and return — the script
	// is fully independent of the HTTP fields.
	if script := fields["script"]; strings.TrimSpace(script) != "" {
		return runInlineScript(ctx, script, fields["interpreter"])
	}

	// Otherwise: HTTP check.
	return runCustomHTTP(ctx, fields)
}

// runInlineScript writes the script body to a temp file, executes it with
// the chosen interpreter, and maps exit codes to UP/DOWN/DEGRADED.
// Convention (same as Nagios/existing script type): 0=up, 1=degraded, else=down.
func runInlineScript(ctx context.Context, script, interpreter string) Result {
	if interpreter == "" {
		interpreter = "python3"
	}

	ext := interpreterExt(interpreter)
	tmp, err := os.CreateTemp("", "custom-monitor-*"+ext)
	if err != nil {
		return Result{Status: StatusUnknown, Error: "could not create temp file: " + err.Error()}
	}
	defer os.Remove(tmp.Name())

	if _, err := tmp.WriteString(script); err != nil {
		return Result{Status: StatusUnknown, Error: "could not write script: " + err.Error()}
	}
	tmp.Close()

	cmd := exec.CommandContext(ctx, interpreter, tmp.Name())
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err = cmd.Run()
	latency := float64(time.Since(start).Milliseconds())

	detail := map[string]any{
		"interpreter": interpreter,
		"stdout":      stdout.String(),
	}
	if stderr.Len() > 0 {
		detail["stderr"] = stderr.String()
	}

	if ctx.Err() != nil {
		return Result{Status: StatusDown, LatencyMs: &latency, Detail: detail, Error: "script timed out"}
	}
	if err == nil {
		return Result{Status: StatusUp, LatencyMs: &latency, Detail: detail}
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		detail["exit_code"] = exitErr.ExitCode()
		if exitErr.ExitCode() == 1 {
			return Result{Status: StatusDegraded, LatencyMs: &latency, Detail: detail, Error: "script exited with code 1 (warning)"}
		}
		return Result{Status: StatusDown, LatencyMs: &latency, Detail: detail,
			Error: "script exited with code " + strconv.Itoa(exitErr.ExitCode())}
	}
	return Result{Status: StatusUnknown, LatencyMs: &latency, Detail: detail, Error: err.Error()}
}

func interpreterExt(interpreter string) string {
	switch {
	case strings.Contains(interpreter, "python"):
		return ".py"
	case strings.Contains(interpreter, "node"):
		return ".js"
	case strings.Contains(interpreter, "bash"), strings.Contains(interpreter, "sh"):
		return ".sh"
	case strings.Contains(interpreter, "ruby"):
		return ".rb"
	default:
		return ".tmp"
	}
}

// runCustomHTTP — generic HTTP check with user-defined headers.
func runCustomHTTP(ctx context.Context, fields map[string]string) Result {
	url := fields["url"]
	if url == "" {
		return Result{Status: StatusUnknown, Error: "a field named 'url' is required (or add a 'script' field to run a script instead)"}
	}
	method := fields["method"]
	if method == "" {
		method = "GET"
	}
	expectedStatus := 200
	if v := fields["expected_status"]; v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			expectedStatus = parsed
		}
	}
	bodyPattern := fields["body_pattern"]

	var bodyReader io.Reader
	if b := fields["body"]; b != "" {
		bodyReader = strings.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return Result{Status: StatusDown, Error: "build request: " + err.Error()}
	}

	headers := map[string]string{}
	for k, v := range fields {
		if customReservedKeys[k] || k == "" {
			continue
		}
		req.Header.Set(k, v)
		headers[k] = v
	}

	start := time.Now()
	resp, err := customCl.Do(req)
	latency := float64(time.Since(start).Milliseconds())
	if err != nil {
		return Result{Status: StatusDown, LatencyMs: &latency, Error: err.Error()}
	}
	defer resp.Body.Close()

	detail := map[string]any{"status_code": resp.StatusCode, "url": url}
	if len(headers) > 0 {
		detail["custom_fields"] = headers
	}

	if resp.StatusCode != expectedStatus {
		return Result{
			Status:    StatusDown,
			LatencyMs: &latency,
			Detail:    detail,
			Error:     fmt.Sprintf("expected %d got %d", expectedStatus, resp.StatusCode),
		}
	}

	if bodyPattern != "" {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
		if matched, _ := regexp.Match(bodyPattern, body); !matched {
			return Result{
				Status:    StatusDown,
				LatencyMs: &latency,
				Detail:    detail,
				Error:     fmt.Sprintf("body pattern %q not matched", bodyPattern),
			}
		}
	}

	return Result{Status: StatusUp, LatencyMs: &latency, Detail: detail}
}