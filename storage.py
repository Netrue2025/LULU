import copy
import json
import os
import shutil
import threading
import time
import zipfile
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

try:
    import msvcrt
except ImportError:  # pragma: no cover - Windows is the target dev machine.
    msvcrt = None

try:
    import fcntl
except ImportError:  # pragma: no cover - fcntl is unavailable on Windows.
    fcntl = None


BASE_DIR = Path(__file__).resolve().parent
LOCAL_DATA_DIR = Path(os.getenv("LULU_FALLBACK_DATA_DIR", str(BASE_DIR / "LULU_DATA"))).resolve()
SD_CARD_DIR = os.getenv("LULU_SDCARD_DIR", "").strip()
SD_DATA_DIR = Path(SD_CARD_DIR).expanduser().resolve() if SD_CARD_DIR else None
DATA_DIR = LOCAL_DATA_DIR
BACKUP_DIR = Path(os.getenv("LULU_BACKUP_DIR", str(BASE_DIR / "Backups"))).resolve()
MAX_BACKUPS = int(os.getenv("LULU_MAX_BACKUPS", "30"))
MAX_LOG_BYTES = int(os.getenv("LULU_MAX_LOG_BYTES", str(1024 * 1024)))
MAX_CACHE_AGE_SECONDS = int(os.getenv("LULU_CACHE_MAX_AGE_SECONDS", str(24 * 60 * 60)))

REQUIRED_FOLDERS = (
    "users",
    "settings",
    "conversations",
    "reminders",
    "medications",
    "portuguese",
    "portuguese/lessons",
    "portuguese/vocabulary",
    "chinese",
    "chinese/lessons",
    "chinese/vocabulary",
    "languages",
    "languages/portuguese",
    "languages/portuguese/cache",
    "dashboard",
    "logs",
    "emotions",
    "radio",
    "cache",
    "cache/whisper",
    "cache/tts",
    "cache/ai",
    "Music",
    "Stories",
    "Languages",
    "Images",
    "Config",
    "Voices",
)

DEFAULT_USER = {
    "name": "Jeremiah",
    "nickname": "LULU Owner",
    "language": "English",
    "timezone": "Africa/Lagos",
    "created": "",
    "lastSeen": "",
}

DEFAULT_SETTINGS = {
    "voice": "female",
    "volume": 90,
    "speechRate": 1.0,
    "wakeWord": "LULU",
    "nightMode": False,
    "autoReconnect": True,
}

DEFAULT_PORTUGUESE_PROGRESS = {
    "lessonsCompleted": [],
    "currentLesson": 1,
    "updated": "",
}

DEFAULT_PORTUGUESE_LESSON = {
    "lesson": 1,
    "title": "Greetings",
    "completed": False,
    "words": [
        {
            "english": "Hello",
            "portuguese": "Ola",
            "pronunciation": "oh-LAH",
        }
    ],
}

DEFAULT_CHINESE_PROGRESS = {
    "lessonsCompleted": [],
    "currentLesson": 1,
    "updated": "",
}

DEFAULT_CHINESE_LESSON = {
    "lesson": 1,
    "title": "Greetings",
    "completed": False,
    "words": [
        {
            "character": "你",
            "pinyin": "ni",
            "english": "you",
            "difficulty": "beginner",
        },
        {
            "character": "好",
            "pinyin": "hao",
            "english": "good",
            "difficulty": "beginner",
        },
    ],
}

# Keep the source ASCII-safe while loading real Chinese characters at runtime.
DEFAULT_CHINESE_LESSON["words"][0]["character"] = "\u4f60"
DEFAULT_CHINESE_LESSON["words"][1]["character"] = "\u597d"

DEFAULT_REMINDERS: list[dict[str, Any]] = []
DEFAULT_REMINDER_HISTORY: list[dict[str, Any]] = []
DEFAULT_MEDICATION_SCHEDULE = {"medicines": [], "updated": ""}
DEFAULT_EMOTIONS = {
    "happy": 0,
    "excited": 0,
    "sleepy": 0,
    "lonely": 0,
    "lastInteraction": "",
}
DEFAULT_RADIO_FAVORITES: list[dict[str, Any]] = []
DEFAULT_REMOTE_COMMANDS = {"pending": None, "last_command": None}
DEFAULT_REPLY_CACHE: dict[str, Any] = {}
DEFAULT_RADIO_CACHE = {
    "updated_at": 0,
    "selected_index": 0,
    "stations": [],
    "selected": None,
}
DEFAULT_SOURCE_META = {}

