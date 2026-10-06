// hooks/useAlertSocket.ts
import { useEffect, useState } from "react";

export interface AlertEvent {
  type: string;
  monitor_id: string;
  name: string;
  old_status: string;
  new_status: string;
  error?: string;
  timestamp: string;
}

export function useAlertSocket() {
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);

  useEffect(() => {
  const wsUrl = import.meta.env.DEV
    ? `ws://localhost:8080/ws/alerts`
    : `ws://${window.location.host}/ws/alerts`;
  const ws = new WebSocket(wsUrl);

    ws.onopen = () => console.log("alert socket opened");
    ws.onmessage = (event) => {
      console.log("WS message received:", event.data);
      const data: AlertEvent = JSON.parse(event.data);
      setAlerts((prev) => [data, ...prev].slice(0, 20));
    };

    ws.onclose = () => console.log("alert socket closed");
    ws.onerror = (err) => console.error("alert socket error", err);

    return () => ws.close();
  }, []);

  return alerts;
}