#include "ReminderManager.h"

#include <ArduinoJson.h>
#include <WiFi.h>
#include <ctype.h>
#include <esp_heap_caps.h>
#include <time.h>

namespace
{
const char *REMINDER_FILE = "/reminders.json";
const char *REMINDER_TEMP_FILE = "/reminders.tmp";
const char *REMINDER_BACKUP_FILE = "/reminders.bak";
const char *RTC_TIMEZONE = "WAT-1";
const char *NTP_SERVER_1 = "pool.ntp.org";
const char *NTP_SERVER_2 = "time.google.com";
const uint16_t REMINDER_JSON_BYTES = 4096;
const uint32_t REMINDER_HEAP_LOG_INTERVAL_MS = 60000;

bool startsWithWord(const char *text, const char *prefix)
{
  return strncmp(text, prefix, strlen(prefix)) == 0;
}

uint8_t parseSmallNumber(const char *text)
{
  if (!text)
    return 0;

  while (*text && !isdigit((unsigned char)*text) && !isalpha((unsigned char)*text))
    text++;

  if (isdigit((unsigned char)*text))
    return (uint8_t)atoi(text);

  if (startsWithWord(text, "eleven"))
    return 11;
  if (startsWithWord(text, "twelve"))
    return 12;
  if (startsWithWord(text, "ten"))
    return 10;
  if (startsWithWord(text, "nine"))
    return 9;
  if (startsWithWord(text, "eight"))
    return 8;
  if (startsWithWord(text, "seven"))
    return 7;
  if (startsWithWord(text, "six"))
    return 6;
  if (startsWithWord(text, "five"))
    return 5;
  if (startsWithWord(text, "four"))
    return 4;
  if (startsWithWord(text, "three"))
    return 3;
  if (startsWithWord(text, "two"))
    return 2;
  if (startsWithWord(text, "one"))
    return 1;

  return 0;
}

uint8_t parseNumberWord(const char *text, const char **endOut)
{
  struct NumberWord
  {
    const char *word;
    uint8_t value;
  };

  static const NumberWord words[] = {
      {"twenty", 20},
      {"fifteen", 15},
      {"fourteen", 14},
      {"thirteen", 13},
      {"twelve", 12},
      {"eleven", 11},
      {"ten", 10},
      {"nine", 9},
      {"eight", 8},
      {"seven", 7},
      {"six", 6},
      {"five", 5},
      {"four", 4},
      {"three", 3},
      {"two", 2},
      {"one", 1}};

  for (size_t i = 0; i < sizeof(words) / sizeof(words[0]); i++)
  {
    size_t len = strlen(words[i].word);
    if (strncmp(text, words[i].word, len) == 0 && !isalpha((unsigned char)text[len]))
    {
      if (endOut)
        *endOut = text + len;
      return words[i].value;
    }
  }

  return 0;
}

uint16_t parseDurationAmount(const char *text, const char **unitOut)
{
  while (*text == ' ')
    text++;

  if (startsWithWord(text, "a "))
  {
    if (unitOut)
      *unitOut = text + 2;
    return 1;
  }
  if (startsWithWord(text, "an "))
  {
    if (unitOut)
      *unitOut = text + 3;
    return 1;
  }

  if (isdigit((unsigned char)*text))
  {
    uint16_t value = (uint16_t)atoi(text);
    while (isdigit((unsigned char)*text))
      text++;
    if (unitOut)
      *unitOut = text;
    return value;
  }

  const char *afterWord = text;
  uint16_t value = parseNumberWord(text, &afterWord);
  if (value > 0)
  {
    if (unitOut)
      *unitOut = afterWord;
    return value;
  }

  return 0;
}

bool parseDuration(const char *text, uint32_t *secondsOut, uint16_t *amountOut, bool *hoursOut, const char **endOut)
{
  const char *unit = nullptr;
  uint16_t amount = parseDurationAmount(text, &unit);
  if (amount == 0)
    return false;

  while (*unit == ' ')
    unit++;

  uint32_t seconds = 0;
  bool hours = false;
  if (startsWithWord(unit, "sec") || startsWithWord(unit, "second"))
    seconds = (uint32_t)amount;
  else if (startsWithWord(unit, "min") || startsWithWord(unit, "minute"))
    seconds = (uint32_t)amount * 60UL;
  else if (startsWithWord(unit, "hr") || startsWithWord(unit, "hour"))
  {
    seconds = (uint32_t)amount * 3600UL;
    hours = true;
  }
  else if (startsWithWord(unit, "day"))
  {
    seconds = (uint32_t)amount * 86400UL;
    hours = true;
  }
  else
    return false;

  while (*unit && isalpha((unsigned char)*unit))
    unit++;

  *secondsOut = seconds;
  *amountOut = amount;
  *hoursOut = hours;
  if (endOut)
    *endOut = unit;
  return true;
}

const char *findAddMessageStart(const char *normalized)
{
  const char *markers[] = {
      "remind me to ",
      "remind me about ",
      "remind me for ",
      "remind me ",
      "reminder me to ",
      "reminder me about ",
      "set a reminder to ",
      "set a reminder for ",
      "set a reminder ",
      "set reminder to ",
      "set reminder for ",
      "set reminder ",
      "create a reminder to ",
      "create a reminder for ",
      "create a reminder ",
      "create reminder to ",
      "create reminder for ",
      "create reminder ",
      "add a reminder to ",
      "add a reminder for ",
      "add a reminder ",
      "add reminder to ",
      "add reminder for ",
      "add reminder ",
      "remember to ",
      "remember me to ",
      "notify me to ",
      "notify me about ",
      "notify me ",
      "alert me to ",
      "alert me about ",
      "alert me ",
      "alarm me to ",
      "alarm me about ",
      "alarm me ",
      "wake me up to ",
      "wake me up for ",
      "wake me up ",
      "set an alarm to ",
      "set an alarm for ",
      "set an alarm ",
      "set alarm to ",
      "set alarm for ",
      "set alarm ",
      "set a timer to ",
      "set a timer for ",
      "set a timer ",
      "set timer to ",
      "set timer for ",
      "set timer ",
      "start a timer to ",
      "start a timer for ",
      "start a timer ",
      "tell me to ",
      "let me know to ",
      "let me know ",
      "don t let me forget to ",
      "dont let me forget to ",
      "do not let me forget to "};

  for (size_t i = 0; i < sizeof(markers) / sizeof(markers[0]); i++)
  {
    const char *found = strstr(normalized, markers[i]);
    if (found)
      return found + strlen(markers[i]);
  }

  return nullptr;
}

const char *findFirstMarker(const char *text, const char *const markers[], size_t count, size_t *markerLenOut)
{
  const char *best = nullptr;
  size_t bestLen = 0;
  for (size_t i = 0; i < count; i++)
  {
    const char *found = strstr(text, markers[i]);
    if (found && (!best || found < best))
    {
      best = found;
      bestLen = strlen(markers[i]);
    }
  }
  if (markerLenOut)
    *markerLenOut = bestLen;
  return best;
}

void cleanReminderMessage(char *text)
{
  if (!text)
    return;

  const char *leading[] = {"to ", "about ", "for ", "that ", "me to ", "me about "};
  bool changed = true;
  while (changed)
  {
    changed = false;
    while (*text == ' ')
      memmove(text, text + 1, strlen(text));
    for (size_t i = 0; i < sizeof(leading) / sizeof(leading[0]); i++)
    {
      size_t len = strlen(leading[i]);
      if (strncmp(text, leading[i], len) == 0)
      {
        memmove(text, text + len, strlen(text + len) + 1);
        changed = true;
      }
    }
  }

  const char *trailing[] = {" tomorrow", " today", " tonight"};
  for (size_t i = 0; i < sizeof(trailing) / sizeof(trailing[0]); i++)
  {
    size_t textLen = strlen(text);
    size_t tailLen = strlen(trailing[i]);
    if (textLen > tailLen && strcmp(text + textLen - tailLen, trailing[i]) == 0)
      text[textLen - tailLen] = '\0';
  }
}
}

