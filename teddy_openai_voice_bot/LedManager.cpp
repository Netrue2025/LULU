#include "arduino_secrets.h"
#include "LedManager.h"
#include "esp32-hal-rmt.h"

#ifndef LED_PIN
#define LED_PIN 21
#endif

#ifndef LED_COUNT
#define LED_COUNT 24
#endif

#ifndef MAX_BRIGHTNESS
#define MAX_BRIGHTNESS 120
#endif

#ifndef LED_UPDATE_INTERVAL_MS
#define LED_UPDATE_INTERVAL_MS 20
#endif

#ifndef LED_TRANSITION_MS
#define LED_TRANSITION_MS 220
#endif

struct Rgb
{
  uint8_t r;
  uint8_t g;
  uint8_t b;
};

#define LED_RGB(red, green, blue) Rgb{red, green, blue}

#ifndef IDLE_COLOR
#define IDLE_COLOR LED_RGB(0, 190, 210)
#endif

#ifndef LISTENING_COLOR
#define LISTENING_COLOR LED_RGB(0, 80, 255)
#endif

#ifndef THINKING_COLOR
#define THINKING_COLOR LED_RGB(150, 0, 255)
#endif

#ifndef SPEAKING_COLOR
#define SPEAKING_COLOR LED_RGB(0, 255, 90)
#endif

#ifndef MUSIC_COLOR
#define MUSIC_COLOR LED_RGB(255, 80, 0)
#endif

#ifndef RADIO_COLOR
#define RADIO_COLOR LED_RGB(0, 160, 255)
#endif

#ifndef NOTIFICATION_COLOR
#define NOTIFICATION_COLOR LED_RGB(255, 210, 0)
#endif

#ifndef SUCCESS_COLOR
#define SUCCESS_COLOR LED_RGB(0, 255, 70)
#endif

#ifndef ERROR_COLOR
#define ERROR_COLOR LED_RGB(255, 0, 0)
#endif

#ifndef WIFI_COLOR
#define WIFI_COLOR LED_RGB(0, 80, 255)
#endif

#ifndef CHARGING_EMPTY_COLOR
#define CHARGING_EMPTY_COLOR LED_RGB(255, 0, 0)
#endif

#ifndef CHARGING_FULL_COLOR
#define CHARGING_FULL_COLOR LED_RGB(0, 255, 0)
#endif

static Rgb leds[LED_COUNT];
static Rgb frame[LED_COUNT];
static Rgb transitionFrom[LED_COUNT];
static rmt_data_t ledData[LED_COUNT * 24];

LedManagerClass LedManager;

static uint8_t clampUnitToByte(float value)
{
  if (value <= 0.0f)
    return 0;
  if (value >= 1.0f)
    return 255;
  return (uint8_t)(value * 255.0f);
}

static uint8_t clampBrightness(uint16_t value)
{
  return value > 255 ? 255 : (uint8_t)value;
}

static uint16_t mapU16(uint32_t value, uint32_t inMin, uint32_t inMax, uint16_t outMin, uint16_t outMax)
{
  if (value <= inMin)
    return outMin;
  if (value >= inMax)
    return outMax;

  return outMin + (uint32_t)(value - inMin) * (outMax - outMin) / (inMax - inMin);
}

static uint8_t triangleWave(unsigned long elapsedMs, unsigned long periodMs, uint8_t low, uint8_t high)
{
  unsigned long phase = elapsedMs % periodMs;
  unsigned long half = periodMs / 2;
  uint8_t span = high - low;

  if (phase < half)
    return low + (uint32_t)phase * span / half;

  return high - (uint32_t)(phase - half) * span / half;
}

static Rgb scaleColor(Rgb color, uint8_t scale)
{
  return LED_RGB(
      (uint16_t)color.r * scale / 255,
      (uint16_t)color.g * scale / 255,
      (uint16_t)color.b * scale / 255);
}

static Rgb blendColor(Rgb from, Rgb to, uint8_t amount)
{
  uint8_t inverse = 255 - amount;
  return LED_RGB(
      ((uint16_t)from.r * inverse + (uint16_t)to.r * amount) / 255,
      ((uint16_t)from.g * inverse + (uint16_t)to.g * amount) / 255,
      ((uint16_t)from.b * inverse + (uint16_t)to.b * amount) / 255);
}