DEFAULT_FILES: tuple[tuple[str, Any], ...] = (
    ("users/default.json", DEFAULT_USER),
    ("settings/settings.json", DEFAULT_SETTINGS),
    ("portuguese/progress.json", DEFAULT_PORTUGUESE_PROGRESS),
    ("portuguese/lessons/lesson_001.json", DEFAULT_PORTUGUESE_LESSON),
    ("portuguese/vocabulary/words.json", []),
    ("chinese/progress.json", DEFAULT_CHINESE_PROGRESS),
    ("chinese/lessons/lesson_001.json", DEFAULT_CHINESE_LESSON),
    ("chinese/vocabulary/words.json", []),
    ("reminders/reminders.json", DEFAULT_REMINDERS),
    ("reminders/history.json", DEFAULT_REMINDER_HISTORY),
    ("medications/schedule.json", DEFAULT_MEDICATION_SCHEDULE),
    ("emotions/state.json", DEFAULT_EMOTIONS),
    ("radio/favorites.json", DEFAULT_RADIO_FAVORITES),
    ("radio/stations_cache.json", DEFAULT_RADIO_CACHE),
    ("dashboard/remote_commands.json", DEFAULT_REMOTE_COMMANDS),
    ("dashboard/local_qa.json", []),
    ("dashboard/stories.json", []),
    ("dashboard/source_meta.json", DEFAULT_SOURCE_META),
    ("cache/reply_cache.json", DEFAULT_REPLY_CACHE),
    ("cache/ai/responses.json", DEFAULT_REPLY_CACHE),
)

_locks_guard = threading.Lock()
_path_locks: dict[Path, threading.RLock] = {}
_cache_guard = threading.Lock()
_json_cache: dict[Path, tuple[float, Any]] = {}
_backup_guard = threading.Lock()
_scheduler_started = False
_last_backup_date: str | None = None


def _choose_data_dir() -> Path:
    """Prefer the mounted SD card when configured, otherwise use local fallback data."""
    if not SD_DATA_DIR:
        return LOCAL_DATA_DIR
    try:
        SD_DATA_DIR.mkdir(parents=True, exist_ok=True)
        test_path = SD_DATA_DIR / ".lulu-write-test"
        test_path.write_text("ok", encoding="utf-8")
        test_path.unlink(missing_ok=True)
        return SD_DATA_DIR
    except OSError:
        return LOCAL_DATA_DIR


def refresh_data_dir() -> Path:
    """Re-check the configured SD card and switch back to fallback if it is unavailable."""
    global DATA_DIR
    DATA_DIR = _choose_data_dir()
    return DATA_DIR


refresh_data_dir()


def _clone(value: Any) -> Any:
    return copy.deepcopy(value)


def data_path(path: str | Path) -> Path:
    raw_path = Path(path)
    if raw_path.is_absolute():
        return raw_path
    return refresh_data_dir() / raw_path


def fallback_path(path: str | Path) -> Path:
    """Return a path under the local server fallback data directory."""
    raw_path = Path(path)
    if raw_path.is_absolute():
        return raw_path
    return LOCAL_DATA_DIR / raw_path


def relative_data_path(path: Path) -> Path | None:
    """Return a path relative to the active data root, or None when outside it."""
    try:
        return path.resolve().relative_to(refresh_data_dir())
    except ValueError:
        return None


def get_data_path(path: str | Path) -> Path:
    resolved = data_path(path)
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def _path_lock(path: Path) -> threading.RLock:
    with _locks_guard:
        lock = _path_locks.get(path)
        if lock is None:
            lock = threading.RLock()
            _path_locks[path] = lock
        return lock


