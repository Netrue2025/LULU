#include "LocalBibleService.h"

static const char *BIBLE_ROOT = "/lulu/bible";
static const char *BIBLE_INDEX = "/lulu/bible/index.json";

struct BibleAlias
{
  const char *alias;
  const char *code;
};

static const BibleAlias BIBLE_ALIASES[] = {
    {"genesis", "GEN"}, {"gen", "GEN"},
    {"exodus", "EXO"}, {"exo", "EXO"}, {"exod", "EXO"},
    {"leviticus", "LEV"}, {"lev", "LEV"},
    {"numbers", "NUM"}, {"num", "NUM"},
    {"deuteronomy", "DEU"}, {"deut", "DEU"}, {"deu", "DEU"},
    {"joshua", "JOS"}, {"josh", "JOS"}, {"jos", "JOS"},
    {"judges", "JDG"}, {"judg", "JDG"}, {"jdg", "JDG"},
    {"ruth", "RUT"}, {"rut", "RUT"},
    {"1 samuel", "1SA"}, {"first samuel", "1SA"}, {"i samuel", "1SA"}, {"1samuel", "1SA"}, {"1 sam", "1SA"},
    {"2 samuel", "2SA"}, {"second samuel", "2SA"}, {"ii samuel", "2SA"}, {"2samuel", "2SA"}, {"2 sam", "2SA"},
    {"1 kings", "1KI"}, {"first kings", "1KI"}, {"i kings", "1KI"}, {"1kings", "1KI"}, {"1 kin", "1KI"},
    {"2 kings", "2KI"}, {"second kings", "2KI"}, {"ii kings", "2KI"}, {"2kings", "2KI"}, {"2 kin", "2KI"},
    {"1 chronicles", "1CH"}, {"first chronicles", "1CH"}, {"i chronicles", "1CH"}, {"1chronicles", "1CH"}, {"1 chron", "1CH"},
    {"2 chronicles", "2CH"}, {"second chronicles", "2CH"}, {"ii chronicles", "2CH"}, {"2chronicles", "2CH"}, {"2 chron", "2CH"},
    {"ezra", "EZR"}, {"ezr", "EZR"},
    {"nehemiah", "NEH"}, {"neh", "NEH"},
    {"esther", "EST"}, {"est", "EST"},
    {"job", "JOB"},
    {"psalm", "PSA"}, {"psalms", "PSA"}, {"psa", "PSA"}, {"ps", "PSA"},
    {"proverbs", "PRO"}, {"proverb", "PRO"}, {"prov", "PRO"}, {"pro", "PRO"},
    {"ecclesiastes", "ECC"}, {"eccl", "ECC"}, {"ecc", "ECC"},
    {"song of solomon", "SNG"}, {"song of songs", "SNG"}, {"songs", "SNG"}, {"sng", "SNG"},
    {"isaiah", "ISA"}, {"isa", "ISA"},
    {"jeremiah", "JER"}, {"jer", "JER"},
    {"lamentations", "LAM"}, {"lam", "LAM"},
    {"ezekiel", "EZK"}, {"ezek", "EZK"}, {"ezk", "EZK"},
    {"daniel", "DAN"}, {"dan", "DAN"},
    {"hosea", "HOS"}, {"hos", "HOS"},
    {"joel", "JOL"}, {"jol", "JOL"},
    {"amos", "AMO"}, {"amo", "AMO"},
    {"obadiah", "OBA"}, {"oba", "OBA"},
    {"jonah", "JON"}, {"jon", "JON"},
    {"micah", "MIC"}, {"mic", "MIC"},
    {"nahum", "NAM"}, {"nah", "NAM"}, {"nam", "NAM"},
    {"habakkuk", "HAB"}, {"hab", "HAB"},
    {"zephaniah", "ZEP"}, {"zep", "ZEP"},
    {"haggai", "HAG"}, {"hag", "HAG"},
    {"zechariah", "ZEC"}, {"zec", "ZEC"},
    {"malachi", "MAL"}, {"mal", "MAL"},
    {"matthew", "MAT"}, {"matt", "MAT"}, {"mat", "MAT"},
    {"mark", "MRK"}, {"mrk", "MRK"},
    {"luke", "LUK"}, {"luk", "LUK"},
    {"john", "JHN"}, {"jhn", "JHN"},
    {"acts", "ACT"}, {"act", "ACT"},
    {"romans", "ROM"}, {"rom", "ROM"},
    {"1 corinthians", "1CO"}, {"first corinthians", "1CO"}, {"1corinthians", "1CO"}, {"1 cor", "1CO"},
    {"2 corinthians", "2CO"}, {"second corinthians", "2CO"}, {"2corinthians", "2CO"}, {"2 cor", "2CO"},
    {"galatians", "GAL"}, {"gal", "GAL"},
    {"ephesians", "EPH"}, {"eph", "EPH"},
    {"philippians", "PHP"}, {"phil", "PHP"}, {"php", "PHP"},
    {"colossians", "COL"}, {"col", "COL"},
    {"1 thessalonians", "1TH"}, {"first thessalonians", "1TH"}, {"1thessalonians", "1TH"}, {"1 thess", "1TH"},
    {"2 thessalonians", "2TH"}, {"second thessalonians", "2TH"}, {"2thessalonians", "2TH"}, {"2 thess", "2TH"},
    {"1 timothy", "1TI"}, {"first timothy", "1TI"}, {"1timothy", "1TI"}, {"1 tim", "1TI"},
    {"2 timothy", "2TI"}, {"second timothy", "2TI"}, {"2timothy", "2TI"}, {"2 tim", "2TI"},
    {"titus", "TIT"}, {"tit", "TIT"},
    {"philemon", "PHM"}, {"phm", "PHM"},
    {"hebrews", "HEB"}, {"heb", "HEB"},
    {"james", "JAS"}, {"jas", "JAS"},
    {"1 peter", "1PE"}, {"first peter", "1PE"}, {"1peter", "1PE"}, {"1 pet", "1PE"},
    {"2 peter", "2PE"}, {"second peter", "2PE"}, {"2peter", "2PE"}, {"2 pet", "2PE"},
    {"1 john", "1JN"}, {"first john", "1JN"}, {"1john", "1JN"},
    {"2 john", "2JN"}, {"second john", "2JN"}, {"2john", "2JN"},
    {"3 john", "3JN"}, {"third john", "3JN"}, {"3john", "3JN"},
    {"jude", "JUD"}, {"jud", "JUD"},
    {"revelation", "REV"}, {"revelations", "REV"}, {"rev", "REV"},
};

