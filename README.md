# LULU Local Voice Server

This version moves speech-to-text and speech playback generation off the ESP32. The teddy's name is LULU, and Jeremiah is the owner/user in the default local replies.

Flow:

1. ESP32-S3 records WAV audio from the INMP441 microphone.
2. ESP32 posts the WAV to `http://<SERVER_IP>:8000/chat`.
3. `server.py` transcribes locally with Faster-Whisper.
4. If the child asks about weather, `server.py` checks Open-Meteo for Lagos weather.
5. If the child asks for a Bible verse or chapter, `server.py` checks bible-api.com.
6. If a full Bible chapter is installed on SD, the ESP32 plays the local MP3 from `/lulu/bible`.
7. Otherwise, `server.py` answers from local Q&A and a local fallback. OpenAI is disabled by default for local testing.
8. Piper creates `audio/reply.wav` for normal TTS responses.
9. ESP32 plays the response through the speaker output.

## Files

- `server.py` - FastAPI server for local STT, intent handling, local replies, and Piper TTS.
- `requirements.txt` - Python dependencies.
- `teddy_openai_voice_bot/teddy_openai_voice_bot.ino` - ESP32 firmware.
- `teddy_openai_voice_bot/arduino_secrets.h.example` - WiFi and server configuration template.
- `local_qa.txt` - Local question/answer pairs. Copy this to the ESP32 SD card as `/local_qa.txt` if you want the board to send its own Q&A set with each recording.

## Installation

Use Python 3.10, 3.11, or 3.12. Python 3.13/3.14 may not have wheels for every speech dependency yet.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

OpenAI is not required for local testing. Leave it off while you build the local radio, weather, Bible, and Q&A flow.

```powershell
python server.py
```

## Offline Bible Audio

Bible chapter audio is installed on the ESP32 SD card and played locally as MP3. Railway is not responsible for Bible audio playback.

Prepare a Faith Comes By Hearing Bible MP3 ZIP for the SD card with:

```powershell
python tools/import_bible.py C:\path\to\bible.zip C:\path\to\sd\lulu\bible
```

The ESP32 expects:

```text
/lulu/bible/index.json
/lulu/bible/<translation>/<BOOK>/<CHAPTER>.mp3
```

See `docs/BIBLE_OFFLINE.md` for import, validation, troubleshooting, and licensing notes.

## Whisper Setup

The server uses Faster-Whisper with:

```text
WHISPER_MODEL=base
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_BEAM_SIZE=5
WHISPER_VAD_FILTER=0
```

The first run downloads the Whisper model. Start with the CPU settings first. If your machine has a working NVIDIA CUDA setup, you can switch to:

```powershell
$env:WHISPER_DEVICE="cuda"
$env:WHISPER_COMPUTE_TYPE="float16"
```

For better transcription accuracy, keep `WHISPER_BEAM_SIZE=5`. The server also gives Whisper a short command prompt so it recognizes Bible references, volume commands, radio, music, and weather more reliably. `WHISPER_VAD_FILTER` is off by default because short button recordings can be clipped by VAD; turn it on only if background noise is causing false words.

If transcription is still poor and the computer can handle it, try the larger model:

```powershell
$env:WHISPER_MODEL="small"
python server.py
```

If you want to test imports from PowerShell, run Python with `-c`:

```powershell
python -c "from faster_whisper import WhisperModel; print('faster-whisper OK')"
```

Do not paste `from faster_whisper import WhisperModel` directly into PowerShell; that line only works inside Python.

## Piper Setup

`server.py` calls Piper as an external command-line program. Do not install `piper-tts` with pip for this project; on Windows it can fail while looking for `piper-phonemize`.

The project is set up to use the local Piper executable at:

```text
tools/piper/piper.exe
```

Download a Piper English voice model into:

```text
voices/en_US-amy-medium.onnx
voices/en_US-amy-medium.onnx.json
```

The older fallback voice also works:

