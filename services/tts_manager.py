from __future__ import annotations

import json
import logging
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .cache_manager import TTSCacheManager
from .elevenlabs_provider import ElevenLabsProvider
from .piper_provider import PiperProvider


COMMON_PHRASES = (
    "Hello",
    "Hi",
    "Good morning",
    "Good afternoon",
    "Good evening",
    "Goodbye",
    "See you later",
    "Thank you",
    "You're welcome",
    "Yes",
    "No",
    "Okay",
    "Sure",
    "Let's play",
    "Let's learn",
    "Great job!",
    "Excellent!",
    "Well done!",
    "I love you",
    "I'm here",
    "I'm listening",
    "One moment please",
    "Can you repeat that?",
    "I didn't understand.",
    "Please try again.",
    "I'm thinking...",
    "Let's read a story.",
    "Let's practice Portuguese.",
    "Let's practice Chinese.",
    "Battery is low.",
    "Charging started.",
    "Charging complete.",
    "WiFi connected.",
    "WiFi disconnected.",
    "Playing music.",
    "Stopping music.",
    "Radio started.",
    "Radio stopped.",
    "Story finished.",
    "Lesson completed.",
    "Sleep mode activated.",
    "Wake up!",
    "Good night.",
)


@dataclass(frozen=True)
class TTSResult:
    audio_path: Path
    provider: str
    voice_id: str
    mode: str
    cache_hit: bool
    fallback_used: bool
    generation_seconds: float