bool LocalBibleService::begin(bool sdAvailable)
{
  _available = false;
  _bookCount = 0;
  _chapterCount = 0;
  _translation = "";
  _language = "";
  _lastError = "";

  if (!sdAvailable)
  {
    _lastError = "SD card is not ready";
    Serial.println("[BIBLE] Bible audio not installed: SD card unavailable");
    return false;
  }

  if (!SD.exists(BIBLE_INDEX))
  {
    _lastError = "Missing /lulu/bible/index.json";
    Serial.println("[BIBLE] Bible audio not installed");
    return false;
  }

  File file = SD.open(BIBLE_INDEX, FILE_READ);
  if (!file)
  {
    _lastError = "Could not open Bible index";
    return false;
  }

  DynamicJsonDocument doc(12288);
  DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error)
  {
    _lastError = "Invalid Bible index JSON";
    Serial.println("[BIBLE] Invalid Bible index JSON");
    return false;
  }

  _translation = doc["translation"] | "";
  _language = doc["language"] | "";
  const char *format = doc["audioFormat"] | "";
  if (!_translation.length() || !String(format).equalsIgnoreCase("mp3"))
  {
    _lastError = "Bible index must declare translation and mp3 audio";
    return false;
  }

  String translationDir = String(BIBLE_ROOT) + "/" + _translation;
  if (!SD.exists(translationDir))
  {
    _lastError = "Missing Bible translation folder";
    return false;
  }

  JsonObject books = doc["books"].as<JsonObject>();
  for (JsonPair pair : books)
  {
    if (_bookCount >= MAX_BOOKS)
      break;

    String code = pair.key().c_str();
    code.toUpperCase();
    JsonObject value = pair.value().as<JsonObject>();
    uint16_t chapters = value["chapters"] | 0;
    if (!code.length() || chapters == 0)
      continue;

    _books[_bookCount].code = code;
    _books[_bookCount].name = value["name"] | code;
    _books[_bookCount].chapters = chapters;
    _chapterCount += chapters;
    _bookCount++;
  }

  _available = _bookCount > 0;
  if (_available)
  {
    Serial.println("[BIBLE] Local Bible initialized");
    Serial.println("[BIBLE] Translation: " + _translation);
    Serial.println("[BIBLE] Audio: MP3");
    Serial.println("[BIBLE] Offline: YES");
  }
  else
  {
    _lastError = "Bible index has no books";
    Serial.println("[BIBLE] Bible audio not installed");
  }
  return _available;
}

bool LocalBibleService::isAvailable() const { return _available; }
String LocalBibleService::translation() const { return _translation; }
String LocalBibleService::language() const { return _language; }
uint16_t LocalBibleService::bookCount() const { return _bookCount; }
uint16_t LocalBibleService::chapterCount() const { return _chapterCount; }
String LocalBibleService::lastError() const { return _lastError; }

String LocalBibleService::statusJson() const
{
  String json;
  json.reserve(240);
  json += F("{\"success\":true,\"available\":");
  json += _available ? F("true") : F("false");
  json += F(",\"translation\":\"");
  json += _translation;
  json += F("\",\"language\":\"");
  json += _language;
  json += F("\",\"audioFormat\":\"mp3\",\"offline\":true,\"books\":");
  json += String(_bookCount);
  json += F(",\"chapters\":");
  json += String(_chapterCount);
  json += F(",\"lastError\":\"");
  json += _lastError;
  json += F("\"}");
  return json;
}