```text
voices/en_US-lessac-medium.onnx
voices/en_US-lessac-medium.onnx.json
```
Downloaded/extracted Piper to:
tools/piper/piper.exe
Updated server.py (line 25) so it uses that local Piper executable automatically.
Tested Piper successfully: it created audio/test_piper.wav.
Next, run the server from this project folder:



The default voice path is `voices/en_US-amy-medium.onnx` when both the `.onnx` and `.onnx.json` files are present. This is the softer, friendlier LULU voice.

If Amy is missing, the server safely falls back to `voices/en_US-lessac-medium.onnx`. To force a specific voice:

```powershell
$env:PIPER_VOICE_MODEL="$PWD\voices\en_US-amy-medium.onnx"
python server.py
```

To use a different realistic English voice:

```powershell
$env:PIPER_VOICE_MODEL="C:\path\to\voice.onnx"
```

Optional warm/friendly tuning:

```powershell
$env:PIPER_LENGTH_SCALE="1.08"
$env:PIPER_NOISE_SCALE="0.55"
$env:PIPER_NOISE_W="0.65"
python server.py
```

Higher `PIPER_LENGTH_SCALE` speaks a little slower. Lower noise values usually sound steadier and warmer. The server now applies mild friendly defaults automatically: `PIPER_LENGTH_SCALE=1.06`, `PIPER_NOISE_SCALE=0.55`, and `PIPER_NOISE_W=0.65`.

If you want to use a different Piper executable, point the server to it:

```powershell
$env:PIPER_BIN="C:\path\to\piper.exe"
```

## Running Server

Start the server:

```powershell
python server.py
```

Or:

```powershell
uvicorn server:app --host 0.0.0.0 --port 8000
```

Find your computer IP address on the same WiFi network:

```powershell
ipconfig
```

Open this from another device on the same network:

```text
http://<SERVER_IP>:8000/health
```

## Dashboard Remote Control

The dashboard lives in `lulu-dashboard` and runs separately from the LULU server:

```powershell
cd lulu-dashboard
npm start
```

Open:

```text
http://localhost:3000
```

The dashboard health check runs once when the browser page loads or refreshes. It does not continuously poll `/health`.

The Devices page can remotely queue simple LULU commands:

```text
speak
radio
stop
ready
```

Server routes:

```text
POST /remote/command
GET /remote/next?device_id=esp32-lulu
GET /remote/status
```

To make the physical ESP32 respond to dashboard commands, upload the updated `teddy_openai_voice_bot.ino`. The firmware checks `/remote/next` while idle, so normal TALK button conversations continue working.

## Local Q&A

Local Q&A is checked before weather, Bible, radio fallback, or optional OpenAI. The format is:

```text
question|answer
```

The server reads `local_qa.txt` from this project folder. The ESP32 also reads `/local_qa.txt` from the SD card and sends it with each recording, so you can update simple answers on the card without changing the sketch.

Starter questions include:

```text
Who are you?
What is your name?
Who made you?
What can you do?
Tell me a joke.
```

## Local Stories

Story requests are handled from `stories.txt` in this project folder. The recommended format is one story per line:

```text
Story title|Story text
```

LULU picks a random story and avoids reading the same story text twice in a row. Supported prompts include:

```text
Tell me a story.
Read a bedtime story.
LULU, story time.
Can you tell stories?
```

Set `STORY_PATH` to use another story file, or `STORY_MAX_BYTES` to change how much of the file is read.

## Weather Replies

Weather questions are handled by the Python server locally. The default weather endpoint is for Lagos:

```text
https://api.open-meteo.com/v1/forecast?latitude=6.52&longitude=3.37&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m
```

To change the spoken location name or API URL:

```powershell
$env:WEATHER_LOCATION_NAME="Lagos"
$env:WEATHER_API_URL="https://api.open-meteo.com/v1/forecast?latitude=6.52&longitude=3.37&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m"
python server.py
```

Ask teddy things like:

```text
What is the weather?
How hot is it today?
What is the temperature outside?
Is it raining?
Do I need an umbrella?
```

## Optional OpenAI

OpenAI is disabled by default. To turn it back on later for general chat, install the package and set the opt-in environment variables:

```powershell
pip install openai==1.59.6
$env:TEDDY_USE_OPENAI="1"
$env:OPENAI_API_KEY="your-openai-api-key"
python server.py
```

Useful optional settings:

```powershell
$env:OPENAI_MAX_TOKENS="60"
$env:OPENAI_CACHE_SECONDS="3600"
$env:OPENAI_DUPLICATE_WINDOW_SECONDS="60"
$env:MAX_TRANSCRIPTION_CHARS="180"
python server.py
```

The server logs OpenAI token usage whenever it actually calls the model. If you are testing the same phrase repeatedly, the cached reply is reused.

## Bible Replies

Bible questions are handled by the Python server locally. The default API is:

```text
https://bible-api.com
```

The default translation is King James Version:

```powershell
$env:BIBLE_TRANSLATION="kjv"
python server.py
```

Ask teddy things like:

```text
Read John 3:16.
Read John chapter 3 verse 16.
Read John chapter 3 and verse 16.
Read John chapter 3, verse 16.
Look up John 3 16.
Turn to Psalm 23.
Open Psalm chapter 23 verse 1.
Read Psalm 23.
Read Matthew chapter 5 verses 1 to 12.
Read Matthew 5 verses 1 through 12.
Read First John chapter 4 verse 8.
Read 1st John 4:8.
Please read Romans chapter 8 verse 28.
Read me a Bible verse.
```

For exact readings, say the book, chapter, and verse together. LULU now understands common voice forms like `chapter 3 and verse 16`, `chapter 3, verse 16`, `John 3 16`, and `verses 1 through 12`.

For long chapters, Piper may need more time to create the audio. You can increase the timeout:

```powershell
$env:BIBLE_TIMEOUT_SECONDS="20"
$env:BIBLE_RETRIES="3"
$env:PIPER_TIMEOUT_SECONDS="300"
python server.py
```

## ESP32 Configuration

Copy the example secrets file:

```text
teddy_openai_voice_bot/arduino_secrets.h.example
```

to:

```text
teddy_openai_voice_bot/arduino_secrets.h
```

Set:

```cpp
#define WIFI_SSID "Your WiFi name"
#define WIFI_PASSWORD "Your WiFi password"
#define CHAT_SERVER_HOST "192.168.1.100"
#define CHAT_SERVER_PORT 8000
```

Upload `teddy_openai_voice_bot.ino` to the ESP32-S3 N16R8.

For the smart listening buffer, use PSRAM only if your exact ESP32-S3 board really has it. If Serial Monitor shows `quad_psram: PSRAM chip is not connected, or wrong PSRAM line mode`, the selected board/PSRAM mode is wrong for your hardware.

```text
Tools > PSRAM > Disabled
```

If your board does have PSRAM, select the correct mode for that board, often:

```text
Tools > PSRAM > OPI PSRAM
```

If PSRAM is not available, the sketch uses a smaller recording buffer. The active config uses 5 seconds max with a 2-second fallback to avoid RAM pressure.

You can override these in `arduino_secrets.h` before including the sketch defaults:

```cpp
#define RECORD_MAX_SECONDS 5
#define RECORD_MIN_BUFFER_SECONDS 2
#define AUTO_FOLLOWUP_ENABLED 0
```

For the INMP441 microphone, the active config uses more sensitive speech detection:

```cpp
#define RECORD_START_TIMEOUT_MS 5000
#define RECORD_END_SILENCE_MS 1800
#define RECORD_MIN_CLEAR_SPEECH_MS 300
#define MIC_GAIN_SHIFT 3
#define MIC_SPEECH_PEAK_THRESHOLD 550
#define MIC_SPEECH_AVG_THRESHOLD 12
```