@contextmanager
def _file_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_suffix(path.suffix + ".lock")
    with _path_lock(path):
        with lock_path.open("a+b") as lock_file:
            if msvcrt is not None:
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
            elif fcntl is not None:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                if msvcrt is not None:
                    lock_file.seek(0)
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
                elif fcntl is not None:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _read_json_file(path: Path, default_data: Any) -> Any:
    if not path.exists() or path.stat().st_size == 0:
        return _clone(default_data)

    try:
        with path.open("r", encoding="utf-8") as json_file:
            return json.load(json_file)
    except json.JSONDecodeError:
        corrupt_path = path.with_suffix(path.suffix + f".corrupt-{int(time.time())}")
        try:
            path.replace(corrupt_path)
        except OSError:
            pass
        return _clone(default_data)
    except OSError:
        return _clone(default_data)


def load_json(path: str | Path, default_data: Any = None) -> Any:
    target = get_data_path(path)
    default = {} if default_data is None else default_data
    target.parent.mkdir(parents=True, exist_ok=True)

    if not target.exists():
        return save_json(target, _clone(default))

    with _file_lock(target):
        try:
            mtime = target.stat().st_mtime
        except OSError:
            return _clone(default)

        with _cache_guard:
            cached = _json_cache.get(target)
            if cached and cached[0] == mtime:
                return _clone(cached[1])

        data = _read_json_file(target, default)
        with _cache_guard:
            _json_cache[target] = (mtime, _clone(data))
        return data


def save_json(path: str | Path, data: Any) -> Any:
    target = get_data_path(path)
    json_text = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)
    tmp_path = target.with_suffix(target.suffix + ".tmp")

    with _file_lock(target):
        target.parent.mkdir(parents=True, exist_ok=True)
        with tmp_path.open("w", encoding="utf-8") as tmp_file:
            tmp_file.write(json_text)
            tmp_file.write("\n")
        tmp_path.replace(target)

        mtime = target.stat().st_mtime
        with _cache_guard:
            _json_cache[target] = (mtime, _clone(data))

    relative_path = relative_data_path(target)
    if relative_path is not None and refresh_data_dir() != LOCAL_DATA_DIR:
        fallback_target = LOCAL_DATA_DIR / relative_path
        fallback_target.parent.mkdir(parents=True, exist_ok=True)
        fallback_tmp = fallback_target.with_suffix(fallback_target.suffix + ".tmp")
        with fallback_tmp.open("w", encoding="utf-8") as tmp_file:
            tmp_file.write(json_text)
            tmp_file.write("\n")
        fallback_tmp.replace(fallback_target)
    return data


def create_if_missing(path: str | Path, default_data: Any) -> Any:
    target = get_data_path(path)
    if not target.exists() or target.stat().st_size == 0:
        return save_json(target, _clone(default_data))
    return load_json(target, default_data)


def append_json(path: str | Path, item: Any) -> list[Any]:
    items = load_json(path, [])
    if not isinstance(items, list):
        items = []
    items.append(item)
    save_json(path, items)
    return items


def delete_item(path: str | Path, item_id: str) -> bool:
    items = load_json(path, [])
    if not isinstance(items, list):
        return False

    before = len(items)
    items = [item for item in items if not (isinstance(item, dict) and str(item.get("id", "")) == str(item_id))]
    if len(items) == before:
        return False
    save_json(path, items)
    return True


def update_item(path: str | Path, item_id: str, new_data: dict[str, Any]) -> dict[str, Any] | None:
    items = load_json(path, [])
    if not isinstance(items, list):
        return None

    for index, item in enumerate(items):
        if isinstance(item, dict) and str(item.get("id", "")) == str(item_id):
            updated = {**item, **new_data}
            items[index] = updated
            save_json(path, items)
            return updated
    return None


def conversation_path(now: datetime | None = None) -> str:
    current = now or datetime.now()
    return f"conversations/{current:%Y/%m/%d}.json"


def append_conversation(speaker: str, text: str, now: datetime | None = None) -> dict[str, str]:
    current = now or datetime.now()
    item = {
        "time": current.strftime("%H:%M"),
        "speaker": speaker,
        "text": text,
    }
    append_json(conversation_path(current), item)
    return item


