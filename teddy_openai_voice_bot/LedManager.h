#pragma once

#include <Arduino.h>

enum LedMode
{
  LED_OFF,

  LED_STARTUP,

  LED_IDLE,

  LED_LISTENING,

  LED_THINKING,

  LED_SPEAKING,

  LED_MUSIC,

  LED_RADIO,

  LED_SLEEP,

  LED_NOTIFICATION,

  LED_SUCCESS,

  LED_ERROR,

  LED_WIFI_CONNECTING,

  LED_WIFI_CONNECTED,

  LED_CHARGING,

  LED_LOW_BATTERY
};

class LedManagerClass
{
public:
  void begin();
  void update();
  void setMode(LedMode mode);
  LedMode getMode() const;
  void restorePreviousMode();
  void setAudioLevel(float level);
  void setBeatLevel(float level);
  void setChargePercent(int percent);
  void setBrightness(uint8_t brightness);

private:
  void startMode(LedMode mode, bool rememberPrevious);
  bool isMomentaryMode(LedMode mode) const;

  LedMode _mode = LED_OFF;
  LedMode _previousMode = LED_IDLE;
  unsigned long _modeStartedMs = 0;
  unsigned long _lastFrameMs = 0;
  unsigned long _transitionStartedMs = 0;
  bool _transitionActive = false;
  float _audioLevel = 0.0f;
  float _beatLevel = 0.0f;
  int _chargePercent = 0;
  uint8_t _brightness = 120;
  bool _driverReady = false;
};

extern LedManagerClass LedManager;
