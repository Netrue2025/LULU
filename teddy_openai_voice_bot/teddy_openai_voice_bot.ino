#include <Arduino.h>
#include <limits.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <SD.h>
#include <Wire.h>
#include <Preferences.h>
#include <U8g2lib.h>
#include "driver/i2s.h"
#include "esp_heap_caps.h"
#include "esp_system.h"
#include "esp_sleep.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "arduino_secrets.h"
#include "LedManager.h"
#include "SDFileManager.h"
#include "LocalBibleService.h"
// Reminder integration: isolated DS3231/SD reminder plugin.
#include "ReminderManager.h"

#ifndef ENABLE_BIBLE_MP3_HELIX
#define ENABLE_BIBLE_MP3_HELIX 0
#endif
#ifndef __has_include
#define __has_include(path) 0
#endif

#if ENABLE_BIBLE_MP3_HELIX && __has_include("MP3DecoderHelix.h")
#include "MP3DecoderHelix.h"
#define BIBLE_MP3_HELIX_AVAILABLE 1
#else
#define BIBLE_MP3_HELIX_AVAILABLE 0
#endif

// OLED wiring.
#define OLED_SDA 17
#define OLED_SCL 18

// INMP441 microphone wiring.
#define MIC_I2S_WS 4
#define MIC_I2S_SCK 5
#define MIC_I2S_SD 6

// Touch input: TTP223 OUT -> GPIO7. Default module behavior is LOW idle, HIGH touched.
#define TOUCH_INPUT_PIN 7
#ifndef TOUCH_ACTIVE_LEVEL
#define TOUCH_ACTIVE_LEVEL HIGH
#endif
#ifndef TOUCH_DEBUG_SERIAL
#define TOUCH_DEBUG_SERIAL 0
#endif
#ifndef SERIAL_BOOT_DELAY_MS
#define SERIAL_BOOT_DELAY_MS 1200
#endif
#define RECORD_BUTTON_PIN TOUCH_INPUT_PIN

// Touch confirmation beep. By default it plays through the existing audio output.
#ifndef TOUCH_CONFIRM_BEEP_HZ
#define TOUCH_CONFIRM_BEEP_HZ 2000
#endif
#ifndef TOUCH_CONFIRM_BEEP_MS
#define TOUCH_CONFIRM_BEEP_MS 35
#endif
#ifndef TOUCH_BEEP_ACTIVE_BUZZER
#define TOUCH_BEEP_ACTIVE_BUZZER 0
#endif

// PAM8403 analog amplifier output. This is the default because PAM8403 is not an I2S amplifier.
#define AUDIO_PIN 15
#define AUDIO_PWM_FREQ 100000
#ifndef TOUCH_BEEP_PIN
#define TOUCH_BEEP_PIN AUDIO_PIN
#endif

// Optional I2S speaker output for an external I2S DAC/amp such as MAX98357A.
// Set AUDIO_OUTPUT_MODE to AUDIO_OUTPUT_I2S in arduino_secrets.h if you add that hardware.
#define AUDIO_OUTPUT_PWM 1
#define AUDIO_OUTPUT_I2S 2
#ifndef AUDIO_OUTPUT_MODE
#define AUDIO_OUTPUT_MODE AUDIO_OUTPUT_PWM
#endif
#ifndef AUDIO_PLAYBACK_GAIN
#define AUDIO_PLAYBACK_GAIN 1
#endif
#ifndef DEFAULT_PLAYBACK_VOLUME
#define DEFAULT_PLAYBACK_VOLUME 80
#endif
#ifndef MIN_PLAYBACK_VOLUME
#define MIN_PLAYBACK_VOLUME 20
#endif
#ifndef MAX_PLAYBACK_VOLUME
#define MAX_PLAYBACK_VOLUME 100
#endif
#ifndef VOLUME_STEP_PERCENT
#define VOLUME_STEP_PERCENT 20
#endif
#ifndef PLAYBACK_SAMPLE_LIMIT
#define PLAYBACK_SAMPLE_LIMIT 24576
#endif
#ifndef SPEAK_VOLUME_CONFIRMATION
#define SPEAK_VOLUME_CONFIRMATION 1
#endif
#ifndef SPEAKING_FACE_ENABLED
#define SPEAKING_FACE_ENABLED 0
#endif
#ifndef SPEAKING_FACE_INTERVAL_MS
#define SPEAKING_FACE_INTERVAL_MS 320
#endif
#ifndef AUDIO_DEBUG_SERIAL
#define AUDIO_DEBUG_SERIAL 0
#endif
#ifndef PLAYBACK_NET_BUFFER_BYTES
#define PLAYBACK_NET_BUFFER_BYTES 1024
#endif
#ifndef PLAYBACK_I2S_BUFFER_SAMPLES
#define PLAYBACK_I2S_BUFFER_SAMPLES 1024
#endif
#ifndef MAX_REPLY_RAM_WAV_BYTES
#define MAX_REPLY_RAM_WAV_BYTES 786432
#endif
#ifndef MAX_REPLY_SD_WAV_BYTES
#define MAX_REPLY_SD_WAV_BYTES (10UL * 1024UL * 1024UL)
#endif
#ifndef MAX_REPLY_SD_CACHE_FILES
#define MAX_REPLY_SD_CACHE_FILES 48
#endif
#ifndef I2S_WRITE_TIMEOUT_MS
#define I2S_WRITE_TIMEOUT_MS 2000
#endif
#define SPK_I2S_BCLK 8
#define SPK_I2S_LRC 9
#define SPK_I2S_DOUT 14

// Python/FastAPI server. Use CHAT_SERVER_USE_TLS=1 for hosted HTTPS backends.
#ifndef CHAT_SERVER_HOST
#define CHAT_SERVER_HOST "192.168.1.100"
#endif
#ifndef CHAT_SERVER_PORT
#define CHAT_SERVER_PORT 8000
#endif
#ifndef CHAT_SERVER_USE_TLS
#define CHAT_SERVER_USE_TLS 0
#endif
#ifndef WIFI_SETUP_AP_ENABLED
#define WIFI_SETUP_AP_ENABLED 1
#endif
#ifndef WIFI_SETUP_AP_SSID
#define WIFI_SETUP_AP_SSID "LULU-SETUP"
#endif
#ifndef WIFI_SETUP_AP_PASSWORD
#define WIFI_SETUP_AP_PASSWORD "lulu-setup"
#endif
#if CHAT_SERVER_USE_TLS
#define CHAT_SERVER_SCHEME "https"
using ChatNetworkClient = WiFiClientSecure;
#else
#define CHAT_SERVER_SCHEME "http"
using ChatNetworkClient = WiFiClient;
#endif
#define CHAT_SERVER_PATH "/chat"
#define CHAT_AUDIO_PATH "/audio/reply.wav"
#define RADIO_STREAM_PATH "/radio/nigeria.pcm"
#define REMOTE_COMMAND_PATH "/remote/next?device_id=esp32-lulu"
#define REMOTE_STATUS_PATH "/remote/status"
#define REMOTE_DEVICE_STATUS_PATH "/remote/device-status"
#define REMOTE_SD_NEXT_PATH "/remote/sd/next?device_id=esp32-lulu"
#define REMOTE_SD_RESULT_PATH "/remote/sd/result"
#define RADIO_STREAM_SAMPLE_RATE 16000
#define RADIO_STREAM_CHANNELS 1

// Audio capture settings.
#define SAMPLE_RATE 16000
#ifndef RECORD_MAX_SECONDS
#define RECORD_MAX_SECONDS 8
#endif
#ifndef RECORD_MIN_BUFFER_SECONDS
#define RECORD_MIN_BUFFER_SECONDS 2
#endif
#ifndef RECORD_START_TIMEOUT_MS
#define RECORD_START_TIMEOUT_MS 3500
#endif
#ifndef RECORD_END_SILENCE_MS
#define RECORD_END_SILENCE_MS 1200
#endif
#ifndef RECORD_MIN_CLEAR_SPEECH_MS
#define RECORD_MIN_CLEAR_SPEECH_MS 300
#endif
#define WAV_HEADER_BYTES 44
#ifndef MIC_I2S_CHANNEL
#define MIC_I2S_CHANNEL I2S_CHANNEL_FMT_ONLY_LEFT
#endif
#ifndef MIC_SAMPLE_SHIFT
#define MIC_SAMPLE_SHIFT 14
#endif
#ifndef MIC_GAIN_SHIFT
#define MIC_GAIN_SHIFT 2
#endif
#ifndef MIC_NOISE_PEAK_THRESHOLD
#define MIC_NOISE_PEAK_THRESHOLD 250
#endif
#ifndef MIC_NOISE_AVG_THRESHOLD
#define MIC_NOISE_AVG_THRESHOLD 8
#endif
#ifndef MIC_SPEECH_PEAK_THRESHOLD
#define MIC_SPEECH_PEAK_THRESHOLD 550
#endif
#ifndef MIC_SPEECH_AVG_THRESHOLD
#define MIC_SPEECH_AVG_THRESHOLD 12
#endif

// DHT room temperature/humidity sensor.
#ifndef DHT_PIN
#define DHT_PIN 16
#endif
#ifndef DHT_SENSOR_TYPE
#define DHT_SENSOR_TYPE 11
#endif
#ifndef DHT_ENABLED
#define DHT_ENABLED 1
#endif
#ifndef ROOM_TEMP_HOT_C
#define ROOM_TEMP_HOT_C 30.0f
#endif
#ifndef ROOM_TEMP_COLD_C
#define ROOM_TEMP_COLD_C 18.0f
#endif

// microSD is optional. It stores the last recording for debugging.
#define SD_CS 10
#define SD_MOSI 11
#define SD_SCK 12
#define SD_MISO 13
#define LAST_RECORDING_PATH "/last_recording.wav"
#define REPLY_DOWNLOAD_PATH "/reply_download.wav"
#define REPLY_CACHE_DIR "/ReplyCache"
#define LOCAL_QA_PATH "/local_qa.txt"
#define MUSIC_DIR "/Music"
#define STORY_DIR "/Stories"
#define VOICE_DIR "/Voices"
#define WAKE_RESPONSE_FILE_NAME "LULU.wav"
#ifndef MUSIC_QUERY_MIN_SCORE
#define MUSIC_QUERY_MIN_SCORE 180
#endif
#ifndef LOCAL_QA_MAX_BYTES
#define LOCAL_QA_MAX_BYTES 4096
#endif
#ifndef LOCAL_STORY_MAX_CHARS
#define LOCAL_STORY_MAX_CHARS 700
#endif

// Timeouts and retry limits.
#ifndef WIFI_CONNECT_TIMEOUT_MS
#define WIFI_CONNECT_TIMEOUT_MS 12000
#endif
#ifndef WIFI_RECONNECT_TIMEOUT_MS
#define WIFI_RECONNECT_TIMEOUT_MS 8000
#endif
#ifndef SERVER_CONNECT_TIMEOUT_MS
#define SERVER_CONNECT_TIMEOUT_MS 6000
#endif
#define SERVER_READ_TIMEOUT_MS 90000
#define AUDIO_READ_TIMEOUT_MS 45000
#ifndef RADIO_MAX_PLAY_MS
#define RADIO_MAX_PLAY_MS 0
#endif
#define SERVER_CONNECT_RETRIES 3
#define ERROR_DISPLAY_MS 6000
#ifndef AUTO_FOLLOWUP_ENABLED
#define AUTO_FOLLOWUP_ENABLED 0
#endif
#define TOUCH_LONG_PRESS_MS 2500
#ifndef TOUCH_TAP_MAX_MS
#define TOUCH_TAP_MAX_MS 450
#endif
#ifndef TOUCH_DOUBLE_TAP_WINDOW_MS
#define TOUCH_DOUBLE_TAP_WINDOW_MS 320
#endif
#ifndef TOUCH_DEBOUNCE_MS
#define TOUCH_DEBOUNCE_MS 35
#endif
#ifndef TOUCH_PLAYBACK_STOP_HOLD_MS
#define TOUCH_PLAYBACK_STOP_HOLD_MS 450
#endif
#ifndef TOUCH_MUSIC_STOP_HOLD_MS
#define TOUCH_MUSIC_STOP_HOLD_MS 650
#endif
#ifndef RECORD_SHORT_COMMAND_MAX_SPEECH_MS
#define RECORD_SHORT_COMMAND_MAX_SPEECH_MS 800
#endif
#ifndef RECORD_SHORT_COMMAND_END_SILENCE_MS
#define RECORD_SHORT_COMMAND_END_SILENCE_MS 450
#endif
#ifndef DHT_RETRY_INTERVAL_MS
#define DHT_RETRY_INTERVAL_MS 5000
#endif
#define DHT_READ_INTERVAL_MS 60000
#define CLIMATE_ALERT_COOLDOWN_MS 600000
#ifndef REMOTE_CONTROL_ENABLED
#define REMOTE_CONTROL_ENABLED 1
#endif
#ifndef REMOTE_CONTROL_POLL_MS
#define REMOTE_CONTROL_POLL_MS 3000
#endif
#ifndef REMOTE_CONTROL_READ_TIMEOUT_MS
#define REMOTE_CONTROL_READ_TIMEOUT_MS 700
#endif
#ifndef REMOTE_CONTROL_FAILURE_BACKOFF_MS
#define REMOTE_CONTROL_FAILURE_BACKOFF_MS 10000
#endif
#ifndef REMOTE_STOP_POLL_MS
#define REMOTE_STOP_POLL_MS 700
#endif
#ifndef REMOTE_STOP_READ_TIMEOUT_MS
#define REMOTE_STOP_READ_TIMEOUT_MS 600
#endif
#ifndef REMOTE_DEVICE_STATUS_INTERVAL_MS
#define REMOTE_DEVICE_STATUS_INTERVAL_MS 120000
#endif
#ifndef REMOTE_DEVICE_STATUS_TIMEOUT_MS
#define REMOTE_DEVICE_STATUS_TIMEOUT_MS 900
#endif
#ifndef REMOTE_SD_POLL_MS
#define REMOTE_SD_POLL_MS 8000
#endif
#ifndef REMOTE_SD_TIMEOUT_MS
#define REMOTE_SD_TIMEOUT_MS 8000
#endif
#ifndef REMOTE_SD_POLL_TIMEOUT_MS
#define REMOTE_SD_POLL_TIMEOUT_MS 650
#endif
#ifndef REMOTE_SD_UPLOAD_TIMEOUT_MS
#define REMOTE_SD_UPLOAD_TIMEOUT_MS 300000
#endif
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);

#if defined(FSPI)
SPIClass sdSPI(FSPI);
#else
SPIClass sdSPI(VSPI);
#endif

struct ChatServerReply
{
  String transcription;
  String text;
  String audioUrl;
  String audioCacheKey;
  String action;
  String musicQuery;
  bool audioCacheable;
};

struct RemoteCommand
{
  String id;
  String action;
  String text;
};

bool runConversationTurn(bool quietIsError, const String &listenPrompt);
bool checkRemoteStopRequested();
String baseNameFromPath(String path);
void enterDeepSleep();

enum class TeddyState : uint8_t
{
  IDLE,
  LISTENING,
  THINKING,
  SPEAKING,
  CONNECTION_ERROR
};

bool sdReady = false;
bool recordButtonArmed = false;
bool lastRecordingTooQuiet = false;
bool lastFollowupUnclear = false;
bool lastPlaybackStoppedByButton = false;
bool lastStopRequested = false;
unsigned long lastButtonWarningMs = 0;
String lastServerError = "";
uint8_t playbackVolumePercent = DEFAULT_PLAYBACK_VOLUME;
uint16_t nextMusicIndex = 0;
uint16_t nextStoryIndex = 0;
float lastRoomTempC = NAN;
float lastRoomHumidity = NAN;
bool lastDhtOk = false;
unsigned long lastDhtReadMs = 0;
unsigned long lastClimateAlertMs = 0;
int8_t lastClimateAlertState = 0;
uint8_t speakingFaceFrame = 0;
unsigned long lastSpeakingFaceMs = 0;
unsigned long lastRemoteControlPollMs = 0;
unsigned long lastRemoteControlFailureMs = 0;
unsigned long lastRemoteDeviceStatusMs = 0;
unsigned long lastRemoteSdPollMs = 0;
unsigned long lastRemoteSdFailureMs = 0;
bool speakerOutputReady = false;
uint32_t speakerOutputSampleRate = 0;
bool micInputReady = false;
TeddyState currentState = TeddyState::IDLE;
bool connectionErrorActive = false;
bool connectionErrorNeedsWifi = false;
// Reminder integration: single manager instance; audio/mic code remains unchanged.
ReminderManager reminderManager;
LocalBibleService localBible;

struct WavInfo
{
  uint16_t channels;
  uint32_t sampleRate;
  uint16_t bitsPerSample;
  uint32_t dataBytes;
};

// Changes LULU's central state and delegates visual status to the isolated LED manager.
void setState(TeddyState state)
{
  currentState = state;
  if (currentState != TeddyState::CONNECTION_ERROR)
  {
    connectionErrorActive = false;
    connectionErrorNeedsWifi = false;
  }

  switch (currentState)
  {
  case TeddyState::IDLE:
    LedManager.setMode(LED_IDLE);
    break;
  case TeddyState::LISTENING:
    LedManager.setMode(LED_LISTENING);
    break;
  case TeddyState::THINKING:
    LedManager.setMode(LED_THINKING);
    break;
  case TeddyState::SPEAKING:
    LedManager.setMode(LED_SPEAKING);
    break;
  case TeddyState::CONNECTION_ERROR:
    LedManager.setMode(LED_ERROR);
    break;
  }
}

// Sets the idle state: red on, blue off, green off.
void setIdleState()
{
  setState(TeddyState::IDLE);
}

// Sets the listening state: blue on while recording.
void setListeningState()
{
  setState(TeddyState::LISTENING);
}

// Sets the thinking state: blue blinks while waiting on processing/network work.
void setThinkingState()
{
  setState(TeddyState::THINKING);
}

// Sets the speaking state: green on while audio is being played.
void setSpeakingState()
{
  setState(TeddyState::SPEAKING);
}