class TTSManager:
    """Provider-neutral TTS facade for LULU."""

    def __init__(
        self,
        config_path: Path,
        data_dir: Path,
        audio_dir: Path,
        elevenlabs_provider: ElevenLabsProvider,
        piper_provider: PiperProvider,
        ffmpeg_bin_resolver,
        logger: logging.Logger | None = None,
    ) -> None:
        self.config_path = config_path
        self.data_dir = data_dir
        self.audio_dir = audio_dir
        self.elevenlabs = elevenlabs_provider
        self.piper = piper_provider
        self.ffmpeg_bin_resolver = ffmpeg_bin_resolver
        self.logger = logger or logging.getLogger(__name__)
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.audio_dir.mkdir(parents=True, exist_ok=True)

    def speak(self, text: str, mode: str = "conversation", output_path: Path | None = None) -> TTSResult:
        """Generate speech without exposing the selected provider to callers."""
        clean_text = text.strip()
        if not clean_text:
            raise ValueError("TTS text is empty")

        started = time.perf_counter()
        config = self.load_config()
        mode = self.normalize_mode(mode)
        voice = self.voice_for_mode(mode, config)
        voice_id = voice.get("voice_id") or config.get("defaultVoice") or "default"
        output_path = output_path or self.audio_dir / "tts_response.wav"
        cache_enabled = bool(config.get("cacheEnabled", False))
        cache = self.cache_manager(config) if cache_enabled else None

        cache_hit = False
        fallback_used = False
        provider_used = str(config.get("provider", "elevenlabs")).lower()
        source_for_cache: Path | None = None

        if cache and cache.is_cacheable(clean_text):
            entry = cache.lookup(clean_text, voice_id, mode)
            if entry:
                self._prepare_output(cache.path_for(entry), output_path, config, entry.provider)
                self.logger.info(
                    "TTS cache hit mode=%s voice=%s provider=%s text_len=%u",
                    mode,
                    voice_id,
                    entry.provider,
                    len(clean_text),
                )
                return TTSResult(output_path, entry.provider, voice_id, mode, True, False, time.perf_counter() - started)

        self.logger.info(
            "TTS cache %s mode=%s voice=%s text_len=%u",
            "miss" if cache_enabled else "disabled",
            mode,
            voice_id,
            len(clean_text),
        )
        generated_path = self.audio_dir / f"tts_generate_{int(time.time() * 1000)}"
        try:
            if provider_used == "elevenlabs":
                voice_id = self.resolve_elevenlabs_voice_id(voice_id, voice.get("display_name", ""))
                mp3_path = generated_path.with_suffix(".mp3")
                details = self.elevenlabs.synthesize(clean_text, voice_id, mp3_path)
                provider_used = str(details["provider"])
                self._prepare_output(mp3_path, output_path, config, provider_used)
                source_for_cache = mp3_path
            else:
                wav_path = generated_path.with_suffix(".wav")
                details = self.piper.synthesize(clean_text, voice_id, wav_path)
                provider_used = str(details["provider"])
                self._prepare_output(wav_path, output_path, config, provider_used)
                source_for_cache = wav_path
        except Exception as exc:
            fallback_used = True
            provider_used = "piper"
            self.logger.warning("TTS primary provider failed; falling back to Piper: %s", exc)
            wav_path = generated_path.with_suffix(".fallback.wav")
            self.piper.synthesize(clean_text, voice_id, wav_path)
            self._prepare_output(wav_path, output_path, config, provider_used)
            source_for_cache = wav_path

        if cache and cache.is_cacheable(clean_text):
            cache.store(clean_text, voice_id, mode, provider_used, source_for_cache)

        if source_for_cache and source_for_cache.exists() and source_for_cache != output_path:
            try:
                source_for_cache.unlink()
            except OSError:
                self.logger.debug("Could not remove temporary TTS file %s", source_for_cache, exc_info=True)

        seconds = time.perf_counter() - started
        self.logger.info(
            "TTS generated provider=%s fallback=%s cache_hit=%s mode=%s voice=%s seconds=%.3f",
            provider_used,
            fallback_used,
            cache_hit,
            mode,
            voice_id,
            seconds,
        )
        return TTSResult(output_path, provider_used, voice_id, mode, cache_hit, fallback_used, seconds)

    def voices(self) -> list[dict[str, Any]]:
        """Return available ElevenLabs voices, plus configured fallback labels."""
        config = self.load_config()
        try:
            voices = self.elevenlabs.voices()
        except Exception as exc:
            self.logger.warning("ElevenLabs voice discovery failed: %s", exc)
            voices = []

        if voices:
            return voices

        configured = []
        for mode, voice in dict(config.get("voices", {})).items():
            if isinstance(voice, dict):
                configured.append(
                    {
                        "voice_id": str(voice.get("voice_id", mode)),
                        "display_name": str(voice.get("display_name", voice.get("voice_id", mode))),
                        "category": "configured",
                        "labels": {"mode": mode},
                    }
                )
        configured.append({"voice_id": "piper", "display_name": "Local Piper", "category": "local", "labels": {}})
        return configured

    def resolve_elevenlabs_voice_id(self, configured_voice_id: str, display_name: str = "") -> str:
        """Resolve configured labels/names to a real ElevenLabs voice_id."""
        if not self.elevenlabs.available:
            raise RuntimeError("ElevenLabs API key is not configured. Set ELEVENLABS_API_KEY and restart the server.")

        voices = self.elevenlabs.voices()
        if not voices:
            raise RuntimeError("ElevenLabs returned no voices for this API key")

        wanted = configured_voice_id.strip().lower()
        display = display_name.strip().lower()
        for voice in voices:
            voice_id = str(voice.get("voice_id", "")).strip()
            name = str(voice.get("display_name", "")).strip()
            if voice_id.lower() == wanted:
                return voice_id
            if wanted and name.lower() == wanted:
                return voice_id
            if display and name.lower() == display:
                return voice_id

        fallback_voice_id = str(voices[0].get("voice_id", "")).strip()
        fallback_name = str(voices[0].get("display_name", fallback_voice_id)).strip()
        if not fallback_voice_id:
            raise RuntimeError("ElevenLabs voice list did not include a usable voice_id")
        self.logger.warning(
            "Configured ElevenLabs voice %r was not found; using %r instead. Choose a real voice in Dashboard > Settings.",
            configured_voice_id,
            fallback_name,
        )
        return fallback_voice_id

    def cache_summary(self) -> dict[str, Any]:
        """Return cache metadata and storage usage."""
        return self.cache_manager(self.load_config()).summary()

    def clear_cache(self, file_name: str | None = None) -> dict[str, Any]:
        """Clear all cached TTS files or one selected file."""
        return self.cache_manager(self.load_config()).clear(file_name)

    def preload_common_phrases(self) -> dict[str, Any]:
        """Generate the predefined permanent cache phrases once."""
        generated = 0
        skipped = 0
        for phrase in COMMON_PHRASES:
            before = self.cache_summary()["file_count"]
            self.speak(phrase, mode="conversation")
            after = self.cache_summary()["file_count"]
            if after > before:
                generated += 1
            else:
                skipped += 1
        return {"generated": generated, "skipped": skipped, **self.cache_summary()}

    def load_config(self) -> dict[str, Any]:
        """Load TTS configuration from config/tts.json."""
        defaults = {
            "provider": "elevenlabs",
            "defaultVoice": "talia",
            "fallback": "piper",
            "cacheEnabled": False,
            "cacheFolder": "cache/tts_cache",
            "elevenlabsGainDb": 12.0,
            "voices": {
                "conversation": {"voice_id": "talia", "display_name": "Talia"},
                "story": {"voice_id": "florence", "display_name": "Florence"},
                "education": {"voice_id": "eddie", "display_name": "Eddie"},
            },
        }
        if not self.config_path.exists():
            self.save_config(defaults)
            return defaults
        try:
            loaded = json.loads(self.config_path.read_text(encoding="utf-8"))
            if not isinstance(loaded, dict):
                return defaults
            merged = {**defaults, **loaded}
            merged["voices"] = {**defaults["voices"], **dict(loaded.get("voices", {}))}
            return merged
        except Exception:
            self.logger.exception("Could not read TTS config; using defaults")
            return defaults

    def save_config(self, config: dict[str, Any]) -> dict[str, Any]:
        """Persist TTS configuration."""
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
        return self.load_config()

    def cache_manager(self, config: dict[str, Any]) -> TTSCacheManager:
        """Create a cache manager from current config."""
        raw_folder = Path(str(config.get("cacheFolder", "tts_cache")))
        cache_dir = raw_folder if raw_folder.is_absolute() else self.data_dir / raw_folder
        return TTSCacheManager(cache_dir=cache_dir, metadata_path=cache_dir / "tts_cache.json")

    def voice_for_mode(self, mode: str, config: dict[str, Any]) -> dict[str, str]:
        """Return the configured voice mapping for a logical mode."""
        voices = config.get("voices", {})
        voice = voices.get(mode) if isinstance(voices, dict) else None
        if isinstance(voice, dict):
            return {"voice_id": str(voice.get("voice_id", "")), "display_name": str(voice.get("display_name", ""))}
        return {"voice_id": str(config.get("defaultVoice", "talia")), "display_name": str(config.get("defaultVoice", "Talia"))}

    def normalize_mode(self, mode: str) -> str:
        """Normalize unsupported modes to conversation."""
        mode = mode.strip().lower()
        return mode if mode in {"conversation", "story", "education"} else "conversation"

    def elevenlabs_gain_db(self, config: dict[str, Any] | None) -> float:
        """Return the configured ElevenLabs conversion gain, clamped to avoid extreme clipping."""
        raw_gain = (config or {}).get("elevenlabsGainDb", 12.0)
        try:
            gain = float(raw_gain)
        except (TypeError, ValueError):
            gain = 12.0
        return max(-6.0, min(12.0, gain))

    def _prepare_output(
        self,
        source_path: Path,
        output_path: Path,
        config: dict[str, Any] | None = None,
        provider: str = "",
    ) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if source_path.suffix.lower() == ".wav":
            shutil.copyfile(source_path, output_path)
            return

        ffmpeg_bin = self.ffmpeg_bin_resolver()
        if not ffmpeg_bin:
            raise RuntimeError("ffmpeg is required to convert TTS audio for ESP32 playback")
        temp_path = output_path.with_suffix(".convert.tmp.wav")
        command = [
            ffmpeg_bin,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source_path),
            "-ac",
            "1",
            "-ar",
            "22050",
            "-sample_fmt",
            "s16",
        ]
        gain_db = self.elevenlabs_gain_db(config) if provider.lower() == "elevenlabs" else 0.0
        if abs(gain_db) >= 0.1:
            command.extend(["-af", f"volume={gain_db:g}dB"])
        command.append(str(temp_path))
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"ffmpeg TTS conversion failed: {stderr}")
        temp_path.replace(output_path)
