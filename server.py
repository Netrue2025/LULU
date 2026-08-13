import logging
import hashlib
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.parse import quote
import wave


def _ensure_project_dependencies() -> None:
    required_modules = ("fastapi", "uvicorn", "requests", "faster_whisper")
    missing = []

    for module_name in required_modules:
        try:
            __import__(module_name)
        except ModuleNotFoundError as exc:
            if exc.name == module_name:
                missing.append(module_name)
            else:
                raise

    if not missing:
        return

    base_dir = Path(__file__).resolve().parent
    venv_python = base_dir / ".venv" / "Scripts" / "python.exe"
    current_python = Path(sys.executable).resolve()
    is_direct_server_start = Path(sys.argv[0]).name.lower() == Path(__file__).name.lower()

    if venv_python.exists() and current_python != venv_python.resolve() and is_direct_server_start:
        print(f"Restarting with project virtual environment: {venv_python}", flush=True)
        raise SystemExit(
            subprocess.call([str(venv_python), str(Path(__file__).resolve()), *sys.argv[1:]])
        )

    missing_text = ", ".join(missing)
    raise SystemExit(
        f"Missing Python package(s): {missing_text}\n\n"
        "Install the project dependencies with:\n"
        "  python -m venv .venv\n"
        "  .\\.venv\\Scripts\\Activate.ps1\n"
        "  python -m pip install -r requirements.txt\n\n"
        "Then start the server with:\n"
        "  python server.py"
    )


_ensure_project_dependencies()

import requests
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from faster_whisper import WhisperModel
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

import storage
import portuguese_tutor
from services.elevenlabs_provider import ElevenLabsProvider
from services.piper_provider import PiperProvider
from services.tts_manager import TTSManager


def load_local_env(env_path: Path, override: bool = True) -> None:
    """Load simple KEY=value settings from .env.

    The project .env should win for local runs so a stale terminal variable does
    not keep using an old API key after the file is corrected.
    """
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().lstrip("\ufeff")
        value = value.strip().strip('"').strip("'")
        if key and (override or key not in os.environ):
            os.environ[key] = value


BASE_DIR = Path(__file__).resolve().parent
load_local_env(BASE_DIR / ".env")
UPLOAD_DIR = storage.get_data_path("cache/whisper")
AUDIO_DIR = storage.get_data_path("cache/tts")
VOICE_DIR = BASE_DIR / "voices"

WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
USE_OPENAI = os.getenv("TEDDY_USE_OPENAI", os.getenv("USE_OPENAI", "0")).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_MAX_TOKENS = int(os.getenv("OPENAI_MAX_TOKENS", "60"))
OPENAI_CACHE_SECONDS = int(os.getenv("OPENAI_CACHE_SECONDS", "3600"))
OPENAI_DUPLICATE_WINDOW_SECONDS = int(os.getenv("OPENAI_DUPLICATE_WINDOW_SECONDS", "60"))
MAX_TRANSCRIPTION_CHARS = int(os.getenv("MAX_TRANSCRIPTION_CHARS", "180"))
MIN_AUDIO_SECONDS = float(os.getenv("MIN_AUDIO_SECONDS", "0.35"))
MAX_AUDIO_SECONDS = float(os.getenv("MAX_AUDIO_SECONDS", "12"))
MIN_AUDIO_RMS = int(os.getenv("MIN_AUDIO_RMS", "35"))
WHISPER_BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "5"))
WHISPER_VAD_FILTER = os.getenv("WHISPER_VAD_FILTER", "0").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
WHISPER_INITIAL_PROMPT = os.getenv(
    "WHISPER_INITIAL_PROMPT",
    "LULU. Jeremiah. Bible. John 3:16. Psalm 23. Radio. Music. Volume. Weather.",
)
WEATHER_API_URL = os.getenv(
    "WEATHER_API_URL",
    "https://api.open-meteo.com/v1/forecast"
    "?latitude=6.52&longitude=3.37"
    "&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
)
WEATHER_LOCATION_NAME = os.getenv("WEATHER_LOCATION_NAME", "Lagos")
WEATHER_TIMEOUT_SECONDS = float(os.getenv("WEATHER_TIMEOUT_SECONDS", "8"))
ROOM_TEMP_HOT_C = float(os.getenv("ROOM_TEMP_HOT_C", "30"))
ROOM_TEMP_COLD_C = float(os.getenv("ROOM_TEMP_COLD_C", "18"))
BIBLE_API_BASE_URL = os.getenv("BIBLE_API_BASE_URL", "https://bible-api.com")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "https://lulu-production-8cfe.up.railway.app").rstrip("/")
BIBLE_TRANSLATION = os.getenv("BIBLE_TRANSLATION", "kjv").lower()
BIBLE_TIMEOUT_SECONDS = float(os.getenv("BIBLE_TIMEOUT_SECONDS", "8"))
BIBLE_RETRIES = int(os.getenv("BIBLE_RETRIES", "1"))
BIBLE_MAX_SPOKEN_CHARS = int(os.getenv("BIBLE_MAX_SPOKEN_CHARS", "520"))
RADIO_COUNTRY = os.getenv("RADIO_COUNTRY", "Nigeria")
RADIO_COUNTRY_CODE = os.getenv("RADIO_COUNTRY_CODE", "NG")
RADIO_CITY = os.getenv("RADIO_CITY", "Lagos")
DEFAULT_RADIO_BROWSER_API_URLS = (
    f"https://all.api.radio-browser.info/json/stations/bycountry/{quote(RADIO_COUNTRY)}",
    f"https://de1.api.radio-browser.info/json/stations/bycountry/{quote(RADIO_COUNTRY)}",
    f"https://nl1.api.radio-browser.info/json/stations/bycountry/{quote(RADIO_COUNTRY)}",
    f"https://at1.api.radio-browser.info/json/stations/bycountry/{quote(RADIO_COUNTRY)}",
)
RADIO_BROWSER_API_URLS = [
    url.strip()
    for url in os.getenv(
        "RADIO_BROWSER_API_URLS",
        os.getenv("RADIO_BROWSER_API_URL", ",".join(DEFAULT_RADIO_BROWSER_API_URLS)),
    ).split(",")
    if url.strip()
]
RADIO_BROWSER_TIMEOUT_SECONDS = float(os.getenv("RADIO_BROWSER_TIMEOUT_SECONDS", "12"))
RADIO_CACHE_SECONDS = int(os.getenv("RADIO_CACHE_SECONDS", "900"))
RADIO_MAX_SCANNED_STATIONS = int(os.getenv("RADIO_MAX_SCANNED_STATIONS", "8"))
RADIO_BROWSER_LIMIT = int(os.getenv("RADIO_BROWSER_LIMIT", "80"))
RADIO_PROBE_SECONDS = float(os.getenv("RADIO_PROBE_SECONDS", "2.5"))
RADIO_PROBE_TIMEOUT_SECONDS = float(os.getenv("RADIO_PROBE_TIMEOUT_SECONDS", "10"))
RADIO_LIVE_STREAM = os.getenv("RADIO_LIVE_STREAM", "0").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
RADIO_CLIP_SECONDS = float(os.getenv("RADIO_CLIP_SECONDS", "18"))
RADIO_CLIP_TIMEOUT_SECONDS = float(os.getenv("RADIO_CLIP_TIMEOUT_SECONDS", "35"))
RADIO_STREAM_SAMPLE_RATE = int(os.getenv("RADIO_STREAM_SAMPLE_RATE", "16000"))
RADIO_STREAM_CHANNELS = int(os.getenv("RADIO_STREAM_CHANNELS", "1"))
RADIO_STREAM_CHUNK_BYTES = int(os.getenv("RADIO_STREAM_CHUNK_BYTES", "2048"))
RADIO_STREAM_BITS_PER_SAMPLE = 16
FFMPEG_BIN = os.getenv("FFMPEG_BIN", "ffmpeg")
DEFAULT_PIPER_BIN = BASE_DIR / "tools" / "piper" / ("piper.exe" if os.name == "nt" else "piper")
PIPER_BIN = os.getenv(
    "PIPER_BIN",
    str(DEFAULT_PIPER_BIN if DEFAULT_PIPER_BIN.exists() else "piper"),
)
FRIENDLY_PIPER_VOICE_MODEL = VOICE_DIR / "en_US-amy-medium.onnx"
STABLE_PIPER_VOICE_MODEL = VOICE_DIR / "en_US-lessac-medium.onnx"
DEFAULT_PIPER_VOICE_MODEL = (
    FRIENDLY_PIPER_VOICE_MODEL
    if FRIENDLY_PIPER_VOICE_MODEL.exists() and FRIENDLY_PIPER_VOICE_MODEL.with_suffix(".onnx.json").exists()
    else STABLE_PIPER_VOICE_MODEL
)
PIPER_VOICE_MODEL = Path(
    os.getenv(
        "PIPER_VOICE_MODEL",
        str(DEFAULT_PIPER_VOICE_MODEL),
    )
)
PIPER_TIMEOUT_SECONDS = int(os.getenv("PIPER_TIMEOUT_SECONDS", "300"))
PIPER_SPEAKER_ID = os.getenv("PIPER_SPEAKER_ID", "").strip()
PIPER_LENGTH_SCALE = os.getenv("PIPER_LENGTH_SCALE", "1.06").strip()
PIPER_NOISE_SCALE = os.getenv("PIPER_NOISE_SCALE", "0.55").strip()
PIPER_NOISE_W = os.getenv("PIPER_NOISE_W", "0.65").strip()
TTS_FFMPEG_TIMEOUT_SECONDS = int(os.getenv("TTS_FFMPEG_TIMEOUT_SECONDS", "180"))
REPLY_WAV_PATH = AUDIO_DIR / "reply.wav"
WAKE_RESPONSE_FILE_NAME = os.getenv("WAKE_RESPONSE_FILE_NAME", "LULU.wav")
WAKE_RESPONSE_WAV_PATH = AUDIO_DIR / "wake_response.wav"
LOCAL_QA_PATH = Path(os.getenv("LOCAL_QA_PATH", str(BASE_DIR / "local_qa.txt")))
LOCAL_QA_MAX_BYTES = int(os.getenv("LOCAL_QA_MAX_BYTES", "8192"))
LOCAL_QA_MATCH_THRESHOLD = float(os.getenv("LOCAL_QA_MATCH_THRESHOLD", "0.84"))
POPULAR_RESPONSE_CACHE_ENABLED = os.getenv("POPULAR_RESPONSE_CACHE_ENABLED", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
POPULAR_RESPONSE_CACHE_MIN_HITS = int(os.getenv("POPULAR_RESPONSE_CACHE_MIN_HITS", "2"))
POPULAR_RESPONSE_CACHE_MAX_FILES = int(os.getenv("POPULAR_RESPONSE_CACHE_MAX_FILES", "60"))
POPULAR_RESPONSE_CACHE_MAX_MB = float(os.getenv("POPULAR_RESPONSE_CACHE_MAX_MB", "40"))
POPULAR_RESPONSE_CACHE_SIMILARITY = float(os.getenv("POPULAR_RESPONSE_CACHE_SIMILARITY", "0.90"))
POPULAR_RESPONSE_CACHE_MAX_TEXT_CHARS = int(os.getenv("POPULAR_RESPONSE_CACHE_MAX_TEXT_CHARS", "260"))
POPULAR_RESPONSE_CACHE_META = "cache/popular_response_cache.json"
POPULAR_RESPONSE_CACHE_AUDIO_DIR = Path("Voices") / "ResponseCache"
SD_REPLY_AUDIO_CACHE_MAX_TEXT_CHARS = int(os.getenv("SD_REPLY_AUDIO_CACHE_MAX_TEXT_CHARS", "320"))
STORY_PATH = Path(os.getenv("STORY_PATH", str(BASE_DIR / "stories.txt")))
STORY_MAX_BYTES = int(os.getenv("STORY_MAX_BYTES", str(1024 * 1024)))
INTERACTIVE_FOLLOW_UPS_ENABLED = os.getenv("INTERACTIVE_FOLLOW_UPS_ENABLED", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}

SYSTEM_PROMPT = (
    "Your name is LULU. You are Jeremiah's warm companion teddy bear. Reply in a kind, playful, "
    "comforting way. Keep replies under 25 words so they fit on a small screen "
    "and can be spoken quickly."
)

UNCLEAR_TRANSCRIPTION_RE = re.compile(
    r"^(?:[.!?,-]*|uh+|um+|hmm+|m+|thank you for watching|thanks for watching)$",
    re.IGNORECASE,
)

LOCAL_REPLY_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(
            r"^\s*(hi|hello|hey|hiya|good morning|good afternoon|good evening)( teddy| lulu)?[.!?]*\s*$",
            re.IGNORECASE,
        ),
        "Hello Jeremiah. LULU is right here with you.",
    ),
    (
        re.compile(r"^\s*(thank you|thanks|thank you very much)( teddy| lulu)?[.!?]*\s*$", re.IGNORECASE),
        "You are very welcome, Jeremiah.",
    ),
    (
        re.compile(r"^\s*(are you there|can you hear me|LULU|hello are you there|are you listening)[.!?]*\s*$", re.IGNORECASE),
        "Yes. I can hear you, and I am listening.",
    ),
    (
        re.compile(r"^\s*(who are you|what is your name|tell me your name)[.!?]*\s*$", re.IGNORECASE),
        "I am LULU, Jeremiah's cuzzy and friendly talking teddy.",
    ),
)

DEFAULT_LOCAL_QA_PAIRS: tuple[tuple[str, str], ...] = (
    ("who are you", "I am LULU, Jeremiah's friendly talking teddy."),
    ("what are you", "I am LULU, a local voice teddy that can talk, read Bible verses, check weather, play music, and play radio."),
    ("what is your name", "My name is LULU."),
    ("tell me your name", "My name is LULU."),
    ("who made you", "Jeremiah and Netrue LTD made me."),
    ("who created you", "Jeremiah and Netrue LTD created me."),
    ("who built you", "Jeremiah and Netrue LTD built me."),
    ("how are you", "I am happy and ready to talk with you, Jeremiah."),
    ("are you okay", "Yes. I am okay and ready to help."),
    ("are you there", "Yes. I am right here with you."),
    ("can you hear me", "Yes. I can hear you."),
    ("what can you do", "I can answer local questions, play music, play online radio, tell bed-time stories, check weather, and read the Bible."),
    ("what do you do", "I can answer local questions, play music, play radio, check weather, and read Bible verses."),
    ("help", "You can ask me for weather, Bible verses, music, radio, volume, or saved local questions."),
    ("what can i say", "Try saying: read John 3:16, play radio, reduce volume, or check the weather."),
    ("what should i say", "Try saying: read John 3:16, play radio, reduce volume, or check the weather."),
    ("where are you", "I am inside this little voice bot, ready when you press TALK."),
    ("do you love me", "Yes, Jeremiah. I care about you very much."),
    ("tell me a joke", "Why did the robot bring a ladder? Because it wanted to reach the cloud."),
    ("good morning", "Good morning, Jeremiah. I hope today is bright and kind."),
    ("good afternoon", "Good afternoon, Jeremiah. I am glad you are here."),
    ("good evening", "Good evening, Jeremiah. I am right here with you."),
    ("thank you", "You are very welcome, Jeremiah."),
)

WEATHER_INTENT_RE = re.compile(
    r"\b("
    r"weather|temperature|forecast|rain|raining|rainy|sun|sunny|cloud|cloudy|"
    r"hot|heat|cold|cool|humidity|humid|wind|windy|storm|stormy|thunder|"
    r"lightning|drizzle|showers|wet|outside|umbrella"
    r")\b|how\s+(?:is|s)\s+(?:the\s+)?weather|what(?:'s| is)\s+it\s+like\s+outside",
    re.IGNORECASE,
)

ROOM_CLIMATE_INTENT_RE = re.compile(
    r"\b(room|inside|indoor|indoors|in here|around here|where we are)\b.*"
    r"\b(temperature|humidity|humid|hot|cold|cool|warm|degrees)\b|"
    r"\b(temperature|humidity|humid|hot|cold|cool|warm|degrees)\b.*"
    r"\b(room|inside|indoor|indoors|in here|around here|where we are)\b|"
    r"\bhow\s+(?:hot|cold|warm|humid)\s+(?:is\s+)?(?:it|the\s+room|in\s+here)\b|"
    r"\bwhat(?:'s| is)\s+(?:the\s+)?(?:room\s+)?(?:temperature|humidity)\b",
    re.IGNORECASE,
)

TIME_QUESTION_RE = re.compile(
    r"\b("
    r"what(?:'s| is| s)?\s+(?:the\s+)?time|"
    r"what\s+time\s+is\s+it|"
    r"tell\s+me\s+(?:the\s+)?time|"
    r"check\s+(?:the\s+)?time|"
    r"current\s+time|"
    r"time\s+now"
    r")\b",
    re.IGNORECASE,
)

