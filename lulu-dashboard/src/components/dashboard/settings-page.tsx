"use client";

import { Play, RefreshCw, Save, Trash2, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SectionCard } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { loadStored, saveStored } from "@/lib/store";

const defaults = {
  name: "LULU",
  prompt: "Warm, friendly local assistant.",
  wakeWord: "Hey LULU",
  language: "English",
  whisperModel: "base",
  piperVoice: "en_US-amy-medium",
  adminPassword: "",
  apiKeys: ""
};

type TtsVoice = {
  voice_id: string;
  display_name: string;
  category?: string;
};

type TtsConfig = {
  provider: string;
  defaultVoice: string;
  fallback: string;
  cacheEnabled: boolean;
  cacheFolder: string;
  elevenlabsGainDb: number;
  voices: Record<string, { voice_id: string; display_name: string }>;
};

type TtsCache = {
  file_count: number;
  storage_used: number;
  files: Array<{ file: string; size: number }>;
};

const defaultTtsConfig: TtsConfig = {
  provider: "elevenlabs",
  defaultVoice: "talia",
  fallback: "piper",
  cacheEnabled: false,
  cacheFolder: "cache/tts_cache",
  elevenlabsGainDb: 12,
  voices: {
    conversation: { voice_id: "talia", display_name: "Talia" },
    story: { voice_id: "florence", display_name: "Florence" },
    education: { voice_id: "eddie", display_name: "Eddie" }
  }
};
const preferredVoiceNames = ["Talia", "Florence", "Eddie"];