bool ReminderManager::begin(TwoWire &wire, bool sdAvailable)
{
  _sdAvailable = sdAvailable;
  _rtcReady = _rtc.begin(&wire);
  if (!_rtcReady)
  {
    Serial.println("[RTC] DS3231 not found");
  }
  else
  {
    DateTime now = _rtc.now();
    _rtcTimeValid = !_rtc.lostPower() && now.year() >= 2024;
    Serial.printf("[RTC] Initialized valid=%s year=%u\n", _rtcTimeValid ? "yes" : "no", now.year());
  }

  load();

  if (_taskHandle == nullptr)
  {
    BaseType_t ok = xTaskCreatePinnedToCore(
        taskThunk,
        "ReminderTask",
        3072,
        this,
        1,
        &_taskHandle,
        1);
    if (ok != pdPASS)
    {
      _taskHandle = nullptr;
      Serial.println("[REMINDER] Task create failed");
      return false;
    }
  }

  return _rtcReady;
}

bool ReminderManager::syncFromNtpIfOnline(bool wifiConnected)
{
  if (!_rtcReady || !wifiConnected)
    return false;

  configTzTime(RTC_TIMEZONE, NTP_SERVER_1, NTP_SERVER_2);

  struct tm timeInfo;
  if (!getLocalTime(&timeInfo, 4000))
  {
    Serial.println("[RTC] NTP sync skipped");
    return false;
  }

  DateTime synced(
      timeInfo.tm_year + 1900,
      timeInfo.tm_mon + 1,
      timeInfo.tm_mday,
      timeInfo.tm_hour,
      timeInfo.tm_min,
      timeInfo.tm_sec);
  _rtc.adjust(synced);
  _rtcTimeValid = true;
  Serial.printf("[RTC] Time synced %04u-%02u-%02u %02u:%02u:%02u\n",
                synced.year(),
                synced.month(),
                synced.day(),
                synced.hour(),
                synced.minute(),
                synced.second());
  return true;
}