// Sets the error state: red blinks quickly for WiFi/server failures.
void setErrorState()
{
  setState(TeddyState::CONNECTION_ERROR);
  connectionErrorActive = true;
  connectionErrorNeedsWifi = WiFi.status() != WL_CONNECTED;
}

// Keeps LED animations alive without blocking WiFi, HTTP, touch, OLED, or audio work.
void updateStatusLeds()
{
  LedManager.update();
}

// Waits in tiny slices so LED blink updates continue during short user-facing pauses.
void waitWithStatusLeds(uint32_t durationMs)
{
  unsigned long startedMs = millis();
  while (millis() - startedMs < durationMs)
  {
    updateStatusLeds();
    if (checkRemoteStopRequested())
      break;
    delay(5);
  }
}

bool isTalkButtonPressedRaw()
{
  return digitalRead(RECORD_BUTTON_PIN) == TOUCH_ACTIVE_LEVEL;
}

void logTouchDiagnostics(bool force = false)
{
#if TOUCH_DEBUG_SERIAL
  static unsigned long lastTouchDebugMs = 0;
  unsigned long now = millis();
  if (!force && now - lastTouchDebugMs < 3000)
    return;

  lastTouchDebugMs = now;
  Serial.printf(
      "[TOUCH] gpio=%u raw=%d activeLevel=%d pressed=%d armed=%d wifi=%d heap=%lu psram=%lu\n",
      (unsigned)RECORD_BUTTON_PIN,
      digitalRead(RECORD_BUTTON_PIN),
      (int)TOUCH_ACTIVE_LEVEL,
      isTalkButtonPressedRaw() ? 1 : 0,
      recordButtonArmed ? 1 : 0,
      (int)WiFi.status(),
      (unsigned long)ESP.getFreeHeap(),
      (unsigned long)ESP.getFreePsram());
#endif
}

bool playbackTouchStopRequested(bool allowButtonStop,
                                bool *stopButtonArmed,
                                unsigned long *pressedSinceMs,
                                uint32_t holdMs)
{
  if (!allowButtonStop)
    return false;

  bool pressed = isTalkButtonPressedRaw();
  if (!*stopButtonArmed)
  {
    if (!pressed)
      *stopButtonArmed = true;
    *pressedSinceMs = 0;
    return false;
  }

  if (!pressed)
  {
    *pressedSinceMs = 0;
    return false;
  }

  if (*pressedSinceMs == 0)
    *pressedSinceMs = millis();

  return millis() - *pressedSinceMs >= holdMs;
}

String buildServerUrl(const char *path)
{
  return String(CHAT_SERVER_SCHEME) + "://" + String(CHAT_SERVER_HOST) + ":" + String(CHAT_SERVER_PORT) + String(path);
}

bool isHttpUrl(const String &url)
{
  return url.startsWith("http://") || url.startsWith("https://");
}

String normalizeServerAudioUrl(const String &url, const char *fallbackPath)
{
  String cleanUrl = url;
  cleanUrl.trim();
  if (cleanUrl.length() == 0 ||
      cleanUrl.indexOf("://0.0.0.0") >= 0 ||
      cleanUrl.indexOf("://127.0.0.1") >= 0 ||
      !isHttpUrl(cleanUrl))
  {
    return buildServerUrl(fallbackPath);
  }

  int hostIndex = cleanUrl.indexOf(CHAT_SERVER_HOST);
  if (hostIndex >= 0)
  {
    int pathIndex = cleanUrl.indexOf('/', hostIndex + String(CHAT_SERVER_HOST).length());
    if (pathIndex >= 0)
      return buildServerUrl(cleanUrl.substring(pathIndex).c_str());
  }

  return cleanUrl;
}

void prepareChatClient(ChatNetworkClient &client, uint32_t timeoutMs)
{
#if CHAT_SERVER_USE_TLS
  client.setInsecure();
#endif
  client.setTimeout(timeoutMs);
}

String jsonEscapeValue(const String &value)
{
  String escaped;
  escaped.reserve(value.length() + 8);
  for (uint16_t i = 0; i < value.length(); i++)
  {
    char c = value[i];
    if (c == '\\')
      escaped += "\\\\";
    else if (c == '"')
      escaped += "\\\"";
    else if (c == '\n')
      escaped += "\\n";
    else if (c == '\r')
      escaped += "\\r";
    else
      escaped += c;
  }
  return escaped;
}

String uint64String(uint64_t value)
{
  char buffer[24];
  snprintf(buffer, sizeof(buffer), "%llu", (unsigned long long)value);
  return String(buffer);
}

const char *currentStateName()
{
  switch (currentState)
  {
  case TeddyState::IDLE:
    return "idle";
  case TeddyState::LISTENING:
    return "listening";
  case TeddyState::THINKING:
    return "thinking";
  case TeddyState::SPEAKING:
    return "speaking";
  case TeddyState::CONNECTION_ERROR:
    return "connection_error";
  }
  return "unknown";
}

void reportRemoteDeviceStatus(bool force = false)
{
#if REMOTE_CONTROL_ENABLED
  if (WiFi.status() != WL_CONNECTED)
    return;

  unsigned long now = millis();
  if (!force && now - lastRemoteDeviceStatusMs < REMOTE_DEVICE_STATUS_INTERVAL_MS)
    return;
  lastRemoteDeviceStatusMs = now;

  String body;
  uint64_t sdTotalBytes = 0;
  uint64_t sdUsedBytes = 0;
  uint64_t sdFreeBytes = 0;
  if (sdReady)
  {
    sdTotalBytes = SD.totalBytes();
    sdUsedBytes = SD.usedBytes();
    sdFreeBytes = sdTotalBytes > sdUsedBytes ? sdTotalBytes - sdUsedBytes : 0;
  }

  body.reserve(360);
  body += "{\"device_id\":\"esp32-lulu\",";
  body += "\"wifi_connected\":true,";
  body += "\"wifi_ssid\":\"" + jsonEscapeValue(WiFi.SSID()) + "\",";
  body += "\"wifi_ip\":\"" + WiFi.localIP().toString() + "\",";
  body += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
  body += "\"free_heap\":" + String((unsigned long)ESP.getFreeHeap()) + ",";
  body += "\"sd_ready\":";
  body += sdReady ? "true," : "false,";
  body += "\"sd_used_bytes\":";
  body += uint64String(sdUsedBytes);
  body += ",";
  body += "\"sd_total_bytes\":";
  body += uint64String(sdTotalBytes);
  body += ",";
  body += "\"sd_free_bytes\":";
  body += uint64String(sdFreeBytes);
  body += ",";
  body += "\"state\":\"" + String(currentStateName()) + "\"}";

  HTTPClient http;
  ChatNetworkClient client;
  prepareChatClient(client, REMOTE_DEVICE_STATUS_TIMEOUT_MS);
  String url = buildServerUrl(REMOTE_DEVICE_STATUS_PATH);
  if (!http.begin(client, url))
  {
    client.stop();
    return;
  }

  http.setTimeout(REMOTE_DEVICE_STATUS_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  if (code > 0 && code != HTTP_CODE_OK)
    Serial.printf("[REMOTE] device status HTTP %d\n", code);
  http.end();
  client.stop();
#else
  (void)force;
#endif
}

class MemoryReadStream : public Stream
{
public:
  MemoryReadStream(const uint8_t *data, size_t length) : _data(data), _length(length), _position(0) {}

  int available() override
  {
    return _position < _length ? (int)min((size_t)INT_MAX, _length - _position) : 0;
  }

  int read() override
  {
    if (_position >= _length)
      return -1;
    return _data[_position++];
  }

  int read(uint8_t *buffer, size_t size)
  {
    if (!buffer || _position >= _length)
      return 0;
    size_t want = min(size, _length - _position);
    memcpy(buffer, _data + _position, want);
    _position += want;
    return (int)want;
  }

  size_t readBytes(uint8_t *buffer, size_t size)
  {
    return (size_t)read(buffer, size);
  }

  int peek() override
  {
    return _position < _length ? _data[_position] : -1;
  }

  void flush() override {}

  size_t write(uint8_t) override
  {
    return 0;
  }

private:
  const uint8_t *_data;
  size_t _length;
  size_t _position;
};

void printMemoryDiagnostics(const char *label)
{
  Serial.printf(
      "[MEM] %s heap=%lu largest8=%lu internal=%lu largestInternal=%lu psram=%lu largestPsram=%lu stackHighWater=%lu\n",
      label,
      (unsigned long)ESP.getFreeHeap(),
      (unsigned long)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT),
      (unsigned long)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
      (unsigned long)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
      (unsigned long)ESP.getFreePsram(),
      (unsigned long)heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT),
      (unsigned long)uxTaskGetStackHighWaterMark(NULL));
}

void audioStep(uint8_t step, const char *label)
{
#if AUDIO_DEBUG_SERIAL
  Serial.printf("[AUDIO] STEP %u %s\n", step, label);
  printMemoryDiagnostics(label);
#else
  Serial.printf("[AUDIO] STEP %u %s\n", step, label);
#endif
}

void audioStatus(const char *label)
{
#if AUDIO_DEBUG_SERIAL
  Serial.printf("[AUDIO] %s\n", label);
  printMemoryDiagnostics(label);
#else
  Serial.printf("[AUDIO] %s\n", label);
#endif
}

void *allocPlaybackBytes(size_t bytes, const char *label)
{
  void *ptr = nullptr;
  if (ESP.getPsramSize() > 0 && ESP.getFreePsram() >= bytes)
    ptr = heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);

  if (!ptr)
    ptr = heap_caps_malloc(bytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);

  if (!ptr)
    ptr = malloc(bytes);

#if AUDIO_DEBUG_SERIAL
  Serial.printf("[AUDIO] alloc %s bytes=%lu ptr=%p\n", label, (unsigned long)bytes, ptr);
  printMemoryDiagnostics(label);
#endif
  return ptr;
}

String urlEncode(const String &value)
{
  const char *hex = "0123456789ABCDEF";
  String encoded;
  encoded.reserve(value.length() * 3);

  for (size_t i = 0; i < value.length(); i++)
  {
    uint8_t c = (uint8_t)value[i];
    bool safe = (c >= 'A' && c <= 'Z') ||
                (c >= 'a' && c <= 'z') ||
                (c >= '0' && c <= '9') ||
                c == '-' || c == '_' || c == '.' || c == '~';

    if (safe)
      encoded += (char)c;
    else
    {
      encoded += '%';
      encoded += hex[c >> 4];
      encoded += hex[c & 0x0F];
    }
  }

  return encoded;
}

void drawCenteredText(const char *text, uint8_t y)
{
  int16_t width = u8g2.getStrWidth(text);
  int16_t x = max(0, (128 - width) / 2);
  u8g2.drawStr(x, y, text);
}

void playStartupTone(uint16_t frequency, uint16_t durationMs)
{
#if AUDIO_OUTPUT_MODE == AUDIO_OUTPUT_I2S
  if (!speakerOutputReady)
    return;
#endif

  const uint32_t sampleRate = 16000;
  uint32_t totalSamples = (sampleRate * durationMs) / 1000;
  uint16_t halfPeriodSamples = max((uint16_t)1, (uint16_t)(sampleRate / (frequency * 2UL)));

  for (uint32_t i = 0; i < totalSamples; i++)
  {
    int16_t sample = ((i / halfPeriodSamples) & 1) ? 9000 : -9000;
#if AUDIO_OUTPUT_MODE == AUDIO_OUTPUT_I2S
    int16_t stereo[2] = {sample, sample};
    size_t bytesWritten = 0;
    esp_err_t err = i2s_write(I2S_NUM_1, stereo, sizeof(stereo), &bytesWritten, pdMS_TO_TICKS(I2S_WRITE_TIMEOUT_MS));
    if (err != ESP_OK || bytesWritten != sizeof(stereo))
      break;
#else
    uint8_t pwm = (uint16_t)(sample + 32768) >> 8;
    ledcWrite(AUDIO_PIN, pwm);
    delayMicroseconds(1000000UL / sampleRate);
#endif
  }

#if AUDIO_OUTPUT_MODE == AUDIO_OUTPUT_I2S
  i2s_zero_dma_buffer(I2S_NUM_1);
#else
  ledcWrite(AUDIO_PIN, 128);
#endif
}

// Plays the short touch confirmation beep before recording starts.
void playTouchConfirmationBeep()
{
#if TOUCH_BEEP_ACTIVE_BUZZER
  pinMode(TOUCH_BEEP_PIN, OUTPUT);
  digitalWrite(TOUCH_BEEP_PIN, HIGH);
  waitWithStatusLeds(TOUCH_CONFIRM_BEEP_MS);
  digitalWrite(TOUCH_BEEP_PIN, LOW);
#else
  playStartupTone(TOUCH_CONFIRM_BEEP_HZ, TOUCH_CONFIRM_BEEP_MS);
#endif
}

void showStartupAnimation()
{
  const char *brand = "Netrue LTD";

  for (uint8_t i = 0; i <= 24; i++)
  {
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_logisoso18_tf);
    drawCenteredText(brand, 31);
    u8g2.setFont(u8g2_font_6x12_tf);
    drawCenteredText("AI Voice Bot", 49);
    u8g2.drawFrame(18, 56, 92, 6);
    u8g2.drawBox(20, 58, map(i, 0, 24, 0, 88), 2);
    u8g2.sendBuffer();

    if (i == 2)
      playStartupTone(660, 70);
    else if (i == 10)
      playStartupTone(880, 70);
    else if (i == 18)
      playStartupTone(990, 90);
    else
      waitWithStatusLeds(45);
  }
}

void showText(const String &line1, const String &line2 = "", const String &line3 = "")
{
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x12_tf);
  u8g2.drawUTF8(0, 14, line1.c_str());
  if (line2.length() > 0)
    u8g2.drawUTF8(0, 34, line2.c_str());
  if (line3.length() > 0)
    u8g2.drawUTF8(0, 54, line3.c_str());
  u8g2.sendBuffer();
}

void showWrapped(const String &title, const String &text)
{
  String first = text.substring(0, min((int)text.length(), 20));
  String second = text.length() > 20 ? text.substring(20, min((int)text.length(), 40)) : "";
  showText(title, first, second);
}

void showSpeakingFace(bool force = false)
{
  unsigned long now = millis();
  if (!force && now - lastSpeakingFaceMs < SPEAKING_FACE_INTERVAL_MS)
    return;

  lastSpeakingFaceMs = now;
  speakingFaceFrame = (speakingFaceFrame + 1) % 4;

  uint8_t mouthHeight = 4 + (speakingFaceFrame % 3) * 5;
  uint8_t mouthY = 45 - (mouthHeight / 2);
  int8_t pupilOffset = speakingFaceFrame == 1 ? -2 : (speakingFaceFrame == 3 ? 2 : 0);

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x12_tf);
  drawCenteredText("LULU speaking", 12);

  u8g2.drawRBox(24, 22, 28, 18, 8);
  u8g2.drawRBox(76, 22, 28, 18, 8);
  u8g2.setDrawColor(0);
  u8g2.drawDisc(38 + pupilOffset, 31, 4);
  u8g2.drawDisc(90 + pupilOffset, 31, 4);
  u8g2.setDrawColor(1);

  if (speakingFaceFrame == 0)
    u8g2.drawRBox(48, 45, 32, 4, 2);
  else
    u8g2.drawRFrame(47, mouthY, 34, mouthHeight, 6);

  u8g2.sendBuffer();
}

bool readDhtSensor(float *temperatureC, float *humidity)
{
  uint8_t data[5] = {0, 0, 0, 0, 0};

  pinMode(DHT_PIN, OUTPUT);
  digitalWrite(DHT_PIN, LOW);
  delay(DHT_SENSOR_TYPE == 11 ? 18 : 2);
  digitalWrite(DHT_PIN, HIGH);
  delayMicroseconds(40);
  pinMode(DHT_PIN, INPUT_PULLUP);

  if (pulseIn(DHT_PIN, LOW, 1000) == 0 || pulseIn(DHT_PIN, HIGH, 1000) == 0)
    return false;

  for (uint8_t bit = 0; bit < 40; bit++)
  {
    if (pulseIn(DHT_PIN, LOW, 1000) == 0)
      return false;

    uint32_t highUs = pulseIn(DHT_PIN, HIGH, 1000);
    if (highUs == 0)
      return false;

    data[bit / 8] <<= 1;
    if (highUs > 50)
      data[bit / 8] |= 1;
  }

  uint8_t checksum = data[0] + data[1] + data[2] + data[3];
  if (checksum != data[4])
    return false;

#if DHT_SENSOR_TYPE == 22
  uint16_t rawHumidity = ((uint16_t)data[0] << 8) | data[1];
  uint16_t rawTemperature = (((uint16_t)data[2] & 0x7F) << 8) | data[3];
  *humidity = rawHumidity / 10.0f;
  *temperatureC = rawTemperature / 10.0f;
  if (data[2] & 0x80)
    *temperatureC = -*temperatureC;
#else
  *humidity = data[0] + (data[1] / 10.0f);
  *temperatureC = data[2] + (data[3] / 10.0f);
#endif

  return *humidity >= 0.0f && *humidity <= 100.0f && *temperatureC > -40.0f && *temperatureC < 80.0f;
}

bool updateRoomClimate(bool force = false)
{
#if !DHT_ENABLED
  (void)force;
  lastDhtOk = false;
  lastRoomTempC = NAN;
  lastRoomHumidity = NAN;
  return false;
#else
  unsigned long now = millis();
  unsigned long readIntervalMs = lastDhtOk ? DHT_READ_INTERVAL_MS : DHT_RETRY_INTERVAL_MS;
  if (!force && lastDhtReadMs > 0 && now - lastDhtReadMs < readIntervalMs)
    return lastDhtOk;

  lastDhtReadMs = now;
  float temperatureC = NAN;
  float humidity = NAN;
  lastDhtOk = readDhtSensor(&temperatureC, &humidity);

  if (lastDhtOk)
  {
    lastRoomTempC = temperatureC;
    lastRoomHumidity = humidity;
    Serial.printf("Room climate: %.1f C, %.1f%% humidity\n", lastRoomTempC, lastRoomHumidity);
  }
  else
  {
    Serial.println("DHT read failed");
  }

  return lastDhtOk;
#endif
}