def update_emotion_state(changes: dict[str, Any]) -> dict[str, Any]:
    state = load_json("emotions/state.json", DEFAULT_EMOTIONS)
    if not isinstance(state, dict):
        state = _clone(DEFAULT_EMOTIONS)
    state.update(changes)
    save_json("emotions/state.json", state)
    return state


def rotate_log(path: str | Path, max_bytes: int = MAX_LOG_BYTES, keep: int = 5) -> Path:
    target = get_data_path(path)
    if not target.exists() or target.stat().st_size < max_bytes:
        target.touch(exist_ok=True)
        return target

    for index in range(keep - 1, 0, -1):
        old_path = target.with_suffix(target.suffix + f".{index}")
        new_path = target.with_suffix(target.suffix + f".{index + 1}")
        if old_path.exists():
            old_path.replace(new_path)
    target.replace(target.with_suffix(target.suffix + ".1"))
    target.touch()
    return target


def append_log(name: str, message: str) -> None:
    target = rotate_log(f"logs/{name}")
    timestamp = datetime.now().isoformat(timespec="seconds")
    with target.open("a", encoding="utf-8") as log_file:
        log_file.write(f"{timestamp} {message}\n")


def cleanup_cache(max_age_seconds: int = MAX_CACHE_AGE_SECONDS) -> None:
    cutoff = time.time() - max_age_seconds
    cache_root = refresh_data_dir() / "cache"
    if not cache_root.exists():
        return

    for path in cache_root.rglob("*"):
        if path.is_file() and path.suffix not in {".json", ".lock"}:
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
            except OSError:
                pass


def backup_database(backup_date: datetime | None = None) -> Path:
    initialize_database()
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    current = backup_date or datetime.now()
    backup_path = BACKUP_DIR / f"{current:%Y-%m-%d}.zip"
    active_dir = refresh_data_dir()

    with _backup_guard:
        with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file_path in active_dir.rglob("*"):
                if file_path.is_file() and not file_path.name.endswith(".lock"):
                    archive.write(file_path, file_path.relative_to(active_dir))
        prune_backups()
    return backup_path


def restore_database(backup_path: str | Path) -> Path:
    archive_path = Path(backup_path)
    if not archive_path.exists():
        raise FileNotFoundError(str(archive_path))

    with _backup_guard:
        active_dir = refresh_data_dir()
        if active_dir.exists():
            shutil.rmtree(active_dir)
        active_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive_path, "r") as archive:
            archive.extractall(active_dir)
        with _cache_guard:
            _json_cache.clear()
    initialize_database()
    return refresh_data_dir()


def prune_backups(max_backups: int = MAX_BACKUPS) -> None:
    if not BACKUP_DIR.exists():
        return
    backups = sorted(BACKUP_DIR.glob("*.zip"), key=lambda path: path.stat().st_mtime, reverse=True)
    for backup in backups[max_backups:]:
        try:
            backup.unlink()
        except OSError:
            pass


def storage_status() -> dict[str, Any]:
    """Report which storage root is active for dashboard health checks."""
    active = refresh_data_dir()
    return {
        "active_data_dir": str(active),
        "fallback_data_dir": str(LOCAL_DATA_DIR),
        "sdcard_data_dir": str(SD_DATA_DIR) if SD_DATA_DIR else "",
        "sdcard_configured": bool(SD_DATA_DIR),
        "sdcard_active": bool(SD_DATA_DIR and active == SD_DATA_DIR),
        "fallback_active": active == LOCAL_DATA_DIR,
    }


def copy_tree(source: Path, destination: Path, overwrite: bool = True) -> int:
    """Copy non-lock files between storage roots and return the copied count."""
    if not source.exists():
        return 0
    copied = 0
    for source_path in source.rglob("*"):
        if not source_path.is_file() or source_path.name.endswith(".lock"):
            continue
        relative_path = source_path.relative_to(source)
        destination_path = destination / relative_path
        if destination_path.exists() and not overwrite:
            continue
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination_path)
        copied += 1
    with _cache_guard:
        _json_cache.clear()
    return copied