static void addColor(Rgb *target, Rgb color)
{
  target->r = clampBrightness((uint16_t)target->r + color.r);
  target->g = clampBrightness((uint16_t)target->g + color.g);
  target->b = clampBrightness((uint16_t)target->b + color.b);
}

static void fillFrame(Rgb color)
{
  for (uint16_t i = 0; i < LED_COUNT; i++)
    frame[i] = color;
}

static void clearFrame()
{
  fillFrame(LED_RGB(0, 0, 0));
}

static void addScaledPixel(int index, Rgb color, uint8_t scale)
{
  while (index < 0)
    index += LED_COUNT;
  index %= LED_COUNT;
  addColor(&frame[index], scaleColor(color, scale));
}

static void drawSmoothDot(uint16_t position256, Rgb color)
{
  uint16_t base = (position256 >> 8) % LED_COUNT;
  uint8_t fraction = position256 & 0xFF;
  uint8_t baseScale = 255 - fraction;

  addScaledPixel(base, color, baseScale);
  addScaledPixel(base + 1, color, fraction);
  addScaledPixel(base - 1, color, 45);
  addScaledPixel(base - 2, color, 14);
}

static Rgb hsvToRgb(uint8_t hue, uint8_t sat, uint8_t val)
{
  uint8_t region = hue / 43;
  uint8_t remainder = (hue - (region * 43)) * 6;
  uint8_t p = ((uint16_t)val * (255 - sat)) >> 8;
  uint8_t q = ((uint16_t)val * (255 - (((uint16_t)sat * remainder) >> 8))) >> 8;
  uint8_t t = ((uint16_t)val * (255 - (((uint16_t)sat * (255 - remainder)) >> 8))) >> 8;

  switch (region)
  {
  case 0:
    return LED_RGB(val, t, p);
  case 1:
    return LED_RGB(q, val, p);
  case 2:
    return LED_RGB(p, val, t);
  case 3:
    return LED_RGB(p, q, val);
  case 4:
    return LED_RGB(t, p, val);
  default:
    return LED_RGB(val, p, q);
  }
}

static void encodeByte(uint8_t value, uint16_t *symbolIndex)
{
  for (uint8_t bit = 0; bit < 8; bit++)
  {
    rmt_data_t *symbol = &ledData[*symbolIndex];
    if (value & (1 << (7 - bit)))
    {
      symbol->level0 = 1;
      symbol->duration0 = 8;
      symbol->level1 = 0;
      symbol->duration1 = 4;
    }
    else
    {
      symbol->level0 = 1;
      symbol->duration0 = 4;
      symbol->level1 = 0;
      symbol->duration1 = 8;
    }
    (*symbolIndex)++;
  }
}

static void showLeds()
{
  uint16_t symbolIndex = 0;

  for (uint16_t i = 0; i < LED_COUNT; i++)
  {
    encodeByte(leds[i].g, &symbolIndex);
    encodeByte(leds[i].r, &symbolIndex);
    encodeByte(leds[i].b, &symbolIndex);
  }

  rmtWrite(LED_PIN, ledData, symbolIndex, RMT_WAIT_FOR_EVER);
}

static void renderIdle(unsigned long elapsedMs)
{
  // Idle: soft cyan breathing from 15 percent to 45 percent over five seconds.
  uint8_t scale = triangleWave(elapsedMs, 5000, 38, 115);
  fillFrame(scaleColor(IDLE_COLOR, scale));
}