uint16_t readLE16(const uint8_t *p)
{
  return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

uint32_t readLE32(const uint8_t *p)
{
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

int16_t applyPlaybackGain(int16_t sample)
{
  int32_t scaled = (int32_t)sample * AUDIO_PLAYBACK_GAIN * playbackVolumePercent / 100;
  return (int16_t)constrain(scaled, -PLAYBACK_SAMPLE_LIMIT, PLAYBACK_SAMPLE_LIMIT);
}

uint8_t *allocBytes(size_t bytes)
{
  if (ESP.getPsramSize() > 0 && ESP.getFreePsram() >= bytes)
  {
    uint8_t *ptr = (uint8_t *)ps_malloc(bytes);
    if (ptr)
      return ptr;
  }

  return (uint8_t *)malloc(bytes);
}

uint8_t *allocRecordingBuffer(uint16_t *secondsOut, size_t *wavBytesOut)
{
  for (int seconds = RECORD_MAX_SECONDS; seconds >= RECORD_MIN_BUFFER_SECONDS; seconds--)
  {
    size_t sampleCount = SAMPLE_RATE * seconds;
    size_t wavBytes = WAV_HEADER_BYTES + (sampleCount * sizeof(int16_t));
    uint8_t *buffer = allocBytes(wavBytes);
    if (buffer)
    {
      *secondsOut = seconds;
      *wavBytesOut = wavBytes;
      return buffer;
    }
  }

  *secondsOut = 0;
  *wavBytesOut = 0;
  return nullptr;
}

void initAudioOutput()
{
#if AUDIO_OUTPUT_MODE == AUDIO_OUTPUT_I2S
  audioStatus("I2S speaker install begin");
  i2s_config_t config = {
      .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
      .sample_rate = 22050,
      .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
      .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,
      .communication_format = I2S_COMM_FORMAT_STAND_I2S,
      .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
      .dma_buf_count = 8,
      .dma_buf_len = 256,
      .use_apll = false,
      .tx_desc_auto_clear = true,
      .fixed_mclk = 0};

  i2s_pin_config_t pins = {
      .bck_io_num = SPK_I2S_BCLK,
      .ws_io_num = SPK_I2S_LRC,
      .data_out_num = SPK_I2S_DOUT,
      .data_in_num = I2S_PIN_NO_CHANGE};

  esp_err_t err = i2s_driver_install(I2S_NUM_1, &config, 0, NULL);
  if (err != ESP_OK && err != ESP_ERR_INVALID_STATE)
  {
    Serial.printf("[AUDIO] I2S speaker driver install failed: %d\n", (int)err);
    speakerOutputReady = false;
    return;
  }

  err = i2s_set_pin(I2S_NUM_1, &pins);
  if (err != ESP_OK)
  {
    Serial.printf("[AUDIO] I2S speaker pin setup failed: %d\n", (int)err);
    speakerOutputReady = false;
    return;
  }

  i2s_zero_dma_buffer(I2S_NUM_1);
  speakerOutputReady = true;
  speakerOutputSampleRate = 22050;
  audioStatus("I2S speaker install done");
#else
  ledcAttach(AUDIO_PIN, AUDIO_PWM_FREQ, 8);
  ledcWrite(AUDIO_PIN, 128);
  speakerOutputReady = true;
  speakerOutputSampleRate = 0;
#endif
}

bool configureAudioOutputRate(uint32_t sampleRate)
{
  if (sampleRate < 8000 || sampleRate > 48000)
  {
    Serial.printf("[AUDIO] Unsupported sample rate: %lu\n", (unsigned long)sampleRate);
    return false;
  }

#if AUDIO_OUTPUT_MODE == AUDIO_OUTPUT_I2S
  if (!speakerOutputReady)
  {
    Serial.println("[AUDIO] I2S speaker output is not ready");
    return false;
  }

  if (speakerOutputSampleRate == sampleRate)
    return true;

  esp_err_t err = i2s_set_sample_rates(I2S_NUM_1, sampleRate);
  if (err != ESP_OK)
  {
    Serial.printf("[AUDIO] I2S sample rate setup failed: %d rate=%lu\n", (int)err, (unsigned long)sampleRate);
    return false;
  }

  speakerOutputSampleRate = sampleRate;
  return true;
#else
  (void)sampleRate;
  return true;
#endif
}

void stopAudioOutput()
{
#if AUDIO_OUTPUT_MODE == AUDIO_OUTPUT_I2S
  i2s_zero_dma_buffer(I2S_NUM_1);
#else
  ledcWrite(AUDIO_PIN, 128);
#endif
}

void initMic()
{
  i2s_config_t config = {
      .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
      .sample_rate = SAMPLE_RATE,
      .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
      .channel_format = MIC_I2S_CHANNEL,
      .communication_format = I2S_COMM_FORMAT_STAND_I2S,
      .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
      .dma_buf_count = 8,
      .dma_buf_len = 256,
      .use_apll = false,
      .tx_desc_auto_clear = false,
      .fixed_mclk = 0};

  i2s_pin_config_t pins = {
      .bck_io_num = MIC_I2S_SCK,
      .ws_io_num = MIC_I2S_WS,
      .data_out_num = I2S_PIN_NO_CHANGE,
      .data_in_num = MIC_I2S_SD};

  esp_err_t err = i2s_driver_install(I2S_NUM_0, &config, 0, NULL);
  if (err != ESP_OK && err != ESP_ERR_INVALID_STATE)
  {
    Serial.printf("[MIC] I2S mic driver install failed: %d\n", (int)err);
    micInputReady = false;
    return;
  }

  err = i2s_set_pin(I2S_NUM_0, &pins);
  if (err != ESP_OK)
  {
    Serial.printf("[MIC] I2S mic pin setup failed: %d\n", (int)err);
    micInputReady = false;
    return;
  }

  i2s_zero_dma_buffer(I2S_NUM_0);
  micInputReady = true;
  Serial.println("[MIC] I2S mic ready");
}

void writeWavHeader(uint8_t *header, uint32_t dataBytes)
{
  uint32_t fileSize = dataBytes + WAV_HEADER_BYTES - 8;
  uint32_t byteRate = SAMPLE_RATE * 2;
  uint16_t blockAlign = 2;
  uint16_t bitsPerSample = 16;
  uint16_t channels = 1;
  uint32_t sampleRate = SAMPLE_RATE;

  memcpy(header, "RIFF", 4);
  memcpy(header + 4, &fileSize, 4);
  memcpy(header + 8, "WAVEfmt ", 8);
  uint32_t subchunk1Size = 16;
  uint16_t audioFormat = 1;
  memcpy(header + 16, &subchunk1Size, 4);
  memcpy(header + 20, &audioFormat, 2);
  memcpy(header + 22, &channels, 2);
  memcpy(header + 24, &sampleRate, 4);
  memcpy(header + 28, &byteRate, 4);
  memcpy(header + 32, &blockAlign, 2);
  memcpy(header + 34, &bitsPerSample, 2);
  memcpy(header + 36, "data", 4);
  memcpy(header + 40, &dataBytes, 4);
}

bool initSDCard()
{
  showText("Starting SD...");
  sdSPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  sdReady = SD.begin(SD_CS, sdSPI);
  if (!sdReady)
  {
    Serial.println("SD init failed; continuing without recording cache");
    showText("SD not found", "Continuing");
    delay(900);
    return false;
  }

  Serial.println("SD ready");
  return true;
}

bool saveWavToSD(const uint8_t *wav, size_t wavBytes)
{
  if (!sdReady)
    return false;

  if (SD.exists(LAST_RECORDING_PATH))
    SD.remove(LAST_RECORDING_PATH);

  File file = SD.open(LAST_RECORDING_PATH, FILE_WRITE);
  if (!file)
    return false;

  size_t written = file.write(wav, wavBytes);
  file.flush();
  file.close();
  Serial.printf("Saved %lu bytes to %s\n", (unsigned long)written, LAST_RECORDING_PATH);
  return written == wavBytes;
}

String readLocalQaFromSD()
{
  if (!sdReady || !SD.exists(LOCAL_QA_PATH))
    return "";

  File file = SD.open(LOCAL_QA_PATH, FILE_READ);
  if (!file)
    return "";

  String text;
  size_t limit = min((size_t)file.size(), (size_t)LOCAL_QA_MAX_BYTES);
  text.reserve(limit + 1);

  while (file.available() && text.length() < limit)
  {
    text += (char)file.read();
  }

  file.close();
  return text;
}

bool recordWav(uint8_t **wavOut, size_t *wavBytesOut, bool quietIsError, const String &promptLine)
{
  lastRecordingTooQuiet = false;
  if (!micInputReady)
  {
    lastServerError = "Mic I2S not ready";
    showText("Mic error", "I2S not ready");
    return false;
  }

  uint16_t bufferSeconds = 0;
  size_t maxWavBytes = 0;
  uint8_t *wav = allocRecordingBuffer(&bufferSeconds, &maxWavBytes);
  if (!wav)
  {
    showText("Memory low", "Enable PSRAM", "or free heap");
    Serial.printf("Recording allocation failed. Free heap=%lu, PSRAM=%lu, free PSRAM=%lu\n",
                  (unsigned long)ESP.getFreeHeap(),
                  (unsigned long)ESP.getPsramSize(),
                  (unsigned long)ESP.getFreePsram());
    return false;
  }

  const size_t maxSampleCount = SAMPLE_RATE * bufferSeconds;
  const size_t maxDataBytes = maxSampleCount * sizeof(int16_t);
  const size_t maxWritableSamples = maxWavBytes > WAV_HEADER_BYTES ? (maxWavBytes - WAV_HEADER_BYTES) / sizeof(int16_t) : 0;
  if (maxWritableSamples == 0)
  {
    free(wav);
    showText("Memory low", "Bad buffer");
    return false;
  }

  writeWavHeader(wav, maxDataBytes);
  showText("Listening...", promptLine, String(bufferSeconds) + " sec max");
  Serial.printf("Recording buffer: %u sec, %lu bytes. Free heap=%lu, free PSRAM=%lu\n",
                bufferSeconds,
                (unsigned long)maxWavBytes,
                (unsigned long)ESP.getFreeHeap(),
                (unsigned long)ESP.getFreePsram());
  i2s_zero_dma_buffer(I2S_NUM_0);

  size_t writtenSamples = 0;
  int32_t raw[256];
  int32_t chunkPeak = 0;
  uint64_t chunkAbsTotal = 0;
  uint32_t chunkSamples = 0;
  int32_t recordingPeak = 0;
  uint64_t recordingAbsTotal = 0;
  uint32_t speechMs = 0;
  uint64_t speechAbsTotal = 0;
  uint32_t speechSamples = 0;
  bool speechStarted = false;
  unsigned long startedMs = millis();
  unsigned long lastSpeechMs = 0;
  unsigned long lastMeterMs = millis();

  while (writtenSamples < maxWritableSamples)
  {
    updateStatusLeds();
    if (checkRemoteStopRequested())
    {
      free(wav);
      return false;
    }

    size_t bytesRead = 0;
    esp_err_t readErr = i2s_read(I2S_NUM_0, raw, sizeof(raw), &bytesRead, pdMS_TO_TICKS(1000));
    if (readErr != ESP_OK)
    {
      Serial.printf("[MIC] i2s_read failed: %d\n", (int)readErr);
      delay(10);
      continue;
    }
    size_t samplesRead = bytesRead / sizeof(int32_t);

    for (size_t i = 0; i < samplesRead && writtenSamples < maxWritableSamples; i++)
    {
      int32_t scaled = (raw[i] >> MIC_SAMPLE_SHIFT) << MIC_GAIN_SHIFT;
      scaled = constrain(scaled, -32768, 32767);
      int16_t sample = (int16_t)scaled;
      int32_t sampleAbs = abs((int32_t)sample);

      chunkPeak = max(chunkPeak, sampleAbs);
      chunkAbsTotal += sampleAbs;
      chunkSamples++;
      recordingPeak = max(recordingPeak, sampleAbs);
      recordingAbsTotal += sampleAbs;
      size_t writeOffset = WAV_HEADER_BYTES + (writtenSamples * sizeof(int16_t));
      if (writeOffset + sizeof(int16_t) > maxWavBytes)
        break;

      memcpy(wav + writeOffset, &sample, sizeof(int16_t));
      writtenSamples++;
    }

    unsigned long now = millis();
    if (now - lastMeterMs >= 250)
    {
      uint32_t chunkAvg = chunkSamples > 0 ? chunkAbsTotal / chunkSamples : 0;
      bool speechChunk = chunkPeak >= MIC_SPEECH_PEAK_THRESHOLD && chunkAvg >= MIC_SPEECH_AVG_THRESHOLD;
      bool quietChunk = chunkPeak < MIC_NOISE_PEAK_THRESHOLD && chunkAvg < MIC_NOISE_AVG_THRESHOLD;

      if (speechChunk)
      {
        if (!speechStarted)
        {
          speechStarted = true;
          Serial.println("Speech detected");
        }

        speechMs += now - lastMeterMs;
        speechAbsTotal += chunkAbsTotal;
        speechSamples += chunkSamples;
        lastSpeechMs = now;
      }

      uint8_t bars = map(constrain(chunkPeak, 0, 16000), 0, 16000, 0, 18);
      u8g2.clearBuffer();
      u8g2.setFont(u8g2_font_6x12_tf);
      u8g2.drawUTF8(0, 14, "Listening...");
      u8g2.drawUTF8(0, 34, speechStarted ? "Keep talking" : "Waiting speech");
      u8g2.drawFrame(0, 46, 112, 10);
      u8g2.drawBox(2, 48, bars * 6, 6);
      u8g2.sendBuffer();
      chunkPeak = 0;
      chunkAbsTotal = 0;
      chunkSamples = 0;
      lastMeterMs = now;

      if (!speechStarted && now - startedMs >= RECORD_START_TIMEOUT_MS)
        break;

      if (speechStarted && quietChunk)
      {
        uint32_t endSilenceMs = speechMs <= RECORD_SHORT_COMMAND_MAX_SPEECH_MS
                                    ? RECORD_SHORT_COMMAND_END_SILENCE_MS
                                    : RECORD_END_SILENCE_MS;
        if (now - lastSpeechMs >= endSilenceMs)
          break;
      }
    }

    delay(1);
  }

  uint32_t avgAbs = writtenSamples > 0 ? recordingAbsTotal / writtenSamples : 0;
  uint32_t speechAvgAbs = speechSamples > 0 ? speechAbsTotal / speechSamples : 0;
  uint32_t actualDataBytes = writtenSamples * sizeof(int16_t);
  size_t actualWavBytes = WAV_HEADER_BYTES + actualDataBytes;
  Serial.printf("Recording peak: %ld, avg abs: %lu, speech avg: %lu, speech ms: %lu, bytes: %lu\n",
                (long)recordingPeak,
                (unsigned long)avgAbs,
                (unsigned long)speechAvgAbs,
                (unsigned long)speechMs,
                (unsigned long)actualDataBytes);

  if (!speechStarted ||
      speechMs < RECORD_MIN_CLEAR_SPEECH_MS ||
      recordingPeak < MIC_SPEECH_PEAK_THRESHOLD ||
      speechAvgAbs < MIC_SPEECH_AVG_THRESHOLD)
  {
    lastRecordingTooQuiet = true;
    if (quietIsError)
      showText("No clear speech", "Speak closer/louder");
    free(wav);
    return false;
  }

  writeWavHeader(wav, actualDataBytes);
  saveWavToSD(wav, actualWavBytes);
  *wavOut = wav;
  *wavBytesOut = actualWavBytes;
  return true;
}

bool connectWiFi()
{
  showText("Connecting WiFi");
  Preferences wifiPreferences;
  String savedSsid;
  String savedPassword;
  if (wifiPreferences.begin("lulu_wifi", true))
  {
    savedSsid = wifiPreferences.getString("ssid", "");
    savedPassword = wifiPreferences.getString("password", "");
    wifiPreferences.end();
  }

  const char *ssid = savedSsid.length() > 0 ? savedSsid.c_str() : WIFI_SSID;
  const char *password = savedSsid.length() > 0 ? savedPassword.c_str() : WIFI_PASSWORD;

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  unsigned long startedMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedMs < WIFI_CONNECT_TIMEOUT_MS)
  {
    updateStatusLeds();
    delay(300);
    Serial.print(".");
  }

  Serial.println();
  if (WiFi.status() != WL_CONNECTED)
  {
    Serial.println("WiFi connect timeout");
#if WIFI_SETUP_AP_ENABLED
    WiFi.mode(WIFI_AP_STA);
    if (WiFi.softAP(WIFI_SETUP_AP_SSID, WIFI_SETUP_AP_PASSWORD))
    {
      Serial.print("WiFi setup AP started: ");
      Serial.print(WIFI_SETUP_AP_SSID);
      Serial.print(" IP=");
      Serial.println(WiFi.softAPIP());
      showText("Setup WiFi", String(WIFI_SETUP_AP_SSID));
    }
    else
    {
      Serial.println("WiFi setup AP failed");
      showText("WiFi offline", "Check router");
    }
#else
    showText("WiFi offline", "Check router");
#endif
    setErrorState();
    return false;
  }

  Serial.print("WiFi connected: ");
  Serial.println(WiFi.localIP());
  showText("WiFi connected", WiFi.localIP().toString());
  delay(800);
  return true;
}

bool ensureWiFiReady()
{
  if (WiFi.status() == WL_CONNECTED)
    return true;

  showText("WiFi lost", "Reconnecting...");
  Serial.println("WiFi disconnected; reconnecting");
  WiFi.disconnect(false);
  WiFi.reconnect();

  unsigned long startedMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedMs < WIFI_RECONNECT_TIMEOUT_MS)
  {
    updateStatusLeds();
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED)
  {
    lastServerError = "WiFi reconnect failed";
    setErrorState();
    showText("WiFi failed", "Check router");
    return false;
  }

  Serial.print("WiFi reconnected: ");
  Serial.println(WiFi.localIP());
  if (currentState == TeddyState::CONNECTION_ERROR)
    setIdleState();
  return true;
}