void ReminderManager::taskThunk(void *arg)
{
  static_cast<ReminderManager *>(arg)->taskLoop();
}

void ReminderManager::taskLoop()
{
  for (;;)
  {
    _checkRequested = true;
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

void ReminderManager::processDue()
{
  if (!_checkRequested)
    return;

  _checkRequested = false;
  if (!_rtcReady || !_rtcTimeValid || _pendingTriggered || activeCount() == 0)
    return;

  logHeap("[REMINDER] before processing");
  uint32_t now = nowEpoch();

  for (uint8_t i = 0; i < _count; i++)
  {
    Reminder &reminder = _reminders[i];
    if (reminder.done || reminder.time > now)
      continue;

    reminder.done = true;
    _pendingTriggered = true;
    _pendingId = reminder.id;
    copyText(_pendingMessage, sizeof(_pendingMessage), reminder.message);
    save();
    Serial.printf("[REMINDER] Triggered id=%u message=%s\n", reminder.id, reminder.message);
    logHeap("[REMINDER] after processing", true);
    return;
  }

  logHeap("[REMINDER] after processing");
}

bool ReminderManager::consumeTriggered(char *message, size_t messageSize, uint16_t *idOut)
{
  if (!_pendingTriggered)
    return false;

  copyText(message, messageSize, _pendingMessage);
  if (idOut)
    *idOut = _pendingId;

  _pendingTriggered = false;
  _pendingId = 0;
  _pendingMessage[0] = '\0';
  return true;
}

uint8_t ReminderManager::activeCount() const
{
  uint8_t active = 0;
  for (uint8_t i = 0; i < _count; i++)
  {
    if (!_reminders[i].done)
      active++;
  }
  return active;
}

bool ReminderManager::load()
{
  _count = 0;
  _nextId = 1;

  if (!_sdAvailable)
  {
    Serial.println("[REMINDER] Loaded 0 reminder(s), SD unavailable");
    return false;
  }

  if (!SD.exists(REMINDER_FILE))
  {
    if (SD.exists(REMINDER_BACKUP_FILE))
      SD.rename(REMINDER_BACKUP_FILE, REMINDER_FILE);
  }

  if (!SD.exists(REMINDER_FILE))
  {
    Serial.println("[REMINDER] Loaded 0 reminder(s)");
    return true;
  }

  File file = SD.open(REMINDER_FILE, FILE_READ);
  if (!file)
  {
    Serial.println("[REMINDER] Load failed");
    return false;
  }

  DynamicJsonDocument doc(REMINDER_JSON_BYTES);
  DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error || !doc.is<JsonArray>())
  {
    Serial.println("[REMINDER] Load JSON failed");
    return false;
  }

  JsonArray array = doc.as<JsonArray>();
  for (JsonObject item : array)
  {
    if (_count >= MAX_REMINDERS)
      break;

    Reminder &reminder = _reminders[_count];
    reminder.id = item["id"] | _nextId;
    reminder.time = item["time"] | 0;
    reminder.done = item["done"] | false;
    copyText(reminder.message, sizeof(reminder.message), item["message"] | "reminder");
    if (reminder.time > 0 && reminder.message[0] != '\0')
    {
      if ((uint16_t)(reminder.id + 1) > _nextId)
        _nextId = reminder.id + 1;
      _count++;
    }
  }

  Serial.printf("[REMINDER] Loaded %u reminder(s)\n", _count);
  return true;
}

bool ReminderManager::save()
{
  if (!_sdAvailable)
    return false;

  if (SD.exists(REMINDER_TEMP_FILE))
    SD.remove(REMINDER_TEMP_FILE);

  File file = SD.open(REMINDER_TEMP_FILE, FILE_WRITE);
  if (!file)
  {
    Serial.println("[REMINDER] Save open failed");
    return false;
  }

  DynamicJsonDocument doc(REMINDER_JSON_BYTES);
  JsonArray array = doc.to<JsonArray>();
  for (uint8_t i = 0; i < _count; i++)
  {
    JsonObject item = array.createNestedObject();
    item["id"] = _reminders[i].id;
    item["time"] = _reminders[i].time;
    item["message"] = _reminders[i].message;
    item["done"] = _reminders[i].done;
  }

  bool ok = serializeJson(doc, file) > 0;
  file.flush();
  file.close();
  if (!ok)
  {
    SD.remove(REMINDER_TEMP_FILE);
    Serial.println("[REMINDER] Save write failed");
    return false;
  }

  if (SD.exists(REMINDER_BACKUP_FILE))
    SD.remove(REMINDER_BACKUP_FILE);

  if (SD.exists(REMINDER_FILE) && !SD.rename(REMINDER_FILE, REMINDER_BACKUP_FILE))
  {
    SD.remove(REMINDER_TEMP_FILE);
    Serial.println("[REMINDER] Save backup failed");
    return false;
  }

  if (!SD.rename(REMINDER_TEMP_FILE, REMINDER_FILE))
  {
    if (SD.exists(REMINDER_BACKUP_FILE))
      SD.rename(REMINDER_BACKUP_FILE, REMINDER_FILE);
    Serial.println("[REMINDER] Save rename failed");
    return false;
  }

  if (SD.exists(REMINDER_BACKUP_FILE))
    SD.remove(REMINDER_BACKUP_FILE);

  Serial.printf("[REMINDER] Saved %u reminder(s)\n", _count);
  return true;
}

void ReminderManager::compactDone()
{
  uint8_t writeIndex = 0;
  for (uint8_t readIndex = 0; readIndex < _count; readIndex++)
  {
    if (_reminders[readIndex].done)
      continue;

    if (writeIndex != readIndex)
      _reminders[writeIndex] = _reminders[readIndex];
    writeIndex++;
  }
  _count = writeIndex;
}

bool ReminderManager::addReminder(uint32_t when, const char *message)
{
  if (!_sdAvailable || !_rtcReady || !_rtcTimeValid)
    return false;

  compactDone();
  if (_count >= MAX_REMINDERS)
    return false;

  Reminder &reminder = _reminders[_count++];
  reminder.id = _nextId++;
  reminder.time = when;
  reminder.done = false;
  copyText(reminder.message, sizeof(reminder.message), message);
  return save();
}

bool ReminderManager::deleteActiveByNumber(uint8_t number)
{
  if (number == 0)
    return false;

  uint8_t activeNumber = 0;
  for (uint8_t i = 0; i < _count; i++)
  {
    if (_reminders[i].done)
      continue;

    activeNumber++;
    if (activeNumber != number)
      continue;

    for (uint8_t move = i; move + 1 < _count; move++)
      _reminders[move] = _reminders[move + 1];
    _count--;
    return save();
  }

  return false;
}

bool ReminderManager::clearAll()
{
  _count = 0;
  _pendingTriggered = false;
  _pendingId = 0;
  _pendingMessage[0] = '\0';
  return save();
}

bool ReminderManager::handleVoiceCommand(const char *transcription, char *response, size_t responseSize)
{
  char normalized[192];
  normalizeCommand(transcription, normalized, sizeof(normalized));
  if (normalized[0] == '\0')
    return false;

  const char *timePhrases[] = {
      "what is the time",
      "whats the time",
      "what s the time",
      "what time is it",
      "tell me the time",
      "check the time",
      "please check the time",
      "current time",
      "time now"};
  if (containsAny(normalized, timePhrases, sizeof(timePhrases) / sizeof(timePhrases[0])))
    return formatCurrentTime(response, responseSize);

  const char *listPhrases[] = {
      "what are my reminders",
      "what reminders do i have",
      "what reminder do i have",
      "check what reminders i have",
      "please check what reminders i have",
      "list my reminders",
      "show my reminders",
      "read my reminders",
      "tell me my reminders",
      "do i have reminders",
      "any reminders",
      "my reminders",
      "reminder list"};
  if (containsAny(normalized, listPhrases, sizeof(listPhrases) / sizeof(listPhrases[0])))
  {
    uint8_t active = activeCount();
    snprintf(response, responseSize, "You have %u reminder%s scheduled.", active, active == 1 ? "" : "s");
    return true;
  }

  const char *clearPhrases[] = {
      "clear all reminders",
      "delete all reminders",
      "cancel all reminders",
      "remove all reminders",
      "wipe all reminders",
      "clear my reminders",
      "delete my reminders"};
  if (containsAny(normalized, clearPhrases, sizeof(clearPhrases) / sizeof(clearPhrases[0])))
  {
    if (!_sdAvailable)
      setResponse(response, responseSize, "I cannot clear reminders because the SD card is not ready.");
    else if (clearAll())
      setResponse(response, responseSize, "Okay Jeremiah. I cleared all reminders.");
    else
      setResponse(response, responseSize, "I could not clear reminders just now.");
    return true;
  }

  const char *deletePos = strstr(normalized, "delete reminder number ");
  if (!deletePos)
    deletePos = strstr(normalized, "remove reminder number ");
  if (!deletePos)
    deletePos = strstr(normalized, "cancel reminder number ");
  if (!deletePos)
    deletePos = strstr(normalized, "delete reminder ");
  if (!deletePos)
    deletePos = strstr(normalized, "remove reminder ");
  if (!deletePos)
    deletePos = strstr(normalized, "cancel reminder ");
  if (deletePos)
  {
    uint8_t number = parseSmallNumber(deletePos);
    if (deleteActiveByNumber(number))
      snprintf(response, responseSize, "Okay Jeremiah. I deleted reminder number %u.", number);
    else
      snprintf(response, responseSize, "I could not find reminder number %u.", number);
    return true;
  }

  const char *addPhrases[] = {
      "remind me",
      "reminder me",
      "set reminder",
      "set a reminder",
      "create reminder",
      "create a reminder",
      "add reminder",
      "add a reminder",
      "remember to",
      "remember me to",
      "notify me",
      "alert me",
      "alarm me",
      "wake me up",
      "set alarm",
      "set an alarm",
      "set timer",
      "set a timer",
      "start timer",
      "start a timer",
      "tell me to",
      "let me know",
      "don t let me forget",
      "dont let me forget",
      "do not let me forget"};
  if (!containsAny(normalized, addPhrases, sizeof(addPhrases) / sizeof(addPhrases[0])))
    return false;

  uint32_t when = 0;
  char message[MAX_MESSAGE_LEN];
  char whenText[40];
  if (!parseAddCommand(normalized, &when, message, sizeof(message), whenText, sizeof(whenText)))
  {
    setResponse(response, responseSize, "Please say it like, remind me to pray in 5 minutes.");
    return true;
  }

  if (!_sdAvailable)
  {
    setResponse(response, responseSize, "I cannot save reminders because the SD card is not ready.");
    return true;
  }
  if (!_rtcReady || !_rtcTimeValid)
  {
    setResponse(response, responseSize, "I cannot set reminders until the RTC time is ready.");
    return true;
  }
  if (!addReminder(when, message))
  {
    setResponse(response, responseSize, "I could not save that reminder just now.");
    return true;
  }

  snprintf(response, responseSize, "Okay Jeremiah. I will remind you %s.", whenText);
  return true;
}

bool ReminderManager::parseAddCommand(const char *normalized, uint32_t *whenOut, char *messageOut, size_t messageSize, char *whenText, size_t whenTextSize)
{
  if (parseRelativeCommand(normalized, whenOut, messageOut, messageSize, whenText, whenTextSize))
    return true;

  return parseAbsoluteCommand(normalized, whenOut, messageOut, messageSize, whenText, whenTextSize);
}

bool ReminderManager::parseRelativeCommand(const char *normalized, uint32_t *whenOut, char *messageOut, size_t messageSize, char *whenText, size_t whenTextSize)
{
  const char *relativeMarkers[] = {" in ", " after "};
  size_t relativeMarkerLen = 0;
  const char *relativePos = findFirstMarker(normalized, relativeMarkers, sizeof(relativeMarkers) / sizeof(relativeMarkers[0]), &relativeMarkerLen);
  if (!relativePos)
    return false;

  uint32_t seconds = 0;
  uint16_t amount = 0;
  bool hours = false;
  const char *durationEnd = nullptr;
  if (!parseDuration(relativePos + relativeMarkerLen, &seconds, &amount, &hours, &durationEnd))
    return false;

  const char *start = findAddMessageStart(normalized);
  const char *afterDurationMarkers[] = {" to ", " about ", " for ", " remind me to ", " remind me about "};
  size_t afterMarkerLen = 0;
  const char *afterDuration = findFirstMarker(durationEnd, afterDurationMarkers, sizeof(afterDurationMarkers) / sizeof(afterDurationMarkers[0]), &afterMarkerLen);

  if (afterDuration)
  {
    copyText(messageOut, messageSize, afterDuration + afterMarkerLen);
  }
  else if (start && start < relativePos)
  {
    size_t messageLen = min((size_t)(relativePos - start), messageSize - 1);
    memcpy(messageOut, start, messageLen);
    messageOut[messageLen] = '\0';
  }
  else if (start && start > relativePos)
  {
    copyText(messageOut, messageSize, start);
  }
  else
  {
    copyText(messageOut, messageSize, "reminder");
  }

  cleanReminderMessage(messageOut);
  trimInPlace(messageOut);
  if (messageOut[0] == '\0')
    return false;

  *whenOut = nowEpoch() + seconds;
  const char *unitText = seconds < 60UL
                             ? (amount == 1 ? "second" : "seconds")
                             : (seconds >= 86400UL
                                    ? (amount == 1 ? "day" : "days")
                                    : (hours ? (amount == 1 ? "hour" : "hours") : (amount == 1 ? "minute" : "minutes")));
  snprintf(whenText, whenTextSize, "in %u %s", amount, unitText);
  return true;
}

bool ReminderManager::parseAbsoluteCommand(const char *normalized, uint32_t *whenOut, char *messageOut, size_t messageSize, char *whenText, size_t whenTextSize)
{
  bool tomorrow = strstr(normalized, "tomorrow") != nullptr;
  const char *timeMarkers[] = {" at ", " by ", " for "};
  uint8_t hour = 0;
  uint8_t minute = 0;
  size_t markerLen = 0;
  const char *timePos = nullptr;
  const char *timeStart = nullptr;

  for (size_t i = 0; i < sizeof(timeMarkers) / sizeof(timeMarkers[0]) && !timePos; i++)
  {
    const char *candidate = normalized;
    size_t len = strlen(timeMarkers[i]);
    while ((candidate = strstr(candidate, timeMarkers[i])) != nullptr)
    {
      if (parseClockTime(candidate + len, &hour, &minute))
      {
        timePos = candidate;
        markerLen = len;
        timeStart = candidate + len;
        break;
      }
      candidate += len;
    }
  }

  if (!timePos || !timeStart)
    return false;

  const char *start = findAddMessageStart(normalized);
  const char *afterTimeMarkers[] = {" to ", " about ", " for "};
  size_t afterMarkerLen = 0;
  const char *afterTime = findFirstMarker(timeStart, afterTimeMarkers, sizeof(afterTimeMarkers) / sizeof(afterTimeMarkers[0]), &afterMarkerLen);
  if (start && start < timePos)
  {
    size_t messageLen = min((size_t)(timePos - start), messageSize - 1);
    memcpy(messageOut, start, messageLen);
    messageOut[messageLen] = '\0';
  }
  else if (afterTime)
  {
    copyText(messageOut, messageSize, afterTime + afterMarkerLen);
  }
  else
  {
    copyText(messageOut, messageSize, "reminder");
  }

  cleanReminderMessage(messageOut);
  trimInPlace(messageOut);
  if (messageOut[0] == '\0')
    return false;

  DateTime now = _rtc.now();
  DateTime target(now.year(), now.month(), now.day(), hour, minute, 0);
  if (tomorrow || target.unixtime() <= now.unixtime())
    target = target + TimeSpan(1, 0, 0, 0);

  *whenOut = target.unixtime();
  uint8_t displayHour = hour % 12;
  if (displayHour == 0)
    displayHour = 12;
  if (tomorrow)
    snprintf(whenText, whenTextSize, "tomorrow at %u:%02u %s", displayHour, minute, hour >= 12 ? "PM" : "AM");
  else
    snprintf(whenText, whenTextSize, "at %u:%02u %s", displayHour, minute, hour >= 12 ? "PM" : "AM");
  return true;
}

bool ReminderManager::parseClockTime(const char *text, uint8_t *hourOut, uint8_t *minuteOut) const
{
  while (*text == ' ')
    text++;
  if (!isdigit((unsigned char)*text))
    return false;

  uint8_t hour = (uint8_t)atoi(text);
  while (isdigit((unsigned char)*text))
    text++;

  uint8_t minute = 0;
  if (*text == ':')
  {
    text++;
    if (!isdigit((unsigned char)*text))
      return false;
    minute = (uint8_t)atoi(text);
    while (isdigit((unsigned char)*text))
      text++;
  }

  while (*text == ' ')
    text++;

  bool pm = startsWithWord(text, "pm");
  bool am = startsWithWord(text, "am");
  if (!am && !pm)
    return false;

  if (hour == 0 || hour > 12 || minute > 59)
    return false;

  if (am && hour == 12)
    hour = 0;
  else if (pm && hour < 12)
    hour += 12;

  *hourOut = hour;
  *minuteOut = minute;
  return true;
}

bool ReminderManager::containsAny(const char *text, const char *const phrases[], size_t count) const
{
  if (!text)
    return false;

  for (size_t i = 0; i < count; i++)
  {
    if (phrases[i] && strstr(text, phrases[i]))
      return true;
  }
  return false;
}

bool ReminderManager::formatCurrentTime(char *response, size_t responseSize)
{
  if (!_rtcReady || !_rtcTimeValid)
  {
    setResponse(response, responseSize, "I cannot read the time until the RTC is ready.");
    return true;
  }

  DateTime now = _rtc.now();
  uint8_t hour = now.hour();
  uint8_t displayHour = hour % 12;
  if (displayHour == 0)
    displayHour = 12;

  snprintf(
      response,
      responseSize,
      "The time is %u:%02u %s.",
      displayHour,
      now.minute(),
      hour >= 12 ? "PM" : "AM");
  return true;
}

uint32_t ReminderManager::nowEpoch()
{
  if (!_rtcReady || !_rtcTimeValid)
    return 0;

  return _rtc.now().unixtime();
}

void ReminderManager::copyText(char *dest, size_t destSize, const char *src) const
{
  if (!dest || destSize == 0)
    return;

  if (!src)
    src = "";

  size_t i = 0;
  for (; i + 1 < destSize && src[i]; i++)
    dest[i] = src[i];
  dest[i] = '\0';
}

void ReminderManager::normalizeCommand(const char *input, char *output, size_t outputSize) const
{
  if (!output || outputSize == 0)
    return;

  if (!input)
    input = "";

  size_t write = 0;
  for (size_t read = 0; input[read] && write + 1 < outputSize; read++)
  {
    char c = (char)tolower((unsigned char)input[read]);
    if (isalnum((unsigned char)c) || c == ':' || c == ' ')
      output[write++] = c;
    else
      output[write++] = ' ';
  }
  output[write] = '\0';
  trimInPlace(output);

  if (startsWithWord(output, "lulu "))
  {
    memmove(output, output + 5, strlen(output + 5) + 1);
    trimInPlace(output);
  }
}

void ReminderManager::trimInPlace(char *text) const
{
  if (!text)
    return;

  char *start = text;
  while (*start && isspace((unsigned char)*start))
    start++;

  char *write = text;
  bool lastSpace = false;
  for (char *read = start; *read; read++)
  {
    bool isSpace = isspace((unsigned char)*read);
    if (isSpace && lastSpace)
      continue;
    *write++ = isSpace ? ' ' : *read;
    lastSpace = isSpace;
  }
  while (write > text && isspace((unsigned char)*(write - 1)))
    write--;
  *write = '\0';
}

void ReminderManager::setResponse(char *response, size_t responseSize, const char *text) const
{
  copyText(response, responseSize, text);
}

void ReminderManager::logHeap(const char *label, bool force)
{
  uint32_t now = millis();
  if (!force && now - _lastHeapLogMs < REMINDER_HEAP_LOG_INTERVAL_MS)
    return;

  _lastHeapLogMs = now;
  Serial.printf(
      "%s heap=%lu largest8=%lu psram=%lu stackHighWater=%lu\n",
      label,
      (unsigned long)ESP.getFreeHeap(),
      (unsigned long)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT),
      (unsigned long)ESP.getFreePsram(),
      (unsigned long)uxTaskGetStackHighWaterMark(NULL));
}
