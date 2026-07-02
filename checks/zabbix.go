package checks

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// zabbixConfig: how to reach the Zabbix API, and which host (by Zabbix's
// own "host" name, exactly as shown in the Zabbix web UI) to check.
type zabbixConfig struct {
	URL      string `json:"url"`      // e.g. http://localhost:8081
	Username string `json:"username"` // Zabbix login, e.g. "Admin"
	Password string `json:"password"`
	HostName string `json:"host_name"` // e.g. "Zabbix server"
}

// Generic JSON-RPC envelope shapes, since every Zabbix API call uses the
// same request/response structure regardless of which "method" is called.
type zbxRequest struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
	Auth    string `json:"auth,omitempty"`
	ID      int    `json:"id"`
}

type zbxError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

type zbxLoginResponse struct {
	Result string    `json:"result"`
	Error  *zbxError `json:"error"`
}

type zbxHost struct {
	HostID    string `json:"hostid"`
	Host      string `json:"host"`
	Status    string `json:"status"`    // "0" = monitored, "1" = disabled
	Available string `json:"available"` // "0" = unknown, "1" = available, "2" = unavailable
}

type zbxHostGetResponse struct {
	Result []zbxHost `json:"result"`
	Error  *zbxError `json:"error"`
}

// zbxCall is a small helper so we don't repeat the "marshal, POST, unmarshal"
// dance for both the login call and the host.get call.
func zbxCall(ctx context.Context, url string, reqBody zbxRequest, out any) error {
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url+"/api_jsonrpc.php", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json-rpc")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return json.NewDecoder(resp.Body).Decode(out)
}

func runZabbix(ctx context.Context, raw json.RawMessage) Result {
	var cfg zabbixConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Result{Status: StatusUnknown, Error: "invalid config: " + err.Error()}
	}
	if cfg.URL == "" || cfg.Username == "" || cfg.HostName == "" {
		return Result{Status: StatusUnknown, Error: "url, username and host_name are required"}
	}

	start := time.Now()

	// Step 1: log in to get an auth token, same as we did by hand with curl/PowerShell.
	var loginResp zbxLoginResponse
	err := zbxCall(ctx, cfg.URL, zbxRequest{
		JSONRPC: "2.0",
		Method:  "user.login",
		Params:  map[string]string{"user": cfg.Username, "password": cfg.Password},
		ID:      1,
	}, &loginResp)
	if err != nil {
		return Result{Status: StatusUnknown, Error: "zabbix login request failed: " + err.Error()}
	}
	if loginResp.Error != nil {
		return Result{Status: StatusUnknown, Error: "zabbix login error: " + loginResp.Error.Message}
	}
	token := loginResp.Result

	// Step 2: ask for this specific host's status/availability.
	var hostResp zbxHostGetResponse
	err = zbxCall(ctx, cfg.URL, zbxRequest{
		JSONRPC: "2.0",
		Method:  "host.get",
		Params: map[string]any{
			"output": []string{"hostid", "host", "status", "available"},
			"filter": map[string]any{"host": []string{cfg.HostName}},
		},
		Auth: token,
		ID:   2,
	}, &hostResp)
	latency := float64(time.Since(start).Milliseconds())

	if err != nil {
		return Result{Status: StatusUnknown, LatencyMs: &latency, Error: "zabbix host.get failed: " + err.Error()}
	}
	if hostResp.Error != nil {
		return Result{Status: StatusUnknown, LatencyMs: &latency, Error: "zabbix host.get error: " + hostResp.Error.Message}
	}
	if len(hostResp.Result) == 0 {
		return Result{Status: StatusUnknown, LatencyMs: &latency, Error: "no host found with name: " + cfg.HostName}
	}

	h := hostResp.Result[0]
	detail := map[string]any{
		"zabbix_status":    h.Status,
		"zabbix_available": h.Available,
	}

	if h.Status == "1" {
		return Result{Status: StatusUnknown, LatencyMs: &latency, Detail: detail, Error: "monitoring is disabled for this host in Zabbix"}
	}

	switch h.Available {
	case "1":
		return Result{Status: StatusUp, LatencyMs: &latency, Detail: detail}
	case "2":
		return Result{Status: StatusDown, LatencyMs: &latency, Detail: detail, Error: "Zabbix reports this host as unavailable"}
	default: // "0" — Zabbix hasn't determined availability yet
		return Result{Status: StatusUnknown, LatencyMs: &latency, Detail: detail, Error: "Zabbix has not yet determined availability for this host"}
	}
}