bool writeAll(WiFiClient &client, const uint8_t *data, size_t length)
{
  size_t sent = 0;
  uint8_t emptyWrites = 0;

  while (sent < length)
  {
    updateStatusLeds();
    size_t chunk = min((size_t)1024, length - sent);
    size_t written = client.write(data + sent, chunk);

    if (written == 0)
    {
      emptyWrites++;
      if (emptyWrites > 20 || !client.connected())
        return false;

      delay(20);
      continue;
    }

    emptyWrites = 0;
    sent += written;
    delay(1);
  }

  return true;
}

bool readExactBody(WiFiClient &client, String &body, size_t targetLength, uint32_t timeoutMs)
{
  unsigned long lastDataMs = millis();

  while (body.length() < targetLength)
  {
    updateStatusLeds();
    while (client.available() > 0 && body.length() < targetLength)
    {
      body += (char)client.read();
      lastDataMs = millis();
    }

    if (millis() - lastDataMs > timeoutMs)
      return false;

    delay(1);
  }

  return true;
}

String readHttpBody(WiFiClient &client, int *statusCodeOut)
{
  *statusCodeOut = -1;
  String statusLine;
  unsigned long statusStartMs = millis();

  while (millis() - statusStartMs < SERVER_READ_TIMEOUT_MS)
  {
    updateStatusLeds();
    if (client.available() > 0)
    {
      statusLine = client.readStringUntil('\n');
      statusLine.trim();
      if (statusLine.length() == 0)
        continue;
      if (statusLine.startsWith("HTTP/1.1 ") || statusLine.startsWith("HTTP/1.0 "))
        break;

      Serial.println("Skipping pre-status line: " + statusLine);
      statusLine = "";
      continue;
    }

    if (!client.connected())
      break;

    delay(1);
  }

  Serial.println("Server status line: " + statusLine);

  if (statusLine.startsWith("HTTP/1.1 ") || statusLine.startsWith("HTTP/1.0 "))
    *statusCodeOut = statusLine.substring(9, 12).toInt();

  bool chunked = false;
  int contentLength = -1;

  while (client.connected() || client.available() > 0)
  {
    updateStatusLeds();
    String line = client.readStringUntil('\n');
    line.trim();
    if (line.length() == 0)
      break;

    String lower = line;
    lower.toLowerCase();
    if (lower.startsWith("transfer-encoding:") && lower.indexOf("chunked") >= 0)
      chunked = true;
    else if (lower.startsWith("content-length:"))
      contentLength = line.substring(line.indexOf(':') + 1).toInt();
  }

  String body;
  body.reserve(contentLength > 0 ? min(contentLength, 4096) : 2048);

  if (chunked)
  {
    while (client.connected() || client.available() > 0)
    {
      updateStatusLeds();
      String sizeLine = client.readStringUntil('\n');
      sizeLine.trim();
      int semicolon = sizeLine.indexOf(';');
      if (semicolon >= 0)
        sizeLine = sizeLine.substring(0, semicolon);

      size_t chunkSize = strtoul(sizeLine.c_str(), NULL, 16);
      if (chunkSize == 0)
        break;

      if (!readExactBody(client, body, body.length() + chunkSize, SERVER_READ_TIMEOUT_MS))
        break;

      client.readStringUntil('\n');
    }
  }
  else if (contentLength >= 0)
  {
    readExactBody(client, body, contentLength, SERVER_READ_TIMEOUT_MS);
  }
  else
  {
    unsigned long lastDataMs = millis();
    while (client.connected() || client.available() > 0)
    {
      updateStatusLeds();
      while (client.available() > 0)
      {
        body += (char)client.read();
        lastDataMs = millis();
      }
      if (millis() - lastDataMs > SERVER_READ_TIMEOUT_MS)
        break;
      delay(1);
    }
  }

  return body;
}

bool connectChatServer(ChatNetworkClient &client)
{
  if (!ensureWiFiReady())
    return false;

  prepareChatClient(client, SERVER_READ_TIMEOUT_MS);

  for (uint8_t attempt = 1; attempt <= SERVER_CONNECT_RETRIES; attempt++)
  {
    updateStatusLeds();
    showText("Sending...", "Server try " + String(attempt));
    Serial.printf("Connecting to %s:%u, try %u/%u\n", CHAT_SERVER_HOST, CHAT_SERVER_PORT, attempt, SERVER_CONNECT_RETRIES);

    if (client.connect(CHAT_SERVER_HOST, CHAT_SERVER_PORT, SERVER_CONNECT_TIMEOUT_MS))
      return true;

    client.stop();
    waitWithStatusLeds(700);
  }

  lastServerError = "Server connect failed";
  setErrorState();
  showText("Server offline", CHAT_SERVER_HOST);
  return false;
}

bool postWavToServer(const uint8_t *wav, size_t wavBytes, ChatServerReply *reply)
{
  lastServerError = "";
  reply->transcription = "";
  reply->text = "";
  reply->audioUrl = "";
  reply->audioCacheKey = "";
  reply->action = "";
  reply->musicQuery = "";
  reply->audioCacheable = false;

  ChatNetworkClient client;
  if (!connectChatServer(client))
    return false;

  String boundary = "----TeddyBoundary";
  boundary += String((uint32_t)millis(), HEX);
  updateRoomClimate(false);
  String localQa = readLocalQaFromSD();

  String head;
  head.reserve(320 + localQa.length());
  if (localQa.length() > 0)
  {
    head += "--" + boundary + "\r\n";
    head += "Content-Disposition: form-data; name=\"local_qa\"\r\n\r\n";
    head += localQa;
    head += "\r\n";
  }
  if (lastDhtOk)
  {
    head += "--" + boundary + "\r\n";
    head += "Content-Disposition: form-data; name=\"room_temperature_c\"\r\n\r\n";
    head += String(lastRoomTempC, 1);
    head += "\r\n";
    head += "--" + boundary + "\r\n";
    head += "Content-Disposition: form-data; name=\"room_humidity_percent\"\r\n\r\n";
    head += String(lastRoomHumidity, 1);
    head += "\r\n";
  }
  head += "--" + boundary + "\r\n";
  head += "Content-Disposition: form-data; name=\"file\"; filename=\"speech.wav\"\r\n";
  head += "Content-Type: audio/wav\r\n\r\n";
  String tail = "\r\n--" + boundary + "--\r\n";
  size_t contentLength = head.length() + wavBytes + tail.length();

  String headers;
  headers.reserve(360);
  headers += "POST " CHAT_SERVER_PATH " HTTP/1.1\r\n";
  headers += "Host: " + String(CHAT_SERVER_HOST) + ":" + String(CHAT_SERVER_PORT) + "\r\n";
  headers += "Content-Type: multipart/form-data; boundary=" + boundary + "\r\n";
  headers += "Content-Length: " + String(contentLength) + "\r\n";
  headers += "Connection: close\r\n\r\n";

  showText("Sending...", "Uploading audio");
  bool sent = true;
  sent = sent && writeAll(client, (const uint8_t *)headers.c_str(), headers.length());
  sent = sent && writeAll(client, (const uint8_t *)head.c_str(), head.length());
  sent = sent && writeAll(client, wav, wavBytes);
  sent = sent && writeAll(client, (const uint8_t *)tail.c_str(), tail.length());

  if (!sent)
  {
    client.stop();
    lastServerError = "Upload failed";
    setErrorState();
    showText("Upload failed", "Try again");
    return false;
  }

  setThinkingState();
  showText("Thinking...");
  int code = -1;
  String response = readHttpBody(client, &code);
  client.stop();

  Serial.printf("Server HTTP: %d\n", code);
  Serial.printf("Server response bytes: %u\n", response.length());
  Serial.println(response);

  if (code != 200)
  {
    lastServerError = "HTTP " + String(code);
    setErrorState();
    DynamicJsonDocument errDoc(2048);
    if (!deserializeJson(errDoc, response))
    {
      if (errDoc["detail"].is<const char *>())
        lastServerError += ": " + String(errDoc["detail"].as<const char *>());
    }
    showWrapped("Server error", lastServerError);
    return false;
  }

  DynamicJsonDocument doc(3072);
  DeserializationError error = deserializeJson(doc, response);
  if (error)
  {
    lastServerError = "Bad server JSON: ";
    lastServerError += error.c_str();
    showText("JSON error", "Server response");
    return false;
  }

  reply->transcription = doc["transcription"] | "";
  reply->text = doc["text"] | "";
  reply->audioUrl = doc["audio_url"] | "";
  reply->audioCacheKey = doc["audio_cache_key"] | "";
  reply->action = doc["action"] | "speak";
  reply->musicQuery = doc["music_query"] | "";
  reply->audioCacheable = doc["audio_cacheable"] | false;
  reply->transcription.trim();
  reply->text.trim();
  reply->audioUrl.trim();
  reply->audioCacheKey.trim();
  reply->action.trim();
  reply->musicQuery.trim();

  if (reply->action == "radio")
    reply->audioUrl = normalizeServerAudioUrl(reply->audioUrl, RADIO_STREAM_PATH);
  else
    reply->audioUrl = normalizeServerAudioUrl(reply->audioUrl, CHAT_AUDIO_PATH);

  Serial.println("Audio URL: " + reply->audioUrl);

  return true;
}

template <typename StreamType>
bool readStreamBytes(StreamType *stream, uint8_t *buffer, size_t length, uint32_t timeoutMs)
{
  size_t offset = 0;
  unsigned long lastDataMs = millis();

  while (offset < length)
  {
    updateStatusLeds();
    int available = stream->available();
    if (available > 0)
    {
      size_t want = min((size_t)available, length - offset);
      int readNow = stream->read(buffer + offset, want);
      if (readNow > 0)
      {
        offset += readNow;
        lastDataMs = millis();
      }
    }
    else
    {
      if (millis() - lastDataMs > timeoutMs)
        return false;
      delay(1);
    }
  }

  return true;
}

template <typename StreamType>
bool skipStreamBytes(StreamType *stream, size_t length)
{
  uint8_t scratch[128];
  size_t skipped = 0;
  while (skipped < length)
  {
    size_t want = min(sizeof(scratch), length - skipped);
    if (!readStreamBytes(stream, scratch, want, AUDIO_READ_TIMEOUT_MS))
      return false;
    skipped += want;
  }
  return true;
}

String hex8(uint32_t value)
{
  char buffer[9];
  snprintf(buffer, sizeof(buffer), "%08lx", (unsigned long)value);
  return String(buffer);
}

uint32_t fnv1aUpdate(uint32_t hash, const String &value)
{
  for (uint16_t i = 0; i < value.length(); i++)
  {
    hash ^= (uint8_t)value[i];
    hash *= 16777619UL;
  }
  return hash;
}

String localReplyAudioCacheKey(const String &prefix, const String &text)
{
  uint32_t first = fnv1aUpdate(2166136261UL, prefix + "\n" + text);
  uint32_t second = fnv1aUpdate(2166136261UL ^ 0x9E3779B9UL, text + "\n" + prefix);
  return hex8(first) + hex8(second);
}

String sanitizeReplyAudioCacheKey(String key)
{
  key.trim();
  key.toLowerCase();
  String clean;
  clean.reserve(min((uint16_t)48, (uint16_t)key.length()));
  for (uint16_t i = 0; i < key.length() && clean.length() < 48; i++)
  {
    char c = key[i];
    if (isalnum((unsigned char)c) || c == '_' || c == '-')
      clean += c;
  }
  return clean;
}

bool ensureReplyCacheDirectory()
{
  if (!sdReady)
    return false;
  if (SD.exists(REPLY_CACHE_DIR))
    return true;
  return SD.mkdir(REPLY_CACHE_DIR);
}

String replyAudioCachePath(String cacheKey)
{
  String clean = sanitizeReplyAudioCacheKey(cacheKey);
  if (clean.length() == 0)
    return "";
  return String(REPLY_CACHE_DIR) + "/" + clean + ".wav";
}

void pruneReplyAudioCache()
{
  if (!sdReady || !SD.exists(REPLY_CACHE_DIR))
    return;

  File dir = SD.open(REPLY_CACHE_DIR, FILE_READ);
  if (!dir || !dir.isDirectory())
  {
    if (dir)
      dir.close();
    return;
  }

  String removable[MAX_REPLY_SD_CACHE_FILES + 8];
  uint16_t count = 0;
  while (true)
  {
    File entry = dir.openNextFile();
    if (!entry)
      break;

    String name = entry.name();
    bool isFile = !entry.isDirectory();
    entry.close();

    name.toLowerCase();
    if (isFile && name.endsWith(".wav"))
    {
      if (count < MAX_REPLY_SD_CACHE_FILES + 8)
        removable[count] = name;
      count++;
    }
  }
  dir.close();

  if (count <= MAX_REPLY_SD_CACHE_FILES)
    return;

  uint16_t removeCount = count - MAX_REPLY_SD_CACHE_FILES;
  for (uint16_t i = 0; i < removeCount && i < MAX_REPLY_SD_CACHE_FILES + 8; i++)
  {
    String name = removable[i];
    if (name.length() == 0)
      continue;
    int slash = name.lastIndexOf('/');
    if (slash >= 0)
      name = name.substring(slash + 1);
    String path = String(REPLY_CACHE_DIR) + "/" + name;
    SD.remove(path);
    Serial.println("[AUDIO] Pruned reply cache: " + path);
  }
}

bool downloadHttpStreamToSD(WiFiClient *stream, int contentLength, const String &path)
{
  if (!sdReady)
    return false;

  if (contentLength > 0 && (uint32_t)contentLength > MAX_REPLY_SD_WAV_BYTES)
  {
    lastServerError = "Reply WAV too large for SD cache";
    return false;
  }

  String tempPath = path + ".tmp";
  if (SD.exists(tempPath))
    SD.remove(tempPath);

  File output = SD.open(tempPath, FILE_WRITE);
  if (!output)
  {
    lastServerError = "Could not open reply SD cache";
    return false;
  }

  uint8_t *buffer = (uint8_t *)allocPlaybackBytes(PLAYBACK_NET_BUFFER_BYTES, "reply sd download buffer");
  if (!buffer)
  {
    output.close();
    lastServerError = "No reply download buffer";
    return false;
  }

  size_t total = 0;
  unsigned long lastDataMs = millis();
  while ((contentLength >= 0 && total < (size_t)contentLength) ||
         (contentLength < 0 && (stream->connected() || stream->available() > 0)))
  {
    updateStatusLeds();
    int available = stream->available();
    if (available > 0)
    {
      size_t want = min((size_t)available, (size_t)PLAYBACK_NET_BUFFER_BYTES);
      if (contentLength >= 0)
        want = min(want, (size_t)contentLength - total);

      int readNow = stream->read(buffer, want);
      if (readNow > 0)
      {
        size_t written = output.write(buffer, (size_t)readNow);
        if (written != (size_t)readNow)
        {
          free(buffer);
          output.close();
          if (SD.exists(tempPath))
            SD.remove(tempPath);
          lastServerError = "Reply SD write failed";
          return false;
        }

        total += (size_t)readNow;
        lastDataMs = millis();
        if (total > MAX_REPLY_SD_WAV_BYTES)
        {
          free(buffer);
          output.close();
          if (SD.exists(tempPath))
            SD.remove(tempPath);
          lastServerError = "Reply WAV too large for SD cache";
          return false;
        }
      }
    }
    else
    {
      if (millis() - lastDataMs > AUDIO_READ_TIMEOUT_MS)
      {
        free(buffer);
        output.close();
        if (SD.exists(tempPath))
          SD.remove(tempPath);
        lastServerError = "Reply SD download timeout";
        return false;
      }
      delay(1);
    }
  }

  free(buffer);
  output.close();
  if (total < 44)
  {
    if (SD.exists(tempPath))
      SD.remove(tempPath);
    lastServerError = "Reply WAV download too small";
    return false;
  }

  if (SD.exists(path))
    SD.remove(path);
  if (!SD.rename(tempPath, path))
  {
    if (SD.exists(tempPath))
      SD.remove(tempPath);
    lastServerError = "Could not save reply SD cache";
    return false;
  }

  Serial.printf("[AUDIO] Saved reply WAV to SD: %lu bytes path=%s\n", (unsigned long)total, path.c_str());
  return true;
}