static void renderStartup(unsigned long elapsedMs)
{
  clearFrame();

  // Startup part 1: blue wipe from dark.
  if (elapsedMs < 700)
  {
    uint16_t lit = mapU16(elapsedMs, 0, 700, 0, LED_COUNT);
    for (uint16_t i = 0; i < lit && i < LED_COUNT; i++)
      frame[i] = LISTENING_COLOR;
    return;
  }

  // Startup part 2: green wipe over the completed blue wipe.
  if (elapsedMs < 1400)
  {
    uint16_t lit = mapU16(elapsedMs - 700, 0, 700, 0, LED_COUNT);
    fillFrame(LISTENING_COLOR);
    for (uint16_t i = 0; i < lit && i < LED_COUNT; i++)
      frame[i] = SUCCESS_COLOR;
    return;
  }

  // Startup part 3: one clockwise rainbow rotation.
  if (elapsedMs < 2400)
  {
    uint8_t offset = mapU16(elapsedMs - 1400, 0, 1000, 0, 255);
    for (uint16_t i = 0; i < LED_COUNT; i++)
      frame[i] = hsvToRgb(offset + (i * 255 / LED_COUNT), 255, 255);
    return;
  }

  // Startup part 4: fade the rainbow into the normal idle breathing color.
  Rgb idleFrame = scaleColor(IDLE_COLOR, 90);
  uint8_t amount = mapU16(elapsedMs - 2400, 0, 600, 0, 255);
  for (uint16_t i = 0; i < LED_COUNT; i++)
    frame[i] = blendColor(hsvToRgb(i * 255 / LED_COUNT, 255, 255), idleFrame, amount);
}

static void renderListening(unsigned long elapsedMs)
{
  // Listening: one blue dot rotates clockwise at 180 ms per LED.
  clearFrame();
  frame[(elapsedMs / 180) % LED_COUNT] = LISTENING_COLOR;
}

static void renderThinking(unsigned long elapsedMs)
{
  // Thinking: two opposite purple orbits move smoothly around the ring.
  clearFrame();
  uint16_t position = ((elapsedMs % (LED_COUNT * 95UL)) * 256UL) / 95UL;
  drawSmoothDot(position, THINKING_COLOR);
  drawSmoothDot(position + ((LED_COUNT * 256) / 2), THINKING_COLOR);
}

static void renderSpeaking(unsigned long elapsedMs, float audioLevel)
{
  // Speaking: live audio level lights more LEDs; when no level is supplied yet,
  // use a synthetic voice meter so spoken replies never look like one stuck pixel.
  clearFrame();
  uint8_t level = clampUnitToByte(audioLevel);
  if (level == 0)
  {
    uint8_t pulseA = triangleWave(elapsedMs, 760, 80, 210);
    uint8_t pulseB = triangleWave(elapsedMs + 260, 920, 45, 180);
    level = max(pulseA, pulseB);
  }

  uint16_t lit = mapU16(level, 0, 255, LED_COUNT / 4, LED_COUNT);
  uint16_t half = LED_COUNT / 2;
  uint16_t used = 0;

  for (uint16_t step = 0; used < lit && step <= half; step++)
  {
    uint16_t fade = min((uint16_t)150, (uint16_t)(step * 18));
    uint8_t scale = (uint8_t)(255 - fade);
    if (used < lit)
    {
      frame[step % LED_COUNT] = scaleColor(SPEAKING_COLOR, scale);
      used++;
    }

    if (used < lit)
    {
      frame[(LED_COUNT - step) % LED_COUNT] = scaleColor(SPEAKING_COLOR, scale);
      used++;
    }
  }
}

static void renderMusic(unsigned long elapsedMs, float beatLevel)
{
  // Music: a rotating rainbow with brightness pulsing from externally supplied beat level.
  uint8_t offset = elapsedMs / 18;
  uint8_t beat = mapU16(clampUnitToByte(beatLevel), 0, 255, 110, 255);

  for (uint16_t i = 0; i < LED_COUNT; i++)
    frame[i] = scaleColor(hsvToRgb(offset + (i * 255 / LED_COUNT), 255, 255), beat);
}

static void renderRadio(unsigned long elapsedMs)
{
  // Radio: same rainbow family as music, but slow and steady with no beat pulse.
  uint8_t offset = elapsedMs / 90;
  for (uint16_t i = 0; i < LED_COUNT; i++)
    frame[i] = hsvToRgb(offset + (i * 255 / LED_COUNT), 220, 170);
}

static void renderSleep(unsigned long elapsedMs)
{
  // Sleep: very dim blue breathing so LULU looks asleep instead of powered off.
  uint8_t scale = triangleWave(elapsedMs, 6500, 4, 22);
  fillFrame(scaleColor(LED_RGB(0, 20, 90), scale));
}

