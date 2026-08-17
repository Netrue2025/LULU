from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlretrieve


PIPER_SOFT_VOICES = (
    {
        "voice_id": "en_US-amy-medium",
        "display_name": "Amy - Main LULU Voice",
        "description": "Female, youthful and warm.",
        "rank": "1",
        "suitability": "5/5",
        "recommended_use": "Main LULU voice",
        "locale": "en_US",
        "speaker": "amy",
        "quality": "medium",
    },
    {
        "voice_id": "en_US-kathleen-low",
        "display_name": "Kathleen - Gentle Companion",
        "description": "Female and soft.",
        "rank": "2",
        "suitability": "5/5",
        "recommended_use": "Gentle companion",
        "locale": "en_US",
        "speaker": "kathleen",
        "quality": "low",
    },
    {
        "voice_id": "en_GB-jenny_dioco-medium",
        "display_name": "Jenny Dioco - Premium UK LULU",
        "description": "Female, young and warm.",
        "rank": "3",
        "suitability": "5/5",
        "recommended_use": "Premium UK LULU, story, education",
        "locale": "en_GB",
        "speaker": "jenny_dioco",
        "quality": "medium",
    },
    {
        "voice_id": "en_US-libritts_r-medium",
        "display_name": "LibriTTS R - Natural Conversation",
        "description": "Female/multi-speaker style.",
        "rank": "4",
        "suitability": "4.5/5",
        "recommended_use": "Natural conversation",
        "locale": "en_US",
        "speaker": "libritts_r",
        "quality": "medium",
    },
    {
        "voice_id": "en_US-lessac-medium",
        "display_name": "Lessac - Polished Assistant",
        "description": "Female and polished.",
        "rank": "5",
        "suitability": "4.5/5",
        "recommended_use": "General assistant",
        "locale": "en_US",
        "speaker": "lessac",
        "quality": "medium",
    },
    {
        "voice_id": "en_US-arctic-medium",
        "display_name": "Arctic - Character Voice",
        "description": "Female/multi-speaker style.",
        "rank": "6",
        "suitability": "4/5",
        "recommended_use": "Character voice",
        "locale": "en_US",
        "speaker": "arctic",
        "quality": "medium",
    },
    {
        "voice_id": "en_US-kusal-medium",
        "display_name": "Kusal - Boy Companion",
        "description": "Male and youthful.",
        "rank": "7",
        "suitability": "4/5",
        "recommended_use": "Boy companion",
        "locale": "en_US",
        "speaker": "kusal",
        "quality": "medium",
    },
    {
        "voice_id": "en_US-danny-low",
        "display_name": "Danny - Young Boy Character",
        "description": "Male and lighter.",
        "rank": "8",
        "suitability": "4/5",
        "recommended_use": "Young-boy character",
        "locale": "en_US",
        "speaker": "danny",
        "quality": "low",
    },
    {
        "voice_id": "en_US-ryan-medium",
        "display_name": "Ryan - Friendly Teen",
        "description": "Male and friendly.",
        "rank": "9",
        "suitability": "4/5",
        "recommended_use": "Older-boy/teen",
        "locale": "en_US",
        "speaker": "ryan",
        "quality": "medium",
    },
    {
        "voice_id": "en_GB-cori-medium",
        "display_name": "Cori - British Story Mode",
        "description": "Female British voice.",
        "rank": "10",
        "suitability": "4/5",
        "recommended_use": "Story mode",
        "locale": "en_GB",
        "speaker": "cori",
        "quality": "medium",
    },
    {
        "voice_id": "en_GB-alba-medium",
        "display_name": "Alba - Soft British Character",
        "description": "Female British voice.",
        "rank": "11",
        "suitability": "3.5/5",
        "recommended_use": "Soft British character",
        "locale": "en_GB",
        "speaker": "alba",
        "quality": "medium",
    },
    {
        "voice_id": "en_US-hfc_female-medium",
        "display_name": "HFC Female - Alternative Female",
        "description": "Female voice.",
        "rank": "13",
        "suitability": "3.5/5",
        "recommended_use": "Alternative female",
        "locale": "en_US",
        "speaker": "hfc_female",
        "quality": "medium",
    },
    {
        "voice_id": "en_US-hfc_male-medium",
        "display_name": "HFC Male - Alternative Male",
        "description": "Male voice.",
        "rank": "14",
        "suitability": "3.5/5",
        "recommended_use": "Alternative male",
        "locale": "en_US",
        "speaker": "hfc_male",
        "quality": "medium",
    },
    {
        "voice_id": "en_US-john-medium",
        "display_name": "John - Narrator Teacher",
        "description": "Male voice.",
        "rank": "15",
        "suitability": "3/5",
        "recommended_use": "Narrator/teacher",
        "locale": "en_US",
        "speaker": "john",
        "quality": "medium",
    },
)


def _piper_voice_urls(voice: dict[str, str]) -> tuple[str, str]:
    base = (
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
        f"en/{voice['locale']}/{voice['speaker']}/{voice['quality']}/{voice['voice_id']}.onnx"
    )
    return base, f"{base}.json"


PIPER_VOICE_DOWNLOADS = {f"{voice['voice_id']}.onnx": _piper_voice_urls(voice) for voice in PIPER_SOFT_VOICES}


