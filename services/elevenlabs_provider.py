from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests


@dataclass(frozen=True)
class ElevenLabsVoice:
    voice_id: str
    display_name: str
    category: str = ""
    labels: dict[str, Any] | None = None


class ElevenLabsProvider:
    """Generate speech and discover voices through the ElevenLabs API."""

    def __init__(self, api_key: str | None = None, model_id: str | None = None, timeout_seconds: float = 45) -> None:
        self.api_key = (api_key or os.getenv("ELEVENLABS_API_KEY", "")).strip()
        self.model_id = (model_id or os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")).strip()
        self.timeout_seconds = float(os.getenv("ELEVENLABS_TIMEOUT_SECONDS", str(timeout_seconds)))
        self.retry_count = max(1, int(os.getenv("ELEVENLABS_RETRY_COUNT", "2")))
        self.base_url = os.getenv("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io/v1").rstrip("/")

    @property
    def available(self) -> bool:
        """Return True when the provider has enough configuration to run."""
        return bool(self.api_key)

    def api_key_status(self) -> dict[str, Any]:
        """Return safe diagnostics for the configured API key without exposing it."""
        if not self.api_key:
            return {"configured": False, "length": 0, "prefix": "", "suffix": ""}
        return {
            "configured": True,
            "length": len(self.api_key),
            "prefix": self.api_key[:6],
            "suffix": self.api_key[-4:],
        }

    def _raise_for_auth_or_status(self, response: requests.Response, action: str) -> None:
        if response.status_code == 401:
            status = self.api_key_status()
            detail = ""
            try:
                error_body = response.json()
                raw_detail = error_body.get("detail") if isinstance(error_body, dict) else None
                if isinstance(raw_detail, dict):
                    code = str(raw_detail.get("code", "")).strip()
                    message = str(raw_detail.get("message", "")).strip()
                    detail = f" ElevenLabs says: {code} - {message}".strip()
                elif raw_detail:
                    detail = f" ElevenLabs says: {raw_detail}"
            except Exception:
                detail = ""
            raise RuntimeError(
                "ElevenLabs rejected ELEVENLABS_API_KEY with 401 Unauthorized while "
                f"{action}. Server is using key {status['prefix']}...{status['suffix']} "
                f"(length {status['length']}).{detail} Check the key permissions in ElevenLabs, "
                "update .env if needed, and restart the server."
            )
        response.raise_for_status()

    def synthesize(self, text: str, voice_id: str, output_path: Path) -> dict[str, Any]:
        """Generate MP3 audio for text using a configured ElevenLabs voice."""
        if not self.available:
            raise RuntimeError("ElevenLabs API key is not configured")

        started = time.perf_counter()
        response: requests.Response | None = None
        last_error: Exception | None = None
        for attempt in range(1, self.retry_count + 1):
            try:
                response = requests.post(
                    f"{self.base_url}/text-to-speech/{voice_id}",
                    headers={
                        "xi-api-key": self.api_key,
                        "Accept": "audio/mpeg",
                        "Content-Type": "application/json",
                    },
                    json={
                        "text": text,
                        "model_id": self.model_id,
                        "voice_settings": {"stability": 0.45, "similarity_boost": 0.75},
                    },
                    timeout=self.timeout_seconds,
                )
                self._raise_for_auth_or_status(response, "generating speech")
                if response.content:
                    break
                last_error = RuntimeError("ElevenLabs returned empty audio")
            except Exception as exc:
                last_error = exc
                if attempt >= self.retry_count:
                    raise
                time.sleep(0.6 * attempt)

        if response is None or not response.content:
            raise RuntimeError(str(last_error or "ElevenLabs returned empty audio"))

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(response.content)
        return {"provider": "elevenlabs", "seconds": time.perf_counter() - started, "format": "mp3"}

    def voices(self) -> list[dict[str, Any]]:
        """Fetch available ElevenLabs voices."""
        if not self.available:
            return []

        response = requests.get(
            f"{self.base_url}/voices",
            headers={"xi-api-key": self.api_key},
            timeout=self.timeout_seconds,
        )
        self._raise_for_auth_or_status(response, "loading voices")
        data = response.json()
        voices = data.get("voices", []) if isinstance(data, dict) else []
        results = []
        for voice in voices:
            if not isinstance(voice, dict):
                continue
            results.append(
                {
                    "voice_id": str(voice.get("voice_id", "")),
                    "display_name": str(voice.get("name", "")),
                    "category": str(voice.get("category", "")),
                    "labels": voice.get("labels") if isinstance(voice.get("labels"), dict) else {},
                }
            )
        return [item for item in results if item["voice_id"]]
