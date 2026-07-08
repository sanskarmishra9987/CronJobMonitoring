package runner

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type AlertEvent struct {
	Type      string    `json:"type"`
	MonitorID uuid.UUID `json:"monitor_id"`
	Name      string    `json:"name"`
	OldStatus string    `json:"old_status"`
	NewStatus string    `json:"new_status"`
	Error     string    `json:"error,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

type Hub struct {
	mu      sync.Mutex
	clients map[*websocket.Conn]bool
}

func NewHub() *Hub {
	return &Hub{clients: make(map[*websocket.Conn]bool)}
}

func (h *Hub) AddClient(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[conn] = true
}

func (h *Hub) RemoveClient(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, conn)
	conn.Close()
}

func (h *Hub) Broadcast(event AlertEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		slog.Error("hub: marshal event", "err", err)
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	for conn := range h.clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			slog.Error("hub: write failed, dropping client", "err", err)
			conn.Close()
			delete(h.clients, conn)
		}
	}
}

// BroadcastStatusChange lets callers outside this package (like api.monitorHandlers)
// send an alert without needing to import runner and construct AlertEvent directly.
func (h *Hub) BroadcastStatusChange(monitorID uuid.UUID, name, oldStatus, newStatus, errMsg string) {
	h.Broadcast(AlertEvent{
		Type:      "status_change",
		MonitorID: monitorID,
		Name:      name,
		OldStatus: oldStatus,
		NewStatus: newStatus,
		Error:     errMsg,
		Timestamp: time.Now(),
	})
}