template <typename StreamType>
bool parseWavHeader(StreamType *stream, uint16_t *channels, uint32_t *sampleRate, uint16_t *bitsPerSample, uint32_t *dataBytes)
{
  uint8_t riff[12];
  if (!readStreamBytes(stream, riff, sizeof(riff), AUDIO_READ_TIMEOUT_MS))
    return false;

  if (memcmp(riff, "RF64", 4) == 0)
  {
    Serial.println("[AUDIO] RF64 WAV is not supported for teddy playback");
    return false;
  }

  if (memcmp(riff, "RIFF", 4) != 0 || memcmp(riff + 8, "WAVE", 4) != 0)
  {
    Serial.print("Bad WAV header first 12 bytes:");
    for (uint8_t i = 0; i < sizeof(riff); i++)
      Serial.printf(" %02X", riff[i]);
    Serial.println();
    return false;
  }

  bool haveFmt = false;
  bool haveData = false;

  while (!haveData)
  {
    uint8_t chunkHeader[8];
    if (!readStreamBytes(stream, chunkHeader, sizeof(chunkHeader), AUDIO_READ_TIMEOUT_MS))
      return false;

    char chunkId[5] = {0};
    memcpy(chunkId, chunkHeader, 4);
    uint32_t chunkSize = readLE32(chunkHeader + 4);
    if (memcmp(chunkId, "data", 4) != 0 && chunkSize > 1024UL * 1024UL)
    {
      Serial.printf("[AUDIO] WAV chunk too large: %.4s size=%lu\n", chunkId, (unsigned long)chunkSize);
      return false;
    }

    size_t paddedSize = (size_t)chunkSize + (chunkSize & 1);
    Serial.printf("[AUDIO] WAV chunk %.4s size=%lu\n", chunkId, (unsigned long)chunkSize);

    if (memcmp(chunkId, "fmt ", 4) == 0)
    {
      if (chunkSize < 16)
        return false;

      uint8_t fmt[40] = {0};
      size_t readSize = min((size_t)chunkSize, sizeof(fmt));
      if (!readStreamBytes(stream, fmt, readSize, AUDIO_READ_TIMEOUT_MS))
        return false;

      uint16_t audioFormat = readLE16(fmt);
      *channels = readLE16(fmt + 2);
      *sampleRate = readLE32(fmt + 4);
      *bitsPerSample = readLE16(fmt + 14);
      Serial.printf("[AUDIO] WAV fmt format=%u channels=%u sampleRate=%lu bits=%u\n",
                    audioFormat,
                    *channels,
                    (unsigned long)*sampleRate,
                    *bitsPerSample);

      if (paddedSize > readSize && !skipStreamBytes(stream, paddedSize - readSize))
        return false;

      bool pcmFormat = audioFormat == 1;
      if (!pcmFormat && audioFormat == 0xFFFE && readSize >= 40)
        pcmFormat = readLE16(fmt + 24) == 1;

      haveFmt = pcmFormat && (*channels == 1 || *channels == 2) && *bitsPerSample == 16;
      haveFmt = haveFmt && *sampleRate >= 8000 && *sampleRate <= 48000;
      if (!haveFmt)
      {
        Serial.printf("Unsupported WAV fmt: format=%u channels=%u sampleRate=%lu bits=%u\n",
                      audioFormat, *channels, (unsigned long)*sampleRate, *bitsPerSample);
        return false;
      }
    }
    else if (memcmp(chunkId, "data", 4) == 0)
    {
      if (!haveFmt)
        return false;

      *dataBytes = chunkSize;
      haveData = true;
    }
    else
    {
      if (!skipStreamBytes(stream, paddedSize))
        return false;
    }
  }

  return haveData;
}

void playSamplePWM(int16_t sample, uint32_t sampleRate)
{
  sample = applyPlaybackGain(sample);
  uint8_t pwm = (uint16_t)(sample + 32768) >> 8;
  ledcWrite(AUDIO_PIN, pwm);
  delayMicroseconds(1000000UL / sampleRate);
}

template <typename StreamType>
bool playPcmFromStream(StreamType *stream,
                       uint16_t channels,
                       uint32_t sampleRate,
                       uint32_t dataBytes,
                       bool liveStream = false,
                       bool animateFace = false,
                       LedMode playbackLedMode = LED_SPEAKING,
                       bool allowRemoteStop = true,
                       bool allowButtonStop = true)
{
  audioStep(5, "I2S INIT");
  if (!configureAudioOutputRate(sampleRate))
  {
    stopAudioOutput();
    return false;
  }

  uint8_t *chunk = (uint8_t *)allocPlaybackBytes(PLAYBACK_NET_BUFFER_BYTES, "playback net buffer");
  if (!chunk)
  {
    lastServerError = "No playback net buffer";
    stopAudioOutput();
    return false;
  }

#if AUDIO_OUTPUT_MODE == AUDIO_OUTPUT_I2S
  int16_t *i2sOut = (int16_t *)allocPlaybackBytes(PLAYBACK_I2S_BUFFER_SAMPLES * sizeof(int16_t), "playback i2s buffer");
  if (!i2sOut)
  {
    free(chunk);
    lastServerError = "No playback I2S buffer";
    stopAudioOutput();
    return false;
  }
#endif

  size_t frameBytes = channels * sizeof(int16_t);
  if (frameBytes == 0)
  {
    free(chunk);
#if AUDIO_OUTPUT_MODE == AUDIO_OUTPUT_I2S
    free(i2sOut);
#endif
    lastServerError = "Bad PCM frame size";
    stopAudioOutput();
    return false;
  }

  uint32_t playedBytes = 0;
  bool stopButtonArmed = !allowButtonStop || !isTalkButtonPressedRaw();
  unsigned long stopButtonPressedSinceMs = 0;
  uint32_t touchStopHoldMs = playbackLedMode == LED_MUSIC ? TOUCH_MUSIC_STOP_HOLD_MS : TOUCH_PLAYBACK_STOP_HOLD_MS;
  bool endlessStream = liveStream && dataBytes == 0xFFFFFFFF;
  unsigned long startedMs = millis();
  bool ok = true;
  bool speakingStarted = false;

  if (animateFace && SPEAKING_FACE_ENABLED)
    showSpeakingFace(true);

  audioStep(6, "DMA START");
  audioStep(7, "PLAYBACK");

  while (playedBytes < dataBytes)
  {
    updateStatusLeds();
    if (allowRemoteStop && checkRemoteStopRequested())
      break;

    if (animateFace && SPEAKING_FACE_ENABLED)
      showSpeakingFace();

    if (liveStream && RADIO_MAX_PLAY_MS > 0 && millis() - startedMs >= RADIO_MAX_PLAY_MS)
    {
      stopAudioOutput();
      break;
    }

    if (playbackTouchStopRequested(allowButtonStop, &stopButtonArmed, &stopButtonPressedSinceMs, touchStopHoldMs))
    {
      lastPlaybackStoppedByButton = true;
      stopAudioOutput();
      break;
    }

    uint32_t remaining = dataBytes - playedBytes;
    size_t want = endlessStream ? PLAYBACK_NET_BUFFER_BYTES : min((size_t)PLAYBACK_NET_BUFFER_BYTES, (size_t)remaining);
    if (!endlessStream && want > remaining)
      want = remaining;
    want -= want % frameBytes;
    if (want == 0)
      break;

    if (!readStreamBytes(stream, chunk, want, AUDIO_READ_TIMEOUT_MS))
    {
      ok = false;
      break;
    }

    if (!speakingStarted)
    {
      if (playbackLedMode == LED_SPEAKING)
        setSpeakingState();
      else
        LedManager.setMode(playbackLedMode);
      speakingStarted = true;
    }

#if AUDIO_OUTPUT_MODE == AUDIO_OUTPUT_I2S
    size_t outSamples = 0;
    size_t maxOutSamples = PLAYBACK_I2S_BUFFER_SAMPLES;

    for (size_t i = 0; i + frameBytes <= want && outSamples + 1 < maxOutSamples; i += frameBytes)
    {
      int16_t left = (int16_t)readLE16(chunk + i);
      int16_t right = channels == 2 ? (int16_t)readLE16(chunk + i + 2) : left;
      i2sOut[outSamples++] = applyPlaybackGain(left);
      i2sOut[outSamples++] = applyPlaybackGain(right);
    }

    size_t bytesWritten = 0;
    size_t bytesToWrite = outSamples * sizeof(int16_t);
    esp_err_t err = i2s_write(I2S_NUM_1, i2sOut, bytesToWrite, &bytesWritten, pdMS_TO_TICKS(I2S_WRITE_TIMEOUT_MS));
    if (err != ESP_OK || bytesWritten != bytesToWrite)
    {
      Serial.printf("[AUDIO] I2S write failed err=%d wrote=%lu expected=%lu\n",
                    (int)err,
                    (unsigned long)bytesWritten,
                    (unsigned long)bytesToWrite);
      ok = false;
      break;
    }
#else
    for (size_t i = 0; i + frameBytes <= want; i += frameBytes)
    {
      if (playbackTouchStopRequested(allowButtonStop, &stopButtonArmed, &stopButtonPressedSinceMs, touchStopHoldMs))
      {
        lastPlaybackStoppedByButton = true;
        stopAudioOutput();
        break;
      }

      int16_t sample = (int16_t)readLE16(chunk + i);
      if (channels == 2)
      {
        int16_t right = (int16_t)readLE16(chunk + i + 2);
        sample = (int16_t)(((int32_t)sample + (int32_t)right) / 2);
      }
      playSamplePWM(sample, sampleRate);
    }
#endif

    if (lastPlaybackStoppedByButton)
      break;

    playedBytes += want;
    delay(1);
  }

  stopAudioOutput();
#if AUDIO_OUTPUT_MODE == AUDIO_OUTPUT_I2S
  free(i2sOut);
#endif
  free(chunk);
  if (currentState != TeddyState::CONNECTION_ERROR)
    setIdleState();
  audioStatus(ok ? "playback done" : "playback failed");
  return ok;
}

bool playReplyWavFromSD(const char *path, const String &replyText, bool animateFace)
{
  File file = SD.open(path, FILE_READ);
  if (!file)
  {
    lastServerError = "Could not open reply WAV from SD";
    return false;
  }

  uint16_t channels = 0;
  uint16_t bitsPerSample = 0;
  uint32_t sampleRate = 0;
  uint32_t dataBytes = 0;

  audioStep(4, "SD WAV HEADER");
  if (!parseWavHeader(&file, &channels, &sampleRate, &bitsPerSample, &dataBytes))
  {
    file.close();
    lastServerError = "Unsupported SD reply WAV";
    showText("WAV error", "Need 16-bit PCM");
    return false;
  }

  Serial.printf("Playing SD reply WAV: %lu Hz, %u ch, %u bits, %lu bytes\n",
                (unsigned long)sampleRate,
                channels,
                bitsPerSample,
                (unsigned long)dataBytes);
  audioStatus("sd wav parsed");
  if (animateFace && SPEAKING_FACE_ENABLED)
    showSpeakingFace(true);
  else
    showWrapped("Speaking...", replyText);

  bool played = playPcmFromStream(&file, channels, sampleRate, dataBytes, false, animateFace, LED_SPEAKING, false, true);
  file.close();
  return played;
}

bool downloadAndPlayWav(const String &audioUrl, const String &replyText, bool liveStream = false, bool animateFace = false, const String &audioCacheKey = "")
{
  lastPlaybackStoppedByButton = false;
  audioStep(1, "HTTP BEGIN");
  Serial.println(String(liveStream ? "Streaming audio: " : "Downloading audio: ") + audioUrl);

  String cachePath = "";
  if (!liveStream && sdReady && audioCacheKey.length() > 0 && ensureReplyCacheDirectory())
  {
    cachePath = replyAudioCachePath(audioCacheKey);
    if (cachePath.length() > 0 && SD.exists(cachePath))
    {
      Serial.println("[AUDIO] Reply SD cache hit: " + cachePath);
      showText("Speaking...", "Cached reply");
      bool playedCached = playReplyWavFromSD(cachePath.c_str(), replyText, animateFace);
      if (lastPlaybackStoppedByButton)
      {
        showText("Stopped", "Release TALK");
        return true;
      }
      if (playedCached)
        return true;
      Serial.println("[AUDIO] Reply SD cache invalid, removing: " + cachePath);
      SD.remove(cachePath);
    }
  }

  if (!ensureWiFiReady())
    return false;

  HTTPClient http;
  ChatNetworkClient client;
  prepareChatClient(client, AUDIO_READ_TIMEOUT_MS);

  showText("Speaking...", liveStream ? "Streaming" : "Downloading");
  if (!http.begin(client, audioUrl))
  {
    lastServerError = "Bad audio URL";
    setErrorState();
    showText("Audio URL error");
    client.stop();
    return false;
  }

  http.setTimeout(AUDIO_READ_TIMEOUT_MS);
  http.useHTTP10(true);
  audioStep(2, "HTTP GET");
  int code = http.GET();
  Serial.printf("Audio HTTP: %d\n", code);
  if (code != HTTP_CODE_OK)
  {
    lastServerError = "Audio HTTP " + String(code);
    setErrorState();
    showText("Audio error", String(code));
    http.end();
    client.stop();
    return false;
  }

  audioStep(3, "STREAM OPEN");
  WiFiClient *stream = http.getStreamPtr();

  int contentLength = http.getSize();
  Serial.printf("[AUDIO] contentLength=%d sdReady=%d liveStream=%d\n", contentLength, sdReady ? 1 : 0, liveStream ? 1 : 0);
  if (!liveStream && sdReady)
  {
    audioStep(4, "SD DOWNLOAD");
    String targetPath = cachePath.length() > 0 ? cachePath : String(REPLY_DOWNLOAD_PATH);
    bool downloaded = downloadHttpStreamToSD(stream, contentLength, targetPath);
    http.end();
    client.stop();
    if (!downloaded)
    {
      setErrorState();
      showWrapped("Audio download failed", lastServerError);
      return false;
    }

    if (cachePath.length() > 0)
      pruneReplyAudioCache();

    bool playedFromSd = playReplyWavFromSD(targetPath.c_str(), replyText, animateFace);
    if (lastPlaybackStoppedByButton)
    {
      showText("Stopped", "Release TALK");
      return true;
    }
    if (!playedFromSd)
    {
      setErrorState();
      showWrapped("Audio failed", lastServerError);
      return false;
    }
    return true;
  }

  if (!liveStream && contentLength > 44 && contentLength <= MAX_REPLY_RAM_WAV_BYTES)
  {
    uint8_t *audioBuffer = (uint8_t *)allocPlaybackBytes((size_t)contentLength, "reply wav ram buffer");
    if (audioBuffer && !readStreamBytes(stream, audioBuffer, (size_t)contentLength, AUDIO_READ_TIMEOUT_MS))
    {
      free(audioBuffer);
      http.end();
      client.stop();
      lastServerError = "Audio download timeout";
      setErrorState();
      showText("Audio timeout", "Try again");
      return false;
    }

    if (audioBuffer)
    {
      http.end();
      client.stop();

      MemoryReadStream memoryStream(audioBuffer, (size_t)contentLength);
      uint16_t memoryChannels = 0;
      uint16_t memoryBitsPerSample = 0;
      uint32_t memorySampleRate = 0;
      uint32_t memoryDataBytes = 0;

      audioStep(4, "RAM WAV HEADER");
      if (!parseWavHeader(&memoryStream, &memoryChannels, &memorySampleRate, &memoryBitsPerSample, &memoryDataBytes))
      {
        free(audioBuffer);
        lastServerError = "Unsupported RAM WAV";
        showText("WAV error", "Need 16-bit PCM");
        return false;
      }

      Serial.printf("Playing RAM WAV: %lu Hz, %u ch, %u bits, %lu bytes\n",
                    (unsigned long)memorySampleRate,
                    memoryChannels,
                    memoryBitsPerSample,
                    (unsigned long)memoryDataBytes);
      if (animateFace && SPEAKING_FACE_ENABLED)
        showSpeakingFace(true);
      else
        showWrapped("Speaking...", replyText);

      bool played = playPcmFromStream(&memoryStream, memoryChannels, memorySampleRate, memoryDataBytes, false, animateFace, LED_SPEAKING, false, true);
      free(audioBuffer);

      if (lastPlaybackStoppedByButton)
      {
        showText("Stopped", "Release TALK");
        return true;
      }

      if (!played)
      {
        lastServerError = "RAM audio playback failed";
        setErrorState();
        showText("Audio failed", "Try again");
        return false;
      }

      return true;
    }

    Serial.println("[AUDIO] RAM buffering unavailable; streaming reply audio");
  }

  uint16_t channels = 0;
  uint16_t bitsPerSample = 0;
  uint32_t sampleRate = 0;
  uint32_t dataBytes = 0;

  audioStep(4, "WAV HEADER");
  if (!parseWavHeader(stream, &channels, &sampleRate, &bitsPerSample, &dataBytes))
  {
    lastServerError = "Unsupported WAV";
    showText("WAV error", "Need 16-bit PCM");
    http.end();
    client.stop();
    return false;
  }

  if (liveStream && dataBytes == 0)
    dataBytes = 0xFFFFFFFF;

  Serial.printf("Playing WAV: %lu Hz, %u ch, %u bits, %lu bytes\n",
                (unsigned long)sampleRate, channels, bitsPerSample, (unsigned long)dataBytes);
  audioStatus("wav parsed");
  if (animateFace && SPEAKING_FACE_ENABLED)
    showSpeakingFace(true);
  else
    showWrapped("Speaking...", replyText);
  bool played = playPcmFromStream(stream, channels, sampleRate, dataBytes, liveStream, animateFace, LED_SPEAKING, liveStream, true);
  http.end();
  client.stop();

  if (lastPlaybackStoppedByButton)
  {
    showText("Stopped", "Release TALK");
    return true;
  }

  if (!played)
  {
    lastServerError = "Audio stream timeout";
    setErrorState();
    showText("Audio timeout", "Try again");
    return false;
  }

  return true;
}

#if BIBLE_MP3_HELIX_AVAILABLE
static void bibleMp3PcmCallback(MP3FrameInfo &info, int16_t *pcmBuffer, size_t len, void *ref)
{
  (void)ref;
  uint32_t sampleRate = (uint32_t)info.samprate;
  int channels = max(1, min(2, info.nChans));
  if (speakerOutputSampleRate != sampleRate)
    configureAudioOutputRate(sampleRate);

#if AUDIO_OUTPUT_MODE == AUDIO_OUTPUT_I2S
  size_t bytesWritten = 0;
  i2s_write(I2S_NUM_1, pcmBuffer, len * sizeof(int16_t), &bytesWritten, pdMS_TO_TICKS(I2S_WRITE_TIMEOUT_MS));
#else
  for (size_t i = 0; i < len; i += channels)
  {
    int16_t sample = pcmBuffer[i];
    if (channels == 2 && i + 1 < len)
      sample = (int16_t)(((int32_t)sample + (int32_t)pcmBuffer[i + 1]) / 2);
    playSamplePWM(sample, sampleRate);
  }
#endif
}
#endif