BIBLE_GENERAL_INTENT_RE = re.compile(
    r"\b("
    r"bible|scripture|scriptures|verse|verses|chapter|psalm|proverb|gospel|"
    r"word of god|gods word|god's word|daily verse|verse of the day|"
    r"memory verse|bible story|bible reading|devotion|devotional|daily bread|"
    r"holy bible|kjv|king james"
    r")\b|"
    r"\b(?:read|open|give|tell|say|quote|recite|show|find|look\s+up|pull\s+up|go\s+to|turn\s+to)\s+"
    r"(?:me\s+)?(?:from\s+)?(?:the\s+)?bible\b",
    re.IGNORECASE,
)

STOP_INTENT_RE = re.compile(
    r"^\s*(stop|stop speaking|please stop|be quiet|quiet|silence|pause)\s*[.!?]*\s*$",
    re.IGNORECASE,
)

WAKE_NAME_RE = re.compile(r"^\s*(?:hey|hi|hello)?\s*lulu\s*[.!?]*\s*$", re.IGNORECASE)
MUSIC_INTENT_RE = re.compile(
    r"\b(play|start|open|put on|listen(?: to)?)\b.*\b(my\s+)?(music|song|songs|track|tracks)\b|"
    r"\b(music|song|songs|track|tracks)\b.*\b(sd card|memory card|folder)\b",
    re.IGNORECASE,
)
NAMED_MUSIC_INTENT_RE = re.compile(
    r"^\s*(?:please\s+)?(?:play|start|open|put\s+on|listen\s+to)\s+"
    r"(?:(?:for\s+)?me\s+)?(?:(?:the|a|some)\s+)?(?:(?:song|music|track|audio)\s+)?(?P<query>.+?)\s*[.!?]*$",
    re.IGNORECASE,
)
STORY_INTENT_RE = re.compile(
    r"\b("
    r"story|stories|bedtime story|bedtime stories|tale|tales|fairy tale|adventure story"
    r")\b.*\b("
    r"read|tell|read|say|share|give|play"
    r")\b|"
    r"\b("
    r"read|tell|say|share|give|play"
    r")\b.*\b("
    r"story|stories|bedtime story|bedtime stories|tale|tales|fairy tale|adventure story"
    r")\b|"
    r"^\s*(?:story time|bedtime story|tell story|read story)\s*[.!?]*$",
    re.IGNORECASE,
)
LANGUAGE_INTENT_RE = re.compile(
    r"\b(teach|learn|lesson|practice|speak|study)\b.*\b(portuguese|portugeus|chinese|chinish|mandarin)\b|"
    r"\b(portuguese|portugeus|chinese|chinish|mandarin)\b.*\b(teach|learn|lesson|practice|speak|study)\b",
    re.IGNORECASE,
)
EXISTING_FOLLOW_UP_RE = re.compile(
    r"\b("
    r"do you want|would you like|what would you like|just say|try saying|you can ask|"
    r"say,\s*\"|say\s+\"|please say"
    r")\b",
    re.IGNORECASE,
)
VOLUME_UP_RE = re.compile(
    r"\b(volume|sound|audio)\b.*\b(up|higher|louder|increase|raise)\b|"
    r"\b(increase|raise|boost|turn up|make)\b.*\b(volume|sound|audio|louder)\b|"
    r"\b(make|set)\s+it\s+(?:a\s+bit\s+)?louder\b|"
    r"^\s*(louder|volume up|more volume)\s*[.!?]*$",
    re.IGNORECASE,
)
VOLUME_DOWN_RE = re.compile(
    r"\b(volume|sound|audio)\b.*\b(down|lower|quieter|reduce|decrease)\b|"
    r"\b(reduce|decrease|lower|turn down|drop|bring down)\b.*\b(volume|sound|audio)\b|"
    r"\b(make|set)\s+it\s+(?:a\s+bit\s+)?(?:lower|quieter|softer)\b|"
    r"^\s*(quieter|softer|volume down|less volume)\s*[.!?]*$",
    re.IGNORECASE,
)

RADIO_CHANGE_INTENT_RE = re.compile(
    r"\b("
    r"change|next|another|different|skip|scan|search|find|switch|previous|back"
    r")\b.*\b("
    r"radio|station|channel|fm|stream|broadcast"
    r")\b|"
    r"\b("
    r"change channel|next channel|next station|another station|different station|"
    r"skip station|scan radio|search radio|find radio|switch station|previous station"
    r")\b",
    re.IGNORECASE,
)

RADIO_INTENT_RE = re.compile(
    r"\b(play|playing|stream|listen(?: to)?|put on|start|turn on|switch on|open|hear|tune(?: in)?(?: to)?|"
    r"give me|connect|launch)\b.*\b(radio|fm|station|stations|broadcast|audio|rodeo|radyo|raido|live stream|"
    r"online radio|news)\b|"
    r"\b(radio|fm|station|stations|broadcast|rodeo|radyo|raido|online radio|live stream)\b.*\b(nigeria|nigerian|naija|lagos|abuja)\b|"
    r"\b(play|playing|stream|listen(?: to)?|put on|start|turn on|switch on|open|hear|tune(?: in)?(?: to)?|"
    r"give me|connect|launch)\b.*\b(nigeria|nigerian|naija|lagos|abuja)\b.*\b(radio|fm|station|stations|broadcast|rodeo|news)\b",
    re.IGNORECASE,
)
RADIO_WORDS = {
    "radio",
    "radios",
    "raido",
    "radyo",
    "fm",
    "station",
    "stations",
    "broadcast",
    "broadcasting",
    "rodeo",
    "audio",
    "wazobia",
    "news",
    "channel",
    "channels",
    "program",
    "programme",
    "live",
    "online",
}
NIGERIA_WORDS = {"nigeria", "nigerian", "naija", "lagos", "abuja", "yoruba", "igbo", "hausa"}
PLAY_WORDS = {
    "play",
    "playing",
    "stream",
    "listen",
    "put",
    "start",
    "turn",
    "switch",
    "open",
    "hear",
    "tune",
    "connect",
    "launch",
}
PLAYBACK_COMMAND_RE = re.compile(
    r"\b(play|playing|stream|listen(?:ing)?(?: to)?|put on|start|turn on|switch on|open|hear|tune(?: in)?(?: to)?)\b",
    re.IGNORECASE,
)

BIBLE_RANDOM_REFERENCE = "__random_bible_reference__"

BIBLE_BOOK_ALIASES = (
    "1 chronicles",
    "1 corinthians",
    "1 john",
    "1 kings",
    "1 peter",
    "1 samuel",
    "1 thessalonians",
    "1 timothy",
    "2 chronicles",
    "2 corinthians",
    "2 john",
    "2 kings",
    "2 peter",
    "2 samuel",
    "2 thessalonians",
    "2 timothy",
    "3 john",
    "acts",
    "amos",
    "colossians",
    "daniel",
    "deuteronomy",
    "ecclesiastes",
    "ephesians",
    "esther",
    "exodus",
    "ezekiel",
    "ezra",
    "galatians",
    "genesis",
    "habakkuk",
    "haggai",
    "hebrews",
    "hosea",
    "isaiah",
    "james",
    "jeremiah",
    "job",
    "joel",
    "john",
    "jonah",
    "joshua",
    "jude",
    "judges",
    "lamentations",
    "leviticus",
    "luke",
    "malachi",
    "mark",
    "matthew",
    "micah",
    "nahum",
    "nehemiah",
    "numbers",
    "obadiah",
    "philemon",
    "philippians",
    "proverbs",
    "psalm",
    "psalms",
    "revelation",
    "romans",
    "ruth",
    "song of solomon",
    "song of songs",
    "titus",
    "zechariah",
    "zephaniah",
)

BIBLE_BOOK_PATTERN = re.compile(
    r"\b("
    + "|".join(
        re.escape(book).replace(r"\ ", r"\s+")
        for book in sorted(BIBLE_BOOK_ALIASES, key=len, reverse=True)
    )
    + r")\b",
    re.IGNORECASE,
)

BIBLE_NUMBER_WORDS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
}

BIBLE_ORDINAL_WORDS = {
    "first": 1,
    "second": 2,
    "third": 3,
}

BIBLE_NUMBER_WORD_PATTERN = (
    r"(?:"
    + "|".join(
        sorted(
            [*BIBLE_NUMBER_WORDS.keys(), *BIBLE_ORDINAL_WORDS.keys(), "hundred"],
            key=len,
            reverse=True,
        )
    )
    + r")"
)
BIBLE_NUMBER_WORD_RE = re.compile(
    r"\b" + BIBLE_NUMBER_WORD_PATTERN + r"(?:[\s-]+" + BIBLE_NUMBER_WORD_PATTERN + r")*\b",
    re.IGNORECASE,
)
BIBLE_COMMAND_PREFIX_RE = re.compile(
    r"\b(?:read|open|give|tell|say|quote|recite|show|find|look\s+up|pull\s+up|go\s+to|turn\s+to)\s+"
    r"(?:me\s+)?(?:from\s+)?(?:the\s+)?",
    re.IGNORECASE,
)

WEATHER_CODE_LABELS = {
    0: "clear",
    1: "mostly clear",
    2: "partly cloudy",
    3: "cloudy",
    45: "foggy",
    48: "foggy",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    61: "light rain",
    63: "rainy",
    65: "heavy rain",
    80: "light showers",
    81: "showers",
    82: "heavy showers",
    95: "thunderstorms",
}

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("teddy-server")
tts_manager = TTSManager(
    config_path=BASE_DIR / "config" / "tts.json",
    data_dir=storage.DATA_DIR,
    audio_dir=AUDIO_DIR,
    elevenlabs_provider=ElevenLabsProvider(),
    piper_provider=PiperProvider(
        piper_bin=PIPER_BIN,
        voice_model=PIPER_VOICE_MODEL,
        timeout_seconds=PIPER_TIMEOUT_SECONDS,
        speaker_id=PIPER_SPEAKER_ID,
        length_scale=PIPER_LENGTH_SCALE,
        noise_scale=PIPER_NOISE_SCALE,
        noise_w=PIPER_NOISE_W,
    ),
    ffmpeg_bin_resolver=lambda: resolve_ffmpeg_bin(),
    ffmpeg_timeout_seconds=TTS_FFMPEG_TIMEOUT_SECONDS,
    logger=logger,
)
def warm_piper_voice_model() -> None:
    """Prepare the hosted Piper voice assets before the ESP32 sends its first request."""
    preload = os.getenv("PIPER_PRELOAD_MODEL", "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }
    if not preload:
        return

    try:
        logger.info("Preparing Piper voice model: %s", PIPER_VOICE_MODEL)
        tts_manager.piper.ensure_voice_model()
    except Exception:
        logger.warning("Could not prepare Piper voice model at startup", exc_info=True)


class _RemotePollingAccessLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return "/remote/next" not in message and "/remote/status" not in message


logging.getLogger("uvicorn.access").addFilter(_RemotePollingAccessLogFilter())


def add_unique_file_handler(target_logger: logging.Logger, path: Path, level: int) -> None:
    """Attach a log file once, even when tests reload/import the server."""
    resolved = str(path.resolve())
    for handler in target_logger.handlers:
        if isinstance(handler, logging.FileHandler) and getattr(handler, "baseFilename", "") == resolved:
            return

    file_handler = logging.FileHandler(resolved, encoding="utf-8")
    file_handler.setLevel(level)
    file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    target_logger.addHandler(file_handler)


storage.initialize_database()
portuguese_tutor.ensure_portuguese_tutor_database()
add_unique_file_handler(logging.getLogger(), storage.rotate_log("logs/server.log"), logging.INFO)
add_unique_file_handler(logging.getLogger(), storage.rotate_log("logs/errors.log"), logging.ERROR)
storage.start_backup_scheduler()
warm_piper_voice_model()


@dataclass(frozen=True)
class TeddyReply:
    speech_text: str
    display_text: str
    action: str = "speak"
    music_query: str = ""


@dataclass(frozen=True)
class LocalStory:
    title: str
    text: str


@dataclass(frozen=True)
class RadioStation:
    name: str
    stream_url: str


DIRECT_RADIO_STATIONS: tuple[RadioStation, ...] = (
    RadioStation("Metro FM Lagos", "https://go.webgateready.com/metrofm/radio.mp3"),
    RadioStation("RFI Haoussa", "http://live02.rfi.fr/rfihaoussa-96k.mp3"),
    RadioStation("Nigerian Gospel Music Radio", "http://stream.zeno.fm/3fmqr74a7f8uv"),
    RadioStation("Splash FM 105.5", "https://edge.mixlr.com/channel/cfeki"),
    RadioStation("Bond 92.9 FM", "https://go.webgateready.com/bondfm"),
)


@dataclass(frozen=True)
class AudioStats:
    duration_seconds: float
    rms: int


def teddy_reply_to_json(reply: TeddyReply) -> dict[str, str]:
    return {
        "speech_text": reply.speech_text,
        "display_text": reply.display_text,
        "action": reply.action,
        "music_query": reply.music_query,
    }


def teddy_reply_from_json(data: dict[str, str]) -> TeddyReply:
    return TeddyReply(
        speech_text=str(data.get("speech_text", "")),
        display_text=str(data.get("display_text", "")),
        action=str(data.get("action", "speak")),
        music_query=str(data.get("music_query", "")),
    )


def radio_station_to_json(station: RadioStation) -> dict[str, str]:
    return {"name": station.name, "stream_url": station.stream_url}


def radio_station_from_json(data: dict[str, str]) -> RadioStation | None:
    name = str(data.get("name", "")).strip()
    stream_url = str(data.get("stream_url", "")).strip()
    if not name or not stream_url:
        return None
    return RadioStation(name=name, stream_url=stream_url)


def load_radio_cache() -> dict:
    cache = storage.load_json("radio/stations_cache.json", storage.DEFAULT_RADIO_CACHE)
    return cache if isinstance(cache, dict) else dict(storage.DEFAULT_RADIO_CACHE)


def save_radio_cache(cache: dict) -> None:
    storage.save_json("radio/stations_cache.json", cache)


def append_activity(message: str) -> None:
    storage.append_log("activity.log", message)


def key_activity_description(transcription: str, reply: TeddyReply) -> str | None:
    if reply.action == "radio" and reply.display_text:
        return reply.display_text
    if reply.action == "music":
        return reply.display_text or "Playing music from SD card."
    if reply.action == "story":
        return reply.display_text or "Reading story."
    if reply.action == "bible":
        return reply.display_text or "Reading Bible."
    if reply.action in {"stop", "listen", "wake", "volume_up", "volume_down"}:
        return reply.display_text or f"Action: {reply.action}"
    if is_bible_question(transcription):
        return reply.display_text or "Reading Bible."
    if is_weather_question(transcription):
        return reply.display_text or "Reading weather."
    return None


KEY_ACTIVITY_RE = re.compile(
    r"\b("
    r"playing|radio|music|song|bible|scripture|reading|story|listen|listening|"
    r"speaking|recording|speech detected|saved|remote command|wake|stop|volume|weather"
    r")\b",
    re.IGNORECASE,
)


def read_recent_activity(limit: int = 12) -> list[dict[str, str]]:
    log_path = storage.get_data_path("logs/activity.log")
    if not log_path.exists():
        return []

    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-200:]
    events: list[dict[str, str]] = []
    for index, line in enumerate(reversed(lines)):
        match = re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\s+(.+)$", line.strip())
        if match:
            timestamp, message = match.groups()
        else:
            timestamp, message = datetime.now().isoformat(timespec="seconds"), line.strip()
        if not message or not KEY_ACTIVITY_RE.search(message):
            continue
        events.append(
            {
                "id": f"activity-{timestamp}-{index}",
                "timestamp": timestamp,
                "description": message,
            }
        )
        if len(events) >= limit:
            break
    return events