def sync_local_to_sd(overwrite: bool = True) -> dict[str, Any]:
    """Copy server fallback data onto the configured SD card storage root."""
    if not SD_DATA_DIR:
        raise RuntimeError("LULU_SDCARD_DIR is not configured")
    SD_DATA_DIR.mkdir(parents=True, exist_ok=True)
    copied = copy_tree(LOCAL_DATA_DIR, SD_DATA_DIR, overwrite=overwrite)
    refresh_data_dir()
    initialize_database()
    return {**storage_status(), "copied_files": copied, "direction": "local_to_sd"}


def sync_sd_to_local(overwrite: bool = True) -> dict[str, Any]:
    """Copy SD card data back into the local server fallback data root."""
    if not SD_DATA_DIR or not SD_DATA_DIR.exists():
        raise RuntimeError("Mounted SD card data directory is not available")
    copied = copy_tree(SD_DATA_DIR, LOCAL_DATA_DIR, overwrite=overwrite)
    refresh_data_dir()
    initialize_database()
    return {**storage_status(), "copied_files": copied, "direction": "sd_to_local"}


def safe_storage_path(relative_path: str | Path = "") -> Path:
    """Resolve a dashboard storage path without allowing directory traversal."""
    root = refresh_data_dir().resolve()
    raw_path = Path(relative_path or ".")
    if raw_path.is_absolute():
        raise ValueError("Storage paths must be relative")
    target = (root / raw_path).resolve()
    if target != root and root not in target.parents:
        raise ValueError("Storage path escapes the active data directory")
    return target


def display_relative_path(path: Path) -> str:
    """Format a filesystem path as a dashboard-safe relative path."""
    try:
        return str(path.resolve().relative_to(refresh_data_dir().resolve())).replace("\\", "/")
    except ValueError:
        return ""


def list_files(relative_path: str | Path = "") -> dict[str, Any]:
    """List files and folders from the active storage root for the dashboard."""
    root = refresh_data_dir().resolve()
    target = safe_storage_path(relative_path)
    if not target.exists():
        raise FileNotFoundError(display_relative_path(target))
    if not target.is_dir():
        raise NotADirectoryError(display_relative_path(target))

    items = []
    for child in sorted(target.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
        try:
            stat = child.stat()
        except OSError:
            continue
        relative = str(child.relative_to(root)).replace("\\", "/")
        items.append(
            {
                "name": child.name,
                "path": relative,
                "type": "directory" if child.is_dir() else "file",
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
                "editable": child.is_file() and not child.name.endswith(".lock"),
            }
        )
    return {"path": display_relative_path(target), "items": items, **storage_status()}


def read_file(relative_path: str | Path) -> dict[str, Any]:
    """Read one text file from active storage, keeping binary files read-only."""
    target = safe_storage_path(relative_path)
    if not target.exists():
        raise FileNotFoundError(display_relative_path(target))
    if not target.is_file():
        raise IsADirectoryError(display_relative_path(target))
    if target.name.endswith(".lock"):
        raise PermissionError("Lock files are not editable")

    raw = target.read_bytes()
    try:
        content = raw.decode("utf-8")
        encoding = "utf-8"
    except UnicodeDecodeError:
        content = ""
        encoding = "binary"

    return {
        "path": display_relative_path(target),
        "name": target.name,
        "size": len(raw),
        "encoding": encoding,
        "content": content,
        "editable": encoding == "utf-8",
        **storage_status(),
    }


def write_file(relative_path: str | Path, content: str) -> dict[str, Any]:
    """Write a dashboard-edited text file and mirror it to fallback when SD is active."""
    target = safe_storage_path(relative_path)
    if target.name.endswith(".lock"):
        raise PermissionError("Lock files are not editable")
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.suffix.lower() == ".json":
        try:
            data = json.loads(content or "null")
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON: {exc}") from exc
        save_json(target, data)
    else:
        target.write_text(content, encoding="utf-8")

    if refresh_data_dir() != LOCAL_DATA_DIR:
        relative_path_obj = relative_data_path(target)
        if relative_path_obj is not None:
            fallback_target = LOCAL_DATA_DIR / relative_path_obj
            fallback_target.parent.mkdir(parents=True, exist_ok=True)
            fallback_target.write_text(content, encoding="utf-8")
    return read_file(relative_path)


def write_binary_file(relative_path: str | Path, source) -> dict[str, Any]:
    """Write a dashboard-uploaded binary file into active storage and mirror to fallback."""
    target = safe_storage_path(relative_path)
    if target.name.endswith(".lock"):
        raise PermissionError("Lock files are not editable")
    target.parent.mkdir(parents=True, exist_ok=True)

    with _file_lock(target):
        with target.open("wb") as output_file:
            shutil.copyfileobj(source, output_file)

    if refresh_data_dir() != LOCAL_DATA_DIR:
        relative_path_obj = relative_data_path(target)
        if relative_path_obj is not None:
            fallback_target = LOCAL_DATA_DIR / relative_path_obj
            fallback_target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, fallback_target)

    with _cache_guard:
        _json_cache.clear()
    stat = target.stat()
    return {
        "path": display_relative_path(target),
        "name": target.name,
        "size": stat.st_size,
        "encoding": "binary",
        "editable": False,
        **storage_status(),
    }


