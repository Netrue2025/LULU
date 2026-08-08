# LULU File Database

LULU now uses a centralized JSON storage layer in `storage.py`. The Python server keeps its public API backward compatible, while persistent state is kept under the active storage root.

By default the active root is local server fallback storage:

```text
LULU_DATA/
```

When the SD card is mounted on the computer running `server.py`, set `LULU_SDCARD_DIR` to that mounted folder before starting the server. LULU will then read and write directly from the SD card, while still mirroring edits into local `LULU_DATA/` as a safe fallback.

```powershell
$env:LULU_SDCARD_DIR = "E:\"
.\.venv\Scripts\python.exe server.py
```

Use the SD card root if you want the dashboard to see everything on the card. Use a subfolder such as `E:\LULU_DATA` if you want only LULU's database files exposed.

## Architecture

```text
ESP32 firmware
  |
  | existing HTTP API
  v
server.py
  |
  | all JSON reads/writes
  v
storage.py
  |
  v
mounted SD card when LULU_SDCARD_DIR is available
  |
  | safe fallback mirror
  v
local LULU_DATA/
  users/ settings/ conversations/ reminders/ medications/
  portuguese/ chinese/ dashboard/ logs/ emotions/ radio/ cache/
  languages/portuguese/
```

## Root Folders

- `users/` stores owner and profile records.
- `settings/` stores voice, volume, wake word, and behavior settings.
- `conversations/` stores chat turns by date, not one huge file.
- `reminders/` stores server-side reminder records for future dashboard use.
- `medications/` stores medicine schedules.
- `portuguese/` stores Portuguese lessons, vocabulary, and progress.
- `chinese/` stores Chinese lessons, vocabulary, and progress.
- `languages/portuguese/` stores the complete Portuguese tutor pack used by the new tutor APIs and dashboard.
- `dashboard/` stores dashboard-visible server state such as remote commands, imported local Q&A, and imported stories.
- `logs/` stores `server.log`, `errors.log`, and `activity.log`.
- `emotions/` stores LULU emotional state.
- `radio/` stores favorite stations and the current scanned station cache.
- `cache/` stores temporary Whisper uploads, TTS audio, and AI response caches.

## Important JSON Files

- `users/default.json`: default owner profile.
- `settings/settings.json`: voice, volume, speech rate, wake word, night mode, and reconnect settings.
- `conversations/YYYY/MM/DD.json`: daily conversation items with `time`, `speaker`, and `text`.
- `reminders/reminders.json`: reminder list.
- `medications/schedule.json`: medicine schedule.
- `portuguese/progress.json`: Portuguese lesson progress.
- `portuguese/lessons/lesson_001.json`: starter Portuguese lesson.
- `portuguese/vocabulary/words.json`: Portuguese vocabulary list.
- `chinese/progress.json`: Chinese lesson progress.
- `chinese/lessons/lesson_001.json`: starter Chinese lesson.
- `chinese/vocabulary/words.json`: Chinese vocabulary list.
- `emotions/state.json`: happy, excited, sleepy, lonely, and last interaction state.
- `radio/favorites.json`: favorite stations.
- `radio/stations_cache.json`: scanned playable stations and selected channel.
- `dashboard/remote_commands.json`: pending and last delivered dashboard command.
- `dashboard/local_qa.json`: JSON copy of legacy `local_qa.txt`.
- `dashboard/stories.json`: JSON copy of legacy `stories.txt`.
- `dashboard/source_meta.json`: legacy import timestamps.
- `cache/reply_cache.json`: recent and OpenAI reply cache.
- `cache/ai/responses.json`: reserved AI response cache.
- `languages/portuguese/lessons.json`: structured beginner-to-intermediate lesson browser.
- `languages/portuguese/vocabulary.json`: several hundred generated and editable Portuguese words and phrases.
- `languages/portuguese/grammar.json`: grammar topics and examples.
- `languages/portuguese/conversations.json`: conversation practice scripts.
- `languages/portuguese/quizzes.json`: quiz bank.
- `languages/portuguese/pronunciation.json`: pronunciation tips.
- `languages/portuguese/progress.json`: level, streak, learned vocabulary, quiz scores, weaknesses, and revision schedule.
- `languages/portuguese/mistakes.json`: saved corrections and difficult answers.

## Storage Helpers

All JSON access should go through `storage.py`.

- `load_json(path, default_data)`: reads JSON safely and returns defaults for missing, empty, or malformed files.
- `save_json(path, data)`: validates JSON by serializing, then atomically writes it.
- `append_json(path, item)`: appends one item to a JSON list.
- `create_if_missing(path, default_data)`: creates a JSON file only when absent or empty.
- `delete_item(path, id)`: deletes a list item by `id`.
- `update_item(path, id, new_data)`: updates a list item by `id`.
- `backup_database()`: compresses `LULU_DATA` to `Backups/YYYY-MM-DD.zip`.
- `restore_database(path)`: restores `LULU_DATA` from a backup zip.
- `append_conversation(speaker, text)`: writes to the current daily conversation file.
- `rotate_log(path)`: rotates large logs.
- `cleanup_cache()`: deletes old temporary non-JSON cache files.

## APIs

Existing endpoints remain backward compatible:

- `POST /chat`: accepts ESP32 WAV upload and returns `transcription`, `text`, `audio_url`, and `action`.
- `GET /speak`: creates speech audio and returns the same audio URL style as before.
- `GET /audio/reply.wav`: still serves LULU speech audio.
- `POST /remote/command`: queues a dashboard command.
- `GET /remote/next`: ESP32 polls this while idle.
- `GET /remote/status`: reports pending and last command.
- Dashboard remote commands now include `listen`, which asks the ESP32 to start one normal listening/conversation turn.
- `GET /radio/nigeria.wav`: serves WAV radio.
- `GET /radio/nigeria.pcm`: serves raw PCM radio.
- `GET /health`: reports server status.

New non-breaking database and storage endpoints:

- `GET /database/status`: lists the storage root, backup root, folders, and JSON files.
- `GET /database/file/{relative_path}`: reads one JSON file from the active storage root.
- `POST /database/backup`: creates a backup zip immediately.
- `GET /database/storage`: reports active, SD, and fallback storage paths.
- `POST /database/sync-to-sd`: copies local fallback data to the configured SD card root.
- `POST /database/sync-from-sd`: copies SD card data back to local fallback storage.
- `GET /database/files?path=...`: lists files and folders from active storage.
- `GET /database/read-file?path=...`: reads one dashboard-selected file.
- `POST /database/write-file`: creates or updates one text or JSON file.
- `POST /database/delete-file`: deletes one file or empty folder.
- `POST /database/create-folder`: creates one folder.

New language endpoints:

- `GET /language/portuguese/lesson`: reads the current Portuguese lesson.
- `POST /language/portuguese/lesson`: saves a Portuguese lesson.
- `GET /language/portuguese/progress`: reads Portuguese progress.
- `POST /language/portuguese/progress`: saves Portuguese progress.
- `GET /language/chinese/lesson`: reads the current Chinese lesson.
- `POST /language/chinese/lesson`: saves a Chinese lesson.
- `GET /language/chinese/progress`: reads Chinese progress.
- `POST /language/chinese/progress`: saves Chinese progress.

New Portuguese tutor endpoints:

- `GET /language/pack`: exports the complete Portuguese tutor pack.
- `POST /language/pack`: imports dashboard-edited Portuguese tutor files.
- `GET /language/lesson`: returns the current Portuguese lesson.
- `GET /language/progress`: returns Portuguese tutor progress.
- `POST /language/progress`: saves Portuguese tutor progress.
- `POST /language/translate`: translates with local SD cache first, then optional OpenAI.
- `POST /language/quiz`: creates a quiz from the offline quiz bank.
- `POST /language/conversation`: continues immersive Portuguese conversation practice.
- `POST /language/check-answer`: checks an answer and stores mistakes.
- `POST /language/pronunciation`: returns saved pronunciation guidance.
- `GET /language/revision`: returns vocabulary scheduled for review.

## Dashboard Storage Page

The LULU dashboard now has a `Storage` page. It can:

- Browse folders and files from the active storage root.
- Create files and folders.
- Edit UTF-8 text and JSON files.
- Keep binary files read-only.
- Delete files and empty folders.
- Sync local fallback data to the SD card.
- Sync SD card data back to local fallback storage.
- Edit starter Portuguese and Chinese lessons.
- Open the dedicated `Portuguese` page for full tutor lessons, vocabulary, progress, quiz history, conversation history, grammar topics, import/export, and manual lesson editing.

For safety, dashboard paths are always resolved inside the active storage root. Directory traversal paths and lock files are rejected.

## Language Lessons

LULU can now answer commands such as:

- `Teach me Portuguese`
- `Teach me Portugeus`
- `Teach me Chinese`
- `Teach me Chinish`
- `Teach me Mandarin`

Lessons are stored in:

- `portuguese/lessons/lesson_001.json`
- `chinese/lessons/lesson_001.json`
- `languages/portuguese/lessons.json` for the full Portuguese tutor.

Progress is stored in:

- `portuguese/progress.json`
- `chinese/progress.json`
- `languages/portuguese/progress.json` for full tutor progress.

## Portuguese Tutor

The complete Portuguese tutor is additive and lives in `portuguese_tutor.py`. It creates and maintains the requested SD-backed files under `languages/portuguese/` in the active storage root. When `LULU_SDCARD_DIR` points to the SD card, these files are created on the SD card. When the SD card is unavailable, the same structure is created under local `LULU_DATA/` and can be synced later.

The tutor classifies requests such as:

- `How do you say thank you?`
- `Translate I need help`
- `What's Portuguese for water?`
- `Give me today's lesson`
- `Quiz me`
- `Test my Portuguese`
- `Explain this grammar`
- `Pronounce this`
- `Give another example`
- `Start a conversation`
- `Correct my answer`
- `Continue my lesson`
- `Review yesterday's lesson`

Translations use this order:

1. Cached result in `languages/portuguese/cache/translations.json`.
2. Offline match from `languages/portuguese/vocabulary.json`.
3. Existing OpenAI model, only when OpenAI is enabled.
4. Local fallback response saved to cache for later editing.

## Backup

`storage.py` starts a lightweight maintenance thread from `server.py`. It checks once per minute, creates a daily backup zip from the active storage root when needed, deletes old cache files, and keeps the latest 30 backups by default.

## Future Expansion

New modules should add their own folder or JSON files under `LULU_DATA` and use `storage.py` only. Good future paths:

- `spanish/`
- `french/`
- `calendar/`
- `weather/`
- `smart_home/`
- `face_recognition/`
- `incubator/`
- `medicine_ai/`