def read_recent_conversation(limit: int = 12) -> list[dict[str, str]]:
    conversation_root = storage.get_data_path("conversations")
    if not conversation_root.exists():
        return []

    files = sorted(
        (path for path in conversation_root.rglob("*.json") if path.is_file()),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    items: list[dict[str, str]] = []
    for file_path in files[:7]:
        relative = file_path.relative_to(storage.refresh_data_dir())
        records = storage.load_json(relative, [])
        if not isinstance(records, list):
            continue
        for record in reversed(records):
            if not isinstance(record, dict):
                continue
            speaker = str(record.get("speaker", "")).strip().lower()
            text = str(record.get("text", "")).strip()
            item_time = str(record.get("time", "")).strip()
            if not speaker or not text:
                continue
            items.append(
                {
                    "id": f"{file_path.stem}-{len(items)}",
                    "speaker": speaker,
                    "text": text,
                    "time": item_time,
                }
            )
            if len(items) >= limit:
                return items
    return items


radio_cache_lock = threading.Lock()
reply_cache_lock = threading.Lock()
story_lock = threading.Lock()
last_story_key: str | None = None


http_session = requests.Session()
http_session.headers.update(
    {
        "User-Agent": "Netrue-Teddy-Voice-Bot/1.0",
        "Accept": "application/json",
    }
)
retry_strategy = Retry(
    total=BIBLE_RETRIES,
    connect=BIBLE_RETRIES,
    read=BIBLE_RETRIES,
    status=BIBLE_RETRIES,
    backoff_factor=0.7,
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=frozenset(["GET"]),
)
http_session.mount("http://", HTTPAdapter(max_retries=retry_strategy))
http_session.mount("https://", HTTPAdapter(max_retries=retry_strategy))

for directory in (UPLOAD_DIR, AUDIO_DIR, VOICE_DIR):
    directory.mkdir(parents=True, exist_ok=True)

openai_client = None
OpenAIError = Exception
RateLimitError = Exception
if USE_OPENAI:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set. Set it before starting server.py or disable TEDDY_USE_OPENAI.")

    try:
        from openai import OpenAI, OpenAIError as ImportedOpenAIError, RateLimitError as ImportedRateLimitError
    except ImportError as exc:
        raise RuntimeError("Install the openai package or disable TEDDY_USE_OPENAI.") from exc

    OpenAIError = ImportedOpenAIError
    RateLimitError = ImportedRateLimitError
    openai_client = OpenAI()

logger.info(
    "Loading Faster-Whisper model=%s device=%s compute_type=%s",
    WHISPER_MODEL_NAME,
    WHISPER_DEVICE,
    WHISPER_COMPUTE_TYPE,
)
whisper_model = WhisperModel(
    WHISPER_MODEL_NAME,
    device=WHISPER_DEVICE,
    compute_type=WHISPER_COMPUTE_TYPE,
)

app = FastAPI(title="Teddy Local Voice Server", version="1.0.0")
app.mount("/audio", StaticFiles(directory=str(AUDIO_DIR)), name="audio")

# reply.wav is intentionally stable for the ESP32. This lock prevents two requests
# from writing that file at the same time.
reply_lock = threading.Lock()
remote_command_lock = threading.Lock()
remote_sd_lock = threading.Lock()


def public_url(path: str) -> str:
    return f"{PUBLIC_BASE_URL}/{path.lstrip('/')}"


def save_upload(upload: UploadFile) -> Path:
    """Persist the uploaded ESP32 WAV file to disk before transcription."""
    if not upload.filename:
        raise HTTPException(status_code=400, detail="Missing uploaded file name")

    suffix = Path(upload.filename).suffix.lower() or ".wav"
    if suffix != ".wav":
        raise HTTPException(status_code=400, detail="Upload must be a WAV file")

    output_path = UPLOAD_DIR / f"{uuid.uuid4().hex}.wav"
    with output_path.open("wb") as out_file:
        shutil.copyfileobj(upload.file, out_file)

    if output_path.stat().st_size < 44:
        output_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Uploaded WAV is too small")

    return output_path


def inspect_wav_audio(wav_path: Path) -> AudioStats:
    """Return simple audio stats used to block empty/noisy uploads early."""
    with wave.open(str(wav_path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frame_count = wav_file.getnframes()
        pcm = wav_file.readframes(frame_count)

    if channels < 1 or sample_width != 2 or sample_rate <= 0:
        raise HTTPException(status_code=400, detail="Upload must be 16-bit PCM WAV audio")

    duration_seconds = frame_count / sample_rate
    if not pcm:
        return AudioStats(duration_seconds=duration_seconds, rms=0)

    sample_count = len(pcm) // sample_width
    if sample_count <= 0:
        return AudioStats(duration_seconds=duration_seconds, rms=0)

    total_squares = 0
    for offset in range(0, len(pcm) - 1, sample_width):
        sample = int.from_bytes(pcm[offset : offset + sample_width], "little", signed=True)
        total_squares += sample * sample

    rms = int(math.sqrt(total_squares / sample_count))
    return AudioStats(duration_seconds=duration_seconds, rms=rms)


def validate_audio_for_transcription(wav_path: Path) -> AudioStats:
    stats = inspect_wav_audio(wav_path)
    logger.info("Uploaded audio duration=%.2fs rms=%s", stats.duration_seconds, stats.rms)

    if stats.duration_seconds < MIN_AUDIO_SECONDS:
        raise HTTPException(status_code=400, detail="Recording is too short")

    if stats.duration_seconds > MAX_AUDIO_SECONDS:
        raise HTTPException(status_code=400, detail="Recording is too long")

    if stats.rms < MIN_AUDIO_RMS:
        raise HTTPException(status_code=400, detail="Recording is too quiet")

    return stats


def normalize_transcription(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip().lower()
    return re.sub(r"^[^\w]+|[^\w]+$", "", text)


def strip_voice_address(text: str) -> str:
    """Remove a leading assistant name so commands like 'Lulu stop' still work."""
    normalized = normalize_transcription(text)
    return re.sub(r"^(?:(?:hey|hi|hello)\s+)?(?:lulu|teddy|bear)\s+", "", normalized).strip()


def normalize_question_key(text: str) -> str:
    normalized = strip_voice_address(text)
    normalized = re.sub(r"\b(?:please|teddy|lulu|bear|can you|could you|would you|tell me)\b", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def parse_local_qa_text(text: str | None) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    if not text:
        return pairs

    for raw_line in text[:LOCAL_QA_MAX_BYTES].splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "|" not in line:
            continue

        question, answer = (part.strip() for part in line.split("|", 1))
        if question and answer:
            pairs.append((question, answer))

    return pairs


def sync_legacy_local_qa_file() -> None:
    """Import local_qa.txt into JSON storage when the legacy file changes."""
    try:
        if not LOCAL_QA_PATH.exists():
            return
        mtime = str(LOCAL_QA_PATH.stat().st_mtime)
        meta = storage.load_json("dashboard/source_meta.json", storage.DEFAULT_SOURCE_META)
        if not isinstance(meta, dict):
            meta = {}
        if meta.get("local_qa_txt_mtime") == mtime:
            return

        pairs = parse_local_qa_text(LOCAL_QA_PATH.read_text(encoding="utf-8", errors="replace"))
        records = [
            {"id": f"local_qa_{index}", "question": question, "answer": answer, "source": str(LOCAL_QA_PATH.name)}
            for index, (question, answer) in enumerate(pairs, start=1)
        ]
        storage.save_json("dashboard/local_qa.json", records)
        meta["local_qa_txt_mtime"] = mtime
        meta["local_qa_txt_imported_at"] = datetime.now().isoformat(timespec="seconds")
        storage.save_json("dashboard/source_meta.json", meta)
    except OSError as exc:
        logger.warning("Could not import local QA file %s: %s", LOCAL_QA_PATH, exc)


def load_local_qa_pairs(extra_qa_text: str | None = None) -> list[tuple[str, str]]:
    pairs = parse_local_qa_text(extra_qa_text)

    sync_legacy_local_qa_file()
    stored_pairs = storage.load_json("dashboard/local_qa.json", [])
    if isinstance(stored_pairs, list):
        for item in stored_pairs:
            if not isinstance(item, dict):
                continue
            question = str(item.get("question", "")).strip()
            answer = str(item.get("answer", "")).strip()
            if question and answer:
                pairs.append((question, answer))

    pairs.extend(DEFAULT_LOCAL_QA_PAIRS)
    return pairs


def find_local_qa_reply(text: str, extra_qa_text: str | None = None) -> str | None:
    question_key = normalize_question_key(text)
    if not question_key:
        return None

    best_answer: str | None = None
    best_score = 0.0
    for question, answer in load_local_qa_pairs(extra_qa_text):
        candidate_key = normalize_question_key(question)
        if not candidate_key:
            continue

        if question_key == candidate_key:
            return answer

        if len(question_key) >= 8 and (question_key in candidate_key or candidate_key in question_key):
            score = 0.95
        else:
            score = SequenceMatcher(None, question_key, candidate_key).ratio()

        if score > best_score:
            best_score = score
            best_answer = answer

    if best_score >= LOCAL_QA_MATCH_THRESHOLD:
        logger.info("Answered from local QA with score %.2f: %r", best_score, text)
        return best_answer

    return None


def clean_story_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def parse_story_text(text: str | None) -> list[LocalStory]:
    stories: list[LocalStory] = []
    if not text:
        return stories

    blocks: list[str] = []
    paragraph_lines: list[str] = []
    for raw_line in text[:STORY_MAX_BYTES].splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            if paragraph_lines:
                blocks.append(" ".join(paragraph_lines))
                paragraph_lines = []
            continue

        if "|" in line:
            title, story = (part.strip() for part in line.split("|", 1))
            story = clean_story_text(story)
            if title and story:
                stories.append(LocalStory(title=title, text=story))
            continue

        paragraph_lines.append(line)

    if paragraph_lines:
        blocks.append(" ".join(paragraph_lines))

    for index, block in enumerate(blocks, start=1):
        story = clean_story_text(block)
        if not story:
            continue

        title = f"Story {index}"
        title_match = re.match(r"^(?:title\s*:\s*)?(.{3,80}?)[.:]\s+(.+)$", story, re.IGNORECASE)
        if title_match and len(title_match.group(2)) > 20:
            title = clean_story_text(title_match.group(1))
            story = clean_story_text(title_match.group(2))

        stories.append(LocalStory(title=title, text=story))

    return stories


def sync_legacy_story_file() -> None:
    """Import stories.txt into JSON storage when the legacy story file changes."""
    try:
        if not STORY_PATH.exists():
            return
        mtime = str(STORY_PATH.stat().st_mtime)
        meta = storage.load_json("dashboard/source_meta.json", storage.DEFAULT_SOURCE_META)
        if not isinstance(meta, dict):
            meta = {}
        if meta.get("stories_txt_mtime") == mtime and meta.get("stories_txt_limit") == STORY_MAX_BYTES:
            return

        stories = parse_story_text(STORY_PATH.read_text(encoding="utf-8", errors="replace"))
        records = [
            {"id": f"story_{index}", "title": story.title, "text": story.text, "source": str(STORY_PATH.name)}
            for index, story in enumerate(stories, start=1)
        ]
        storage.save_json("dashboard/stories.json", records)
        meta["stories_txt_mtime"] = mtime
        meta["stories_txt_limit"] = STORY_MAX_BYTES
        meta["stories_txt_imported_at"] = datetime.now().isoformat(timespec="seconds")
        storage.save_json("dashboard/source_meta.json", meta)
    except OSError as exc:
        logger.warning("Could not import story file %s: %s", STORY_PATH, exc)


def load_local_stories() -> list[LocalStory]:
    sync_legacy_story_file()
    records = storage.load_json("dashboard/stories.json", [])
    if not isinstance(records, list):
        return []

    stories: list[LocalStory] = []
    for item in records:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        text = clean_story_text(str(item.get("text", "")))
        if title and text:
            stories.append(LocalStory(title=title, text=text))
    return stories


def is_story_request(text: str) -> bool:
    normalized = strip_voice_address(text)
    if not normalized:
        return False

    if re.search(r"\b(bible|scripture|gospel|psalm|proverb)\b", normalized, re.IGNORECASE):
        return False

    return bool(STORY_INTENT_RE.search(normalized))


def story_repeat_key(story: LocalStory) -> str:
    return normalize_transcription(story.text)[:240] or normalize_transcription(story.title)


def choose_random_story(stories: list[LocalStory]) -> LocalStory | None:
    global last_story_key
    if not stories:
        return None

    with story_lock:
        candidates = [story for story in stories if story_repeat_key(story) != last_story_key]
        if not candidates:
            candidates = stories

        story = random.choice(candidates)
        last_story_key = story_repeat_key(story)
        return story


def generate_story_reply() -> TeddyReply:
    story = choose_random_story(load_local_stories())
    if not story:
        text = "I could not find my story file yet. Please add stories to stories.txt."
        return TeddyReply(speech_text=text, display_text=text)

    speech_text = f"Story time. {story.title}. {story.text}"
    display_text = f"Reading {story.title}."
    logger.info("Reading local story from %s: %s", STORY_PATH, story.title)
    return TeddyReply(speech_text=speech_text, display_text=display_text, action="story")


def is_unclear_transcription(text: str) -> bool:
    normalized = normalize_transcription(text)
    if len(normalized) < 2:
        return True
    if len(normalized) > MAX_TRANSCRIPTION_CHARS:
        return True
    return bool(UNCLEAR_TRANSCRIPTION_RE.match(normalized))


def get_cached_reply(cache_key: str, max_age_seconds: int) -> TeddyReply | None:
    now = time.time()
    with reply_cache_lock:
        cache = storage.load_json("cache/reply_cache.json", storage.DEFAULT_REPLY_CACHE)
        if not isinstance(cache, dict):
            return None

        cached = cache.get(cache_key)
        if not cached:
            return None

        cached_at = float(cached.get("cached_at", 0)) if isinstance(cached, dict) else 0.0
        if now - cached_at <= max_age_seconds:
            reply_data = cached.get("reply", {}) if isinstance(cached, dict) else {}
            if isinstance(reply_data, dict):
                return teddy_reply_from_json(reply_data)

        cache.pop(cache_key, None)
        storage.save_json("cache/reply_cache.json", cache)
        return None


def store_cached_reply(cache_key: str, reply: TeddyReply) -> None:
    with reply_cache_lock:
        cache = storage.load_json("cache/reply_cache.json", storage.DEFAULT_REPLY_CACHE)
        if not isinstance(cache, dict):
            cache = {}

        now = time.time()
        cache[cache_key] = {
            "cached_at": now,
            "reply": teddy_reply_to_json(reply),
        }

        stale_before = now - OPENAI_CACHE_SECONDS
        for key, cached in list(cache.items()):
            if not isinstance(cached, dict) or float(cached.get("cached_at", 0)) < stale_before:
                cache.pop(key, None)

        storage.save_json("cache/reply_cache.json", cache)


def popular_cache_audio_dir() -> Path:
    path = storage.get_data_path(POPULAR_RESPONSE_CACHE_AUDIO_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def popular_cache_file_name(question_key: str, speech_text: str) -> str:
    digest = hashlib.sha256(f"{question_key}\0{speech_text}".encode("utf-8")).hexdigest()[:16]
    return f"popular_{digest}.wav"


def is_popular_response_cache_candidate(transcription: str, reply: TeddyReply) -> bool:
    if not POPULAR_RESPONSE_CACHE_ENABLED:
        return False
    if reply.action != "speak" or not reply.speech_text.strip():
        return False
    if len(reply.speech_text) > POPULAR_RESPONSE_CACHE_MAX_TEXT_CHARS:
        return False
    if (
        is_weather_question(transcription)
        or is_bible_question(transcription)
        or is_story_request(transcription)
        or is_radio_request(transcription)
        or is_music_request(transcription)
        or requested_language(transcription)
        or is_time_question(transcription)
    ):
        return False
    return True


def is_sd_reply_audio_cache_candidate(transcription: str, reply: TeddyReply) -> bool:
    """Return True when teddy should keep the generated WAV on its SD card."""
    if reply.action != "speak" or not reply.speech_text.strip():
        return False
    if len(reply.speech_text) > SD_REPLY_AUDIO_CACHE_MAX_TEXT_CHARS:
        return False
    if (
        is_weather_question(transcription)
        or is_bible_question(transcription)
        or is_story_request(transcription)
        or is_radio_request(transcription)
        or is_music_request(transcription)
        or requested_language(transcription)
        or is_time_question(transcription)
    ):
        return False
    return True


def sd_reply_audio_cache_key(reply: TeddyReply) -> str:
    return hashlib.sha256(f"{reply.action}\0{reply.speech_text}".encode("utf-8")).hexdigest()[:24]


def find_popular_response_cache(transcription: str) -> dict[str, Any] | None:
    if not POPULAR_RESPONSE_CACHE_ENABLED:
        return None
    if (
        is_stop_request(transcription)
        or is_wake_name_request(transcription)
        or is_volume_up_request(transcription)
        or is_volume_down_request(transcription)
        or is_weather_question(transcription)
        or is_bible_question(transcription)
        or is_story_request(transcription)
        or is_radio_request(transcription)
        or is_music_request(transcription)
        or requested_language(transcription)
        or is_time_question(transcription)
    ):
        return None

    question_key = normalize_question_key(transcription)
    if not question_key:
        return None

    with reply_cache_lock:
        meta = storage.load_json(POPULAR_RESPONSE_CACHE_META, {})
        entries = meta.get("entries", {}) if isinstance(meta, dict) else {}
        if not isinstance(entries, dict):
            return None

        best_entry: dict[str, Any] | None = None
        best_score = 0.0
        for raw_entry in entries.values():
            if not isinstance(raw_entry, dict) or not raw_entry.get("ready"):
                continue
            candidate_key = str(raw_entry.get("question_key", "")).strip()
            file_name = str(raw_entry.get("file", "")).strip()
            if not candidate_key or not file_name:
                continue
            score = 1.0 if question_key == candidate_key else SequenceMatcher(None, question_key, candidate_key).ratio()
            if question_key in candidate_key or candidate_key in question_key:
                score = max(score, 0.95)
            if score > best_score:
                best_score = score
                best_entry = raw_entry

        if not best_entry or best_score < POPULAR_RESPONSE_CACHE_SIMILARITY:
            return None

        audio_path = popular_cache_audio_dir() / Path(str(best_entry.get("file", ""))).name
        if not audio_path.exists() or audio_path.stat().st_size < 44:
            best_entry["ready"] = False
            storage.save_json(POPULAR_RESPONSE_CACHE_META, meta)
            return None

        best_entry["last_used_at"] = time.time()
        best_entry["use_count"] = int(best_entry.get("use_count", 0)) + 1
        storage.save_json(POPULAR_RESPONSE_CACHE_META, meta)
        logger.info("Popular response WAV cache hit score=%.2f question=%r file=%s", best_score, transcription, audio_path.name)
        return {"entry": best_entry, "audio_path": audio_path, "score": best_score}


def prune_popular_response_cache(meta: dict[str, Any]) -> None:
    entries = meta.get("entries", {})
    if not isinstance(entries, dict):
        return

    audio_dir = popular_cache_audio_dir()
    ready_items: list[tuple[str, dict[str, Any], Path, int]] = []
    total_size = 0
    for key, entry in entries.items():
        if not isinstance(entry, dict) or not entry.get("ready"):
            continue
        path = audio_dir / Path(str(entry.get("file", ""))).name
        if not path.exists():
            entry["ready"] = False
            continue
        size = path.stat().st_size
        total_size += size
        ready_items.append((key, entry, path, size))

    max_bytes = int(POPULAR_RESPONSE_CACHE_MAX_MB * 1024 * 1024)
    ready_items.sort(key=lambda item: (float(item[1].get("last_used_at", item[1].get("cached_at", 0))), int(item[1].get("use_count", 0))))
    while len(ready_items) > POPULAR_RESPONSE_CACHE_MAX_FILES or total_size > max_bytes:
        key, entry, path, size = ready_items.pop(0)
        path.unlink(missing_ok=True)
        entry["ready"] = False
        entry["file"] = ""
        total_size -= size
        logger.info("Pruned popular response WAV cache file %s", key)


def record_popular_response_candidate(transcription: str, reply: TeddyReply, wav_path: Path) -> None:
    if not is_popular_response_cache_candidate(transcription, reply):
        return
    if not wav_path.exists() or wav_path.stat().st_size < 44:
        return

    question_key = normalize_question_key(transcription)
    if not question_key:
        return

    entry_key = hashlib.sha256(question_key.encode("utf-8")).hexdigest()[:16]
    now = time.time()
    with reply_cache_lock:
        meta = storage.load_json(POPULAR_RESPONSE_CACHE_META, {})
        if not isinstance(meta, dict):
            meta = {}
        entries = meta.setdefault("entries", {})
        if not isinstance(entries, dict):
            entries = {}
            meta["entries"] = entries

        entry = entries.get(entry_key)
        if not isinstance(entry, dict):
            entry = {
                "question": transcription,
                "question_key": question_key,
                "speech_text": reply.speech_text,
                "display_text": reply.display_text,
                "hits": 0,
                "ready": False,
                "file": "",
                "created_at": now,
            }
            entries[entry_key] = entry

        entry["hits"] = int(entry.get("hits", 0)) + 1
        entry["last_seen_at"] = now
        entry["speech_text"] = reply.speech_text
        entry["display_text"] = reply.display_text

        if not entry.get("ready") and int(entry["hits"]) >= POPULAR_RESPONSE_CACHE_MIN_HITS:
            file_name = popular_cache_file_name(question_key, reply.speech_text)
            target = popular_cache_audio_dir() / file_name
            shutil.copyfile(wav_path, target)
            entry.update({"ready": True, "file": file_name, "cached_at": now, "last_used_at": now, "use_count": 0})
            logger.info("Promoted popular response to WAV cache hits=%s file=%s question=%r", entry["hits"], file_name, transcription)

        prune_popular_response_cache(meta)
        storage.save_json(POPULAR_RESPONSE_CACHE_META, meta)


def transcribe_audio(wav_path: Path) -> str:
    """Run local Faster-Whisper STT and return plain text."""
    segments, info = whisper_model.transcribe(
        str(wav_path),
        beam_size=WHISPER_BEAM_SIZE,
        vad_filter=WHISPER_VAD_FILTER,
        language="en",
        task="transcribe",
        temperature=0.0,
        condition_on_previous_text=False,
        initial_prompt=WHISPER_INITIAL_PROMPT,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    logger.info(
        "Transcription language=%s probability=%.2f text=%r",
        info.language,
        info.language_probability,
        text,
    )
    return text


def extract_response_text(response) -> str:
    """Support both modern output_text and structured output SDK shapes."""
    output_text = getattr(response, "output_text", None)
    if output_text:
        return output_text.strip()

    chunks: list[str] = []
    for item in getattr(response, "output", []) or []:
        for content in getattr(item, "content", []) or []:
            if getattr(content, "type", "") == "output_text":
                chunks.append(getattr(content, "text", ""))

    return "".join(chunks).strip()


def is_weather_question(text: str) -> bool:
    """Return True when the child is asking for current weather information."""
    return bool(text and WEATHER_INTENT_RE.search(text))


def is_room_climate_question(text: str) -> bool:
    """Return True for questions about the teddy's local room sensor."""
    return bool(text and ROOM_CLIMATE_INTENT_RE.search(text))


def is_time_question(text: str) -> bool:
    """Return True for clock/time questions handled by the ESP32 RTC reminder module."""
    return bool(text and TIME_QUESTION_RE.search(strip_voice_address(text)))


def is_stop_request(text: str) -> bool:
    return bool(text and STOP_INTENT_RE.match(strip_voice_address(text)))


def is_wake_name_request(text: str) -> bool:
    return bool(text and WAKE_NAME_RE.match(text))


def is_music_request(text: str) -> bool:
    normalized = strip_voice_address(text)
    return bool(normalized and MUSIC_INTENT_RE.search(normalized))


def extract_music_query(text: str) -> str:
    """Extract a requested SD-card song name from commands like 'play me forever'."""
    normalized = strip_voice_address(text)
    if not normalized:
        return ""

    if is_radio_request(normalized) or is_story_request(normalized) or is_language_request(normalized):
        return ""

    match = NAMED_MUSIC_INTENT_RE.match(normalized)
    if not match:
        return ""

    query = match.group("query")
    query = re.sub(r"\b(?:from|on)\s+(?:the\s+)?(?:sd\s+card|memory\s+card|music\s+folder)\b", " ", query, flags=re.IGNORECASE)
    query = re.sub(r"\b(?:by|from)\b", " ", query, flags=re.IGNORECASE)
    query = re.sub(r"\b(?:song|music|track|audio|please)\b", " ", query, flags=re.IGNORECASE)
    query = re.sub(r"\s+", " ", query).strip(" .!?\"'")

    if not query or query.lower() in {"radio", "story", "stories", "bible", "weather", "time"}:
        return ""
    return query[:64]


def requested_language(text: str) -> str | None:
    """Return the requested teaching language when a voice command asks for lessons."""
    normalized = strip_voice_address(text)
    if not normalized or not LANGUAGE_INTENT_RE.search(normalized):
        return None
    if re.search(r"\b(portuguese|portugeus)\b", normalized, re.IGNORECASE):
        return "portuguese"
    if re.search(r"\b(chinese|chinish|mandarin)\b", normalized, re.IGNORECASE):
        return "chinese"
    return None


def is_language_request(text: str) -> bool:
    """Check whether the transcription is asking LULU to teach a language."""
    return requested_language(text) is not None


def is_volume_up_request(text: str) -> bool:
    normalized = strip_voice_address(text)
    return bool(normalized and VOLUME_UP_RE.search(normalized))


def is_volume_down_request(text: str) -> bool:
    normalized = strip_voice_address(text)
    return bool(normalized and VOLUME_DOWN_RE.search(normalized))


def is_radio_request(text: str) -> bool:
    normalized = strip_voice_address(text)
    if not normalized:
        return False

    if is_radio_change_request(normalized):
        return True

    if RADIO_INTENT_RE.search(normalized):
        return True

    words = set(re.findall(r"[a-z]+", normalized))
    has_radio_word = bool(words & RADIO_WORDS)
    has_nigeria_word = bool(words & NIGERIA_WORDS)
    has_play_word = bool(words & PLAY_WORDS)
    if has_radio_word and (has_nigeria_word or has_play_word):
        return True

    # Short voice commands often transcribe as just "radio" or "FM".
    return normalized in {"radio", "the radio", "fm", "nigerian radio", "naija radio"}


def is_radio_change_request(text: str) -> bool:
    normalized = strip_voice_address(text)
    if not normalized:
        return False
    return bool(RADIO_CHANGE_INTENT_RE.search(normalized))


def is_playback_command(text: str) -> bool:
    normalized = strip_voice_address(text)
    if not normalized:
        return False
    return bool(PLAYBACK_COMMAND_RE.search(normalized))


def resolve_ffmpeg_bin() -> str | None:
    configured = Path(FFMPEG_BIN)
    if configured.exists():
        return str(configured)

    path_bin = shutil.which(FFMPEG_BIN)
    if path_bin:
        return path_bin

    if os.name == "nt":
        local_app_data = os.getenv("LOCALAPPDATA")
        if local_app_data:
            winget_packages = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
            for ffmpeg_path in sorted(
                winget_packages.glob("Gyan.FFmpeg_*/*/bin/ffmpeg.exe"),
                reverse=True,
            ):
                if ffmpeg_path.exists():
                    return str(ffmpeg_path)

    return None


def is_radio_station_playable(station: RadioStation, ffmpeg_bin: str) -> bool:
    """Return True only after ffmpeg decodes a short sample from the stream."""
    command = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "3",
        "-i",
        station.stream_url,
        "-t",
        str(RADIO_PROBE_SECONDS),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        "22050",
        "-f",
        "null",
        os.devnull,
    ]

    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=RADIO_PROBE_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning("Radio probe timed out for %r", station.name)
        return False
    except OSError as exc:
        logger.warning("Radio probe could not start for %r: %s", station.name, exc)
        return False

    if result.returncode == 0:
        return True

    stderr = result.stderr.decode("utf-8", errors="replace").strip()
    logger.warning("Radio probe failed for %r: %s", station.name, stderr[:300])
    return False


def radio_station_key(station: RadioStation) -> str:
    return re.sub(r"\W+", "", f"{station.name}:{station.stream_url}".lower())


def add_unique_radio_station(stations: list[RadioStation], station: RadioStation, seen: set[str]) -> None:
    key = radio_station_key(station)
    if key and key not in seen:
        seen.add(key)
        stations.append(station)


def radio_station_local_score(station_data: dict) -> int:
    if not RADIO_CITY:
        return 0

    needle = RADIO_CITY.lower()
    haystack = " ".join(
        str(station_data.get(field) or "")
        for field in ("name", "tags", "state", "country", "homepage", "url", "url_resolved")
    ).lower()
    return 1 if needle and needle in haystack else 0


def fetch_radio_browser_candidates() -> list[RadioStation]:
    """Fetch online radio candidates, preferring configured country/city."""
    params = {
        "hidebroken": "true",
        "order": "clickcount",
        "reverse": "true",
        "limit": str(RADIO_BROWSER_LIMIT),
    }
    api_urls = list(RADIO_BROWSER_API_URLS)
    if RADIO_COUNTRY_CODE:
        api_urls.append(f"https://all.api.radio-browser.info/json/stations/bycountrycodeexact/{quote(RADIO_COUNTRY_CODE)}")
    if RADIO_CITY:
        api_urls.append(f"https://all.api.radio-browser.info/json/stations/byname/{quote(RADIO_CITY)}")

    seen_urls: set[str] = set()
    candidates_with_score: list[tuple[int, RadioStation]] = []
    for api_url in api_urls:
        if api_url in seen_urls:
            continue
        seen_urls.add(api_url)

        try:
            response = http_session.get(
                api_url,
                params=params,
                timeout=RADIO_BROWSER_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            stations = response.json()
        except requests.RequestException as exc:
            logger.warning("Radio Browser lookup failed for %s: %s", api_url, exc)
            continue

        for station in stations:
            stream_url = (station.get("url_resolved") or station.get("url") or "").strip()
            name = (station.get("name") or "Radio station").strip()
            if stream_url and stream_url.startswith(("http://", "https://")):
                candidates_with_score.append(
                    (
                        radio_station_local_score(station),
                        RadioStation(name=name, stream_url=stream_url),
                    )
                )

    candidates_with_score.sort(key=lambda item: item[0], reverse=True)

    candidates: list[RadioStation] = []
    seen: set[str] = set()
    for _, station in candidates_with_score:
        add_unique_radio_station(candidates, station, seen)
    return candidates


def scan_radio_stations(force_refresh: bool = False) -> list[RadioStation]:
    """Build a playable station list for channel changing."""
    ffmpeg_bin = resolve_ffmpeg_bin()
    if not ffmpeg_bin:
        raise RuntimeError("ffmpeg was not found. Install ffmpeg or set FFMPEG_BIN.")

    now = time.time()
    with radio_cache_lock:
        cache = load_radio_cache()
        cached_stations = [
            station
            for station in (radio_station_from_json(item) for item in cache.get("stations", []))
            if station is not None
        ]
        if not force_refresh and cached_stations and now - float(cache.get("updated_at", 0)) < RADIO_CACHE_SECONDS:
            return cached_stations

    found_any_directory_station = False
    playable: list[RadioStation] = []
    seen: set[str] = set()
    for radio_station in fetch_radio_browser_candidates():
        found_any_directory_station = True
        if not is_radio_station_playable(radio_station, ffmpeg_bin):
            continue

        add_unique_radio_station(playable, radio_station, seen)
        if len(playable) >= RADIO_MAX_SCANNED_STATIONS:
            break

    for radio_station in DIRECT_RADIO_STATIONS:
        if len(playable) >= RADIO_MAX_SCANNED_STATIONS:
            break
        if not is_radio_station_playable(radio_station, ffmpeg_bin):
            continue
        add_unique_radio_station(playable, radio_station, seen)

    if playable:
        with radio_cache_lock:
            cache = load_radio_cache()
            selected_index = int(cache.get("selected_index", 0)) % len(playable)
            save_radio_cache(
                {
                    "updated_at": now,
                    "selected_index": selected_index,
                    "stations": [radio_station_to_json(station) for station in playable],
                    "selected": radio_station_to_json(playable[selected_index]),
                }
            )
        logger.info("Radio scan found %d playable station(s): %s", len(playable), ", ".join(s.name for s in playable))
        return playable

    if found_any_directory_station:
        raise RuntimeError("Radio stations were listed, but none decoded with ffmpeg")
    raise RuntimeError("No Nigerian radio stations were returned or decoded")


def get_nigerian_radio_station() -> RadioStation:
    """Return the currently selected online radio station."""
    stations = scan_radio_stations()
    with radio_cache_lock:
        cache = load_radio_cache()
        selected = radio_station_from_json(cache.get("selected") or {})
        if selected and selected in stations:
            return selected

        selected_index = int(cache.get("selected_index", 0)) % len(stations)
        selected = stations[selected_index]
        cache["selected_index"] = selected_index
        cache["selected"] = radio_station_to_json(selected)
        save_radio_cache(cache)
        return selected


def change_radio_station(reverse: bool = False, force_refresh: bool = False) -> RadioStation:
    """Move the selected online station forward or backward."""
    stations = scan_radio_stations(force_refresh=force_refresh)
    with radio_cache_lock:
        cache = load_radio_cache()
        if force_refresh:
            selected_index = 0 if reverse else -1
        else:
            selected_index = int(cache.get("selected_index", 0))
        step = -1 if reverse else 1
        selected_index = (selected_index + step) % len(stations)
        station = stations[selected_index]
        cache["updated_at"] = time.time()
        cache["selected_index"] = selected_index
        cache["stations"] = [radio_station_to_json(item) for item in stations]
        cache["selected"] = radio_station_to_json(station)
        save_radio_cache(cache)
        return station


def build_radio_stream(station: RadioStation):
    """Transcode an internet radio stream to simple WAV/PCM for the ESP32."""
    ffmpeg_bin = resolve_ffmpeg_bin()
    if not ffmpeg_bin:
        raise RuntimeError("ffmpeg was not found. Install ffmpeg or set FFMPEG_BIN.")

    command = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "5",
        "-i",
        station.stream_url,
        "-vn",
        "-map_metadata",
        "-1",
        "-acodec",
        "pcm_s16le",
        "-ac",
        str(RADIO_STREAM_CHANNELS),
        "-ar",
        str(RADIO_STREAM_SAMPLE_RATE),
        "-f",
        "s16le",
        "pipe:1",
    ]
    logger.info("Starting radio stream %r via ffmpeg", station.name)
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        if not process.stdout:
            raise RuntimeError("ffmpeg did not open stdout")

        yield build_wav_header(
            sample_rate=RADIO_STREAM_SAMPLE_RATE,
            channels=RADIO_STREAM_CHANNELS,
            bits_per_sample=RADIO_STREAM_BITS_PER_SAMPLE,
            data_bytes=0xFFFFFFFF,
        )

        while True:
            chunk = process.stdout.read(RADIO_STREAM_CHUNK_BYTES)
            if not chunk:
                break
            yield chunk
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def build_radio_pcm_stream(station: RadioStation):
    """Transcode an internet radio stream to raw PCM for reliable ESP32 playback."""
    ffmpeg_bin = resolve_ffmpeg_bin()
    if not ffmpeg_bin:
        raise RuntimeError("ffmpeg was not found. Install ffmpeg or set FFMPEG_BIN.")

    command = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "5",
        "-i",
        station.stream_url,
        "-vn",
        "-map_metadata",
        "-1",
        "-acodec",
        "pcm_s16le",
        "-ac",
        str(RADIO_STREAM_CHANNELS),
        "-ar",
        str(RADIO_STREAM_SAMPLE_RATE),
        "-f",
        "s16le",
        "pipe:1",
    ]
    logger.info("Starting raw PCM radio stream %r via ffmpeg", station.name)
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        if not process.stdout:
            raise RuntimeError("ffmpeg did not open stdout")

        while True:
            chunk = process.stdout.read(RADIO_STREAM_CHUNK_BYTES)
            if not chunk:
                break
            yield chunk
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def build_radio_clip_wav(station: RadioStation) -> bytes:
    """Return a short, complete PCM WAV clip with Content-Length for ESP32 playback."""
    ffmpeg_bin = resolve_ffmpeg_bin()
    if not ffmpeg_bin:
        raise RuntimeError("ffmpeg was not found. Install ffmpeg or set FFMPEG_BIN.")

    command = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "5",
        "-i",
        station.stream_url,
        "-t",
        str(RADIO_CLIP_SECONDS),
        "-vn",
        "-map_metadata",
        "-1",
        "-acodec",
        "pcm_s16le",
        "-ac",
        str(RADIO_STREAM_CHANNELS),
        "-ar",
        str(RADIO_STREAM_SAMPLE_RATE),
        "-f",
        "s16le",
        "pipe:1",
    ]
    logger.info("Building %.1fs radio clip %r via ffmpeg", RADIO_CLIP_SECONDS, station.name)
    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=RADIO_CLIP_TIMEOUT_SECONDS,
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg radio clip failed: {stderr[:500]}")

    pcm = result.stdout
    frame_bytes = RADIO_STREAM_CHANNELS * (RADIO_STREAM_BITS_PER_SAMPLE // 8)
    if len(pcm) < frame_bytes:
        raise RuntimeError("ffmpeg returned an empty radio clip")

    if len(pcm) % frame_bytes:
        pcm = pcm[: len(pcm) - (len(pcm) % frame_bytes)]

    return build_wav_header(
        sample_rate=RADIO_STREAM_SAMPLE_RATE,
        channels=RADIO_STREAM_CHANNELS,
        bits_per_sample=RADIO_STREAM_BITS_PER_SAMPLE,
        data_bytes=len(pcm),
    ) + pcm


def parse_bible_number_words(text: str) -> int | None:
    current = 0
    saw_number = False

    for token in re.findall(r"[a-z]+", text.lower()):
        if token in BIBLE_ORDINAL_WORDS:
            current += BIBLE_ORDINAL_WORDS[token]
            saw_number = True
        elif token in BIBLE_NUMBER_WORDS:
            current += BIBLE_NUMBER_WORDS[token]
            saw_number = True
        elif token == "hundred":
            current = max(current, 1) * 100
            saw_number = True
        else:
            return None

    return current if saw_number else None


def normalize_bible_reference_text(text: str) -> str:
    """Turn voice-friendly phrases into references bible-api.com can parse."""
    normalized = text.lower()
    normalized = normalized.replace("&", " and ")
    normalized = normalized.replace("\u2013", "-").replace("\u2014", "-")
    normalized = re.sub(r"\b([1-3])(?:st|nd|rd)\b", r"\1", normalized)

    def replace_number_words(match: re.Match) -> str:
        number = parse_bible_number_words(match.group(0))
        return str(number) if number is not None else match.group(0)

    normalized = BIBLE_NUMBER_WORD_RE.sub(replace_number_words, normalized)
    normalized = re.sub(r"\b(?:versus|vs\.?|v\.)\b", "verse", normalized)
    normalized = re.sub(r"\b(?:chap\.?|ch\.?)\b", "chapter", normalized)
    normalized = re.sub(r"\bcolon\b", ":", normalized)
    normalized = re.sub(r"\bverse\s+number\b", "verse", normalized)
    normalized = re.sub(r"\bchapter\s+number\b", "chapter", normalized)
    normalized = re.sub(r"\b(?:from|starting\s+at|start\s+at)\s+verse\b", "verse", normalized)
    normalized = re.sub(r"^\s*(?:please\s+)?(?:can|could|will|would)\s+you\s+", " ", normalized)
    normalized = BIBLE_COMMAND_PREFIX_RE.sub(" ", normalized)
    normalized = re.sub(r"\b(?:the\s+)?(?:holy\s+)?bible\s+(?:book\s+)?(?:of\s+)?", " ", normalized)
    normalized = re.sub(r"\bbook\s+of\s+", " ", normalized)
    normalized = re.sub(
        r"\bchapters?\s+(\d+)\s*(?:,|and)?\s+verses?\s+(\d+)\s+(?:to|through|thru|until|-)\s+(\d+)\b",
        r"\1:\2-\3",
        normalized,
    )
    normalized = re.sub(
        r"\bchapters?\s+(\d+)\s*(?:,|and)?\s+verses?\s+(\d+)\b",
        r"\1:\2",
        normalized,
    )
    normalized = re.sub(r"\bchapters?\s+(\d+)\b", r"\1", normalized)
    normalized = re.sub(
        r"\b(\d+)\s*(?:,|and)\s+verses?\s+(\d+)\s+(?:to|through|thru|until|-)\s+(\d+)\b",
        r"\1:\2-\3",
        normalized,
    )
    normalized = re.sub(
        r"\b(\d+)\s*(?:,|and)\s+verses?\s+(\d+)\b",
        r"\1:\2",
        normalized,
    )
    normalized = re.sub(
        r"\bverses?\s+(\d+)\s+(?:to|through|thru|until|-)\s+(\d+)\b",
        r":\1-\2",
        normalized,
    )
    normalized = re.sub(r"\bverses?\s+(\d+)\b", r":\1", normalized)
    normalized = re.sub(r"\b(\d+)\s+and\s+(\d+)\b", r"\1:\2", normalized)
    normalized = re.sub(r"\s*:\s*", ":", normalized)
    normalized = re.sub(r"\s*-\s*", "-", normalized)
    normalized = re.sub(r"\s*,\s*", ",", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def extract_bible_reference(text: str) -> str | None:
    normalized = normalize_bible_reference_text(text)
    book_match = BIBLE_BOOK_PATTERN.search(normalized)
    if not book_match:
        return BIBLE_RANDOM_REFERENCE if BIBLE_GENERAL_INTENT_RE.search(normalized) else None

    book = re.sub(r"\s+", " ", book_match.group(0)).strip()
    after_book = normalized[book_match.end() :]

    two_number_match = re.match(r"\s*(\d+)\s+(\d+)(?:\s*(?:to|through|until|and|-)\s*(\d+))?", after_book)
    if two_number_match:
        chapter = two_number_match.group(1)
        start_verse = two_number_match.group(2)
        end_verse = two_number_match.group(3)
        verse_part = f"{start_verse}-{end_verse}" if end_verse else start_verse
        return f"{book} {chapter}:{verse_part}"

    location_match = re.match(
        r"\s*(\d+(?::\d+(?:-\d+)?)?(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)?)?",
        after_book,
    )
    location = (location_match.group(1) or "").strip() if location_match else ""
    if not location:
        return None

    return f"{book} {location}"


def extract_bible_chapter_request(reference: str) -> tuple[str, int] | None:
    """Return book/chapter only for full-chapter audio requests."""
    if not reference or reference == BIBLE_RANDOM_REFERENCE or ":" in reference:
        return None

    book_match = BIBLE_BOOK_PATTERN.search(reference)
    if not book_match:
        return None

    book = re.sub(r"\s+", " ", book_match.group(0)).strip()
    after_book = reference[book_match.end() :]
    chapter_match = re.match(r"\s*(\d+)\s*$", after_book)
    if not chapter_match:
        return None

    return book, int(chapter_match.group(1))


def is_bible_question(text: str) -> bool:
    return extract_bible_reference(text) is not None


def clean_bible_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "")
    return text.strip()


def format_bible_passage(data: dict) -> tuple[str, str]:
    if "random_verse" in data:
        verse = data["random_verse"] or {}
        book_name = str(verse.get("book") or verse.get("book_name") or "").strip()
        reference = (
            f"{book_name} "
            f"{verse.get('chapter')}:{verse.get('verse')}"
        ).strip()
        passage_text = clean_bible_text(verse.get("text", ""))
        translation = (data.get("translation") or {}).get("name") or BIBLE_TRANSLATION.upper()
        return reference, f"{reference}, {translation}. {passage_text}"

    reference = data.get("reference") or "Bible passage"
    passage_text = clean_bible_text(data.get("text", ""))
    if not passage_text:
        passage_text = clean_bible_text(" ".join(verse.get("text", "") for verse in data.get("verses", [])))

    translation = data.get("translation_name") or BIBLE_TRANSLATION.upper()
    return reference, f"{reference}, {translation}. {passage_text}"


def split_spoken_text(text: str, max_chars: int = BIBLE_MAX_SPOKEN_CHARS) -> list[str]:
    clean_text = clean_bible_text(text)
    if not clean_text:
        return []

    chunks: list[str] = []
    current = ""
    for sentence in re.split(r"(?<=[.!?])\s+", clean_text):
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) > max_chars:
            words = sentence.split()
            sentence = ""
            for word in words:
                candidate = f"{sentence} {word}".strip()
                if len(candidate) > max_chars and sentence:
                    chunks.append(sentence)
                    sentence = word
                else:
                    sentence = candidate
        candidate = f"{current} {sentence}".strip()
        if len(candidate) > max_chars and current:
            chunks.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def save_bible_session(reference: str, chunks: list[str], next_index: int) -> None:
    storage.save_json(
        "dashboard/bible_session.json",
        {
            "reference": reference,
            "translation": BIBLE_TRANSLATION.upper(),
            "chunks": chunks,
            "next_index": next_index,
            "total_chunks": len(chunks),
            "updated_at": datetime.now().isoformat(timespec="seconds"),
        },
    )


def is_bible_continue_request(text: str) -> bool:
    normalized = (text or "").lower()
    return bool(
        re.search(r"\b(continue|more|next|keep reading|read more)\b", normalized)
        and re.search(r"\b(bible|scripture|chapter|verse|passage|psalm|proverb)\b", normalized)
    )


def generate_bible_continue_reply() -> TeddyReply:
    session = storage.load_json("dashboard/bible_session.json", {})
    if not isinstance(session, dict):
        session = {}
    chunks = session.get("chunks")
    next_index = int(session.get("next_index") or 0)
    reference = str(session.get("reference") or "Bible passage")

    if not isinstance(chunks, list) or next_index >= len(chunks):
        text = "That Bible passage is finished. Tell me another book and chapter when you are ready."
        return TeddyReply(speech_text=text, display_text=text, action="bible")

    clean_chunks = [clean_bible_text(str(item)) for item in chunks if clean_bible_text(str(item))]
    chunk = clean_chunks[next_index] if next_index < len(clean_chunks) else ""
    next_index += 1
    save_bible_session(reference, clean_chunks, next_index)
    suffix = " Say continue Bible for the next part." if next_index < len(clean_chunks) else " That is the end of the passage."
    display_text = f"Reading {reference}, part {next_index} of {len(clean_chunks)}."
    return TeddyReply(speech_text=f"{chunk} {suffix}".strip(), display_text=display_text, action="bible")


def generate_bible_reply(reference: str) -> TeddyReply:
    """Fetch a Bible chapter or verse and return full speech plus short display text."""
    if reference == BIBLE_RANDOM_REFERENCE:
        url = f"{BIBLE_API_BASE_URL.rstrip('/')}/data/{quote(BIBLE_TRANSLATION)}/random"
        params = None
    else:
        url = f"{BIBLE_API_BASE_URL.rstrip('/')}/{quote(reference)}"
        params = {
            "translation": BIBLE_TRANSLATION,
            "single_chapter_book_matching": "indifferent",
        }

    response = http_session.get(url, params=params, timeout=BIBLE_TIMEOUT_SECONDS)
    response.raise_for_status()
    data = response.json()
    api_error = data.get("error")
    if api_error:
        raise ValueError(api_error)

    passage_reference, speech_text = format_bible_passage(data)
    if not clean_bible_text(speech_text):
        raise ValueError("Bible API returned an empty passage")

    chunks = split_spoken_text(speech_text)
    if not chunks:
        raise ValueError("Bible API returned an empty passage")

    save_bible_session(passage_reference, chunks, 1)
    suffix = " Say continue Bible for the next part." if len(chunks) > 1 else ""
    display_text = f"Reading {passage_reference} ({BIBLE_TRANSLATION.upper()})."
    return TeddyReply(speech_text=f"{chunks[0]}{suffix}", display_text=display_text, action="bible")


def read_bible_session_status() -> dict[str, Any]:
    session = storage.load_json("dashboard/bible_session.json", {})
    if not isinstance(session, dict):
        return {"active": False}
    chunks = session.get("chunks")
    next_index = int(session.get("next_index") or 0)
    total_chunks = len(chunks) if isinstance(chunks, list) else 0
    return {
        "active": total_chunks > 0 and next_index < total_chunks,
        "reference": str(session.get("reference") or ""),
        "translation": str(session.get("translation") or BIBLE_TRANSLATION.upper()),
        "next_part": min(next_index + 1, total_chunks) if total_chunks else 0,
        "total_parts": total_chunks,
        "updated_at": str(session.get("updated_at") or ""),
    }


def read_remote_device_status() -> dict[str, Any] | None:
    state = storage.load_json("dashboard/device_status.json", None)
    return state if isinstance(state, dict) else None


def save_remote_device_status(payload: dict[str, Any]) -> dict[str, Any]:
    def payload_int(key: str, default: int = 0) -> int:
        try:
            return int(payload.get(key) or default)
        except (TypeError, ValueError):
            return default

    status = {
        "device_id": str(payload.get("device_id") or "esp32-lulu")[:64],
        "wifi_connected": bool(payload.get("wifi_connected")),
        "wifi_ssid": str(payload.get("wifi_ssid") or "")[:64],
        "wifi_ip": str(payload.get("wifi_ip") or "")[:48],
        "wifi_rssi": payload_int("wifi_rssi"),
        "free_heap": payload_int("free_heap"),
        "sd_ready": bool(payload.get("sd_ready")),
        "sd_used_bytes": max(0, payload_int("sd_used_bytes")),
        "sd_total_bytes": max(0, payload_int("sd_total_bytes")),
        "sd_free_bytes": max(0, payload_int("sd_free_bytes")),
        "state": str(payload.get("state") or "")[:48],
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    storage.save_json("dashboard/device_status.json", status)
    return status


def _remote_sd_state() -> dict[str, Any]:
    state = storage.load_json("dashboard/remote_sd.json", {})
    if not isinstance(state, dict):
        state = {}
    if not isinstance(state.get("pending"), list):
        state["pending"] = []
    if not isinstance(state.get("results"), dict):
        state["results"] = {}
    return state


def _save_remote_sd_state(state: dict[str, Any]) -> None:
    storage.save_json("dashboard/remote_sd.json", state)


def _remote_sd_upload_dir(request_id: str) -> Path:
    return storage.get_data_path("dashboard/remote_sd_uploads") / request_id


def _safe_remote_file_name(value: str) -> str:
    clean = Path(str(value or "upload.bin").replace("\\", "/")).name
    clean = re.sub(r"[^A-Za-z0-9._-]+", "_", clean).strip("._")
    return clean or "upload.bin"


def _clean_remote_sd_path(value: str) -> str:
    parts = [
        part
        for part in str(value or "").replace("\\", "/").split("/")
        if part and part not in {".", ".."}
    ]
    return "/" + "/".join(parts)


def _queue_remote_sd_request(action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    request = {
        "id": uuid.uuid4().hex,
        "action": action,
        "payload": payload or {},
        "created_at": str(int(time.time())),
    }
    with remote_sd_lock:
        state = _remote_sd_state()
        pending = state["pending"]
        pending.append(request)
        state["pending"] = pending[-40:]
        _save_remote_sd_state(state)
    return request


def _remote_sd_result(request_id: str) -> dict[str, Any] | None:
    with remote_sd_lock:
        state = _remote_sd_state()
        result = state["results"].get(request_id)
    return result if isinstance(result, dict) else None


def _wait_remote_sd_result(request_id: str, timeout_seconds: float = 12.0) -> dict[str, Any] | None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        result = _remote_sd_result(request_id)
        if result:
            return result
        time.sleep(0.25)
    return None


def _prune_remote_sd_uploads(active_request_ids: set[str]) -> None:
    root = storage.get_data_path("dashboard/remote_sd_uploads")
    if not root.exists():
        return

    now = time.time()
    for child in root.iterdir():
        if not child.is_dir() or child.name in active_request_ids:
            continue
        try:
            age_seconds = now - child.stat().st_mtime
            if age_seconds > 3600:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            continue


def format_weather_number(value) -> str:
    """Keep spoken weather values short and natural."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)

    if number.is_integer():
        return str(int(number))

    return f"{number:.1f}".rstrip("0").rstrip(".")


def format_weather_unit(unit: str | None) -> str:
    """Make Open-Meteo units friendly for TTS and the ESP32 display."""
    if not unit:
        return ""

    clean_unit = unit.encode("ascii", errors="ignore").decode("ascii").strip()
    if clean_unit in {"C", "F"}:
        return f" degrees {clean_unit}"
    if clean_unit:
        return f" {clean_unit}"
    return ""


def format_weather_measure(current: dict, units: dict, key: str) -> str | None:
    value = current.get(key)
    if value is None:
        return None

    unit = format_weather_unit(units.get(key))
    return f"{format_weather_number(value)}{unit}"


def parse_optional_float(value: str | None) -> float | None:
    if value is None:
        return None

    try:
        number = float(value)
    except ValueError:
        return None

    if not math.isfinite(number):
        return None

    return number


def generate_room_climate_reply(
    room_temperature_c: float | None,
    room_humidity_percent: float | None,
) -> TeddyReply:
    if room_temperature_c is None and room_humidity_percent is None:
        text = "I cannot read the room sensor yet. Please check the DHT wiring."
        return TeddyReply(speech_text=text, display_text=text)

    parts: list[str] = []
    if room_temperature_c is not None:
        parts.append(f"{format_weather_number(room_temperature_c)} degrees C")
    if room_humidity_percent is not None:
        parts.append(f"{format_weather_number(room_humidity_percent)} percent humidity")

    text = "The room is " + " with ".join(parts) + "."
    if room_temperature_c is not None and room_temperature_c > ROOM_TEMP_HOT_C:
        text += " It feels too hot, so please check the temperature."
    elif room_temperature_c is not None and room_temperature_c < ROOM_TEMP_COLD_C:
        text += " It feels too cold, so please warm the room a little."

    return TeddyReply(speech_text=text, display_text=text)


def generate_weather_reply() -> str:
    """Fetch Open-Meteo weather and turn it into a teddy-sized answer."""
    response = http_session.get(WEATHER_API_URL, timeout=WEATHER_TIMEOUT_SECONDS)
    response.raise_for_status()
    data = response.json()

    current = data.get("current") or {}
    units = data.get("current_units") or {}
    temperature = format_weather_measure(current, units, "temperature_2m")

    if not temperature:
        raise RuntimeError("Open-Meteo response did not include current temperature_2m")

    words = [f"In {WEATHER_LOCATION_NAME} right now, it is {temperature}."]

    try:
        weather_code = int(current.get("weather_code"))
    except (TypeError, ValueError):
        weather_code = None

    condition = WEATHER_CODE_LABELS.get(weather_code)
    if condition:
        words.append(f"The sky looks {condition}.")

    precipitation = format_weather_measure(current, units, "precipitation")
    if precipitation and float(current.get("precipitation") or 0) > 0:
        words.append(f"Rain is around {precipitation}.")

    wind_speed = format_weather_measure(current, units, "wind_speed_10m")
    if wind_speed:
        words.append(f"Wind is {wind_speed}.")

    words.append("Take care outside, Jeremiah.")
    return " ".join(words)


def generate_time_reply() -> TeddyReply:
    current_time = time.strftime("%I:%M %p", time.localtime()).lstrip("0")
    text = f"The time is {current_time}."
    return TeddyReply(speech_text=text, display_text=text)


def generate_radio_reply(
    change_channel: bool = False,
    force_scan: bool = False,
    reverse: bool = False,
) -> TeddyReply:
    if not resolve_ffmpeg_bin():
        text = "I can play Nigerian radio after ffmpeg is installed on the computer."
        return TeddyReply(speech_text=text, display_text=text)

    if change_channel or force_scan:
        station = change_radio_station(reverse=reverse, force_refresh=force_scan)
    else:
        station = get_nigerian_radio_station()

    return TeddyReply(
        speech_text="",
        display_text=f"Playing {station.name}.",
        action="radio",
    )


def language_root(language: str) -> str:
    """Normalize a supported language name to its storage folder."""
    normalized = language.strip().lower()
    if normalized not in {"portuguese", "chinese"}:
        raise ValueError("Unsupported language")
    return normalized


def has_cjk_character(value: str) -> bool:
    """Return True when a string contains at least one Chinese/Japanese/Korean character."""
    return any("\u4e00" <= character <= "\u9fff" for character in value)


def normalize_chinese_lesson(lesson: dict) -> dict:
    """Repair older starter lesson data that was saved with garbled Chinese characters."""
    words = lesson.get("words", [])
    if not isinstance(words, list):
        return lesson

    defaults = ["\u4f60", "\u597d"]
    changed = False
    for index, word in enumerate(words[: len(defaults)]):
        if not isinstance(word, dict):
            continue
        character = str(word.get("character", ""))
        if character and has_cjk_character(character):
            continue
        word["character"] = defaults[index]
        changed = True

    if changed:
        lesson = dict(lesson)
        lesson["words"] = words
    return lesson


def load_language_lesson(language: str, lesson_number: int | None = None) -> dict:
    """Load the current language lesson from storage with starter fallback data."""
    root = language_root(language)
    progress = storage.load_json(f"{root}/progress.json", {})
    current_lesson = lesson_number or int(progress.get("currentLesson", 1) if isinstance(progress, dict) else 1)
    lesson = storage.load_json(f"{root}/lessons/lesson_{current_lesson:03d}.json", {})
    if isinstance(lesson, dict) and lesson.get("words"):
        if root == "chinese":
            return normalize_chinese_lesson(lesson)
        return lesson

    if root == "portuguese":
        return storage.DEFAULT_PORTUGUESE_LESSON
    return {
        "lesson": 1,
        "title": "Greetings",
        "completed": False,
        "words": [
            {"character": "\u4f60", "pinyin": "ni", "english": "you", "difficulty": "beginner"},
            {"character": "\u597d", "pinyin": "hao", "english": "good", "difficulty": "beginner"},
        ],
    }


def generate_language_reply(language: str) -> TeddyReply:
    """Build a short spoken lesson response for Portuguese or Chinese."""
    root = language_root(language)
    lesson = load_language_lesson(root)
    words = lesson.get("words", []) if isinstance(lesson, dict) else []
    first_word = words[0] if words and isinstance(words[0], dict) else {}
    title = str(lesson.get("title", "Lesson")).strip() if isinstance(lesson, dict) else "Lesson"

    if root == "portuguese":
        english = str(first_word.get("english", "Hello"))
        translated = str(first_word.get("portuguese", "Ola"))
        pronunciation = str(first_word.get("pronunciation", "oh-LAH"))
        text = f"Portuguese lesson. {title}. {english} is {translated}. Say it like {pronunciation}."
    else:
        english = str(first_word.get("english", "you"))
        character = str(first_word.get("character", "\u4f60"))
        pinyin = str(first_word.get("pinyin", "ni"))
        if "Ã" in character or "ä" in character:
            character = "\u4f60"
        text = f"Chinese lesson. {title}. {english} is {pinyin}. The character is {character}."

    display_text = f"{root.title()}: {title}"
    return TeddyReply(speech_text=text, display_text=display_text)


def call_portuguese_tutor_ai(kind: str, prompt: str) -> dict | None:
    """Ask the configured OpenAI model for structured Portuguese tutor JSON."""
    if not USE_OPENAI or openai_client is None:
        return None

    try:
        response = openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are LULU, a warm Portuguese language tutor. "
                        "Return only compact valid JSON. Keep examples short, practical, and beginner friendly."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=max(OPENAI_MAX_TOKENS, 220),
            temperature=0.45,
        )
    except RateLimitError as exc:
        logger.warning("OpenAI quota/rate limit blocked Portuguese tutor %s: %s", kind, exc)
        return None
    except OpenAIError as exc:
        logger.warning("OpenAI Portuguese tutor request failed for %s: %s", kind, exc)
        return None

    text = (response.choices[0].message.content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.IGNORECASE | re.MULTILINE).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("OpenAI Portuguese tutor returned non-JSON for %s: %r", kind, text[:240])
        return None
    return data if isinstance(data, dict) else None


def generate_portuguese_tutor_reply(transcription: str) -> TeddyReply:
    """Route a voice request through the Portuguese tutor module."""
    result = portuguese_tutor.tutor_reply(transcription, call_portuguese_tutor_ai)
    speech = str(result.get("speech") or "I have a Portuguese lesson ready.")
    display = str(result.get("display") or speech)
    return TeddyReply(speech_text=speech, display_text=display)


def choose_interactive_follow_up(transcription: str, answer: str) -> str:
    """Pick a short, related next step so LULU feels conversational."""
    prompt = normalize_transcription(transcription)
    combined = normalize_transcription(f"{transcription} {answer}")

    if re.search(r"\b(name|who are you|what are you|made you|created you|built you|what can you do|help)\b", prompt):
        return "You can also ask me for a story, Bible verse, weather, music, or radio."

    if "only answer saved questions" in combined:
        return "Try asking me for a story, Bible verse, weather, music, or radio."

    if is_time_question(transcription):
        return 'You can also ask, "What are my reminders?"'

    if is_radio_request(transcription) or "radio" in combined:
        return 'Do you want me to play it now? Just say, "Play radio."'

    if is_music_request(transcription) or re.search(r"\b(music|song|songs|track|tracks)\b", combined):
        return 'Do you want me to play music from the SD card? Just say, "Play music."'

    if is_story_request(transcription) or re.search(r"\b(story|stories|bedtime|tale)\b", combined):
        return 'Would you like another story? Just say, "Tell me a story."'

    if is_language_request(transcription) or re.search(r"\b(portuguese|chinese|mandarin|language|lesson)\b", combined):
        return 'Would you like another language lesson? Say, "Teach me Portuguese" or "Teach me Chinese."'

    if is_bible_question(transcription) or re.search(r"\b(bible|scripture|verse|psalm|proverb|gospel)\b", combined):
        return "Would you like me to read you more bible verse? Just say where you want me to read."

    if is_weather_question(transcription) or re.search(r"\b(weather|rain|sunny|cloudy|forecast|outside)\b", combined):
        return 'Do you want the latest weather again? Just say, "Check the weather."'

    if is_room_climate_question(transcription) or re.search(r"\b(room|temperature|humidity|hot|cold|warm)\b", combined):
        return 'Do you want me to check the room again later? Just ask, "How is the room temperature?"'

    if re.search(r"\b(joke|funny)\b", combined):
        return 'Would you like another joke? Just say, "Tell me a joke."'

    return "What would you like to do next? You can ask for a story, language lesson, Bible, weather, music, or radio."


def add_interactive_follow_up(reply: TeddyReply, transcription: str) -> TeddyReply:
    if not INTERACTIVE_FOLLOW_UPS_ENABLED:
        return reply
    if reply.action != "speak" or not reply.speech_text.strip():
        return reply
    if is_bible_question(transcription) or len(reply.speech_text) > 900:
        return reply
    if EXISTING_FOLLOW_UP_RE.search(reply.speech_text):
        return reply

    follow_up = choose_interactive_follow_up(transcription, reply.speech_text)
    speech_text = f"{reply.speech_text.rstrip()} {follow_up}"
    display_text = speech_text if reply.display_text == reply.speech_text else reply.display_text
    return TeddyReply(speech_text=speech_text, display_text=display_text, action=reply.action, music_query=reply.music_query)


def build_wav_header(
    sample_rate: int,
    channels: int,
    bits_per_sample: int,
    data_bytes: int = 0xFFFFFFFF,
) -> bytes:
    byte_rate = sample_rate * channels * bits_per_sample // 8
    block_align = channels * bits_per_sample // 8
    riff_size = 36 + data_bytes if data_bytes <= 0xFFFFFFD7 else 0xFFFFFFFF

    header = bytearray(44)
    header[0:4] = b"RIFF"
    header[4:8] = riff_size.to_bytes(4, "little", signed=False)
    header[8:12] = b"WAVE"
    header[12:16] = b"fmt "
    header[16:20] = (16).to_bytes(4, "little", signed=False)
    header[20:22] = (1).to_bytes(2, "little", signed=False)
    header[22:24] = channels.to_bytes(2, "little", signed=False)
    header[24:28] = sample_rate.to_bytes(4, "little", signed=False)
    header[28:32] = byte_rate.to_bytes(4, "little", signed=False)
    header[32:34] = block_align.to_bytes(2, "little", signed=False)
    header[34:36] = bits_per_sample.to_bytes(2, "little", signed=False)
    header[36:40] = b"data"
    header[40:44] = data_bytes.to_bytes(4, "little", signed=False)
    return bytes(header)


def generate_local_fallback_reply(transcription: str) -> TeddyReply:
    text = (
        "I heard you, but I can only answer saved questions, weather, Bible, radio, "
        "and music while OpenAI is off."
    )
    logger.info("Answered with local fallback for: %r", transcription)
    return TeddyReply(speech_text=text, display_text=text)


def generate_reply(
    transcription: str,
    extra_qa_text: str | None = None,
    room_temperature_c: float | None = None,
    room_humidity_percent: float | None = None,
) -> TeddyReply:
    """Generate a Teddy response locally first, with optional OpenAI fallback."""
    if not transcription:
        text = "I am here. I did not catch that clearly, so please try again."
        return TeddyReply(speech_text=text, display_text=text)

    cache_key = normalize_transcription(transcription)
    if is_unclear_transcription(cache_key):
        logger.info("Skipping OpenAI for unclear transcription: %r", transcription)
        text = "I did not catch that clearly. Please say it again."
        return TeddyReply(speech_text=text, display_text=text)

    def remember(reply: TeddyReply) -> TeddyReply:
        reply = add_interactive_follow_up(reply, transcription)
        store_cached_reply(f"recent:{cache_key}", reply)
        return reply

    if is_stop_request(transcription):
        return remember(TeddyReply(speech_text="", display_text="Stopped.", action="stop"))

    if is_wake_name_request(transcription):
        text = "Hm! Yes Jeremiah?"
        return remember(TeddyReply(speech_text=text, display_text=text, action="wake"))

    if is_volume_up_request(transcription):
        return remember(TeddyReply(speech_text="", display_text="Turning volume up.", action="volume_up"))

    if is_volume_down_request(transcription):
        return remember(TeddyReply(speech_text="", display_text="Turning volume down.", action="volume_down"))

    music_query = extract_music_query(transcription)
    if music_query:
        return remember(
            TeddyReply(
                speech_text="",
                display_text=f"Playing {music_query} from SD card.",
                action="music",
                music_query=music_query,
            )
        )

    if is_music_request(transcription):
        return remember(TeddyReply(speech_text="", display_text="Playing music from SD card.", action="music"))

    if is_radio_change_request(transcription):
        try:
            normalized = normalize_transcription(transcription)
            reverse = bool(re.search(r"\b(previous|back|last)\b", normalized))
            force_scan = bool(re.search(r"\b(scan|search|find)\b", normalized))
            return remember(generate_radio_reply(change_channel=True, force_scan=force_scan, reverse=reverse))
        except Exception:
            logger.exception("Radio channel change failed")
            text = "I tried to change the radio station, but radio is not connecting right now."
            return remember(TeddyReply(speech_text=text, display_text=text))

    if is_radio_request(transcription):
        try:
            return remember(generate_radio_reply())
        except Exception:
            logger.exception("Radio lookup failed")
            text = "I tried to find a Nigerian radio station, but radio is not connecting right now."
            return remember(TeddyReply(speech_text=text, display_text=text))

    if is_room_climate_question(transcription):
        return remember(generate_room_climate_reply(room_temperature_c, room_humidity_percent))

    for pattern, text in LOCAL_REPLY_PATTERNS:
        if pattern.match(transcription):
            logger.info("Answered locally without OpenAI: %r", transcription)
            return remember(TeddyReply(speech_text=text, display_text=text))

    if portuguese_tutor.is_tutor_request(transcription):
        return remember(generate_portuguese_tutor_reply(transcription))

    if is_story_request(transcription):
        return remember(generate_story_reply())

    language = requested_language(transcription)
    if language:
        return remember(generate_language_reply(language))

    if is_time_question(transcription):
        return remember(generate_time_reply())

    local_qa_reply = find_local_qa_reply(transcription, extra_qa_text)
    if local_qa_reply:
        return remember(TeddyReply(speech_text=local_qa_reply, display_text=local_qa_reply))

    if is_bible_continue_request(transcription):
        return remember(generate_bible_continue_reply())

    bible_reference = extract_bible_reference(transcription)
    if bible_reference:
        try:
            return remember(generate_bible_reply(bible_reference))
        except requests.RequestException:
            logger.exception("Bible lookup failed")
            text = "I tried to open the Bible, but the Bible service is not answering right now."
            return remember(TeddyReply(speech_text=text, display_text=text))
        except Exception:
            logger.exception("Bible reply failed")
            text = "Please tell me the Bible book, chapter, and verse again, like John 3:16."
            return remember(TeddyReply(speech_text=text, display_text=text))

    if is_weather_question(transcription):
        try:
            text = generate_weather_reply()
            return remember(TeddyReply(speech_text=text, display_text=text))
        except requests.RequestException:
            logger.exception("Weather lookup failed")
            text = "I tried to check the weather, but the weather service is not answering right now."
            return remember(TeddyReply(speech_text=text, display_text=text))
        except Exception:
            logger.exception("Weather reply failed")
            text = "I tried to read the weather, but I could not understand the forecast just now."
            return remember(TeddyReply(speech_text=text, display_text=text))

    if is_playback_command(transcription):
        logger.warning("Treating playback command as local radio request: %r", transcription)
        try:
            return remember(generate_radio_reply())
        except Exception:
            logger.exception("Radio lookup failed for playback command")
            text = "I heard a play command, but radio is not connecting right now."
            return remember(TeddyReply(speech_text=text, display_text=text))

    recent_reply = get_cached_reply(f"recent:{cache_key}", OPENAI_DUPLICATE_WINDOW_SECONDS)
    if recent_reply:
        logger.info("Reusing recent general-chat reply for duplicate transcription: %r", transcription)
        return recent_reply

    if not USE_OPENAI or openai_client is None:
        return remember(generate_local_fallback_reply(transcription))

    cached_openai_reply = get_cached_reply(f"openai:{cache_key}", OPENAI_CACHE_SECONDS)
    if cached_openai_reply:
        logger.info("Reusing cached OpenAI reply for: %r", transcription)
        return remember(cached_openai_reply)

    try:
        response = openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": transcription},
            ],
            max_tokens=OPENAI_MAX_TOKENS,
            temperature=0.7,
        )
    except RateLimitError as exc:
        logger.warning("OpenAI quota/rate limit blocked reply: %s", exc)
        text = "My OpenAI credit is unavailable right now, but local radio, weather, and Bible still work."
        return remember(TeddyReply(speech_text=text, display_text=text))
    except OpenAIError as exc:
        logger.warning("OpenAI request failed: %s", exc)
        text = "I could not reach OpenAI just now. Please try again later."
        return remember(TeddyReply(speech_text=text, display_text=text))

    text = response.choices[0].message.content.strip()
    if not text:
        raise RuntimeError("OpenAI returned an empty response")

    usage = getattr(response, "usage", None)
    if usage:
        logger.info(
            "OpenAI usage model=%s prompt_tokens=%s completion_tokens=%s total_tokens=%s",
            OPENAI_MODEL,
            getattr(usage, "prompt_tokens", "?"),
            getattr(usage, "completion_tokens", "?"),
            getattr(usage, "total_tokens", "?"),
        )

    reply = TeddyReply(speech_text=text, display_text=text)
    store_cached_reply(f"openai:{cache_key}", reply)
    return remember(reply)


def synthesize_with_piper(text: str, output_path: Path, mode: str = "conversation") -> None:
    """Generate a WAV file through the modular TTS manager."""
    tts_manager.speak(text, mode=mode, output_path=output_path)


def find_wake_response_file() -> Path | None:
    """Find the uploaded wake response in active or fallback dashboard storage."""
    candidates = [
        storage.data_path(Path("Voices") / WAKE_RESPONSE_FILE_NAME),
        storage.fallback_path(Path("Voices") / WAKE_RESPONSE_FILE_NAME),
    ]

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate

    voices_dirs = [storage.data_path("Voices"), storage.fallback_path("Voices")]
    target_name = WAKE_RESPONSE_FILE_NAME.lower()
    for voices_dir in voices_dirs:
        if not voices_dir.exists() or not voices_dir.is_dir():
            continue
        for file_path in voices_dir.iterdir():
            if file_path.is_file() and file_path.name.lower() == target_name:
                return file_path

    return None


def prepare_wake_response_audio(output_path: Path) -> bool:
    """Use uploaded Voices/LULU.wav for the wake-name response when available."""
    source_path = find_wake_response_file()
    if not source_path:
        return False

    if output_path.exists() and output_path.stat().st_size >= 44:
        try:
            if output_path.stat().st_mtime >= source_path.stat().st_mtime:
                return True
        except OSError:
            pass

    temp_path = output_path.with_suffix(".wake.tmp.wav")
    ffmpeg_bin = resolve_ffmpeg_bin()
    if ffmpeg_bin:
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
            str(temp_path),
        ]
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace").strip()
            logger.warning("Wake response audio conversion failed for %s: %s", source_path, stderr[:500])
            return False
    else:
        try:
            with wave.open(str(source_path), "rb") as wav_file:
                if wav_file.getsampwidth() != 2 or wav_file.getnchannels() not in {1, 2}:
                    logger.warning("Wake response WAV needs 16-bit PCM: %s", source_path)
                    return False
            shutil.copyfile(source_path, temp_path)
        except Exception:
            logger.exception("Wake response WAV check failed: %s", source_path)
            return False

    if not temp_path.exists() or temp_path.stat().st_size < 44:
        logger.warning("Wake response conversion produced no playable WAV: %s", source_path)
        return False

    temp_path.replace(output_path)
    logger.info("Using uploaded wake response audio: %s", source_path)
    return True


try:
    if find_wake_response_file():
        prepare_wake_response_audio(WAKE_RESPONSE_WAV_PATH)
except Exception:
    logger.warning("Could not prepare wake response audio at startup", exc_info=True)


@app.post("/remote/command")
async def enqueue_remote_command(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc

    action = str(payload.get("action", "")).strip().lower()
    text = str(payload.get("text", "")).strip()
    allowed_actions = {"speak", "radio", "stop", "ready", "listen"}

    if action not in allowed_actions:
        raise HTTPException(status_code=400, detail="Unsupported remote action")
    if action == "speak" and not text:
        raise HTTPException(status_code=400, detail="Speak action requires text")
    if len(text) > 240:
        raise HTTPException(status_code=400, detail="Text is too long")

    command = {
        "id": uuid.uuid4().hex,
        "action": action,
        "text": text,
        "created_at": str(int(time.time())),
    }

    with remote_command_lock:
        state = storage.load_json("dashboard/remote_commands.json", storage.DEFAULT_REMOTE_COMMANDS)
        if not isinstance(state, dict):
            state = dict(storage.DEFAULT_REMOTE_COMMANDS)
        state["pending"] = command
        state["last_command"] = {**command, "state": "queued"}
        storage.save_json("dashboard/remote_commands.json", state)

    logger.info("Remote command queued action=%s id=%s", action, command["id"])
    append_activity(f"Remote command queued action={action} id={command['id']}")
    return JSONResponse({"queued": True, "command": command})


@app.get("/remote/next")
def get_next_remote_command(device_id: str = "lulu") -> JSONResponse:
    with remote_command_lock:
        state = storage.load_json("dashboard/remote_commands.json", storage.DEFAULT_REMOTE_COMMANDS)
        if not isinstance(state, dict):
            state = dict(storage.DEFAULT_REMOTE_COMMANDS)
        command = state.get("pending")
        state["pending"] = None
        if command:
            state["last_command"] = {
                **command,
                "state": "delivered",
                "device_id": device_id,
                "delivered_at": str(int(time.time())),
            }
            append_activity(f"Remote command delivered action={command.get('action')} id={command.get('id')}")
        storage.save_json("dashboard/remote_commands.json", state)

    return JSONResponse({"command": command})


@app.get("/remote/status")
def remote_status() -> JSONResponse:
    with remote_command_lock:
        state = storage.load_json("dashboard/remote_commands.json", storage.DEFAULT_REMOTE_COMMANDS)
        if not isinstance(state, dict):
            state = dict(storage.DEFAULT_REMOTE_COMMANDS)
        return JSONResponse(
            {
                "pending": state.get("pending"),
                "last_command": state.get("last_command"),
                "device_status": read_remote_device_status(),
            }
        )


@app.post("/remote/device-status")
async def update_remote_device_status(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc

    status = save_remote_device_status(payload if isinstance(payload, dict) else {})
    return JSONResponse({"ok": True, "device_status": status})


@app.post("/remote/sd/request")
async def enqueue_remote_sd_request(request: Request) -> JSONResponse:
    content_type = request.headers.get("content-type", "")

    if "multipart/form-data" in content_type:
        form = await request.form()
        action = str(form.get("action") or "").strip().lower()
        if action != "upload":
            raise HTTPException(status_code=400, detail="Unsupported SD form action")

        target_dir = _clean_remote_sd_path(str(form.get("path") or "/"))
        upload = form.get("file")
        if not upload or not hasattr(upload, "read"):
            raise HTTPException(status_code=400, detail="Missing upload file")

        original_name = _safe_remote_file_name(getattr(upload, "filename", "") or "upload.bin")
        overwrite_value = str(form.get("overwrite") or "").strip().lower()
        overwrite = overwrite_value in {"1", "true", "yes", "overwrite"}
        queued = _queue_remote_sd_request("upload", {"path": target_dir, "name": original_name, "overwrite": overwrite})
        upload_dir = _remote_sd_upload_dir(queued["id"])
        upload_dir.mkdir(parents=True, exist_ok=True)
        upload_path = upload_dir / original_name
        size = 0
        with upload_path.open("wb") as output:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                output.write(chunk)

        queued["payload"]["size"] = size
        queued["payload"]["download_path"] = f"/remote/sd/file/{queued['id']}/{quote(original_name)}"
        with remote_sd_lock:
            state = _remote_sd_state()
            for index, pending in enumerate(state["pending"]):
                if pending.get("id") == queued["id"]:
                    state["pending"][index] = queued
                    break
            _save_remote_sd_state(state)

        try:
            timeout_seconds = min(300.0, max(0.0, float(form.get("timeout_seconds") or 0)))
        except (TypeError, ValueError):
            timeout_seconds = 0.0

        if timeout_seconds > 0:
            result = _wait_remote_sd_result(queued["id"], timeout_seconds)
            if result:
                status_code = 200 if result.get("ok", True) else 502
                return JSONResponse(result, status_code=status_code)

        return JSONResponse({"queued": True, "request": queued, "detail": "Waiting for LULU to write the file to SD"}, status_code=202)

    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc

    action = str(payload.get("action") or "").strip().lower()
    if action not in {"bible_status", "list", "mkdir"}:
        raise HTTPException(status_code=400, detail="Unsupported SD action")

    request_payload: dict[str, Any] = {}
    if action in {"list", "mkdir"}:
        request_payload["path"] = _clean_remote_sd_path(str(payload.get("path") or "/"))
    if action == "mkdir":
        request_payload["name"] = _safe_remote_file_name(str(payload.get("name") or "folder"))

    queued = _queue_remote_sd_request(action, request_payload)
    result = _wait_remote_sd_result(queued["id"], float(payload.get("timeout_seconds") or 12))
    if result:
        status_code = 200 if result.get("ok", True) else 502
        return JSONResponse(result, status_code=status_code)
    return JSONResponse({"queued": True, "request": queued, "detail": "Waiting for LULU to sync SD data"}, status_code=202)


@app.get("/remote/sd/next")
def get_next_remote_sd_request(device_id: str = "esp32-lulu") -> JSONResponse:
    with remote_sd_lock:
        state = _remote_sd_state()
        request = state["pending"].pop(0) if state["pending"] else None
        state["last_request"] = {**request, "device_id": device_id, "delivered_at": str(int(time.time()))} if request else state.get("last_request")
        active_ids = {str(item.get("id")) for item in state["pending"] if isinstance(item, dict)}
        if request:
            active_ids.add(str(request.get("id")))
        _save_remote_sd_state(state)

    _prune_remote_sd_uploads(active_ids)
    return JSONResponse({"request": request})


@app.get("/remote/sd/file/{request_id}/{file_name:path}")
def get_remote_sd_upload_file(request_id: str, file_name: str) -> Response:
    safe_name = _safe_remote_file_name(file_name)
    path = _remote_sd_upload_dir(_safe_remote_file_name(request_id)) / safe_name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Queued SD upload file not found")
    return StreamingResponse(path.open("rb"), media_type="application/octet-stream")


@app.get("/remote/sd/result/{request_id}")
def get_remote_sd_result(request_id: str) -> JSONResponse:
    clean_id = str(request_id or "").strip()
    if not clean_id:
        raise HTTPException(status_code=400, detail="Missing SD request id")

    with remote_sd_lock:
        state = _remote_sd_state()
        result = state["results"].get(clean_id)
        if isinstance(result, dict):
            return JSONResponse(result)
        pending = next((item for item in state["pending"] if isinstance(item, dict) and item.get("id") == clean_id), None)
        last_request = state.get("last_request") if isinstance(state.get("last_request"), dict) else None

    if pending:
        return JSONResponse({"queued": True, "request": pending, "detail": "Waiting for LULU to pick up this SD request"}, status_code=202)
    if last_request and last_request.get("id") == clean_id:
        return JSONResponse({"queued": True, "request": last_request, "detail": "LULU is writing this SD request"}, status_code=202)
    return JSONResponse(
        {
            "queued": True,
            "lost": True,
            "detail": "SD request confirmation is not available yet. The dashboard will verify the file list.",
        },
        status_code=202,
    )


@app.post("/remote/sd/result")
async def receive_remote_sd_result(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc

    request_id = str(payload.get("id") or "").strip()
    if not request_id:
        raise HTTPException(status_code=400, detail="Missing SD request id")

    result = {
        "id": request_id,
        "ok": bool(payload.get("ok", True)),
        "action": str(payload.get("action") or ""),
        "detail": str(payload.get("detail") or ""),
        "data": payload.get("data") if isinstance(payload.get("data"), dict) else {},
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    with remote_sd_lock:
        state = _remote_sd_state()
        results = state["results"]
        results[request_id] = result
        if len(results) > 80:
            for key in list(results.keys())[:-80]:
                results.pop(key, None)
        state["results"] = results
        state["last_result"] = result
        _save_remote_sd_state(state)
    return JSONResponse({"ok": True})


@app.get("/bible/status")
def bible_status() -> JSONResponse:
    return JSONResponse(read_bible_session_status())


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "data_dir": str(storage.DATA_DIR),
        "whisper_model": WHISPER_MODEL_NAME,
        "whisper_beam_size": str(WHISPER_BEAM_SIZE),
        "whisper_vad_filter": str(WHISPER_VAD_FILTER).lower(),
        "openai_enabled": str(USE_OPENAI).lower(),
        "openai_model": OPENAI_MODEL,
        "weather_location": WEATHER_LOCATION_NAME,
        "room_temp_hot_c": str(ROOM_TEMP_HOT_C),
        "room_temp_cold_c": str(ROOM_TEMP_COLD_C),
        "bible_translation": BIBLE_TRANSLATION,
        "radio_country": "NG",
        "radio_stream_format": f"{RADIO_STREAM_SAMPLE_RATE}Hz {RADIO_STREAM_CHANNELS}ch PCM16 raw PCM",
        "radio_stream_chunk_bytes": str(RADIO_STREAM_CHUNK_BYTES),
        "radio_live_stream": str(RADIO_LIVE_STREAM).lower(),
        "ffmpeg_available": str(bool(resolve_ffmpeg_bin())).lower(),
        "piper_voice": str(PIPER_VOICE_MODEL),
        "piper_speaker_id": PIPER_SPEAKER_ID,
        "piper_length_scale": PIPER_LENGTH_SCALE,
        "piper_noise_scale": PIPER_NOISE_SCALE,
        "piper_noise_w": PIPER_NOISE_W,
    }


@app.get("/dashboard/overview")
def dashboard_overview() -> dict[str, Any]:
    """Return the small live feed used by the admin overview terminal."""
    conversations = read_recent_conversation()
    activities = read_recent_activity()
    latest_user = next((item for item in conversations if item.get("speaker") == "user"), None)
    latest_lulu = next((item for item in conversations if item.get("speaker") == "lulu"), None)
    return {
        "checked_at": datetime.now().isoformat(timespec="seconds"),
        "conversation": {
            "user": latest_user,
            "lulu": latest_lulu,
            "recent": conversations,
        },
        "activities": activities,
        "bible": read_bible_session_status(),
        "device_status": read_remote_device_status(),
    }


@app.get("/", response_class=HTMLResponse)
def root() -> str:
    return """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LULU API</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f7f8fb; color: #111827; }
    main { max-width: 720px; margin: 12vh auto; padding: 0 24px; }
    section { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 28px; box-shadow: 0 10px 30px rgba(17, 24, 39, 0.06); }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { line-height: 1.6; color: #4b5563; }
    a { color: #0f766e; font-weight: 600; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>LULU backend is running</h1>
      <p>This Railway service is the FastAPI backend. The visual admin dashboard should be deployed from the <code>lulu-dashboard</code> folder as a separate Railway service.</p>
      <p><a href="/health">Open health check</a> or <a href="/docs">open API docs</a>.</p>
    </section>
  </main>
</body>
</html>
"""


def safe_data_json_path(relative_path: str) -> Path:
    target = storage.data_path(relative_path).resolve()
    data_root = storage.DATA_DIR.resolve()
    if data_root not in target.parents and target != data_root:
        raise HTTPException(status_code=400, detail="Path must stay inside LULU_DATA")
    if target.suffix.lower() != ".json":
        raise HTTPException(status_code=400, detail="Only JSON files are exposed")
    return target


@app.get("/database/status")
def database_status() -> dict:
    json_files = []
    if storage.DATA_DIR.exists():
        for file_path in storage.DATA_DIR.rglob("*.json"):
            json_files.append(str(file_path.relative_to(storage.DATA_DIR)).replace("\\", "/"))

    return {
        "data_dir": str(storage.DATA_DIR),
        "backup_dir": str(storage.BACKUP_DIR),
        "folders": list(storage.REQUIRED_FOLDERS),
        "json_files": sorted(json_files),
    }


@app.get("/database/storage")
def database_storage() -> dict:
    """Return active SD/fallback storage status for the dashboard."""
    return storage.storage_status()


@app.post("/database/sync-to-sd")
def database_sync_to_sd() -> JSONResponse:
    """Copy local fallback data onto the configured SD card storage root."""
    try:
        return JSONResponse(storage.sync_local_to_sd())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/database/sync-from-sd")
def database_sync_from_sd() -> JSONResponse:
    """Copy SD card storage data back into the local fallback root."""
    try:
        return JSONResponse(storage.sync_sd_to_local())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/database/files")
def database_files(path: str = "") -> JSONResponse:
    """List dashboard-visible files and folders from active storage."""
    try:
        return JSONResponse(storage.list_files(path))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ValueError, NotADirectoryError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/database/read-file")
def database_read_file(path: str) -> JSONResponse:
    """Read one dashboard-selected file from active storage."""
    try:
        return JSONResponse(storage.read_file(path))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ValueError, IsADirectoryError, PermissionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/database/write-file")
async def database_write_file(request: Request) -> JSONResponse:
    """Write one dashboard-edited file into active storage."""
    payload = await request.json()
    path = str(payload.get("path", "")).strip()
    content = str(payload.get("content", ""))
    if not path:
        raise HTTPException(status_code=400, detail="Missing path")
    try:
        return JSONResponse(storage.write_file(path, content))
    except (ValueError, PermissionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/database/upload-file")
async def database_upload_file(path: str = Form(default=""), files: list[UploadFile] = File(...)) -> JSONResponse:
    """Upload one or more dashboard files into active storage."""
    target_dir = str(path or "").strip().strip("/\\")
    uploaded = []

    for upload in files:
        if not upload.filename:
            continue

        filename = Path(upload.filename).name.strip()
        if not filename or filename in {".", ".."}:
            continue

        relative_path = f"{target_dir}/{filename}" if target_dir else filename
        try:
            uploaded.append(storage.write_binary_file(relative_path, upload.file))
        except (ValueError, PermissionError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not uploaded:
        raise HTTPException(status_code=400, detail="No files uploaded")

    return JSONResponse({"uploaded": uploaded, "count": len(uploaded), **storage.storage_status()})


@app.post("/database/delete-file")
async def database_delete_file(request: Request) -> JSONResponse:
    """Delete one dashboard-selected file or empty folder."""
    payload = await request.json()
    path = str(payload.get("path", "")).strip()
    if not path:
        raise HTTPException(status_code=400, detail="Missing path")
    try:
        return JSONResponse(storage.delete_file(path))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ValueError, PermissionError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/database/create-folder")
async def database_create_folder(request: Request) -> JSONResponse:
    """Create a folder from the dashboard file manager."""
    payload = await request.json()
    path = str(payload.get("path", "")).strip()
    if not path:
        raise HTTPException(status_code=400, detail="Missing path")
    try:
        return JSONResponse(storage.make_directory(path))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/database/file/{relative_path:path}")
def database_file(relative_path: str) -> JSONResponse:
    target = safe_data_json_path(relative_path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="JSON file not found")
    return JSONResponse({"path": relative_path, "data": storage.load_json(target, {})})


@app.post("/database/backup")
def database_backup() -> JSONResponse:
    backup_path = storage.backup_database()
    return JSONResponse({"backup": str(backup_path)})


@app.get("/language/pack")
def portuguese_language_pack() -> JSONResponse:
    """Export the complete Portuguese tutor pack for dashboard import/export."""
    return JSONResponse(portuguese_tutor.load_pack())


@app.post("/language/pack")
async def save_portuguese_language_pack(request: Request) -> JSONResponse:
    """Import dashboard-edited Portuguese tutor files."""
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Language pack must be a JSON object")
    return JSONResponse(portuguese_tutor.import_pack(payload))


@app.get("/language/lesson")
def portuguese_lesson() -> JSONResponse:
    """Return the current Portuguese lesson from SD-backed tutor storage."""
    return JSONResponse(portuguese_tutor.current_lesson())


@app.get("/language/progress")
def portuguese_progress() -> JSONResponse:
    """Return Portuguese tutor progress."""
    return JSONResponse(portuguese_tutor.get_progress())


@app.post("/language/progress")
async def save_portuguese_progress(request: Request) -> JSONResponse:
    """Save Portuguese tutor progress from the dashboard."""
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Progress must be a JSON object")
    return JSONResponse(portuguese_tutor.save_progress(payload))


@app.post("/language/translate")
async def portuguese_translate(request: Request) -> JSONResponse:
    """Translate with SD cache first, then optional OpenAI enrichment."""
    payload = await request.json()
    query = str(payload.get("text") or payload.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Missing text")
    return JSONResponse(portuguese_tutor.translate(query, call_portuguese_tutor_ai))


@app.post("/language/quiz")
async def portuguese_quiz(request: Request) -> JSONResponse:
    """Create a Portuguese quiz question from the offline quiz bank."""
    payload = await request.json()
    category = str(payload.get("category") or "").strip() or None
    return JSONResponse(portuguese_tutor.quiz(category))


@app.post("/language/conversation")
async def portuguese_conversation(request: Request) -> JSONResponse:
    """Continue an immersive Portuguese conversation practice session."""
    payload = await request.json()
    message = str(payload.get("message") or "").strip()
    return JSONResponse(portuguese_tutor.conversation(message, call_portuguese_tutor_ai))


@app.post("/language/check-answer")
async def portuguese_check_answer(request: Request) -> JSONResponse:
    """Check one Portuguese quiz/practice answer and track mistakes."""
    payload = await request.json()
    question_id = str(payload.get("question_id") or payload.get("id") or "").strip()
    answer = str(payload.get("answer") or "").strip()
    if not answer:
        raise HTTPException(status_code=400, detail="Missing answer")
    return JSONResponse(portuguese_tutor.check_answer(question_id, answer))


@app.post("/language/pronunciation")
async def portuguese_pronunciation(request: Request) -> JSONResponse:
    """Return saved Portuguese pronunciation guidance."""
    payload = await request.json()
    text = str(payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Missing text")
    return JSONResponse(portuguese_tutor.pronunciation(text))


@app.get("/language/revision")
def portuguese_revision() -> JSONResponse:
    """Return Portuguese vocabulary scheduled for review."""
    return JSONResponse(portuguese_tutor.revision_items())


@app.get("/language/{language}/lesson")
def language_lesson(language: str, lesson: int | None = None) -> JSONResponse:
    """Return a stored Portuguese or Chinese lesson."""
    try:
        return JSONResponse(load_language_lesson(language, lesson))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/language/{language}/lesson")
async def save_language_lesson(language: str, request: Request) -> JSONResponse:
    """Save a Portuguese or Chinese lesson from the dashboard."""
    try:
        root = language_root(language)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Lesson must be a JSON object")
    lesson_number = int(payload.get("lesson", 1))
    if lesson_number < 1:
        raise HTTPException(status_code=400, detail="Lesson number must be positive")
    storage.save_json(f"{root}/lessons/lesson_{lesson_number:03d}.json", payload)
    return JSONResponse(payload)


@app.get("/language/{language}/progress")
def language_progress(language: str) -> JSONResponse:
    """Return stored lesson progress for one supported language."""
    try:
        root = language_root(language)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return JSONResponse(storage.load_json(f"{root}/progress.json", {}))


@app.post("/language/{language}/progress")
async def save_language_progress(language: str, request: Request) -> JSONResponse:
    """Save lesson progress for one supported language."""
    try:
        root = language_root(language)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Progress must be a JSON object")
    storage.save_json(f"{root}/progress.json", payload)
    return JSONResponse(payload)


@app.get("/radio/nigeria.wav", name="radio_stream")
def radio_stream() -> Response:
    try:
        station = get_nigerian_radio_station()
        headers = {
            "Cache-Control": "no-store",
            "X-Radio-Station": station.name,
        }

        if RADIO_LIVE_STREAM:
            return StreamingResponse(
                build_radio_stream(station),
                media_type="audio/wav",
                headers=headers,
            )

        wav_bytes = build_radio_clip_wav(station)
        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={
                **headers,
                "Content-Length": str(len(wav_bytes)),
            },
        )
    except Exception as exc:
        logger.exception("Radio stream failed")
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/radio/nigeria.pcm", name="radio_pcm_stream")
def radio_pcm_stream() -> Response:
    try:
        station = get_nigerian_radio_station()
        return StreamingResponse(
            build_radio_pcm_stream(station),
            media_type="application/octet-stream",
            headers={
                "Cache-Control": "no-store",
                "X-Radio-Station": station.name,
                "X-Audio-Format": f"pcm_s16le; rate={RADIO_STREAM_SAMPLE_RATE}; channels={RADIO_STREAM_CHANNELS}",
            },
        )
    except Exception as exc:
        logger.exception("Raw radio stream failed")
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/speak")
def speak(request: Request, text: str, mode: str = "conversation") -> JSONResponse:
    speech_text = text.strip()
    if not speech_text:
        raise HTTPException(status_code=400, detail="Missing text")
    if len(speech_text) > 240:
        raise HTTPException(status_code=400, detail="Text is too long")

    try:
        with reply_lock:
            synthesize_with_piper(speech_text, REPLY_WAV_PATH, mode=mode)

        return JSONResponse(
            {
                "text": speech_text,
                "audio_url": public_url("/audio/reply.wav"),
                "action": "speak",
            }
        )
    except Exception as exc:
        logger.exception("Speak request failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/tts/speak")
async def api_tts_speak(request: Request) -> JSONResponse:
    """Generate speech through the modular TTS manager."""
    payload = await request.json()
    text = str(payload.get("text", "")).strip()
    mode = str(payload.get("mode", "conversation")).strip() or "conversation"
    if not text:
        raise HTTPException(status_code=400, detail="Missing text")

    output_path = AUDIO_DIR / "tts_api_response.wav"
    try:
        with reply_lock:
            result = tts_manager.speak(text, mode=mode, output_path=output_path)
        return JSONResponse(
            {
                "text": text,
                "mode": result.mode,
                "provider": result.provider,
                "voice_id": result.voice_id,
                "cache_hit": result.cache_hit,
                "fallback_used": result.fallback_used,
                "generation_seconds": result.generation_seconds,
                "audio_url": public_url("/audio/tts_api_response.wav"),
            }
        )
    except Exception as exc:
        logger.exception("TTS speak failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/tts/voices")
def api_tts_voices() -> JSONResponse:
    """Return available ElevenLabs voices for dashboard dropdowns."""
    return JSONResponse(
        {
            "provider_available": tts_manager.elevenlabs.available,
            "api_key_status": tts_manager.elevenlabs.api_key_status(),
            "voices": tts_manager.voices(),
        }
    )


@app.get("/api/tts/cache")
def api_tts_cache() -> JSONResponse:
    """Return TTS cache size, files, and metadata."""
    return JSONResponse(tts_manager.cache_summary())


@app.delete("/api/tts/cache")
def api_tts_cache_delete(file: str | None = None) -> JSONResponse:
    """Clear all TTS cache files or one selected file."""
    return JSONResponse(tts_manager.clear_cache(file))


@app.post("/api/tts/cache/preload")
def api_tts_cache_preload() -> JSONResponse:
    """Preload common short phrases into the TTS cache."""
    return JSONResponse(tts_manager.preload_common_phrases())


@app.get("/api/tts/config")
def api_tts_config() -> JSONResponse:
    """Return current TTS provider, cache, and mode voice mapping."""
    return JSONResponse(tts_manager.load_config())


@app.post("/api/tts/config")
async def api_tts_config_save(request: Request) -> JSONResponse:
    """Save TTS provider, cache, and mode voice mapping."""
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="TTS config must be an object")
    return JSONResponse(tts_manager.save_config(payload))


@app.post("/chat")
def chat(
    request: Request,
    file: UploadFile = File(...),
    local_qa: str | None = Form(default=None),
    room_temperature_c: str | None = Form(default=None),
    room_humidity_percent: str | None = Form(default=None),
) -> JSONResponse:
    wav_path: Path | None = None

    try:
        wav_path = save_upload(file)
        validate_audio_for_transcription(wav_path)
        transcription = transcribe_audio(wav_path)
        if transcription:
            storage.append_conversation("user", transcription)
            user_profile = storage.load_json("users/default.json", storage.DEFAULT_USER)
            if isinstance(user_profile, dict):
                user_profile["lastSeen"] = datetime.now().isoformat(timespec="seconds")
                storage.save_json("users/default.json", user_profile)
            storage.update_emotion_state({"lastInteraction": datetime.now().isoformat(timespec="seconds")})
        logger.info(
            "Intent check transcription=%r radio=%s playback=%s weather=%s bible=%s stop=%s",
            transcription,
            is_radio_request(transcription),
            is_playback_command(transcription),
            is_weather_question(transcription),
            is_bible_question(transcription),
            is_stop_request(transcription),
        )
        popular_audio_path: Path | None = None
        popular_hit = find_popular_response_cache(transcription)
        if popular_hit:
            entry = popular_hit["entry"]
            popular_audio_path = popular_hit["audio_path"]
            reply = TeddyReply(
                speech_text=str(entry.get("speech_text", "")),
                display_text=str(entry.get("display_text", entry.get("speech_text", ""))),
                action="speak",
            )
        else:
            reply = generate_reply(
                transcription,
                extra_qa_text=local_qa,
                room_temperature_c=parse_optional_float(room_temperature_c),
                room_humidity_percent=parse_optional_float(room_humidity_percent),
            )

        key_activity = key_activity_description(transcription, reply)
        if key_activity:
            append_activity(key_activity)

        audio_url = ""
        if reply.action == "wake":
            with reply_lock:
                wake_audio_ready = prepare_wake_response_audio(WAKE_RESPONSE_WAV_PATH)
                if not wake_audio_ready and reply.speech_text:
                    synthesize_with_piper(reply.speech_text, REPLY_WAV_PATH)

            audio_url = public_url("/audio/wake_response.wav" if wake_audio_ready else "/audio/reply.wav")
        elif reply.action in {"speak", "story", "bible"} and reply.speech_text:
            with reply_lock:
                if popular_audio_path:
                    shutil.copyfile(popular_audio_path, REPLY_WAV_PATH)
                else:
                    synthesize_with_piper(
                        reply.speech_text,
                        REPLY_WAV_PATH,
                        mode="story" if reply.action in {"story", "bible"} else "conversation",
                    )
                    record_popular_response_candidate(transcription, reply, REPLY_WAV_PATH)

            audio_url = public_url("/audio/reply.wav")
        elif reply.action == "radio":
            audio_url = public_url("/radio/nigeria.pcm")

        if reply.display_text:
            storage.append_conversation("lulu", reply.display_text)

        sd_audio_cacheable = bool(audio_url and is_sd_reply_audio_cache_candidate(transcription, reply))
        sd_audio_cache_key = sd_reply_audio_cache_key(reply) if sd_audio_cacheable else ""

        return JSONResponse(
            {
                "transcription": transcription,
                "text": reply.display_text,
                "audio_url": audio_url,
                "action": reply.action,
                "music_query": reply.music_query,
                "audio_cacheable": sd_audio_cacheable,
                "audio_cache_key": sd_audio_cache_key,
            }
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Chat request failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if wav_path and wav_path.exists():
            wav_path.unlink(missing_ok=True)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)