class PiperProvider:
    """Generate local WAV speech using Piper."""

    def __init__(
        self,
        piper_bin: str,
        voice_model: Path,
        timeout_seconds: int = 300,
        speaker_id: str = "",
        length_scale: str = "1.06",
        noise_scale: str = "0.55",
        noise_w: str = "0.65",
    ) -> None:
        self.piper_bin = piper_bin
        self.voice_model = voice_model
        self.timeout_seconds = timeout_seconds
        self.speaker_id = speaker_id
        self.length_scale = length_scale
        self.noise_scale = noise_scale
        self.noise_w = noise_w

    def synthesize(self, text: str, voice_id: str, output_path: Path) -> dict[str, Any]:
        """Generate WAV audio for text using Piper."""
        voice_model = self.resolve_voice_model(voice_id)
        self.ensure_voice_model(voice_model)

        started = time.perf_counter()
        temp_path = output_path.with_suffix(".tmp.wav")
        command = [
            self.piper_bin,
            "--model",
            str(voice_model),
            "--output_file",
            str(temp_path),
        ]
        if self.speaker_id:
            command.extend(["--speaker", self.speaker_id])
        if self.length_scale:
            command.extend(["--length_scale", self.length_scale])
        if self.noise_scale:
            command.extend(["--noise_scale", self.noise_scale])
        if self.noise_w:
            command.extend(["--noise_w", self.noise_w])

        result = subprocess.run(
            command,
            input=text.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=self.timeout_seconds,
            check=False,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"Piper failed: {stderr}")
        if not temp_path.exists() or temp_path.stat().st_size < 44:
            raise RuntimeError("Piper did not create a valid WAV file")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path.replace(output_path)
        return {
            "provider": "piper",
            "seconds": time.perf_counter() - started,
            "format": "wav",
            "voice_model": str(voice_model),
        }

    def resolve_voice_model(self, voice_id: str) -> Path:
        """Resolve a dashboard Piper voice id into an on-disk model path."""
        normalized = (voice_id or "").strip()
        if not normalized or normalized == "piper":
            return self.voice_model
        file_name = normalized if normalized.endswith(".onnx") else f"{normalized}.onnx"
        if file_name in PIPER_VOICE_DOWNLOADS:
            return self.voice_model.parent / file_name
        candidate = Path(normalized)
        if candidate.suffix == ".onnx":
            return candidate if candidate.is_absolute() else self.voice_model.parent / candidate.name
        return self.voice_model

    def voices(self) -> list[dict[str, Any]]:
        """Return the curated Piper voice list shown in the dashboard."""
        return [
            {
                "voice_id": str(voice["voice_id"]),
                "display_name": str(voice["display_name"]),
                "category": "local_piper",
                "labels": {
                    "provider": "piper",
                    "quality": str(voice["quality"]),
                    "locale": str(voice["locale"]),
                    "description": str(voice["description"]),
                    "rank": str(voice["rank"]),
                    "suitability": str(voice["suitability"]),
                    "recommended_use": str(voice["recommended_use"]),
                },
            }
            for voice in PIPER_SOFT_VOICES
        ]

    def install_voices(self) -> dict[str, Any]:
        """Download every curated Piper voice model and config file."""
        installed: list[dict[str, str]] = []
        failed: list[dict[str, str]] = []
        for voice in PIPER_SOFT_VOICES:
            voice_id = str(voice["voice_id"])
            model = self.resolve_voice_model(voice_id)
            try:
                self.ensure_voice_model(model)
                installed.append({"voice_id": voice_id, "model": str(model)})
            except Exception as exc:
                failed.append({"voice_id": voice_id, "error": str(exc)})
        return {
            "installed": installed,
            "failed": failed,
            "installed_count": len(installed),
            "failed_count": len(failed),
        }

    def ensure_voice_model(self, voice_model: Path | None = None) -> None:
        """Download the configured Piper model/config when a deployment is missing local voice assets."""
        voice_model = voice_model or self.voice_model
        config_path = voice_model.with_suffix(".onnx.json")
        if voice_model.exists() and config_path.exists():
            return

        auto_download = os.getenv("PIPER_AUTO_DOWNLOAD", "1").strip().lower() not in {
            "0",
            "false",
            "no",
            "off",
        }
        if not auto_download:
            raise RuntimeError(f"Piper voice model not found: {voice_model}")

        downloads = PIPER_VOICE_DOWNLOADS.get(voice_model.name)
        if not downloads:
            raise RuntimeError(
                f"Piper voice model not found and no download URL is configured for {voice_model.name}"
            )

        model_url, config_url = downloads
        voice_model.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._download_if_missing(model_url, voice_model)
            self._download_if_missing(config_url, config_path)
        except (HTTPError, URLError, OSError) as exc:
            raise RuntimeError(f"Could not download Piper voice model {voice_model.name}: {exc}") from exc

    def _download_if_missing(self, url: str, target: Path) -> None:
        if target.exists() and target.stat().st_size > 0:
            return

        temp_path = target.with_suffix(target.suffix + ".download")
        if temp_path.exists():
            temp_path.unlink()
        urlretrieve(url, temp_path)
        if not temp_path.exists() or temp_path.stat().st_size == 0:
            raise RuntimeError(f"Downloaded empty Piper asset from {url}")
        temp_path.replace(target)