If Serial Monitor shows very high peaks all the time or audio sounds distorted, reduce `MIC_GAIN_SHIFT` back to `2`.

## Audio Crash Diagnostics

During playback the firmware prints checkpoints like:

```text
[AUDIO] STEP 1 HTTP BEGIN
[AUDIO] STEP 2 HTTP GET
[AUDIO] STEP 3 STREAM OPEN
[AUDIO] STEP 4 WAV HEADER
[AUDIO] STEP 5 I2S INIT
[AUDIO] STEP 6 DMA START
[AUDIO] STEP 7 PLAYBACK
```

Each checkpoint also prints free heap, largest free block, free PSRAM, and stack high-water mark. If the board resets after `Audio URL:` but before `STEP 1`, the fault is before HTTP playback starts, usually stack/heap corruption from the previous request path. If it reaches `STEP 5` or `STEP 6`, inspect the I2S/MAX98357A wiring, sample rate, DMA logs, and power supply.

For ESP32-S3 N16R8, use the PSRAM mode that matches the actual board. A `quad_psram` boot error usually means the IDE selected Quad PSRAM while the board expects OPI PSRAM, or PSRAM should be disabled for that board profile.

Touch sensor wiring, for the pictured TTP223-style module:

```text
TTP223 VCC -> ESP32 3V3
TTP223 GND -> ESP32 GND
TTP223 OUT -> ESP32 GPIO 7
```

With the component side facing you and the 3-pin header on the right, follow the printed labels on your board. In the photo, `OUT` is the top labelled pin and `VCC` is the bottom labelled pin; the remaining middle pin is `GND`. The firmware expects the normal TTP223 mode: LOW when idle, HIGH when touched.

DHT room sensor wiring, for the pictured blue 4-pin DHT11-style sensor:

```text
DHT pin 1 VCC  -> ESP32 3V3
DHT pin 2 DATA -> ESP32 GPIO 16
DHT pin 3 NC   -> not connected
DHT pin 4 GND  -> ESP32 GND
```

Important orientation: hold the blue vented face toward you with the pins pointing downward. Left to right is `VCC`, `DATA`, `NC`, `GND`. Add a 10k resistor between `VCC` and `DATA` if your DHT sensor is the bare 4-pin part; many breakout modules already include that resistor.

Optional climate/touch tuning:

```cpp
#define TOUCH_ACTIVE_LEVEL HIGH
#define DHT_ENABLED 1
#define DHT_PIN 16
#define DHT_SENSOR_TYPE 11
#define DHT_RETRY_INTERVAL_MS 5000
#define ROOM_TEMP_HOT_C 30.0f
#define ROOM_TEMP_COLD_C 18.0f
```

If Serial Monitor repeatedly prints `DHT read failed`, set `DHT_ENABLED 0` until the wiring, pull-up resistor, and sensor type are confirmed. The active local config currently keeps DHT disabled because your serial log shows repeated failures.

Button behavior:

- Release GPIO7 during boot.
- Short touch GPIO7 to record and speak.
- Hold the touch sensor for 2.5 seconds to enter deep sleep.
- Touch GPIO7 again to wake from deep sleep. The ESP32 boots again after waking.
- Say `stop` during a listening window to end the conversation.
- Press TALK while teddy is speaking to stop playback immediately.
- After teddy finishes speaking, it returns to `Ready` by default. Press TALK again for the next question.
- To restore automatic follow-up listening, set `AUTO_FOLLOWUP_ENABLED` to `1`.
- Listening waits up to 3.5 seconds for speech to start, then stops 1.2 seconds after speech ends.
- Quiet background noise is rejected and not sent to the server.
- OLED states are `Listening...`, `Sending...`, `Thinking...`, `Speaking...`, and `Ready`.
- The DHT sensor is checked every 60 seconds. If the room is above `ROOM_TEMP_HOT_C`, LULU says, "Oh, I am feeling very hot. Please check the temperature." If it is below `ROOM_TEMP_COLD_C`, LULU asks you to warm the room.
- Ask things like `What is the room temperature?` or `What is the humidity in here?` to hear the DHT reading.