String LocalBibleService::normalizeBookText(String value) const
{
  value.toLowerCase();
  value.replace(".", " ");
  value.replace(",", " ");
  value.replace("chapter", " ");
  value.replace("chapters", " ");
  value.replace("book of", " ");
  value.replace("the bible", " ");
  value.replace("bible", " ");
  value.replace("read", " ");
  value.replace("play", " ");
  value.replace("open", " ");
  value.replace("turn to", " ");
  value.replace("please", " ");
  value.replace("lulu", " ");
  while (value.indexOf("  ") >= 0)
    value.replace("  ", " ");
  value.trim();
  return value;
}

String LocalBibleService::canonicalBookCode(const String &normalized) const
{
  for (uint16_t i = 0; i < sizeof(BIBLE_ALIASES) / sizeof(BIBLE_ALIASES[0]); i++)
  {
    if (normalized == BIBLE_ALIASES[i].alias)
      return BIBLE_ALIASES[i].code;
  }

  String compact = normalized;
  compact.replace(" ", "");
  for (uint16_t i = 0; i < sizeof(BIBLE_ALIASES) / sizeof(BIBLE_ALIASES[0]); i++)
  {
    String alias = BIBLE_ALIASES[i].alias;
    alias.replace(" ", "");
    if (compact == alias)
      return BIBLE_ALIASES[i].code;
  }

  String upper = normalized;
  upper.toUpperCase();
  return upper;
}

int LocalBibleService::findBookIndex(const String &bookCode) const
{
  String code = bookCode;
  code.toUpperCase();
  for (uint8_t i = 0; i < _bookCount; i++)
  {
    if (_books[i].code == code)
      return i;
  }
  return -1;
}

String LocalBibleService::resolveBook(const String &userBook) const
{
  String code = canonicalBookCode(normalizeBookText(userBook));
  return findBookIndex(code) >= 0 ? code : "";
}

bool LocalBibleService::hasBook(const String &bookCode) const
{
  return findBookIndex(bookCode) >= 0;
}

bool LocalBibleService::hasChapter(const String &bookCode, int chapter) const
{
  int index = findBookIndex(bookCode);
  return index >= 0 && chapter >= 1 && chapter <= _books[index].chapters;
}

String LocalBibleService::getChapterPath(const String &bookCode, int chapter) const
{
  if (!_available || !hasChapter(bookCode, chapter))
    return "";
  String chapterName = (chapter < 100 ? (chapter < 10 ? "00" : "0") : "") + String(chapter) + ".mp3";
  return String(BIBLE_ROOT) + "/" + _translation + "/" + bookCode + "/" + chapterName;
}

bool LocalBibleService::resolveReference(const String &text, LocalBibleChapter &chapter)
{
  chapter = LocalBibleChapter();
  if (!_available)
  {
    _lastError = "Bible audio is not installed";
    return false;
  }

  String normalized = text;
  normalized.toLowerCase();
  normalized.replace(".", " ");
  normalized.replace(",", " ");
  normalized.replace(":", " ");
  while (normalized.indexOf("  ") >= 0)
    normalized.replace("  ", " ");
  normalized.trim();

  int chapterNumber = 0;
  int numberStart = -1;
  int verseIndex = normalized.indexOf(" verse ");
  String chapterSource = verseIndex >= 0 ? normalized.substring(0, verseIndex) : normalized;
  for (int i = chapterSource.length() - 1; i >= 0; i--)
  {
    if (isDigit(chapterSource[i]))
      numberStart = i;
    else if (numberStart >= 0)
      break;
  }

  if (numberStart < 0)
  {
    _lastError = "Please tell me the Bible book and chapter.";
    return false;
  }

  chapterNumber = chapterSource.substring(numberStart).toInt();
  String bookText = chapterSource.substring(0, numberStart);
  bookText.replace("verse", " ");
  bookText.replace("verses", " ");
  bookText = normalizeBookText(bookText);

  String bookCode = resolveBook(bookText);
  if (!bookCode.length())
  {
    _lastError = "I could not find that Bible book offline.";
    return false;
  }

  if (!hasChapter(bookCode, chapterNumber))
  {
    _lastError = "I could not find that Bible chapter offline.";
    return false;
  }

  String path = getChapterPath(bookCode, chapterNumber);
  if (!SD.exists(path))
  {
    _lastError = "The Bible chapter file is missing.";
    return false;
  }

  int index = findBookIndex(bookCode);
  chapter.bookCode = bookCode;
  chapter.bookName = index >= 0 ? _books[index].name : bookCode;
  chapter.chapter = chapterNumber;
  chapter.path = path;
  return true;
}
