from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CacheEntry:
    text: str
    voice: str
    mode: str
    provider: str
    file: str


class TTSCacheManager:
    """Manage permanent short-phrase TTS cache files and metadata."""

    def __init__(self, cache_dir: Path, metadata_path: Path, max_text_length: int = 120) -> None:
        self.cache_dir = cache_dir
        self.metadata_path = metadata_path
        self.max_text_length = max_text_length
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_path.parent.mkdir(parents=True, exist_ok=True)

    def is_cacheable(self, text: str) -> bool:
        """Return True when a phrase should be stored permanently."""
        return 0 < len(text.strip()) <= self.max_text_length

    def key_for(self, text: str, voice: str, mode: str) -> str:
        """Build a stable cache key for text, voice, and mode."""
        payload = f"{mode}\0{voice}\0{text.strip()}".encode("utf-8")
        return hashlib.sha256(payload).hexdigest()[:16]

    def lookup(self, text: str, voice: str, mode: str) -> CacheEntry | None:
        """Return the cached entry if metadata and audio file both exist."""
        metadata = self._load_metadata()
        key = self.key_for(text, voice, mode)
        raw = metadata.get(key)
        if not isinstance(raw, dict):
            return None
        file_name = str(raw.get("file", ""))
        if not file_name or not (self.cache_dir / file_name).exists():
            return None
        return CacheEntry(
            text=str(raw.get("text", text)),
            voice=str(raw.get("voice", voice)),
            mode=str(raw.get("mode", mode)),
            provider=str(raw.get("provider", "")),
            file=file_name,
        )

    def store(self, text: str, voice: str, mode: str, provider: str, source_path: Path) -> CacheEntry:
        """Store generated audio and update cache metadata."""
        suffix = source_path.suffix.lower() or ".wav"
        key = self.key_for(text, voice, mode)
        file_name = f"{key}{suffix}"
        target = self.cache_dir / file_name
        shutil.copyfile(source_path, target)

        metadata = self._load_metadata()
        metadata[key] = {
            "text": text,
            "voice": voice,
            "mode": mode,
            "provider": provider,
            "file": file_name,
        }
        self._save_metadata(metadata)
        return CacheEntry(text=text, voice=voice, mode=mode, provider=provider, file=file_name)

    def path_for(self, entry: CacheEntry) -> Path:
        """Return the absolute audio path for a cache entry."""
        return self.cache_dir / entry.file

    def summary(self) -> dict[str, Any]:
        """Return cache entries, file count, and storage size."""
        metadata = self._load_metadata()
        files = []
        total_size = 0
        for path in self.cache_dir.iterdir() if self.cache_dir.exists() else []:
            if path.is_file() and path.name != self.metadata_path.name:
                size = path.stat().st_size
                total_size += size
                files.append({"file": path.name, "size": size})
        return {
            "cache_dir": str(self.cache_dir),
            "metadata": str(self.metadata_path),
            "file_count": len(files),
            "storage_used": total_size,
            "files": sorted(files, key=lambda item: item["file"]),
            "entries": metadata,
        }

    def clear(self, file_name: str | None = None) -> dict[str, Any]:
        """Clear all cache files or one specific cache file."""
        removed = 0
        metadata = self._load_metadata()
        if file_name:
            target = self.cache_dir / Path(file_name).name
            if target.exists() and target.is_file():
                target.unlink()
                removed += 1
            metadata = {key: value for key, value in metadata.items() if value.get("file") != target.name}
        else:
            for path in self.cache_dir.iterdir() if self.cache_dir.exists() else []:
                if path.is_file():
                    path.unlink()
                    removed += 1
            metadata = {}

        self._save_metadata(metadata)
        return {"removed": removed, **self.summary()}

    def _load_metadata(self) -> dict[str, dict[str, Any]]:
        if not self.metadata_path.exists():
            return {}
        try:
            data = json.loads(self.metadata_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _save_metadata(self, metadata: dict[str, dict[str, Any]]) -> None:
        self.metadata_path.parent.mkdir(parents=True, exist_ok=True)
        self.metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