bool playLocalMp3File(const String &path, const String &label)
{
#if BIBLE_MP3_HELIX_AVAILABLE
  File file = SD.open(path, FILE_READ);
  if (!file)
  {
    lastServerError = "Could not open local MP3";
    return false;
  }

  lastPlaybackStoppedByButton = false;
  showWrapped("Bible", label);
  setSpeakingState();
  libhelix::MP3DecoderHelix decoder(bibleMp3PcmCallback);
  decoder.begin();

  uint8_t *buffer = (uint8_t *)allocPlaybackBytes(PLAYBACK_NET_BUFFER_BYTES, "local mp3 buffer");
  if (!buffer)
  {
    file.close();
    lastServerError = "No MP3 buffer";
    return false;
  }

  bool stopButtonArmed = !isTalkButtonPressedRaw();
  unsigned long stopButtonPressedSinceMs = 0;
  bool ok = true;

  while (file.available() > 0)
  {
    updateStatusLeds();
    if (checkRemoteStopRequested() ||
        playbackTouchStopRequested(true, &stopButtonArmed, &stopButtonPressedSinceMs, TOUCH_PLAYBACK_STOP_HOLD_MS))
    {
      lastPlaybackStoppedByButton = true;
      break;
    }

    size_t want = min((size_t)file.available(), (size_t)PLAYBACK_NET_BUFFER_BYTES);
    int readNow = file.read(buffer, want);
    if (readNow <= 0)
    {
      ok = false;
      lastServerError = "MP3 SD read failed";
      break;
    }
    decoder.write(buffer, (size_t)readNow);
    delay(1);
  }

  decoder.end();
  free(buffer);
  file.close();
  stopAudioOutput();
  setIdleState();
  return ok || lastPlaybackStoppedByButton;
#else
  (void)path;
  (void)label;
#if ENABLE_BIBLE_MP3_HELIX
  lastServerError = "MP3DecoderHelix.h is missing from Arduino libraries";
#else
  lastServerError = "MP3 playback disabled";
#endif
  return false;
#endif
}

bool playLocalBibleChapter(const String &requestText)
{
  LocalBibleChapter chapter;
  if (!localBible.resolveReference(requestText, chapter))
  {
    lastServerError = localBible.lastError();
    return false;
  }

  Serial.printf("[BIBLE] Playing from SD: %s %03d %s\n",
                chapter.bookCode.c_str(),
                chapter.chapter,
                chapter.path.c_str());
  return playLocalMp3File(chapter.path, chapter.bookName + " " + String(chapter.chapter));
}

String localBibleStatusJson()
{
  return localBible.statusJson();
}

bool requestSpeechAudio(const String &speechText, String *audioUrlOut)
{
  *audioUrlOut = "";

  if (!ensureWiFiReady())
    return false;

  HTTPClient http;
  ChatNetworkClient client;
  prepareChatClient(client, SERVER_READ_TIMEOUT_MS);
  String url = buildServerUrl("/speak?text=") + urlEncode(speechText);

  showText("Preparing voice");
  if (!http.begin(client, url))
  {
    lastServerError = "Bad speak URL";
    setErrorState();
    showText("Voice URL error");
    client.stop();
    return false;
  }

  http.setTimeout(SERVER_READ_TIMEOUT_MS);
  int code = http.GET();
  String response = http.getString();
  http.end();
  client.stop();

  if (code != HTTP_CODE_OK)
  {
    lastServerError = "Voice HTTP " + String(code);
    setErrorState();
    showText("Voice error", String(code));
    return false;
  }

  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, response);
  if (error)
  {
    lastServerError = "Bad voice JSON";
    showText("Voice JSON error");
    return false;
  }

  String audioUrl = doc["audio_url"] | "";
  audioUrl.trim();
  audioUrl = normalizeServerAudioUrl(audioUrl, CHAT_AUDIO_PATH);

  *audioUrlOut = audioUrl;
  return true;
}

bool speakText(const String &speechText)
{
  String audioCacheKey = localReplyAudioCacheKey("tts", speechText);
  if (sdReady && ensureReplyCacheDirectory())
  {
    String cachePath = replyAudioCachePath(audioCacheKey);
    if (cachePath.length() > 0 && SD.exists(cachePath))
    {
      Serial.println("[AUDIO] Local speech SD cache hit: " + cachePath);
      bool playedCached = playReplyWavFromSD(cachePath.c_str(), speechText, true);
      showText(WiFi.status() == WL_CONNECTED ? "Ready" : "WiFi offline",
               WiFi.status() == WL_CONNECTED ? "Press TALK" : "Check router");
      if (playedCached)
        return true;
      SD.remove(cachePath);
    }
  }

  String audioUrl;
  if (!requestSpeechAudio(speechText, &audioUrl))
    return false;

  bool ok = downloadAndPlayWav(audioUrl, speechText, false, true, audioCacheKey);
  showText(WiFi.status() == WL_CONNECTED ? "Ready" : "WiFi offline",
           WiFi.status() == WL_CONNECTED ? "Press TALK" : "Check router");
  return ok;
}

bool handleReminderCommand(const String &transcription)
{
  char response[180];
  if (!reminderManager.handleVoiceCommand(transcription.c_str(), response, sizeof(response)))
    return false;

  Serial.println("[REMINDER] Command handled: " + String(response));
  showWrapped("Reminder", response);
  speakText(String(response));
  return true;
}

bool handleDueReminder()
{
  reminderManager.processDue();

  char message[ReminderManager::MAX_MESSAGE_LEN];
  uint16_t reminderId = 0;
  if (!reminderManager.consumeTriggered(message, sizeof(message), &reminderId))
    return false;

  String reminderText(message);
  reminderText.trim();
  if (reminderText.length() == 0)
    reminderText = "reminder";

  Serial.printf("[REMINDER] Speaking id=%u message=%s\n", reminderId, reminderText.c_str());

  String lower = reminderText;
  lower.toLowerCase();
  String speech;
  String displayText;
  if (lower.startsWith("pray"))
  {
    displayText = "Time for prayer";
    speech = "Hello Jeremiah, it is time for your prayer.";
  }
  else if (lower.startsWith("take ") || lower.startsWith("drink ") ||
           lower.startsWith("attend ") || lower.startsWith("call ") || lower.startsWith("go ") ||
           lower.startsWith("check ") || lower.startsWith("read "))
  {
    displayText = "Time to " + reminderText;
    speech = "Hello Jeremiah, it is time to " + reminderText + ".";
  }
  else
  {
    displayText = "Time for your " + reminderText;
    speech = "Hello Jeremiah, it is time for your " + reminderText + ".";
  }

  showWrapped("Reminder:", displayText);
  speakText(speech);
  return true;
}

void handleClimateMonitor()
{
  if (!updateRoomClimate(false))
    return;

  int8_t alertState = 0;
  if (lastRoomTempC > ROOM_TEMP_HOT_C)
    alertState = 1;
  else if (lastRoomTempC < ROOM_TEMP_COLD_C)
    alertState = -1;

  if (alertState == 0)
  {
    lastClimateAlertState = 0;
    return;
  }

  unsigned long now = millis();
  bool stateChanged = alertState != lastClimateAlertState;
  bool cooldownExpired = now - lastClimateAlertMs >= CLIMATE_ALERT_COOLDOWN_MS;
  if (!stateChanged && !cooldownExpired)
    return;

  lastClimateAlertState = alertState;
  lastClimateAlertMs = now;

  String speechText;
  if (alertState > 0)
    speechText = "Oh, I am feeling very hot. Please check the temperature.";
  else
    speechText = "Oh, I am feeling very cold. Please warm up the room a little.";

  Serial.println("Climate alert: " + speechText);
  showWrapped("Room alert", speechText);
  speakText(speechText);
}

bool downloadAndPlayRawPcm(const String &audioUrl, const String &replyText)
{
  lastPlaybackStoppedByButton = false;
  Serial.println("Streaming raw PCM: " + audioUrl);

  if (!ensureWiFiReady())
    return false;

  HTTPClient http;
  ChatNetworkClient client;
  prepareChatClient(client, AUDIO_READ_TIMEOUT_MS);

  showText("Radio...", "Connecting");
  if (!http.begin(client, audioUrl))
  {
    lastServerError = "Bad radio URL";
    setErrorState();
    showText("Radio URL error");
    client.stop();
    return false;
  }

  http.setTimeout(AUDIO_READ_TIMEOUT_MS);
  http.useHTTP10(true);
  int code = http.GET();
  Serial.printf("Radio HTTP: %d\n", code);
  if (code != HTTP_CODE_OK)
  {
    lastServerError = "Radio HTTP " + String(code);
    setErrorState();
    showText("Radio error", String(code));
    http.end();
    client.stop();
    return false;
  }

  WiFiClient *stream = http.getStreamPtr();
  showWrapped("Radio", replyText);
  bool played = playPcmFromStream(
      stream,
      RADIO_STREAM_CHANNELS,
      RADIO_STREAM_SAMPLE_RATE,
      0xFFFFFFFF,
      true,
      false,
      LED_RADIO,
      false,
      true);
  http.end();
  client.stop();

  if (lastPlaybackStoppedByButton)
  {
    showText("Stopped", "Release TALK");
    return true;
  }

  if (!played)
  {
    lastServerError = "Radio stream timeout";
    setErrorState();
    showText("Radio timeout", "Try again");
    return false;
  }

  return true;
}

bool fetchRemoteCommand(RemoteCommand *command, uint32_t timeoutMs = REMOTE_CONTROL_READ_TIMEOUT_MS, bool *requestOk = nullptr)
{
  command->id = "";
  command->action = "";
  command->text = "";
  if (requestOk)
    *requestOk = false;

#if !REMOTE_CONTROL_ENABLED
  return false;
#else
  if (WiFi.status() != WL_CONNECTED)
    return false;

  HTTPClient http;
  ChatNetworkClient client;
  prepareChatClient(client, timeoutMs);
  String url = buildServerUrl(REMOTE_COMMAND_PATH);

  if (!http.begin(client, url))
  {
    client.stop();
    return false;
  }

  http.setTimeout(timeoutMs);
  int code = http.GET();
  String response = http.getString();
  http.end();
  client.stop();

  if (code != HTTP_CODE_OK || response.length() == 0)
    return false;
  if (requestOk)
    *requestOk = true;

  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, response);
  if (error || doc["command"].isNull())
    return false;

  JsonObject remote = doc["command"].as<JsonObject>();
  command->id = remote["id"] | "";
  command->action = remote["action"] | "";
  command->text = remote["text"] | "";
  command->action.trim();
  command->action.toLowerCase();
  command->text.trim();

  return command->action.length() > 0;
#endif
}

String normalizeRemoteSdPath(String path)
{
  path.trim();
  path.replace('\\', '/');
  if (path.length() == 0)
    path = "/";
  if (!path.startsWith("/"))
    path = "/" + path;
  while (path.indexOf("//") >= 0)
    path.replace("//", "/");
  if (path.indexOf("..") >= 0)
    return "/";
  if (path.length() > 1 && path.endsWith("/"))
    path.remove(path.length() - 1);
  return path;
}

String joinRemoteSdPath(const String &dir, String name)
{
  name.replace('\\', '/');
  int slash = name.lastIndexOf('/');
  if (slash >= 0)
    name = name.substring(slash + 1);
  name.trim();
  if (name.length() == 0 || name.indexOf("..") >= 0)
    return "";
  String base = normalizeRemoteSdPath(dir);
  if (base == "/")
    return "/" + name;
  return base + "/" + name;
}

bool ensureRemoteSdDirectory(String dir)
{
  dir = normalizeRemoteSdPath(dir);
  if (dir == "/" || SD.exists(dir))
    return true;

  String current = "";
  int start = 1;
  while (start < dir.length())
  {
    int slash = dir.indexOf('/', start);
    String part = slash >= 0 ? dir.substring(start, slash) : dir.substring(start);
    current += "/" + part;
    if (!SD.exists(current) && !SD.mkdir(current))
      return false;
    if (slash < 0)
      break;
    start = slash + 1;
  }
  return SD.exists(dir);
}

String remoteSdListJson(String dirPath)
{
  String dir = normalizeRemoteSdPath(dirPath);
  File root = SD.open(dir, FILE_READ);
  if (!root || !root.isDirectory())
  {
    if (root)
      root.close();
    return "{\"ok\":false,\"detail\":\"Folder unavailable\",\"data\":{\"path\":\"" + jsonEscapeValue(dir) + "\",\"items\":[]}}";
  }

  String json;
  json.reserve(4096);
  json += "{\"path\":\"";
  json += jsonEscapeValue(dir);
  json += "\",\"sdcard_active\":true,\"source\":\"cloud\",\"items\":[";

  bool first = true;
  while (true)
  {
    File entry = root.openNextFile();
    if (!entry)
      break;

    String name = baseNameFromPath(String(entry.name()));
    if (name.length() > 0)
    {
      if (!first)
        json += ",";
      first = false;
      json += "{\"name\":\"";
      json += jsonEscapeValue(name);
      json += "\",\"path\":\"";
      json += jsonEscapeValue(joinRemoteSdPath(dir, name));
      json += "\",\"type\":\"";
      json += entry.isDirectory() ? "directory" : "file";
      json += "\",\"size\":";
      json += String((uint32_t)entry.size());
      json += ",\"modified\":\"\",\"editable\":false}";
    }
    entry.close();
  }
  root.close();
  json += "]}";
  return "{\"ok\":true,\"detail\":\"\",\"data\":" + json + "}";
}

