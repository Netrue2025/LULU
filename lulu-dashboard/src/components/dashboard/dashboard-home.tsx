"use client";

import { Activity, Clock, Lock, Mic, PlugZap, RadioTower, Search, Sparkles, Square, Wifi, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { HealthIcon, PageGrid, StatusBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { initialAlerts } from "@/lib/mock-data";
import { nowTime } from "@/lib/utils";
import { useLuluRealtime } from "@/hooks/use-lulu-realtime";
import { cn } from "@/lib/utils";

const keyActivityPattern = /radio|music|song|bible|scripture|reading|story|playing|listen|speaking|recording|weather|volume|stop/i;

type ConnectionState = {
  connected: boolean;
  backend: {
    online: boolean;
    status: number;
    baseUrl: string;
    health: Record<string, string> | null;
  };
  remote: {
    pending?: Record<string, string> | null;
    last_command?: Record<string, string> | null;
    device_status?: {
      wifi_connected?: boolean;
      wifi_ssid?: string;
      wifi_ip?: string;
      wifi_rssi?: number;
      updated_at?: string;
      state?: string;
    } | null;
  } | null;
  checked_at: string;
};

type WifiConfig = {
  ssid: string;
  password: string;
  deviceIp: string;
};

type WifiNetwork = {
  ssid: string;
  rssi: number;
  secure: boolean;
  channel?: number;
};

type WifiDeviceStatus = {
  connected: boolean;
  ssid: string;
  ip: string;
  rssi: number;
};

const defaultWifiConfig: WifiConfig = {
  ssid: "",
  password: "",
  deviceIp: "192.168.1.100"
};

export function DashboardHome() {
  const { health, overview, events, status } = useLuluRealtime();
  const [remoteStatus, setRemoteStatus] = useState("");
  const [sendingRemote, setSendingRemote] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const unreadAlerts = initialAlerts.filter((alert) => alert.unread).length + (status === "offline" || status === "error" ? 1 : 0);

  const userPhrase = overview?.conversation.user?.text ?? "Waiting for Jeremiah...";
  const assistantResponse = overview?.conversation.lulu?.text ?? "LULU is ready.";
  const keyActivities = useMemo(() => {
    const live = overview?.activities ?? [];
    if (live.length > 0) return live.slice(0, 5);
    return events
      .filter((event) => keyActivityPattern.test(event.description))
      .slice(0, 3)
      .map((event) => ({ id: event.id, timestamp: event.timestamp, description: event.description }));
  }, [events, overview?.activities]);

  async function sendRemoteCommand(action: "listen" | "stop") {
    setSendingRemote(true);
    setRemoteStatus("");

    try {
      const response = await fetch("/api/lulu/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail ?? "Remote command failed");
      setRemoteStatus(action === "listen" ? "Listening command sent." : "Stop command sent.");
    } catch (error) {
      setRemoteStatus(error instanceof Error ? error.message : "Remote command failed");
    } finally {
      setSendingRemote(false);
    }
  }

  return (
    <DashboardShell title="Overview" subtitle="LULU live room" unreadAlerts={unreadAlerts}>
      <PageGrid>
        <section className="lulu-baby-panel mx-auto w-full max-w-5xl overflow-hidden rounded-lg border border-white/10">
          <div className="lulu-rainbow-bar" />
          <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 rounded-lg border border-white/10 bg-black/70 p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-pink-400 text-slate-950">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-white">LULU terminal</h2>
                    <p className="truncate text-xs text-cyan-100/80">{overview?.checked_at ? `Updated ${new Date(overview.checked_at).toLocaleTimeString()}` : "Waiting for live feed"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className={cn(
                      "relative flex h-9 w-9 items-center justify-center rounded-md border transition",
                      status === "online" ? "border-green-300/50 bg-green-300/20 text-green-100" : "border-red-300/50 bg-red-400/20 text-red-100"
                    )}
                    onClick={() => setConnectionOpen(true)}
                    title="LULU connection"
                    type="button"
                  >
                    <Wifi className="h-4 w-4" />
                    <span className={cn("absolute right-1 top-1 h-2 w-2 rounded-full", status === "online" ? "bg-green-300" : "bg-red-300")} />
                  </button>
                  <StatusBadge status={status} />
                </div>
              </div>

              <div className="space-y-2 font-mono">
                <TerminalLine label="You say" text={userPhrase} tone="cyan" />
                <TerminalLine label="LULU" text={assistantResponse} tone="pink" />
              </div>

              <div className="mt-3 rounded-md border border-white/10 bg-slate-950/80 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase text-yellow-200">Key activity</p>
                  <RadioTower className="h-4 w-4 text-green-300" />
                </div>
                {keyActivities.length > 0 ? (
                  <div className="space-y-2">
                    {keyActivities.map((activity) => (
                      <div key={activity.id} className="grid grid-cols-[4.5rem_1fr] gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-xs text-slate-100">
                        <span className="text-cyan-200">{new Date(activity.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="min-w-0 break-words">{activity.description}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No key action is active right now.</p>
                )}
              </div>
            </div>

            <aside className="grid content-start gap-3">
              <div className="rounded-lg border border-white/10 bg-white/10 p-3">
                <p className="text-xs font-semibold uppercase text-yellow-100">Voice control</p>
                <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
                  <Button className="h-11 bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={sendingRemote} onClick={() => sendRemoteCommand("listen")}>
                    <Mic className="h-4 w-4" />
                    Listen
                  </Button>
                  <Button className="h-11 bg-red-400 text-white hover:bg-red-300" disabled={sendingRemote} onClick={() => sendRemoteCommand("stop")}>
                    <Square className="h-4 w-4" />
                    Stop
                  </Button>
                </div>
                <p className="mt-3 min-h-4 text-xs text-pink-100">{remoteStatus || "Ready for remote action."}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                <MiniStatus label="Connection" value={status} tone={status === "online" ? "green" : "red"} icon={<HealthIcon status={status} />} />
                <MiniStatus label="Last check" value={health ? new Date(health.checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : nowTime()} tone="yellow" icon={<Clock className="h-4 w-4" />} />
              </div>
            </aside>
          </div>
        </section>
      </PageGrid>

      {connectionOpen ? <ConnectionModal onClose={() => setConnectionOpen(false)} /> : null}
    </DashboardShell>
  );
}

function ConnectionModal({ onClose }: { onClose: () => void }) {
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [wifiConfig, setWifiConfig] = useState<WifiConfig>(defaultWifiConfig);
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [wifiStatus, setWifiStatus] = useState("");
  const [deviceWifiStatus, setDeviceWifiStatus] = useState<WifiDeviceStatus | null>(null);
  const [scanningWifi, setScanningWifi] = useState(false);
  const [connectingWifi, setConnectingWifi] = useState("");
  const [disconnectingWifi, setDisconnectingWifi] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState<WifiNetwork | null>(null);

  useEffect(() => {
    let nextConfig = defaultWifiConfig;
    const stored = window.localStorage.getItem("lulu-wifi-config");
    if (stored) {
      try {
        nextConfig = { ...defaultWifiConfig, ...JSON.parse(stored) };
      } catch {
        nextConfig = defaultWifiConfig;
      }
    }
    setWifiConfig(nextConfig);

    async function loadConnection() {
      setLoading(true);
      try {
        const response = await fetch("/api/lulu/connection", { cache: "no-store" });
        if (response.ok) {
          const nextConnection = (await response.json()) as ConnectionState;
          setConnection(nextConnection);
          const remoteDevice = nextConnection.remote?.device_status;
          if (remoteDevice?.wifi_connected) {
            setDeviceWifiStatus({
              connected: true,
              ssid: remoteDevice.wifi_ssid ?? "",
              ip: remoteDevice.wifi_ip ?? "",
              rssi: Number(remoteDevice.wifi_rssi ?? 0)
            });
          }
        }
      } finally {
        setLoading(false);
      }
    }

    void loadConnection();
    void loadWifiStatus(nextConfig.deviceIp);
    const connectionTimer = window.setInterval(loadConnection, 5000);
    return () => window.clearInterval(connectionTimer);
  }, []);

  function updateWifiConfig(next: WifiConfig) {
    setWifiConfig(next);
    window.localStorage.setItem("lulu-wifi-config", JSON.stringify(next));
  }

  async function fetchDeviceWifi(path: string, init?: RequestInit) {
    const directUrl = `http://${wifiConfig.deviceIp}${path}`;
    try {
      const response = await fetch(directUrl, { ...init, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      return { response, data };
    } catch {
      const action = path.includes("status") ? "status" : path.includes("disconnect") ? "disconnect" : path.includes("connect") ? "connect" : "scan";
      const proxyUrl = `/api/lulu/wifi?baseUrl=${encodeURIComponent(`http://${wifiConfig.deviceIp}`)}${action === "status" ? "&action=status" : ""}`;
      if (action === "scan" || action === "status") {
        const response = await fetch(proxyUrl, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        return { response, data };
      }
      throw new Error("Direct LULU WiFi request is blocked. Open the dashboard locally on http://localhost:3000 or use the LULU device IP on the same WiFi.");
    }
  }

  async function postDeviceWifiDirect(path: string, body: Record<string, string>) {
    try {
      const response = await fetch(`http://${wifiConfig.deviceIp}${path}`, {
        method: "POST",
        body: new URLSearchParams(body)
      });
      const data = await response.json().catch(() => ({}));
      return { response, data };
    } catch {
      throw new Error("The browser cannot reach LULU directly. For WiFi passwords, use the local dashboard on http://localhost:3000 or connect to LULU setup WiFi and open http://192.168.4.1.");
    }
  }

  async function loadWifiStatus(deviceIp = wifiConfig.deviceIp) {
    try {
      const response = await fetch(`/api/lulu/wifi?baseUrl=${encodeURIComponent(`http://${deviceIp}`)}&action=status`, { cache: "no-store" });
      if (response.ok) setDeviceWifiStatus((await response.json()) as WifiDeviceStatus);
    } catch {
      setDeviceWifiStatus(null);
    }
  }

  async function scanWifi() {
    setScanningWifi(true);
    setWifiStatus("");
    try {
      const { response, data } = await fetchDeviceWifi("/wifi/scan");
      if (!response.ok) throw new Error(data.detail ?? "WiFi scan failed");
      const nextNetworks: WifiNetwork[] = Array.isArray(data.networks) ? data.networks : [];
      setNetworks(nextNetworks);
      setSelectedNetwork(nextNetworks.find((network) => network.ssid === deviceWifiStatus?.ssid) ?? nextNetworks[0] ?? null);
      setWifiStatus((data.networks?.length ?? 0) > 0 ? "Tap a network to connect." : "No WiFi networks found.");
    } catch (error) {
      setWifiStatus(error instanceof Error ? error.message : "WiFi scan failed");
    } finally {
      setScanningWifi(false);
    }
  }

  async function connectWifi(network: WifiNetwork) {
    const nextConfig = { ...wifiConfig, ssid: network.ssid };
    updateWifiConfig(nextConfig);
    setSelectedNetwork(network);
    if (network.secure && !nextConfig.password) {
      setWifiStatus("Enter the WiFi password, then tap the network again.");
      return;
    }

    setConnectingWifi(network.ssid);
    setWifiStatus("");
    try {
      const { response, data } = await postDeviceWifiDirect("/wifi/connect", { ssid: network.ssid, password: nextConfig.password });
      if (!response.ok) throw new Error(data.detail ?? "WiFi connect failed");
      setWifiStatus(`LULU is connecting to ${network.ssid}. The IP may change after reconnect.`);
      setTimeout(() => void loadWifiStatus(), 2500);
    } catch (error) {
      setWifiStatus(error instanceof Error ? error.message : "WiFi connect failed");
    } finally {
      setConnectingWifi("");
    }
  }

  async function disconnectWifi() {
    setDisconnectingWifi(true);
    setWifiStatus("");
    try {
      const { response, data } = await postDeviceWifiDirect("/wifi/disconnect", {});
      if (!response.ok) throw new Error(data.detail ?? "WiFi disconnect failed");
      setDeviceWifiStatus(null);
      setWifiStatus("LULU is disconnecting from WiFi.");
    } catch (error) {
      setWifiStatus(error instanceof Error ? error.message : "WiFi disconnect failed");
    } finally {
      setDisconnectingWifi(false);
    }
  }

  const connected = connection?.connected ?? false;
  const lastCommand = connection?.remote?.last_command;
  const remoteDevice = connection?.remote?.device_status;
  const setupUrl = `http://${wifiConfig.deviceIp || defaultWifiConfig.deviceIp}`;
  const selectedIsCurrent = Boolean(selectedNetwork?.ssid && deviceWifiStatus?.connected && selectedNetwork.ssid === deviceWifiStatus.ssid);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur sm:items-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-white/10 bg-card shadow-[0_24px_80px_rgb(0_0_0/0.45)]">
        <div className="lulu-rainbow-bar" />
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-md", connected ? "bg-green-300 text-slate-950" : "bg-red-400 text-white")}>
              <PlugZap className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">LULU connection</h2>
              <p className="text-xs text-muted-foreground">{loading ? "Checking now" : connected ? "Connected" : "Not connected"}</p>
            </div>
          </div>
          <Button variant="ghost" className="h-9 w-9 px-0" onClick={onClose} title="Close connection modal">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 p-4">
          <div className={cn("rounded-lg border p-3", connected ? "border-green-300/30 bg-green-300/10" : "border-red-300/30 bg-red-400/10")}>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Status</p>
            <p className="mt-1 text-lg font-semibold">{connected ? "LULU backend is reachable" : "LULU backend is offline"}</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">{connection?.backend.baseUrl ?? "Waiting for backend URL"}</p>
          </div>

          <div className="rounded-lg border border-white/10 p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Device activity</p>
            <p className="mt-2 text-sm">{lastCommand ? `${lastCommand.action ?? "Command"} ${lastCommand.state ?? ""}`.trim() : "No recent remote command activity yet."}</p>
            {lastCommand?.device_id ? <p className="mt-1 text-xs text-muted-foreground">Device: {lastCommand.device_id}</p> : null}
          </div>

          <div className="rounded-lg border border-white/10 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Wifi className="h-4 w-4 text-cyan-200" />
                <p className="text-xs font-semibold uppercase text-muted-foreground">WiFi configuration</p>
              </div>
              <Button variant="secondary" className="h-9 w-9 px-0" disabled={scanningWifi} onClick={scanWifi} title="Search WiFi networks">
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <div className="mb-3 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs">
              <p className="font-medium">{deviceWifiStatus?.connected ? `LULU ESP32 is connected to ${deviceWifiStatus.ssid || "WiFi"}` : "LULU ESP32 WiFi status unavailable"}</p>
              <p className="mt-1 text-muted-foreground">{deviceWifiStatus?.connected ? `IP ${deviceWifiStatus.ip || "unknown"} | signal ${deviceWifiStatus.rssi} dBm` : "Search requires your browser to reach LULU at the device IP."}</p>
              {remoteDevice?.updated_at ? <p className="mt-1 text-muted-foreground">Railway heartbeat: {new Date(remoteDevice.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p> : null}
            </div>
            <div className="grid gap-3">
              <ConfigField label="WiFi SSID" value={wifiConfig.ssid} placeholder="Your router name" onChange={(ssid) => updateWifiConfig({ ...wifiConfig, ssid })} />
              <ConfigField label="WiFi password" value={wifiConfig.password} placeholder="Saved locally in this browser" type="password" onChange={(password) => updateWifiConfig({ ...wifiConfig, password })} />
              <ConfigField label="LULU device IP" value={wifiConfig.deviceIp} placeholder="192.168.1.100" onChange={(deviceIp) => updateWifiConfig({ ...wifiConfig, deviceIp })} />
            </div>
            <a className="mt-3 block rounded-md border border-cyan-200/30 bg-cyan-300/10 px-3 py-2 text-center text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/20" href={setupUrl} rel="noreferrer" target="_blank">
              Open LULU local setup
            </a>
            {wifiStatus ? <p className="mt-3 text-xs leading-5 text-cyan-100">{wifiStatus}</p> : null}
            {networks.length > 0 ? (
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto thin-scrollbar">
                {networks.map((network) => (
                  <button
                    key={`${network.ssid}-${network.channel ?? ""}`}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition hover:bg-white/10",
                      selectedNetwork?.ssid === network.ssid ? "border-cyan-200/60 bg-cyan-300/10" : "border-white/10 bg-white/5"
                    )}
                    disabled={connectingWifi.length > 0}
                    onClick={() => {
                      setSelectedNetwork(network);
                      updateWifiConfig({ ...wifiConfig, ssid: network.ssid });
                    }}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Wifi className="h-4 w-4 text-cyan-200" />
                        <span className="truncate">{network.ssid || "Hidden network"}</span>
                        {network.secure ? <Lock className="h-3.5 w-3.5 text-yellow-200" /> : null}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {network.rssi} dBm{network.channel ? ` | channel ${network.channel}` : ""}{deviceWifiStatus?.ssid === network.ssid ? " | current" : ""}
                      </span>
                    </span>
                    <span className="text-xs text-pink-100">{selectedNetwork?.ssid === network.ssid ? "Details" : "View"}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {selectedNetwork ? (
              <div className="mt-3 rounded-md border border-pink-200/30 bg-pink-300/10 p-3">
                <p className="text-sm font-semibold">{selectedNetwork.ssid || "Hidden network"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedNetwork.secure ? "Secured network" : "Open network"} | signal {selectedNetwork.rssi} dBm{selectedNetwork.channel ? ` | channel ${selectedNetwork.channel}` : ""}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Button className="w-full" disabled={connectingWifi.length > 0 || selectedIsCurrent} onClick={() => connectWifi(selectedNetwork)}>
                    {connectingWifi === selectedNetwork.ssid ? "Connecting" : selectedIsCurrent ? "Connected" : "Connect"}
                  </Button>
                  <Button variant="destructive" className="w-full" disabled={disconnectingWifi || !deviceWifiStatus?.connected} onClick={disconnectWifi}>
                    {disconnectingWifi ? "Disconnecting" : "Disconnect"}
                  </Button>
                </div>
              </div>
            ) : null}
            <p className="mt-3 text-xs leading-5 text-muted-foreground">Safest setup: the password is sent only from this browser directly to the ESP32, not through Railway. If this public dashboard cannot scan, open the dashboard locally or use LULU setup WiFi.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigField({ label, value, placeholder, type = "text", onChange }: { label: string; value: string; placeholder: string; type?: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TerminalLine({ label, text, tone }: { label: string; text: string; tone: "cyan" | "pink" }) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-950/90 px-3 py-3">
      <p className={cn("text-xs font-semibold uppercase", tone === "cyan" ? "text-cyan-200" : "text-pink-200")}>{label}:</p>
      <p className="mt-1 break-words text-sm leading-6 text-white">{text}</p>
    </div>
  );
}

function MiniStatus({ label, value, icon, tone }: { label: string; value: string; icon: ReactNode; tone: "green" | "red" | "yellow" }) {
  return (
    <div className={cn("rounded-lg border p-3", tone === "green" && "border-green-300/30 bg-green-300/15", tone === "red" && "border-red-300/30 bg-red-400/15", tone === "yellow" && "border-yellow-200/30 bg-yellow-200/15")}>
      <div className="flex items-center gap-2 text-white">
        {icon}
        <p className="text-xs font-semibold uppercase">{label}</p>
      </div>
      <p className="mt-2 truncate text-sm text-white/90">{value}</p>
    </div>
  );
}
