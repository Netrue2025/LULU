from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Any


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
        if not self.voice_model.exists():
            raise RuntimeError(f"Piper voice model not found: {self.voice_model}")

        started = time.perf_counter()
        temp_path = output_path.with_suffix(".tmp.wav")
        command = [
            self.piper_bin,
            "--model",
            str(self.voice_model),
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
        return {"provider": "piper", "seconds": time.perf_counter() - started, "format": "wav"}