bool postRemoteSdResult(const String &id, const String &action, bool ok, const String &detail, const String &dataJson = "{}")
{
  if (WiFi.status() != WL_CONNECTED || id.length() == 0)
    return false;

  String body;
  body.reserve(256 + dataJson.length());
  body += "{\"id\":\"" + jsonEscapeValue(id) + "\",";
  body += "\"action\":\"" + jsonEscapeValue(action) + "\",";
  body += "\"ok\":";
  body += ok ? "true" : "false";
  body += ",\"detail\":\"" + jsonEscapeValue(detail) + "\",";
  body += "\"data\":";
  body += dataJson.length() ? dataJson : "{}";
  body += "}";

  HTTPClient http;
  ChatNetworkClient client;
  prepareChatClient(client, REMOTE_SD_TIMEOUT_MS);
  if (!http.begin(client, buildServerUrl(REMOTE_SD_RESULT_PATH)))
  {
    client.stop();
    return false;
  }
  http.setTimeout(REMOTE_SD_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();
  client.stop();
  return code == HTTP_CODE_OK;
}

bool downloadRemoteSdUpload(const String &downloadPath, const String &targetPath, bool overwrite)
{
  if (SD.exists(targetPath) && !overwrite)
    return false;

  String tempPath = targetPath + ".upload";
  if (SD.exists(tempPath))
    SD.remove(tempPath);

  HTTPClient http;
  ChatNetworkClient client;
  prepareChatClient(client, REMOTE_SD_UPLOAD_TIMEOUT_MS);
  String url = buildServerUrl(downloadPath.c_str());
  if (!http.begin(client, url))
  {
    client.stop();
    return false;
  }

  http.setTimeout(REMOTE_SD_UPLOAD_TIMEOUT_MS);
  int code = http.GET();
  if (code != HTTP_CODE_OK)
  {
    http.end();
    client.stop();
    return false;
  }

  File output = SD.open(tempPath, FILE_WRITE);
  if (!output)
  {
    http.end();
    client.stop();
    return false;
  }

  WiFiClient *stream = http.getStreamPtr();
  uint8_t *buffer = (uint8_t *)allocPlaybackBytes(PLAYBACK_NET_BUFFER_BYTES, "remote sd upload buffer");
  if (!buffer)
  {
    output.close();
    if (SD.exists(tempPath))
      SD.remove(tempPath);
    http.end();
    client.stop();
    return false;
  }

  int contentLength = http.getSize();
  int remaining = contentLength;
  unsigned long lastDataMs = millis();
  while (http.connected() && (remaining > 0 || contentLength < 0))
  {
    updateStatusLeds();
    size_t available = stream->available();
    if (available)
    {
      size_t want = min(available, (size_t)PLAYBACK_NET_BUFFER_BYTES);
      int readNow = stream->readBytes(buffer, want);
      if (readNow > 0)
      {
        output.write(buffer, readNow);
        if (remaining > 0)
          remaining -= readNow;
        lastDataMs = millis();
      }
    }
    else if (millis() - lastDataMs > REMOTE_SD_TIMEOUT_MS)
      break;
    delay(1);
  }

  free(buffer);
  output.close();
  http.end();
  client.stop();

  bool complete = contentLength < 0 || remaining <= 0;
  if (!complete)
  {
    if (SD.exists(tempPath))
      SD.remove(tempPath);
    return false;
  }

  if (SD.exists(targetPath))
    SD.remove(targetPath);
  if (!SD.rename(tempPath, targetPath))
  {
    if (SD.exists(tempPath))
      SD.remove(tempPath);
    return false;
  }

  return true;
}

bool handleRemoteSdRequest(const JsonObject &request)
{
  String id = request["id"] | "";
  String action = request["action"] | "";
  JsonObject payload = request["payload"].as<JsonObject>();
  action.trim();
  action.toLowerCase();

  if (!sdReady)
    return postRemoteSdResult(id, action, false, "SD card is not ready");

  if (action == "bible_status")
  {
    String status = localBible.statusJson();
    return postRemoteSdResult(id, action, true, "", status);
  }

  if (action == "list")
  {
    String result = remoteSdListJson(payload["path"] | "/");
    bool ok = result.indexOf("\"ok\":true") >= 0;
    int dataIndex = result.indexOf("\"data\":");
    String dataJson = dataIndex >= 0 ? result.substring(dataIndex + 7, result.length() - 1) : "{}";
    return postRemoteSdResult(id, action, ok, ok ? "" : "Folder unavailable", dataJson);
  }

  if (action == "mkdir")
  {
    String dir = payload["path"] | "/";
    String name = payload["name"] | "";
    String target = joinRemoteSdPath(dir, name);
    bool ok = target.length() > 0 && ensureRemoteSdDirectory(target);
    return postRemoteSdResult(id, action, ok, ok ? "Folder ready" : "Could not create folder", "{\"path\":\"" + jsonEscapeValue(target) + "\"}");
  }

  if (action == "upload")
  {
    String dir = payload["path"] | "/";
    String name = payload["name"] | "";
    String downloadPath = payload["download_path"] | "";
    bool overwrite = payload["overwrite"] | false;
    String target = joinRemoteSdPath(dir, name);
    if (target.length() > 0 && SD.exists(target) && !overwrite)
      return postRemoteSdResult(id, action, false, "File already exists on SD", "{\"path\":\"" + jsonEscapeValue(target) + "\"}");
    bool ok = target.length() > 0 && downloadPath.length() > 0 && ensureRemoteSdDirectory(dir) && downloadRemoteSdUpload(downloadPath, target, overwrite);
    return postRemoteSdResult(id, action, ok, ok ? "Uploaded to SD" : "Upload to SD failed", "{\"path\":\"" + jsonEscapeValue(target) + "\"}");
  }

  return postRemoteSdResult(id, action, false, "Unsupported SD action");
}

bool handleRemoteSdRelay()
{
#if !REMOTE_CONTROL_ENABLED
  return false;
#else
  unsigned long now = millis();
  if (now - lastRemoteSdPollMs < REMOTE_SD_POLL_MS)
    return false;
  if (lastRemoteSdFailureMs > 0 && now - lastRemoteSdFailureMs < REMOTE_CONTROL_FAILURE_BACKOFF_MS)
    return false;
  lastRemoteSdPollMs = now;

  if (WiFi.status() != WL_CONNECTED)
    return false;

  HTTPClient http;
  ChatNetworkClient client;
  prepareChatClient(client, REMOTE_SD_POLL_TIMEOUT_MS);
  if (!http.begin(client, buildServerUrl(REMOTE_SD_NEXT_PATH)))
  {
    client.stop();
    return false;
  }
  http.setTimeout(REMOTE_SD_POLL_TIMEOUT_MS);
  int code = http.GET();
  String response = http.getString();
  http.end();
  client.stop();

  if (code != HTTP_CODE_OK || response.length() == 0)
  {
    lastRemoteSdFailureMs = now;
    return false;
  }
  lastRemoteSdFailureMs = 0;

  DynamicJsonDocument doc(2048);
  DeserializationError error = deserializeJson(doc, response);
  if (error || doc["request"].isNull())
    return false;

  JsonObject request = doc["request"].as<JsonObject>();
  return handleRemoteSdRequest(request);
#endif
}

bool checkRemoteStopRequested()
{
#if !REMOTE_CONTROL_ENABLED
  return false;
#else
  static unsigned long lastRemoteStopPollMs = 0;
  static unsigned long lastRemoteStopFailureMs = 0;
  unsigned long now = millis();
  if (now - lastRemoteStopPollMs < REMOTE_STOP_POLL_MS)
    return false;
  if (lastRemoteStopFailureMs > 0 && now - lastRemoteStopFailureMs < REMOTE_CONTROL_FAILURE_BACKOFF_MS)
    return false;

  lastRemoteStopPollMs = now;

  if (WiFi.status() != WL_CONNECTED)
    return false;

  HTTPClient http;
  ChatNetworkClient client;
  prepareChatClient(client, REMOTE_STOP_READ_TIMEOUT_MS);
  String url = buildServerUrl(REMOTE_STATUS_PATH);

  if (!http.begin(client, url))
  {
    client.stop();
    return false;
  }

  http.setTimeout(REMOTE_STOP_READ_TIMEOUT_MS);
  int code = http.GET();
  String response = http.getString();
  http.end();
  client.stop();

  if (code != HTTP_CODE_OK || response.length() == 0)
  {
    lastRemoteStopFailureMs = now;
    return false;
  }

  DynamicJsonDocument doc(768);
  DeserializationError error = deserializeJson(doc, response);
  if (error || doc["pending"].isNull())
  {
    lastRemoteStopFailureMs = 0;
    return false;
  }
  lastRemoteStopFailureMs = 0;

  String action = doc["pending"]["action"] | "";
  action.trim();
  action.toLowerCase();
  if (action != "stop")
    return false;

  RemoteCommand command;
  fetchRemoteCommand(&command, REMOTE_STOP_READ_TIMEOUT_MS);
  lastPlaybackStoppedByButton = true;
  lastStopRequested = true;
  stopAudioOutput();
  showText("Stopped", "Remote command");
  Serial.println("[REMOTE] Stop requested during active work");
  return true;
#endif
}

bool handleRemoteControl()
{
#if !REMOTE_CONTROL_ENABLED
  return false;
#else
  unsigned long now = millis();
  if (now - lastRemoteControlPollMs < REMOTE_CONTROL_POLL_MS)
    return false;
  if (lastRemoteControlFailureMs > 0 && now - lastRemoteControlFailureMs < REMOTE_CONTROL_FAILURE_BACKOFF_MS)
    return false;

  lastRemoteControlPollMs = now;

  RemoteCommand command;
  bool requestOk = false;
  if (!fetchRemoteCommand(&command, REMOTE_CONTROL_READ_TIMEOUT_MS, &requestOk))
  {
    if (!requestOk)
      lastRemoteControlFailureMs = now;
    return false;
  }

  lastRemoteControlFailureMs = 0;

  Serial.printf("[REMOTE] id=%s action=%s text=%s\n",
                command.id.c_str(),
                command.action.c_str(),
                command.text.c_str());

  if (command.action == "speak")
  {
    if (command.text.length() == 0)
      return false;

    showWrapped("Remote", command.text);
    speakText(command.text);
    return true;
  }

  if (command.action == "radio")
  {
    downloadAndPlayRawPcm(buildServerUrl(RADIO_STREAM_PATH), "Remote radio");
    showText(WiFi.status() == WL_CONNECTED ? "Ready" : "WiFi offline",
             WiFi.status() == WL_CONNECTED ? "Press TALK" : "Check router");
    return true;
  }

  if (command.action == "stop")
  {
    lastPlaybackStoppedByButton = true;
    lastStopRequested = true;
    stopAudioOutput();
    showText("Stopped", "Remote command");
    return true;
  }

  if (command.action == "ready")
  {
    showText(WiFi.status() == WL_CONNECTED ? "Ready" : "WiFi offline",
             WiFi.status() == WL_CONNECTED ? "Press TALK" : "Check router");
    return true;
  }

  if (command.action == "listen")
  {
    showText("Remote listen", "Speak now");
    return runConversationTurn(false, "Remote listen");
  }

  return false;
#endif
}

bool isSupportedMusicFile(String name)
{
  name.toLowerCase();
  return name.endsWith(".wav");
}

bool isSupportedStoryFile(String name)
{
  name.toLowerCase();
  return name.endsWith(".wav") || name.endsWith(".txt") || name.endsWith(".json");
}

String baseNameFromPath(String path)
{
  path.replace('\\', '/');
  int slash = path.lastIndexOf('/');
  if (slash >= 0)
    return path.substring(slash + 1);
  return path;
}

String resolveSdDirectory(const char *preferred, const char *alternate = nullptr)
{
  if (SD.exists(preferred))
    return String(preferred);
  if (alternate && SD.exists(alternate))
    return String(alternate);

  String preferredName = baseNameFromPath(String(preferred));
  String alternateName = alternate ? baseNameFromPath(String(alternate)) : "";
  preferredName.toLowerCase();
  alternateName.toLowerCase();

  File root = SD.open("/", FILE_READ);
  if (!root || !root.isDirectory())
  {
    if (root)
      root.close();
    return String(preferred);
  }

  while (true)
  {
    File entry = root.openNextFile();
    if (!entry)
      break;

    if (entry.isDirectory())
    {
      String name = baseNameFromPath(String(entry.name()));
      String key = name;
      key.toLowerCase();
      if (key == preferredName || (alternateName.length() > 0 && key == alternateName))
      {
        String resolved = "/" + name;
        entry.close();
        root.close();
        return resolved;
      }
    }

    entry.close();
  }

  root.close();
  return String(preferred);
}

String mediaFilePath(const String &dir, const String &name)
{
  if (name.startsWith("/"))
    return name;
  return dir + "/" + name;
}

String musicFilePath(const String &name)
{
  return mediaFilePath(resolveSdDirectory(MUSIC_DIR), name);
}

String findNextMusicFile()
{
  if (!sdReady)
  {
    lastServerError = "SD card not ready";
    return "";
  }

  String musicDir = resolveSdDirectory(MUSIC_DIR);
  File dir = SD.open(musicDir, FILE_READ);
  if (!dir || !dir.isDirectory())
  {
    if (dir)
      dir.close();
    lastServerError = "Missing /Music folder";
    return "";
  }

  uint16_t supportedCount = 0;
  String selected = "";

  while (true)
  {
    File entry = dir.openNextFile();
    if (!entry)
      break;

    String name = entry.name();
    bool supported = !entry.isDirectory() && isSupportedMusicFile(name);
    entry.close();

    if (supported)
    {
      if (supportedCount == nextMusicIndex)
        selected = mediaFilePath(musicDir, name);
      supportedCount++;
    }
  }

  dir.close();

  if (supportedCount == 0)
  {
    lastServerError = "No WAV music found";
    return "";
  }

  if (selected.length() == 0)
  {
    nextMusicIndex = 0;
    return findNextMusicFile();
  }

  nextMusicIndex = (nextMusicIndex + 1) % supportedCount;
  return selected;
}

String normalizeMediaSearchText(String value)
{
  value.toLowerCase();
  value.replace('\\', '/');
  int slash = value.lastIndexOf('/');
  if (slash >= 0)
    value = value.substring(slash + 1);

  int dot = value.lastIndexOf('.');
  if (dot > 0)
    value = value.substring(0, dot);

  for (uint16_t i = 0; i < value.length(); i++)
  {
    char c = value[i];
    if (!isalnum((unsigned char)c))
      value.setCharAt(i, ' ');
  }

  while (value.indexOf("  ") >= 0)
    value.replace("  ", " ");
  value.trim();
  return value;
}

String normalizeMusicToken(String token)
{
  token.trim();
  token.toLowerCase();
  if (token == "richie" || token == "richei" || token == "ritchie")
    return "richie";
  return token;
}

uint8_t tokenEditDistance(const String &a, const String &b)
{
  uint8_t la = min((uint8_t)a.length(), (uint8_t)24);
  uint8_t lb = min((uint8_t)b.length(), (uint8_t)24);
  uint8_t prev[25];
  uint8_t curr[25];

  for (uint8_t j = 0; j <= lb; j++)
    prev[j] = j;

  for (uint8_t i = 1; i <= la; i++)
  {
    curr[0] = i;
    for (uint8_t j = 1; j <= lb; j++)
    {
      uint8_t cost = a[i - 1] == b[j - 1] ? 0 : 1;
      curr[j] = min(min((uint8_t)(prev[j] + 1), (uint8_t)(curr[j - 1] + 1)), (uint8_t)(prev[j - 1] + cost));
    }
    for (uint8_t j = 0; j <= lb; j++)
      prev[j] = curr[j];
  }

  return prev[lb];
}

bool tokenAppearsInText(const String &token, const String &text)
{
  if (token.length() < 2 || text.length() == 0)
    return false;
  if (text.indexOf(token) >= 0)
    return true;

  uint16_t start = 0;
  while (start < text.length())
  {
    while (start < text.length() && text[start] == ' ')
      start++;
    uint16_t end = start;
    while (end < text.length() && text[end] != ' ')
      end++;

    if (end > start)
    {
      String candidate = normalizeMusicToken(text.substring(start, end));
      if (candidate.length() >= 4 && token.length() >= 4 && tokenEditDistance(token, candidate) <= 1)
        return true;
      if (candidate.length() >= 5 && token.length() >= 5 && (candidate.indexOf(token) >= 0 || token.indexOf(candidate) >= 0))
        return true;
    }
    start = end + 1;
  }

  return false;
}

uint16_t musicMatchScore(const String &query, const String &name)
{
  if (query.length() == 0 || name.length() == 0)
    return 0;
  if (name == query)
    return 1000;
  if (name.indexOf(query) >= 0)
    return 800 + query.length();
  if (query.indexOf(name) >= 0)
    return 600 + name.length();

  uint16_t score = 0;
  uint16_t start = 0;
  while (start < query.length())
  {
    while (start < query.length() && query[start] == ' ')
      start++;
    uint16_t end = start;
    while (end < query.length() && query[end] != ' ')
      end++;

    if (end > start)
    {
      String token = normalizeMusicToken(query.substring(start, end));
      if (token.length() >= 2 && tokenAppearsInText(token, name))
        score += 120 + (token.length() * 8);
    }
    start = end + 1;
  }
  return score;
}

String findMusicFileByQuery(const String &query)
{
  if (!sdReady)
  {
    lastServerError = "SD card not ready";
    return "";
  }

  String normalizedQuery = normalizeMediaSearchText(query);
  if (normalizedQuery.length() == 0)
    return "";

  String musicDir = resolveSdDirectory(MUSIC_DIR);
  File dir = SD.open(musicDir, FILE_READ);
  if (!dir || !dir.isDirectory())
  {
    if (dir)
      dir.close();
    lastServerError = "Missing /Music folder";
    return "";
  }

  String selected = "";
  uint16_t bestScore = 0;
  while (true)
  {
    File entry = dir.openNextFile();
    if (!entry)
      break;

    String name = entry.name();
    bool supported = !entry.isDirectory() && isSupportedMusicFile(name);
    entry.close();

    if (supported)
    {
      uint16_t score = musicMatchScore(normalizedQuery, normalizeMediaSearchText(name));
      if (score > bestScore)
      {
        bestScore = score;
        selected = mediaFilePath(musicDir, name);
      }
    }
  }

  dir.close();
  if (selected.length() == 0 || bestScore < MUSIC_QUERY_MIN_SCORE)
  {
    lastServerError = "I am sorry, there is no music named like " + query + " in the SD card.";
    return "";
  }
  return selected;
}

String findNextStoryFile()
{
  if (!sdReady)
  {
    lastServerError = "SD card not ready";
    return "";
  }

  String storyDir = resolveSdDirectory(STORY_DIR, "/Story");
  File dir = SD.open(storyDir, FILE_READ);
  if (!dir || !dir.isDirectory())
  {
    if (dir)
      dir.close();
    lastServerError = "Missing /Stories folder";
    return "";
  }

  uint16_t supportedCount = 0;
  String selected = "";

  while (true)
  {
    File entry = dir.openNextFile();
    if (!entry)
      break;

    String name = entry.name();
    bool supported = !entry.isDirectory() && isSupportedStoryFile(name);
    entry.close();

    if (supported)
    {
      if (supportedCount == nextStoryIndex)
        selected = mediaFilePath(storyDir, name);
      supportedCount++;
    }
  }

  dir.close();

  if (supportedCount == 0)
  {
    lastServerError = "No story files found";
    return "";
  }

  if (selected.length() == 0)
  {
    nextStoryIndex = 0;
    return findNextStoryFile();
  }

  nextStoryIndex = (nextStoryIndex + 1) % supportedCount;
  return selected;
}

bool playMusicFromSD(const String &query = "")
{
  lastPlaybackStoppedByButton = false;
  lastServerError = "";
  showText("Music", "Checking SD");

  String path = query.length() > 0 ? findMusicFileByQuery(query) : findNextMusicFile();
  if (path.length() == 0)
  {
    showWrapped("Music failed", lastServerError);
    return false;
  }

  File file = SD.open(path, FILE_READ);
  if (!file)
  {
    lastServerError = "Could not open song";
    showWrapped("Music failed", path);
    return false;
  }

  uint16_t channels = 0;
  uint16_t bitsPerSample = 0;
  uint32_t sampleRate = 0;
  uint32_t dataBytes = 0;

  if (!parseWavHeader(&file, &channels, &sampleRate, &bitsPerSample, &dataBytes))
  {
    file.close();
    lastServerError = "Unsupported music WAV";
    showText("Music WAV error", "Use PCM 16-bit");
    return false;
  }

  uint32_t dataStart = file.position();
  uint32_t fileSize = file.size();
  uint32_t availableDataBytes = fileSize > dataStart ? fileSize - dataStart : 0;
  if (availableDataBytes < dataBytes)
  {
    uint32_t frameBytes = channels * sizeof(int16_t);
    uint32_t clampedBytes = frameBytes > 0 ? availableDataBytes - (availableDataBytes % frameBytes) : availableDataBytes;
    Serial.printf("[MUSIC] WAV data is shorter than header: data=%lu available=%lu, playing available bytes\n",
                  (unsigned long)dataBytes,
                  (unsigned long)availableDataBytes);
    dataBytes = clampedBytes;
  }

  if (dataBytes == 0)
  {
    file.close();
    lastServerError = "Empty music WAV";
    showText("Music WAV error", "Empty file");
    return false;
  }

  Serial.println("Playing SD music: " + path);
  showWrapped("Playing music", path);
  bool played = playPcmFromStream(&file, channels, sampleRate, dataBytes, false, false, LED_MUSIC, false, true);
  file.close();

  if (lastPlaybackStoppedByButton)
  {
    showText("Stopped", "Release TALK");
    return true;
  }

  if (!played)
  {
    lastServerError = "Music read timeout";
    showText("Music stopped", "Read timeout");
    return false;
  }

  return true;
}

String findVoiceFile(const char *fileName)
{
  if (!sdReady)
  {
    lastServerError = "SD card not ready";
    return "";
  }

  String voiceDir = resolveSdDirectory(VOICE_DIR, "/Voice");
  File dir = SD.open(voiceDir, FILE_READ);
  if (!dir || !dir.isDirectory())
  {
    if (dir)
      dir.close();
    lastServerError = "Missing /Voices folder";
    return "";
  }

  String targetName = String(fileName);
  targetName.toLowerCase();

  while (true)
  {
    File entry = dir.openNextFile();
    if (!entry)
      break;

    String name = baseNameFromPath(String(entry.name()));
    String key = name;
    key.toLowerCase();
    bool matched = !entry.isDirectory() && key == targetName;
    entry.close();

    if (matched)
    {
      dir.close();
      return mediaFilePath(voiceDir, name);
    }
  }

  dir.close();
  lastServerError = String(fileName) + " not found";
  return "";
}

bool playWakeResponseFromSD()
{
  lastPlaybackStoppedByButton = false;
  lastServerError = "";
  showText("LULU", "Checking voice");

  String path = findVoiceFile(WAKE_RESPONSE_FILE_NAME);
  if (path.length() == 0)
    return false;

  File file = SD.open(path, FILE_READ);
  if (!file)
  {
    lastServerError = "Could not open voice";
    return false;
  }

  uint16_t channels = 0;
  uint16_t bitsPerSample = 0;
  uint32_t sampleRate = 0;
  uint32_t dataBytes = 0;

  if (!parseWavHeader(&file, &channels, &sampleRate, &bitsPerSample, &dataBytes))
  {
    file.close();
    lastServerError = "Unsupported voice WAV";
    return false;
  }

  Serial.println("Playing wake voice: " + path);
  showWrapped("LULU", baseNameFromPath(path));
  bool played = playPcmFromStream(&file, channels, sampleRate, dataBytes, false, false, LED_SPEAKING);
  file.close();
  return played || lastPlaybackStoppedByButton;
}

String readStoryTextFile(const String &path)
{
  File file = SD.open(path, FILE_READ);
  if (!file || file.isDirectory())
  {
    if (file)
      file.close();
    return "";
  }

  String text;
  text.reserve(min((uint32_t)LOCAL_STORY_MAX_CHARS, (uint32_t)file.size()));
  while (file.available() && text.length() < LOCAL_STORY_MAX_CHARS)
  {
    updateStatusLeds();
    char c = (char)file.read();
    if (c == '\r')
      continue;
    text += c;
  }
  file.close();
  text.trim();

  String lower = path;
  lower.toLowerCase();
  if (lower.endsWith(".json"))
  {
    DynamicJsonDocument doc(LOCAL_STORY_MAX_CHARS + 256);
    DeserializationError error = deserializeJson(doc, text);
    if (!error)
    {
      String title = doc["title"] | "";
      String body = doc["text"] | "";
      if (body.length() == 0)
        body = doc["story"] | "";
      title.trim();
      body.trim();
      if (body.length() > 0)
        text = title.length() > 0 ? title + ". " + body : body;
    }
  }

  text.replace('\n', ' ');
  while (text.indexOf("  ") >= 0)
    text.replace("  ", " ");
  text.trim();
  return text;
}

bool speakStoryText(const String &storyText)
{
  uint16_t offset = 0;
  bool spokeAny = false;

  while (offset < storyText.length())
  {
    updateStatusLeds();
    uint16_t end = min((uint16_t)(offset + 220), (uint16_t)storyText.length());
    int split = -1;
    for (uint16_t i = offset; i < end; i++)
    {
      char c = storyText[i];
      if (c == '.' || c == '!' || c == '?' || c == ',')
        split = i + 1;
    }
    if (end < storyText.length() && split > (int)offset + 60)
      end = split;

    String chunk = storyText.substring(offset, end);
    chunk.trim();
    if (chunk.length() > 0)
    {
      if (!speakText(chunk))
        return spokeAny;
      spokeAny = true;
      if (lastPlaybackStoppedByButton)
        return true;
    }

    offset = end;
    while (offset < storyText.length() && storyText[offset] == ' ')
      offset++;
  }

  return spokeAny;
}

bool playStoryFromSD()
{
  lastPlaybackStoppedByButton = false;
  lastServerError = "";
  showText("Story", "Checking SD");

  String path = findNextStoryFile();
  if (path.length() == 0)
    return false;

  String lower = path;
  lower.toLowerCase();

  if (lower.endsWith(".wav"))
  {
    File file = SD.open(path, FILE_READ);
    if (!file)
    {
      lastServerError = "Could not open story";
      return false;
    }

    uint16_t channels = 0;
    uint16_t bitsPerSample = 0;
    uint32_t sampleRate = 0;
    uint32_t dataBytes = 0;

    if (!parseWavHeader(&file, &channels, &sampleRate, &bitsPerSample, &dataBytes))
    {
      file.close();
      lastServerError = "Unsupported story WAV";
      return false;
    }

    Serial.println("Playing SD story: " + path);
    showWrapped("Story", path);
    bool played = playPcmFromStream(&file, channels, sampleRate, dataBytes, false, false, LED_SPEAKING);
    file.close();
    return played || lastPlaybackStoppedByButton;
  }

  String storyText = readStoryTextFile(path);
  if (storyText.length() == 0)
  {
    lastServerError = "Story file is empty";
    return false;
  }

  Serial.println("Reading SD story: " + path);
  showWrapped("Story", baseNameFromPath(path));
  return speakStoryText("Story time. " + storyText);
}

bool handleVolumeAction(const String &action)
{
  bool volumeUp = action == "volume_up";
  if (action == "volume_up")
    playbackVolumePercent = min((int)MAX_PLAYBACK_VOLUME, (int)playbackVolumePercent + VOLUME_STEP_PERCENT);
  else if (action == "volume_down")
    playbackVolumePercent = max((int)MIN_PLAYBACK_VOLUME, (int)playbackVolumePercent - VOLUME_STEP_PERCENT);
  else
    return false;

  Serial.printf("Playback volume: %u%%\n", playbackVolumePercent);
  String message = volumeUp
                       ? "Volume increased to " + String(playbackVolumePercent) + " percent."
                       : "Volume reduced to " + String(playbackVolumePercent) + " percent.";
  showWrapped("Volume", message);
#if SPEAK_VOLUME_CONFIRMATION
  if (!speakText(message))
    waitWithStatusLeds(900);
#else
  waitWithStatusLeds(900);
#endif
  return true;
}

bool runConversationTurn(bool quietIsError, const String &listenPrompt)
{
  lastFollowupUnclear = false;
  lastStopRequested = false;

  uint8_t *wav = nullptr;
  size_t wavBytes = 0;

  playTouchConfirmationBeep();
  setListeningState();
  if (!recordWav(&wav, &wavBytes, quietIsError, listenPrompt))
  {
    if (lastStopRequested)
    {
      setIdleState();
      showText("Ready", "Press TALK");
    }
    else if (quietIsError || !lastRecordingTooQuiet)
      waitWithStatusLeds(ERROR_DISPLAY_MS);
    if (currentState == TeddyState::LISTENING)
      setIdleState();
    return false;
  }

  setThinkingState();
  ChatServerReply reply;
  bool ok = postWavToServer(wav, wavBytes, &reply);
  free(wav);

  if (!ok)
  {
    if (lastServerError.length() > 0)
      showWrapped("Server failed", lastServerError);
    waitWithStatusLeds(ERROR_DISPLAY_MS);
    return false;
  }

  Serial.printf("[CHAT] action=%s textLen=%u audioLen=%u transcriptionLen=%u\n",
                reply.action.c_str(),
                reply.text.length(),
                reply.audioUrl.length(),
                reply.transcription.length());
  printMemoryDiagnostics("after chat response");

  // Reminder integration: handle reminder/planner commands from the server transcription locally.
  if (reply.transcription.length() > 0 && handleReminderCommand(reply.transcription))
    return true;

  if (reply.action == "stop")
  {
    lastStopRequested = true;
    showText("Stopped", "Press TALK");
    return false;
  }

  if (handleVolumeAction(reply.action))
    return true;

  if (reply.action == "music")
  {
    if (reply.text.length() > 0)
    {
      Serial.println("LULU: " + reply.text);
      showWrapped("LULU:", reply.text);
      waitWithStatusLeds(700);
    }

    if (!playMusicFromSD(reply.musicQuery))
    {
      if (lastServerError.length() > 0)
      {
        showWrapped("Music failed", lastServerError);
        if (reply.musicQuery.length() > 0)
          speakText(lastServerError);
      }
      waitWithStatusLeds(ERROR_DISPLAY_MS);
      return false;
    }

    lastStopRequested = true;
    return false;
  }

  if (reply.action == "radio")
  {
    if (reply.text.length() > 0)
    {
      Serial.println("LULU: " + reply.text);
      showWrapped("LULU:", reply.text);
      waitWithStatusLeds(900);
    }

    if (!downloadAndPlayRawPcm(reply.audioUrl, reply.text))
    {
      if (lastServerError.length() > 0)
        showWrapped("Radio failed", lastServerError);
      waitWithStatusLeds(ERROR_DISPLAY_MS);
      return false;
    }

    lastStopRequested = true;
    return false;
  }

  if (reply.action == "bible")
  {
    String bibleRequest = reply.transcription.length() > 0 ? reply.transcription : reply.text;
    if (playLocalBibleChapter(bibleRequest))
    {
      if (lastPlaybackStoppedByButton)
      {
        lastStopRequested = true;
        return false;
      }
      return true;
    }

    Serial.println("[BIBLE] Local playback unavailable: " + lastServerError);
    String friendly = sdReady
                          ? "I can't find that Bible chapter on my SD card."
                          : "I can't access my Bible right now. Please check my SD card.";
    if (lastServerError.indexOf("decoder") >= 0)
      friendly = "I found the Bible chapter, but my MP3 player is not ready yet.";
    speakText(friendly);
    return false;
  }

  if (reply.action == "wake")
  {
    if (playWakeResponseFromSD())
    {
      if (lastPlaybackStoppedByButton)
      {
        lastStopRequested = true;
        return false;
      }
      return true;
    }

    if (lastServerError.length() > 0)
      Serial.println("Wake voice unavailable: " + lastServerError);

    audioStatus("before wake reply playback");
    setSpeakingState();
    if (!downloadAndPlayWav(reply.audioUrl, "", false, true))
    {
      if (lastServerError.length() > 0)
        showWrapped("Wake failed", lastServerError);
      waitWithStatusLeds(ERROR_DISPLAY_MS);
      return false;
    }

    if (lastPlaybackStoppedByButton)
    {
      lastStopRequested = true;
      return false;
    }

    return true;
  }

  if (reply.action == "story" && reply.audioUrl.length() == 0)
  {
    if (playStoryFromSD())
    {
      lastStopRequested = true;
      return false;
    }

    if (lastServerError.length() > 0)
    {
      Serial.println("SD story unavailable: " + lastServerError);
      showWrapped("Story fallback", lastServerError);
      waitWithStatusLeds(700);
    }
  }

  if (!quietIsError && reply.transcription.length() == 0)
  {
    lastFollowupUnclear = true;
    return false;
  }

  if (reply.transcription.length() > 0)
  {
    Serial.println("You said: " + reply.transcription);
    showWrapped("You said:", reply.transcription);
    waitWithStatusLeds(250);
  }

  if (reply.text.length() > 0)
  {
    Serial.println("LULU: " + reply.text);
    showWrapped("LULU:", reply.text);
    waitWithStatusLeds(150);
  }

  audioStatus("before spoken reply playback");
  setSpeakingState();
  String replyAudioCacheKey = reply.audioCacheable ? reply.audioCacheKey : "";
  bool streamReplyLive = !reply.audioCacheable &&
                         (reply.action == "bible" ||
                          reply.action == "story" ||
                          reply.audioUrl.indexOf(".up.railway.app") >= 0 ||
                          reply.audioUrl.indexOf("railway.app") >= 0);
  if (!downloadAndPlayWav(reply.audioUrl, reply.text, streamReplyLive, true, replyAudioCacheKey))
  {
    if (lastServerError.length() > 0)
      showWrapped("Playback failed", lastServerError);
    waitWithStatusLeds(ERROR_DISPLAY_MS);
    return false;
  }

  if (lastPlaybackStoppedByButton)
  {
    lastStopRequested = true;
    return false;
  }

  return true;
}

bool handleConversation()
{
  lastStopRequested = false;

  if (!runConversationTurn(true, "Speak now"))
  {
    if (lastStopRequested)
    {
      setIdleState();
      showText("Ready", "Press TALK");
    }
    return false;
  }

#if AUTO_FOLLOWUP_ENABLED
  while (true)
  {
    if (runConversationTurn(false, "Ask more now"))
      continue;

    if (lastRecordingTooQuiet || lastFollowupUnclear || lastStopRequested)
    {
      showText("Ready", "Press TALK");
      setIdleState();
      return true;
    }

    return false;
  }
#else
  showText("Ready", "Press TALK");
  setIdleState();
  return true;
#endif
}

bool isRecordButtonPressed()
{
  return isTalkButtonPressedRaw();
}

bool waitForSecondMusicTap()
{
  unsigned long windowStartedMs = millis();
  showText("Tap again", "Music mode");

  while (millis() - windowStartedMs < TOUCH_DOUBLE_TAP_WINDOW_MS)
  {
    updateStatusLeds();
    handleSDFileManager();

    if (isRecordButtonPressed())
    {
      unsigned long secondPressStartedMs = millis();
      unsigned long debounceStartedMs = millis();
      while (millis() - debounceStartedMs < TOUCH_DEBOUNCE_MS)
      {
        updateStatusLeds();
        delay(5);
      }

      while (isRecordButtonPressed())
      {
        if (millis() - secondPressStartedMs >= TOUCH_LONG_PRESS_MS)
        {
          enterDeepSleep();
          return true;
        }
        updateStatusLeds();
        delay(10);
      }

      showText("Music mode", "Playing SD");
      if (!playMusicFromSD())
        showWrapped("Music failed", lastServerError);
      setIdleState();
      showText(WiFi.status() == WL_CONNECTED ? "Ready" : "WiFi offline",
               WiFi.status() == WL_CONNECTED ? "Press TALK" : "Double tap music");
      return true;
    }

    delay(10);
  }

  return false;
}

void showButtonPinWarning()
{
  unsigned long now = millis();
  if (now - lastButtonWarningMs < 1500)
    return;

  lastButtonWarningMs = now;
  showText("Touch active", "Release sensor", "or check GPIO 7");
}

void enterDeepSleep()
{
  showText("Sleeping...", "Touch to wake");
  Serial.println("Entering deep sleep. Touch sensor will wake GPIO7.");
  stopAudioOutput();
  delay(300);

  while (isRecordButtonPressed())
    delay(20);

  delay(250);
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)RECORD_BUTTON_PIN, TOUCH_ACTIVE_LEVEL == HIGH ? 1 : 0);
  esp_deep_sleep_start();
}