static void renderNotification(unsigned long elapsedMs)
{
  // Notification: two quick yellow flashes, then the manager restores the previous mode.
  bool on = elapsedMs < 140 || (elapsedMs >= 260 && elapsedMs < 400);
  fillFrame(on ? NOTIFICATION_COLOR : LED_RGB(0, 0, 0));
}

static void renderMessageUnread(unsigned long elapsedMs)
{
  // Unread message: continuous slow red breathing until the inbox is read.
  uint8_t scale = triangleWave(elapsedMs, 3200, 8, 150);
  fillFrame(scaleColor(ERROR_COLOR, scale));
}

static void renderSuccess(unsigned long elapsedMs)
{
  // Success: a green spiral makes one full clockwise rotation before restoring the previous mode.
  clearFrame();
  uint16_t position = mapU16(elapsedMs, 0, 1100, 0, LED_COUNT * 256);
  drawSmoothDot(position, SUCCESS_COLOR);
  drawSmoothDot(position - 384, scaleColor(SUCCESS_COLOR, 120));
}

static void renderError(unsigned long elapsedMs)
{
  // Error: red pulse three times, then the manager restores the previous mode.
  uint8_t scale = triangleWave(elapsedMs % 600, 600, 20, 255);
  fillFrame(scaleColor(ERROR_COLOR, scale));
}

static void renderWifiConnecting(unsigned long elapsedMs)
{
  // WiFi connecting: blue spinner with a short tail.
  clearFrame();
  uint16_t position = ((elapsedMs % (LED_COUNT * 120UL)) * 256UL) / 120UL;
  drawSmoothDot(position, WIFI_COLOR);
}

static void renderWifiConnected(unsigned long elapsedMs)
{
  // WiFi connected: a quick green wipe, then the manager returns to idle.
  clearFrame();
  uint16_t lit = mapU16(elapsedMs, 0, 850, 0, LED_COUNT);
  for (uint16_t i = 0; i < lit && i < LED_COUNT; i++)
    frame[i] = SUCCESS_COLOR;
}

static void renderCharging(int chargePercent)
{
  // Charging: battery fill from red through yellow into green based on 0-100 percent.
  clearFrame();
  chargePercent = constrain(chargePercent, 0, 100);
  uint16_t lit = mapU16(chargePercent, 0, 100, 0, LED_COUNT);
  Rgb color = blendColor(CHARGING_EMPTY_COLOR, CHARGING_FULL_COLOR, mapU16(chargePercent, 0, 100, 0, 255));

  for (uint16_t i = 0; i < lit && i < LED_COUNT; i++)
    frame[i] = color;
}

static void renderLowBattery(unsigned long elapsedMs)
{
  // Low battery: very slow red breathing.
  uint8_t scale = triangleWave(elapsedMs, 7500, 8, 90);
  fillFrame(scaleColor(ERROR_COLOR, scale));
}

void LedManagerClass::begin()
{
  _brightness = min((uint8_t)MAX_BRIGHTNESS, (uint8_t)120);
  _driverReady = rmtInit(LED_PIN, RMT_TX_MODE, RMT_MEM_NUM_BLOCKS_1, 10000000);
  fillFrame(LED_RGB(0, 0, 0));
  for (uint16_t i = 0; i < LED_COUNT; i++)
  {
    leds[i] = LED_RGB(0, 0, 0);
    transitionFrom[i] = LED_RGB(0, 0, 0);
  }

  if (_driverReady)
    showLeds();

  startMode(LED_STARTUP, false);
}

