#ifndef REMINDER_MANAGER_H
#define REMINDER_MANAGER_H

#include <Arduino.h>
#include <RTClib.h>
#include <SD.h>
#include <Wire.h>

class ReminderManager
{
public:
  static const uint8_t MAX_REMINDERS = 12;
  static const size_t MAX_MESSAGE_LEN = 96;

  bool begin(TwoWire &wire, bool sdAvailable);
  bool syncFromNtpIfOnline(bool wifiConnected);
  bool handleVoiceCommand(const char *transcription, char *response, size_t responseSize);
  void processDue();
  bool consumeTriggered(char *message, size_t messageSize, uint16_t *idOut);
  uint8_t activeCount() const;
  bool rtcReady() const { return _rtcReady && _rtcTimeValid; }

private:
  struct Reminder
  {
    uint16_t id;
    uint32_t time;
    char message[MAX_MESSAGE_LEN];
    bool done;
  };

  RTC_DS3231 _rtc;
  TaskHandle_t _taskHandle = nullptr;
  Reminder _reminders[MAX_REMINDERS];
  uint8_t _count = 0;
  uint16_t _nextId = 1;
  bool _sdAvailable = false;
  bool _rtcReady = false;
  bool _rtcTimeValid = false;
  volatile bool _checkRequested = false;
  bool _pendingTriggered = false;
  uint16_t _pendingId = 0;
  char _pendingMessage[MAX_MESSAGE_LEN] = {0};
  uint32_t _lastHeapLogMs = 0;

  static void taskThunk(void *arg);
  void taskLoop();
  bool load();
  bool save();
  void compactDone();
  bool addReminder(uint32_t when, const char *message);
  bool deleteActiveByNumber(uint8_t number);
  bool clearAll();
  bool parseAddCommand(const char *normalized, uint32_t *whenOut, char *messageOut, size_t messageSize, char *whenText, size_t whenTextSize);
  bool parseRelativeCommand(const char *normalized, uint32_t *whenOut, char *messageOut, size_t messageSize, char *whenText, size_t whenTextSize);
  bool parseAbsoluteCommand(const char *normalized, uint32_t *whenOut, char *messageOut, size_t messageSize, char *whenText, size_t whenTextSize);
  bool parseClockTime(const char *text, uint8_t *hourOut, uint8_t *minuteOut) const;
  bool containsAny(const char *text, const char *const phrases[], size_t count) const;
  bool formatCurrentTime(char *response, size_t responseSize);
  uint32_t nowEpoch();
  void copyText(char *dest, size_t destSize, const char *src) const;
  void normalizeCommand(const char *input, char *output, size_t outputSize) const;
  void trimInPlace(char *text) const;
  void setResponse(char *response, size_t responseSize, const char *text) const;
  void logHeap(const char *label, bool force = false);
};

#endif