export function SettingsPage() {
  const [settings, setSettings] = useState(defaults);
  const [saved, setSaved] = useState(false);
  const [ttsConfig, setTtsConfig] = useState<TtsConfig>(defaultTtsConfig);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [ttsCache, setTtsCache] = useState<TtsCache>({ file_count: 0, storage_used: 0, files: [] });
  const [ttsStatus, setTtsStatus] = useState("");
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    setSettings(loadStored("lulu-settings", defaults));
    loadTtsSettings();
  }, []);

  function save() {
    saveStored("lulu-settings", settings);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  async function loadTtsSettings() {
    const [configResponse, voicesResponse, cacheResponse] = await Promise.all([
      fetch("/api/lulu/tts?action=config", { cache: "no-store" }),
      fetch("/api/lulu/tts?action=voices", { cache: "no-store" }),
      fetch("/api/lulu/tts?action=cache", { cache: "no-store" })
    ]);

    if (configResponse.ok) setTtsConfig({ ...defaultTtsConfig, ...(await configResponse.json()) });
    if (voicesResponse.ok) setVoices(uniqueVoices((await voicesResponse.json()).voices ?? []));
    if (cacheResponse.ok) setTtsCache(await cacheResponse.json());
  }

  function setModeVoice(mode: "conversation" | "story" | "education", voiceId: string) {
    const voice = voices.find((item) => item.voice_id === voiceId);
    setTtsConfig({
      ...ttsConfig,
      voices: {
        ...ttsConfig.voices,
        [mode]: {
          voice_id: voiceId,
          display_name: voice?.display_name ?? voiceId
        }
      }
    });
  }

  function usePreferredVoice(displayName: string) {
    const voice = voices.find((item) => item.display_name.toLowerCase() === displayName.toLowerCase());
    setTtsConfig({
      ...ttsConfig,
      provider: "elevenlabs",
      voices: {
        ...ttsConfig.voices,
        conversation: {
          voice_id: voice?.voice_id ?? displayName.toLowerCase(),
          display_name: voice?.display_name ?? displayName
        }
      }
    });
    setTtsStatus(voice ? `${voice.display_name} selected for conversation` : `${displayName} not found in ElevenLabs voices yet`);
  }

  function usePreferredVoiceSet() {
    const nextVoices = { ...ttsConfig.voices };
    const mapping: Array<["conversation" | "story" | "education", string]> = [
      ["conversation", "Talia"],
      ["story", "Florence"],
      ["education", "Eddie"]
    ];
    for (const [mode, displayName] of mapping) {
      const voice = voices.find((item) => item.display_name.toLowerCase() === displayName.toLowerCase());
      nextVoices[mode] = {
        voice_id: voice?.voice_id ?? displayName.toLowerCase(),
        display_name: voice?.display_name ?? displayName
      };
    }
    setTtsConfig({ ...ttsConfig, provider: "elevenlabs", voices: nextVoices });
    setTtsStatus("Preferred ElevenLabs voice set selected");
  }

  async function saveTtsSettings() {
    const response = await fetch("/api/lulu/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "config", config: ttsConfig })
    });
    setTtsStatus(response.ok ? "Voice settings saved" : "Could not save voice settings");
    if (response.ok) await loadTtsSettings();
  }

  async function previewVoice(mode: "conversation" | "story" | "education") {
    setPreviewing(true);
    setTtsStatus("Generating preview");
    try {
      const response = await fetch("/api/lulu/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "speak", text: "Hello, I'm LULU!", mode })
      });
      const data = await response.json();
      if (!response.ok) {
        setTtsStatus(data.detail ?? "Preview failed");
        return;
      }
      new Audio(data.audio_url).play();
      setTtsStatus(`Preview ready: ${data.provider}${data.cache_hit ? " cache" : ""}`);
      await loadTtsSettings();
    } finally {
      setPreviewing(false);
    }
  }

  async function clearTtsCache() {
    const response = await fetch("/api/lulu/tts", { method: "DELETE" });
    setTtsStatus(response.ok ? "TTS cache cleared" : "Could not clear TTS cache");
    await loadTtsSettings();
  }

  async function preloadTtsCache() {
    setTtsStatus("Preloading common phrases");
    const response = await fetch("/api/lulu/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preload" })
    });
    const data = await response.json();
    setTtsStatus(response.ok ? `Preloaded ${data.generated ?? 0} phrase(s)` : data.detail ?? "Preload failed");
    await loadTtsSettings();
  }

  return (
    <DashboardShell title="Settings" subtitle="General, speech, and security controls">
      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="General Settings">
          <div className="space-y-3">
            <Input placeholder="LULU Name" value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} />
            <Textarea placeholder="Personality Prompt" value={settings.prompt} onChange={(event) => setSettings({ ...settings, prompt: event.target.value })} />
            <Input placeholder="Wake Word" value={settings.wakeWord} onChange={(event) => setSettings({ ...settings, wakeWord: event.target.value })} />
            <Select value={settings.language} onChange={(event) => setSettings({ ...settings, language: event.target.value })}>
              <option>English</option>
              <option>Yoruba</option>
              <option>Pidgin English</option>
            </Select>
          </div>
        </SectionCard>
        <SectionCard title="Speech Settings">
          <div className="space-y-3">
            <Input placeholder="Whisper Model" value={settings.whisperModel} onChange={(event) => setSettings({ ...settings, whisperModel: event.target.value })} />
            <Input placeholder="Piper Voice" value={settings.piperVoice} onChange={(event) => setSettings({ ...settings, piperVoice: event.target.value })} />
          </div>
        </SectionCard>
        <SectionCard title="Security Settings">
          <div className="space-y-3">
            <Input type="password" placeholder="Admin Password" value={settings.adminPassword} onChange={(event) => setSettings({ ...settings, adminPassword: event.target.value })} />
            <Textarea placeholder="API Keys" value={settings.apiKeys} onChange={(event) => setSettings({ ...settings, apiKeys: event.target.value })} />
          </div>
        </SectionCard>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
        <SectionCard
          title="Voice Settings"
          action={<Button variant="secondary" onClick={loadTtsSettings}><RefreshCw className="h-4 w-4" />Refresh</Button>}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Select value={ttsConfig.provider} onChange={(event) => setTtsConfig({ ...ttsConfig, provider: event.target.value })}>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="piper">Piper</option>
            </Select>
            <Select value={ttsConfig.cacheEnabled ? "1" : "0"} onChange={(event) => setTtsConfig({ ...ttsConfig, cacheEnabled: event.target.value === "1" })}>
              <option value="1">Cache Enabled</option>
              <option value="0">Cache Disabled</option>
            </Select>
            <VoiceSelect label="Conversation Voice" mode="conversation" voices={voices} value={ttsConfig.voices.conversation?.voice_id ?? ""} onChange={setModeVoice} />
            <VoiceSelect label="Story Voice" mode="story" voices={voices} value={ttsConfig.voices.story?.voice_id ?? ""} onChange={setModeVoice} />
            <VoiceSelect label="Education Voice" mode="education" voices={voices} value={ttsConfig.voices.education?.voice_id ?? ""} onChange={setModeVoice} />
            <Input placeholder="Cache folder" value={ttsConfig.cacheFolder} onChange={(event) => setTtsConfig({ ...ttsConfig, cacheFolder: event.target.value })} />
            <Input
              type="number"
              min="-6"
              max="12"
              step="1"
              placeholder="ElevenLabs gain dB"
              value={ttsConfig.elevenlabsGainDb}
              onChange={(event) => setTtsConfig({ ...ttsConfig, elevenlabsGainDb: Number(event.target.value) })}
            />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {preferredVoiceNames.map((name) => {
              const available = voices.some((voice) => voice.display_name.toLowerCase() === name.toLowerCase());
              return (
                <Button key={name} variant={available ? "secondary" : "ghost"} onClick={() => usePreferredVoice(name)}>
                  {name}
                </Button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={saveTtsSettings}><Save className="h-4 w-4" />Save Voice Settings</Button>
            <Button variant="secondary" disabled={previewing} onClick={() => previewVoice("conversation")}><Play className="h-4 w-4" />Preview</Button>
            <Button variant="secondary" onClick={usePreferredVoiceSet}>Use Preferred Set</Button>
            <Button variant="secondary" disabled={previewing} onClick={preloadTtsCache}><Volume2 className="h-4 w-4" />Preload Phrases</Button>
          </div>
          {ttsStatus ? <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{ttsStatus}</p> : null}
        </SectionCard>

        <SectionCard title="Voice Cache">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Files</span>
              <span className="font-medium">{ttsCache.file_count ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Storage Used</span>
              <span className="font-medium">{formatBytes(ttsCache.storage_used ?? 0)}</span>
            </div>
            <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
              {(ttsCache.files ?? []).slice(0, 8).map((file) => (
                <div key={file.file} className="flex items-center justify-between gap-2">
                  <span className="truncate">{file.file}</span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
                </div>
              ))}
            </div>
            <Button variant="secondary" className="w-full" onClick={clearTtsCache}><Trash2 className="h-4 w-4" />Clear Cache</Button>
          </div>
        </SectionCard>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={save}><Save className="h-4 w-4" />{saved ? "Saved" : "Save Settings"}</Button>
      </div>
    </DashboardShell>
  );
}

function VoiceSelect({
  label,
  mode,
  voices,
  value,
  onChange
}: {
  label: string;
  mode: "conversation" | "story" | "education";
  voices: TtsVoice[];
  value: string;
  onChange: (mode: "conversation" | "story" | "education", voiceId: string) => void;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onChange={(event) => onChange(mode, event.target.value)}>
        {voices.length ? voices.map((voice, index) => (
          <option key={`${voice.voice_id}-${index}`} value={voice.voice_id}>{voice.display_name || voice.voice_id}</option>
        )) : <option value={value}>{value || "Configured voice"}</option>}
      </Select>
    </label>
  );
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function uniqueVoices(rawVoices: TtsVoice[]) {
  const seen = new Set<string>();
  return rawVoices.filter((voice) => {
    const key = voice.voice_id.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