void LedManagerClass::update()
{
  if (!_driverReady)
    return;

  unsigned long now = millis();
  if (_lastFrameMs != 0 && now - _lastFrameMs < LED_UPDATE_INTERVAL_MS)
    return;
  _lastFrameMs = now;

  unsigned long elapsedMs = now - _modeStartedMs;

  if (_mode == LED_STARTUP && elapsedMs >= 3000)
    startMode(LED_IDLE, false);
  else if (_mode == LED_NOTIFICATION && elapsedMs >= 650)
    restorePreviousMode();
  else if (_mode == LED_SUCCESS && elapsedMs >= 1200)
    restorePreviousMode();
  else if (_mode == LED_ERROR && elapsedMs >= 1800)
    restorePreviousMode();
  else if (_mode == LED_WIFI_CONNECTED && elapsedMs >= 900)
    startMode(LED_IDLE, false);

  elapsedMs = now - _modeStartedMs;

  switch (_mode)
  {
  case LED_OFF:
    clearFrame();
    break;
  case LED_STARTUP:
    renderStartup(elapsedMs);
    break;
  case LED_IDLE:
    renderIdle(elapsedMs);
    break;
  case LED_LISTENING:
    renderListening(elapsedMs);
    break;
  case LED_THINKING:
    renderThinking(elapsedMs);
    break;
  case LED_SPEAKING:
    renderSpeaking(elapsedMs, _audioLevel);
    break;
  case LED_MUSIC:
    renderMusic(elapsedMs, _beatLevel);
    break;
  case LED_RADIO:
    renderRadio(elapsedMs);
    break;
  case LED_SLEEP:
    renderSleep(elapsedMs);
    break;
  case LED_NOTIFICATION:
    renderNotification(elapsedMs);
    break;
  case LED_MESSAGE_UNREAD:
    renderMessageUnread(elapsedMs);
    break;
  case LED_SUCCESS:
    renderSuccess(elapsedMs);
    break;
  case LED_ERROR:
    renderError(elapsedMs);
    break;
  case LED_WIFI_CONNECTING:
    renderWifiConnecting(elapsedMs);
    break;
  case LED_WIFI_CONNECTED:
    renderWifiConnected(elapsedMs);
    break;
  case LED_CHARGING:
    renderCharging(_chargePercent);
    break;
  case LED_LOW_BATTERY:
    renderLowBattery(elapsedMs);
    break;
  }

  if (_transitionActive)
  {
    uint8_t amount = mapU16(now - _transitionStartedMs, 0, LED_TRANSITION_MS, 0, 255);
    for (uint16_t i = 0; i < LED_COUNT; i++)
      leds[i] = scaleColor(blendColor(transitionFrom[i], frame[i], amount), _brightness);

    if (amount >= 255)
      _transitionActive = false;
  }
  else
  {
    for (uint16_t i = 0; i < LED_COUNT; i++)
      leds[i] = scaleColor(frame[i], _brightness);
  }

  showLeds();
}

void LedManagerClass::setMode(LedMode mode)
{
  if (mode == _mode)
    return;

  startMode(mode, true);
}

LedMode LedManagerClass::getMode() const
{
  return _mode;
}

void LedManagerClass::restorePreviousMode()
{
  LedMode restored = isMomentaryMode(_previousMode) ? LED_IDLE : _previousMode;
  startMode(restored, false);
}

void LedManagerClass::setAudioLevel(float level)
{
  _audioLevel = constrain(level, 0.0f, 1.0f);
}

void LedManagerClass::setBeatLevel(float level)
{
  _beatLevel = constrain(level, 0.0f, 1.0f);
}

void LedManagerClass::setChargePercent(int percent)
{
  _chargePercent = constrain(percent, 0, 100);
}

void LedManagerClass::setBrightness(uint8_t brightness)
{
  _brightness = min(brightness, (uint8_t)MAX_BRIGHTNESS);
}

void LedManagerClass::startMode(LedMode mode, bool rememberPrevious)
{
  if (rememberPrevious && isMomentaryMode(mode))
    _previousMode = isMomentaryMode(_mode) ? LED_IDLE : _mode;
  else if (rememberPrevious && !isMomentaryMode(_mode))
    _previousMode = _mode;

  for (uint16_t i = 0; i < LED_COUNT; i++)
    transitionFrom[i] = frame[i];

  _mode = mode;
  _modeStartedMs = millis();
  _transitionStartedMs = _modeStartedMs;
  _transitionActive = true;
}

bool LedManagerClass::isMomentaryMode(LedMode mode) const
{
  return mode == LED_NOTIFICATION ||
         mode == LED_SUCCESS ||
         mode == LED_ERROR ||
         mode == LED_WIFI_CONNECTED;
}