## Internet Radio

Radio requests are handled by the Python server locally. LULU uses Radio Browser to find a Nigerian online station, then uses `ffmpeg` to transcode the stream to raw 16-bit PCM so the ESP32 can keep playing without parsing a live WAV header.

Install `ffmpeg` on the computer running `server.py`, then make sure this command works:

```powershell
ffmpeg -version
```

If FFmpeg was installed by Winget but is not on PATH yet, `server.py` also checks the standard Winget install folder automatically.

Ask teddy:

```text
Play me a radio station in Nigeria.
Play Nigerian radio.
Start FM.
Tune in to Lagos radio.
Play music from my SD card.
Change channel.
Next station.
Scan radio.
Find local radio.
```

Press TALK while radio is playing to stop the stream.

LULU scans online radio stations near the configured country/city, not real over-the-air FM. To scan physical FM stations around you, add an FM tuner module such as an RDA5807M or TEA5767 and wire it to the ESP32 over I2C.

Radio is streamed to the ESP32 as raw 22050 Hz mono 16-bit PCM so it keeps playing until you press TALK, the station disconnects, or the network drops. The older `/radio/nigeria.wav` route remains available as a short WAV clip fallback:

```powershell
$env:RADIO_LIVE_STREAM="0"
$env:RADIO_CLIP_SECONDS="18"
python server.py
```

To force the ESP32 to stop live radio after a fixed time, define `RADIO_MAX_PLAY_MS` in `arduino_secrets.h`. The default `0` means no timer-based stop.

If the ESP32 shows `Unsupported WAV` for radio, it is still running old firmware or still requesting `/radio/nigeria.wav`. Upload the latest sketch so radio uses `/radio/nigeria.pcm`.

## Power-On Sound

The ESP32 plays a short local chime during the animated Netrue startup display. This sound is generated in firmware, so it works without WiFi and without an SD card.

## SD Card Music

Put music files on the SD card in:

```text
/Music
```

The firmware currently plays normal `.wav` files only: PCM, 16-bit, mono or stereo. Say:

```text
Play me music.
Play me a song.
Play music from my SD card.
```

Each request plays the next supported WAV file in the folder. Press TALK while music is playing to stop it.

## Voice Volume

Say:

```text
Increase volume.
Reduce volume.
Turn volume up.
Turn volume down.
Make it louder.
Make it quieter.
Less volume.
```

The firmware now starts at 80 percent, changes playback volume in 20 percent steps, and caps normal volume at 100 percent. After each command, LULU speaks the new level, for example: `Volume reduced to 60 percent.`

If the ESP32 reboots during the volume confirmation, temporarily disable spoken confirmation in `arduino_secrets.h`:

```cpp
#define SPEAK_VOLUME_CONFIRMATION 0
```

The animated speaking face is enabled only while LULU is speaking WAV replies or volume confirmations. It is throttled with `SPEAKING_FACE_INTERVAL_MS` so OLED updates do not fight the I2S audio path.

```cpp
#define SPEAKING_FACE_ENABLED 1
#define SPEAKING_FACE_INTERVAL_MS 320
```

If reboot/brownout symptoms ever return, disable the face first:

```cpp
#define SPEAKING_FACE_ENABLED 0
```

## Reminders And Daily Planning

Reminders are implemented as an isolated firmware module:

```text
teddy_openai_voice_bot/ReminderManager.h
teddy_openai_voice_bot/ReminderManager.cpp
```

The module uses the DS3231 RTC as the primary clock and stores reminders on the SD card:

```text
/reminders.json
```

Voice examples:

```text
LULU remind me to pray in 5 minutes.
Please remind me to drink water in 10 minutes.
Set a reminder to take medicine in 30 minutes.
Create a reminder to call mum in 1 hour.
LULU remind me to take medicine in 30 minutes.
LULU remind me tomorrow at 7 AM to attend church.
LULU remind me at 8 PM to drink water.
LULU what is the time?
LULU what's the time?
LULU what are my reminders.
Please check what reminders I have.
List my reminders.
Do I have reminders?
LULU delete reminder number 2.
Cancel reminder number two.
LULU clear all reminders.
Delete all reminders.
```

DS3231 wiring, sharing the existing OLED I2C bus:

```text
DS3231 VCC -> 3V3
DS3231 GND -> ESP32 GND
DS3231 SDA -> ESP32 GPIO 17
DS3231 SCL -> ESP32 GPIO 18
```

Required Arduino libraries:

```text
RTClib by Adafruit
ArduinoJson
U8g2
SD
WiFi
```

Startup behavior:

- Initializes the DS3231 on the same `Wire` bus as the OLED.
- Loads `/reminders.json` from SD.
- If WiFi is connected, syncs the DS3231 from NTP once.
- Reminders continue to work without internet as long as the RTC time is valid.

Debug logs include:

```text
[RTC] Initialized
[RTC] Time synced
[REMINDER] Loaded
[REMINDER] Saved
[REMINDER] Triggered
```

The reminder task is lightweight. It only requests a check once per second; RTC reads, OLED updates, and Piper speech playback stay on the main firmware path to protect the existing audio and I2C behavior.

To tune the online station search:

```powershell
$env:RADIO_COUNTRY="Nigeria"
$env:RADIO_COUNTRY_CODE="NG"
$env:RADIO_CITY="Lagos"
$env:RADIO_MAX_SCANNED_STATIONS="8"
python server.py
```

If the ESP32 shows `Radio failed`, restart `server.py` and watch the server log for the selected station. If it shows `Unsupported WAV`, the board is still using the old WAV radio route; upload the latest firmware.

If `ffmpeg` is installed somewhere custom:

```powershell
$env:FFMPEG_BIN="C:\path\to\ffmpeg.exe"
python server.py
```

## Speaker Output

The default firmware uses PWM on `AUDIO_PIN` because PAM8403 is an analog amplifier.

If you add a real I2S DAC/amplifier, uncomment this in `arduino_secrets.h`:

```cpp
#define AUDIO_OUTPUT_MODE AUDIO_OUTPUT_I2S
```

The default I2S gain is intentionally conservative:

```cpp
#define AUDIO_PLAYBACK_GAIN 1
```

Then update these sketch pins if needed:

```cpp
#define SPK_I2S_BCLK 8
#define SPK_I2S_LRC 9
#define SPK_I2S_DOUT 14
```

MAX98357A wiring:

```text
MAX98357A VIN  -> 5V external supply or ESP32 5V
MAX98357A GND  -> ESP32 GND and power-supply GND
MAX98357A BCLK -> ESP32 GPIO 8
MAX98357A LRC  -> ESP32 GPIO 9
MAX98357A DIN  -> ESP32 GPIO 14
MAX98357A SD   -> leave open first, or pull to 3V3 if the board stays muted
MAX98357A GAIN -> leave open first
Speaker +      -> MAX98357A speaker +
Speaker -      -> MAX98357A speaker -
```

Do not connect speaker `-` to ESP32 `GND`.

## Testing The API Manually

Use any small WAV file:

```powershell
curl -F "file=@test.wav;type=audio/wav" http://<SERVER_IP>:8000/chat
```

Expected response:

```json
{
  "transcription": "hello teddy",
  "text": "Hello! I am right here with you.",
  "audio_url": "http://<SERVER_IP>:8000/audio/reply.wav"
}
```

## Troubleshooting

`ESP32 shows Server offline`

- Confirm `python server.py` is running.
- Confirm ESP32 and computer are on the same WiFi.
- Check `CHAT_SERVER_HOST`.
- Allow Python through Windows Firewall for private networks.