def delete_file(relative_path: str | Path) -> dict[str, Any]:
    """Delete a dashboard-selected file or empty folder from active storage."""
    target = safe_storage_path(relative_path)
    if not target.exists():
        raise FileNotFoundError(display_relative_path(target))
    if target.name.endswith(".lock"):
        raise PermissionError("Lock files are not editable")
    if target.is_dir():
        if any(target.iterdir()):
            raise OSError("Directory is not empty")
        target.rmdir()
    else:
        target.unlink()

    if refresh_data_dir() != LOCAL_DATA_DIR:
        relative_path_obj = relative_data_path(target)
        if relative_path_obj is not None:
            fallback_target = LOCAL_DATA_DIR / relative_path_obj
            if fallback_target.exists():
                if fallback_target.is_dir():
                    fallback_target.rmdir()
                else:
                    fallback_target.unlink()
    with _cache_guard:
        _json_cache.clear()
    return {"deleted": True, "path": str(relative_path).replace("\\", "/"), **storage_status()}


def make_directory(relative_path: str | Path) -> dict[str, Any]:
    """Create a dashboard-requested folder in active storage and fallback."""
    target = safe_storage_path(relative_path)
    target.mkdir(parents=True, exist_ok=True)
    if refresh_data_dir() != LOCAL_DATA_DIR:
        relative_path_obj = relative_data_path(target)
        if relative_path_obj is not None:
            (LOCAL_DATA_DIR / relative_path_obj).mkdir(parents=True, exist_ok=True)
    return {"created": True, "path": display_relative_path(target), **storage_status()}


def run_midnight_backup_check() -> None:
    global _last_backup_date
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    if _last_backup_date == today or now.hour != 0:
        return

    backup_path = BACKUP_DIR / f"{today}.zip"
    if not backup_path.exists():
        backup_database(now)
        _last_backup_date = today


def start_backup_scheduler() -> None:
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True

    def worker() -> None:
        while True:
            try:
                run_midnight_backup_check()
                cleanup_cache()
            except Exception:
                pass
            time.sleep(60)

    thread = threading.Thread(target=worker, name="lulu-storage-maintenance", daemon=True)
    thread.start()


def initialize_database() -> None:
    active_dir = refresh_data_dir()
    active_dir.mkdir(parents=True, exist_ok=True)
    LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    for root in {active_dir, LOCAL_DATA_DIR}:
        for folder in REQUIRED_FOLDERS:
            (root / folder).mkdir(parents=True, exist_ok=True)

    for path, default in DEFAULT_FILES:
        create_if_missing(path, default)
        if active_dir != LOCAL_DATA_DIR:
            create_if_missing(LOCAL_DATA_DIR / path, default)

    for log_name in ("server.log", "errors.log", "activity.log"):
        rotate_log(f"logs/{log_name}")


def seconds_until_midnight() -> float:
    now = datetime.now()
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(0.0, (tomorrow - now).total_seconds())