void setup()
{
  Serial.begin(115200);
  delay(SERIAL_BOOT_DELAY_MS);
  Serial.println();
  Serial.println("[BOOT] LULU firmware starting");
  Serial.printf("[BOOT] reset_reason=%d freeHeap=%lu freePsram=%lu psramSize=%lu stackHighWater=%lu\n",
                (int)esp_reset_reason(),
                (unsigned long)ESP.getFreeHeap(),
                (unsigned long)ESP.getFreePsram(),
                (unsigned long)ESP.getPsramSize(),
                (unsigned long)uxTaskGetStackHighWaterMark(NULL));
  pinMode(RECORD_BUTTON_PIN, TOUCH_ACTIVE_LEVEL == HIGH ? INPUT_PULLDOWN : INPUT_PULLUP);
  logTouchDiagnostics(true);
  pinMode(DHT_PIN, INPUT_PULLUP);
  LedManager.begin();

  Wire.begin(OLED_SDA, OLED_SCL);
  u8g2.begin();
  initAudioOutput();
  waitWithStatusLeds(250);
  showStartupAnimation();

  initMic();
  initSDCard();
  localBible.begin(sdReady);
  setBibleStatusProvider(localBibleStatusJson);
  // Reminder integration: DS3231 shares the OLED I2C bus on GPIO17/GPIO18.
  reminderManager.begin(Wire, sdReady);
  connectWiFi();
  beginSDFileManager(sdReady);
  reportRemoteDeviceStatus(true);
  reminderManager.syncFromNtpIfOnline(WiFi.status() == WL_CONNECTED);
  updateRoomClimate(true);

  recordButtonArmed = !isRecordButtonPressed();
  Serial.printf("Chat server: %s://%s:%u%s\n", CHAT_SERVER_SCHEME, CHAT_SERVER_HOST, CHAT_SERVER_PORT, CHAT_SERVER_PATH);
  logTouchDiagnostics(true);

  if (recordButtonArmed)
  {
    setIdleState();
    showText("Ready", "Press TALK");
  }
  else
    showButtonPinWarning();
}

void loop()
{
  updateStatusLeds();
  logTouchDiagnostics();
  bool buttonPressed = isRecordButtonPressed();
  if (!buttonPressed)
    handleSDFileManager();

  if (!buttonPressed)
  {
    reportRemoteDeviceStatus();
    handleRemoteSdRelay();
    if (currentState == TeddyState::CONNECTION_ERROR && connectionErrorActive && connectionErrorNeedsWifi && WiFi.status() == WL_CONNECTED)
    {
      setIdleState();
      beginSDFileManager(sdReady);
    }

    if (WiFi.status() != WL_CONNECTED && currentState == TeddyState::IDLE)
      setErrorState();

    if (!recordButtonArmed)
    {
      if (WiFi.status() == WL_CONNECTED && currentState == TeddyState::CONNECTION_ERROR && connectionErrorNeedsWifi)
        setIdleState();
      showText(WiFi.status() == WL_CONNECTED ? "Ready" : "WiFi offline",
               WiFi.status() == WL_CONNECTED ? "Press TALK" : "Check router");
    }

    recordButtonArmed = true;
    if (handleRemoteControl())
    {
      delay(40);
      return;
    }

    // Reminder integration: due reminders are spoken from the main loop to protect audio/I2C.
    if (handleDueReminder())
    {
      delay(40);
      return;
    }
    handleClimateMonitor();
    delay(40);
    return;
  }

  if (!recordButtonArmed)
  {
    showButtonPinWarning();
    delay(100);
    return;
  }

  unsigned long pressStartedMs = millis();
  unsigned long debounceStartedMs = millis();
  while (millis() - debounceStartedMs < TOUCH_DEBOUNCE_MS)
  {
    updateStatusLeds();
    delay(2);
  }

  if (!isRecordButtonPressed())
  {
    recordButtonArmed = false;
    delay(20);
    return;
  }

  recordButtonArmed = false;

  if (WiFi.status() == WL_CONNECTED)
  {
    showText("Listening", "Speak now", "Hold stop in playback");
    handleConversation();
    delay(80);
    return;
  }

  showText("Touch detected", "Release for music", "Hold to sleep");
  while (isRecordButtonPressed())
  {
    if (millis() - pressStartedMs >= TOUCH_LONG_PRESS_MS)
    {
      enterDeepSleep();
      return;
    }

    delay(10);
  }

  unsigned long pressDurationMs = millis() - pressStartedMs;
  if (pressDurationMs <= TOUCH_TAP_MAX_MS && waitForSecondMusicTap())
  {
    delay(80);
    return;
  }

  showText("WiFi offline", "Check router", "Double tap music");
  delay(80);
}