`Piper voice model not found`

- Put `en_US-lessac-medium.onnx` and its `.json` file in the `voices` folder.
- Or set `PIPER_VOICE_MODEL`.

`No matching distribution found for piper-phonemize`

- Remove `piper-tts` from `requirements.txt`.
- Re-run `pip install -r requirements.txt`.
- Use the standalone Piper executable instead of the pip package.

`Local fallback answer`

- OpenAI is disabled by default, so unknown general chat gets a short local fallback.
- Add more entries to `local_qa.txt` for local answers.
- To restore OpenAI later, install `openai`, set `TEDDY_USE_OPENAI=1`, set `OPENAI_API_KEY`, and restart the server.

`Mic too quiet`

- Check INMP441 `WS`, `SCK`, and `SD` wiring.
- Tie the INMP441 `L/R` or `SEL` pin to GND for left channel.
- Speak closer to the microphone.

`Memory low` or `Need PSRAM/free heap`

- If Serial Monitor shows `quad_psram`, disable PSRAM or choose the correct PSRAM mode for your exact board, then upload again.
- Keep `RECORD_MAX_SECONDS` at `5` when PSRAM is unavailable.
- Close Serial Plotter or other tools that may be holding the board, then reset and upload.
- If it still happens, reduce `RECORD_MAX_SECONDS` in `arduino_secrets.h`, for example to `5`.

`Touch active`

- Release the touch pad.
- If it stays on that screen, the TTP223 `OUT` pin is stuck HIGH, the module is wired to the wrong pin, or `TOUCH_ACTIVE_LEVEL` does not match your module mode.

`I cannot read the room sensor yet`

- Confirm the DHT data pin is on ESP32 `GPIO16`.
- Confirm DHT orientation. With the blue vented face toward you and pins downward, left to right is `VCC`, `DATA`, `NC`, `GND`. If you hold it with pins upward, that order is reversed.
- Add a 10k pull-up resistor between DHT `VCC` and `DATA` if you are using the bare 4-pin DHT sensor.
- Use `3V3`, not `5V`, unless your exact DHT breakout is designed for 5V logic.
- Open Serial Monitor at `115200`. A good read logs `Room climate: ...`; a bad read logs `DHT read failed`.
- If you have DHT22/AM2302 instead of DHT11, set `#define DHT_SENSOR_TYPE 22` in `arduino_secrets.h`.

`Audio downloads but sounds wrong`

- Piper must output normal 16-bit PCM WAV.
- For PAM8403, keep the default PWM mode and use a simple RC low-pass filter if audio is noisy.
- For I2S mode, use an actual I2S DAC/amplifier between ESP32 and speaker.

`ESP32 reboots when audio starts or stops`

- This is usually a hardware power issue, not a Python/server software issue, if `server.py` stays running and only the ESP32 resets when speech starts, gets loud, or stops.
- Open Serial Monitor at `115200`. If you see brownout/reset messages, the amplifier or speaker is pulling the supply voltage down.
- Use a stronger 5V supply for the amplifier, ideally separate from the ESP32 USB supply.
- Connect the external supply `GND`, ESP32 `GND`, and MAX98357A `GND` together.
- Add a 470uF to 1000uF electrolytic capacitor across amplifier `VIN` and `GND`, close to the amplifier.
- Keep `AUDIO_PLAYBACK_GAIN` at `1` first.
- Keep `DEFAULT_PLAYBACK_VOLUME` at `80`, `MAX_PLAYBACK_VOLUME` at `100`, and `PLAYBACK_SAMPLE_LIMIT` at `24576` until the hardware is stable.
- Leave `GAIN` unconnected first. If it is too loud or unstable, do not increase gain yet.
- If you are using the PAM8403 analog amplifier, keep speaker wiring isolated from ESP32 `GND`, use the RC filter wiring shown above, and power the amplifier from a supply that can handle speaker current.
#   L U L U  
 
