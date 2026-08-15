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

struct BibleBookInfo
{
  const char *code;
  const char *name;
  uint16_t chapters;
};

static const BibleBookInfo BIBLE_BOOKS[] = {
    {"GEN", "Genesis", 50}, {"EXO", "Exodus", 40}, {"LEV", "Leviticus", 27}, {"NUM", "Numbers", 36},
    {"DEU", "Deuteronomy", 34}, {"JOS", "Joshua", 24}, {"JDG", "Judges", 21}, {"RUT", "Ruth", 4},
    {"1SA", "1 Samuel", 31}, {"2SA", "2 Samuel", 24}, {"1KI", "1 Kings", 22}, {"2KI", "2 Kings", 25},
    {"1CH", "1 Chronicles", 29}, {"2CH", "2 Chronicles", 36}, {"EZR", "Ezra", 10}, {"NEH", "Nehemiah", 13},
    {"EST", "Esther", 10}, {"JOB", "Job", 42}, {"PSA", "Psalms", 150}, {"PRO", "Proverbs", 31},
    {"ECC", "Ecclesiastes", 12}, {"SNG", "Song of Solomon", 8}, {"ISA", "Isaiah", 66}, {"JER", "Jeremiah", 52},
    {"LAM", "Lamentations", 5}, {"EZK", "Ezekiel", 48}, {"DAN", "Daniel", 12}, {"HOS", "Hosea", 14},
    {"JOL", "Joel", 3}, {"AMO", "Amos", 9}, {"OBA", "Obadiah", 1}, {"JON", "Jonah", 4},
    {"MIC", "Micah", 7}, {"NAM", "Nahum", 3}, {"HAB", "Habakkuk", 3}, {"ZEP", "Zephaniah", 3},
    {"HAG", "Haggai", 2}, {"ZEC", "Zechariah", 14}, {"MAL", "Malachi", 4}, {"MAT", "Matthew", 28},
    {"MRK", "Mark", 16}, {"LUK", "Luke", 24}, {"JHN", "John", 21}, {"ACT", "Acts", 28},
    {"ROM", "Romans", 16}, {"1CO", "1 Corinthians", 16}, {"2CO", "2 Corinthians", 13}, {"GAL", "Galatians", 6},
    {"EPH", "Ephesians", 6}, {"PHP", "Philippians", 4}, {"COL", "Colossians", 4}, {"1TH", "1 Thessalonians", 5},
    {"2TH", "2 Thessalonians", 3}, {"1TI", "1 Timothy", 6}, {"2TI", "2 Timothy", 4}, {"TIT", "Titus", 3},
    {"PHM", "Philemon", 1}, {"HEB", "Hebrews", 13}, {"JAS", "James", 5}, {"1PE", "1 Peter", 5},
    {"2PE", "2 Peter", 3}, {"1JN", "1 John", 5}, {"2JN", "2 John", 1}, {"3JN", "3 John", 1},
    {"JUD", "Jude", 1}, {"REV", "Revelation", 22},
};

static String uint64String(uint64_t value)
{
  char buffer[24];
  snprintf(buffer, sizeof(buffer), "%llu", (unsigned long long)value);
  return String(buffer);
}

static String baseNameFromBiblePath(String path)
{
  path.replace("\\", "/");
  int slash = path.lastIndexOf('/');
  return slash >= 0 ? path.substring(slash + 1) : path;
}

static int bibleBookInfoIndex(const String &bookCode)
{
  String code = bookCode;
  code.toUpperCase();
  for (uint8_t i = 0; i < sizeof(BIBLE_BOOKS) / sizeof(BIBLE_BOOKS[0]); i++)
  {
    if (code == BIBLE_BOOKS[i].code)
      return i;
  }
  return -1;
}

static int parseDigitsAt(const String &value, int start, int *endOut = nullptr)
{
  int end = start;
  while (end < value.length() && isDigit(value[end]))
    end++;
  if (endOut)
    *endOut = end;
  return end > start ? value.substring(start, end).toInt() : 0;
}

static int firstDigitAfter(const String &value, int start)
{
  for (int i = start; i < value.length(); i++)
  {
    if (isDigit(value[i]))
      return i;
  }
  return -1;
}

static int lastDigitsBefore(const String &value, int before)
{
  int i = min(before - 1, value.length() - 1);
  while (i >= 0)
  {
    while (i >= 0 && !isDigit(value[i]))
      i--;
    if (i < 0)
      return 0;

    int end = i + 1;
    while (i >= 0 && isDigit(value[i]))
      i--;
    int parsed = value.substring(i + 1, end).toInt();
    if (parsed > 0)
      return parsed;
  }
  return 0;
}

static bool validBibleChapter(const String &bookCode, int chapter)
{
  int infoIndex = bibleBookInfoIndex(bookCode);
  return infoIndex >= 0 && chapter >= 1 && chapter <= (int)BIBLE_BOOKS[infoIndex].chapters;
}

static bool detectNamedBibleFile(const String &path, String &bookCode, int &chapter)
{
  String name = baseNameFromBiblePath(path);
  int dot = name.lastIndexOf('.');
  if (dot > 0)
    name = name.substring(0, dot);
  name.toLowerCase();
  name.replace("_", " ");
  name.replace("-", " ");
  name.replace(".", " ");
  while (name.indexOf("  ") >= 0)
    name.replace("  ", " ");

  int bestAlias = -1;
  int bestAliasPos = -1;
  int bestAliasLen = 0;
  for (uint16_t i = 0; i < sizeof(BIBLE_ALIASES) / sizeof(BIBLE_ALIASES[0]); i++)
  {
    String alias = BIBLE_ALIASES[i].alias;
    int aliasPos = name.indexOf(alias);
    if (aliasPos >= 0 && alias.length() > bestAliasLen)
    {
      bestAlias = i;
      bestAliasPos = aliasPos;
      bestAliasLen = alias.length();
    }
  }

  if (bestAlias < 0)
    return false;

  String candidateBook = BIBLE_ALIASES[bestAlias].code;
  int parsedChapter = lastDigitsBefore(name, bestAliasPos);
  if (!validBibleChapter(candidateBook, parsedChapter))
  {
    int digitAt = firstDigitAfter(name, bestAliasPos + bestAliasLen);
    if (digitAt >= 0)
    {
      int numberEnd = 0;
      parsedChapter = parseDigitsAt(name, digitAt, &numberEnd);
    }
  }

  if (!validBibleChapter(candidateBook, parsedChapter))
    return false;

  bookCode = candidateBook;
  chapter = parsedChapter;
  return true;
}

static bool detectNumberedBibleFile(const String &path, String &bookCode, int &chapter)
{
  String name = baseNameFromBiblePath(path);
  int dot = name.lastIndexOf('.');
  if (dot > 0)
    name = name.substring(0, dot);
  if (name.length() < 5 || !isAlpha(name[0]))
    return false;

  int bookEnd = 0;
  int bookNumber = parseDigitsAt(name, 1, &bookEnd);
  if (bookNumber < 1 || bookNumber > (int)(sizeof(BIBLE_BOOKS) / sizeof(BIBLE_BOOKS[0])))
    return false;

  int chapterStart = name.indexOf("___", bookEnd);
  chapterStart = chapterStart >= 0 ? chapterStart + 3 : firstDigitAfter(name, bookEnd);
  if (chapterStart < 0)
    return false;

  int parsedChapter = parseDigitsAt(name, chapterStart);
  const BibleBookInfo &book = BIBLE_BOOKS[bookNumber - 1];
  if (parsedChapter < 1 || parsedChapter > (int)book.chapters)
    return false;

  bookCode = book.code;
  chapter = parsedChapter;
  return true;
}

bool LocalBibleService::begin(bool sdAvailable)
{
  _available = false;
  _bookCount = 0;
  _chapterCount = 0;
  _translation = "";
  _language = "";
  _lastError = "";
  _looseMode = false;
  memset(_looseChapters, 0, sizeof(_looseChapters));

  if (!sdAvailable)
  {
    _lastError = "SD card is not ready";
    Serial.println("[BIBLE] Bible audio not installed: SD card unavailable");
    return false;
  }

  if (!SD.exists(BIBLE_INDEX))
  {
    Serial.println("[BIBLE] Bible index missing; scanning uploaded MP3 folders");
    return beginLooseScan();
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

bool LocalBibleService::beginLooseScan()
{
  if (!SD.exists(BIBLE_ROOT))
  {
    _lastError = "Missing /lulu/bible folder";
    Serial.println("[BIBLE] Bible audio not installed");
    return false;
  }

  File root = SD.open(BIBLE_ROOT, FILE_READ);
  if (!root || !root.isDirectory())
  {
    _lastError = "Could not open /lulu/bible";
    return false;
  }

  _translation = "SDCARD";
  _language = "eng";
  _looseMode = true;
  scanLooseDirectory(root, BIBLE_ROOT, 0);
  root.close();

  _available = _bookCount > 0 && _chapterCount > 0;
  if (_available)
  {
    _lastError = "Using scanned Bible MP3 files without index.json";
    Serial.printf("[BIBLE] Scanned Bible audio: books=%u chapters=%u\n", _bookCount, _chapterCount);
  }
  else
  {
    _looseMode = false;
    _translation = "";
    _language = "";
    _lastError = "Bible audio is not installed";
    Serial.println("[BIBLE] No readable Bible MP3 chapters found");
  }
  return _available;
}

void LocalBibleService::scanLooseDirectory(File dir, const String &dirPath, uint8_t depth)
{
  if (!dir || depth > 5)
    return;

  File entry = dir.openNextFile();
  while (entry)
  {
    String name = baseNameFromBiblePath(String(entry.name()));
    String path = dirPath + "/" + name;
    if (entry.isDirectory())
    {
      scanLooseDirectory(entry, path, depth + 1);
    }
    else
    {
      String lower = name;
      lower.toLowerCase();
      if (lower.endsWith(".mp3"))
      {
        String bookCode;
        int chapter = 0;
        if (detectLooseChapter(path, bookCode, chapter))
          addLooseChapter(bookCode, chapter);
      }
    }
    entry.close();
    entry = dir.openNextFile();
  }
}

bool LocalBibleService::addLooseChapter(const String &bookCode, int chapter)
{
  int infoIndex = bibleBookInfoIndex(bookCode);
  if (infoIndex < 0 || chapter < 1 || chapter > MAX_TRACKED_CHAPTERS)
    return false;

  int index = findBookIndex(bookCode);
  if (index < 0)
  {
    if (_bookCount >= MAX_BOOKS)
      return false;
    index = _bookCount++;
    _books[index].code = BIBLE_BOOKS[infoIndex].code;
    _books[index].name = BIBLE_BOOKS[infoIndex].name;
    _books[index].chapters = 0;
  }

  if (!_looseChapters[index][chapter])
  {
    _looseChapters[index][chapter] = true;
    _chapterCount++;
  }
  if (chapter > _books[index].chapters)
    _books[index].chapters = chapter;
  return true;
}

bool LocalBibleService::detectLooseChapter(const String &path, String &bookCode, int &chapter) const
{
  if (detectNamedBibleFile(path, bookCode, chapter))
    return true;

  if (detectNumberedBibleFile(path, bookCode, chapter))
    return true;

  String compact = path;
  compact.toLowerCase();
  compact.replace("\\", "/");
  for (uint16_t i = 0; i < sizeof(BIBLE_ALIASES) / sizeof(BIBLE_ALIASES[0]); i++)
  {
    String alias = BIBLE_ALIASES[i].alias;
    alias.replace(" ", "");
    String compactPath = compact;
    compactPath.replace(" ", "");
    compactPath.replace("-", "");
    compactPath.replace("_", "");
    if (alias.length() && compactPath.indexOf(alias) >= 0)
    {
      int digitAt = firstDigitAfter(baseNameFromBiblePath(path), 0);
      if (digitAt < 0)
        return false;
      int parsedChapter = parseDigitsAt(baseNameFromBiblePath(path), digitAt);
      int infoIndex = bibleBookInfoIndex(BIBLE_ALIASES[i].code);
      if (infoIndex >= 0 && parsedChapter >= 1 && parsedChapter <= (int)BIBLE_BOOKS[infoIndex].chapters)
      {
        bookCode = BIBLE_ALIASES[i].code;
        chapter = parsedChapter;
        return true;
      }
    }
  }
  return false;
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
  json.reserve(360);
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
  json += F(",\"sd_used_bytes\":");
  json += uint64String(SD.usedBytes());
  json += F(",\"sd_total_bytes\":");
  json += uint64String(SD.totalBytes());
  json += F(",\"sd_free_bytes\":");
  json += uint64String(SD.totalBytes() > SD.usedBytes() ? SD.totalBytes() - SD.usedBytes() : 0);
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
  if (index < 0 || chapter < 1 || chapter > _books[index].chapters)
    return false;
  if (_looseMode)
    return chapter <= MAX_TRACKED_CHAPTERS && _looseChapters[index][chapter];
  return true;
}

String LocalBibleService::getChapterPath(const String &bookCode, int chapter) const
{
  if (!_available || !hasChapter(bookCode, chapter))
    return "";
  if (_looseMode)
    return findLooseChapterPath(bookCode, chapter);
  String chapterName = (chapter < 100 ? (chapter < 10 ? "00" : "0") : "") + String(chapter) + ".mp3";
  return String(BIBLE_ROOT) + "/" + _translation + "/" + bookCode + "/" + chapterName;
}

String LocalBibleService::findLooseChapterPath(const String &bookCode, int chapter) const
{
  File root = SD.open(BIBLE_ROOT, FILE_READ);
  if (!root || !root.isDirectory())
    return "";

  String path;
  bool found = findLooseChapterPathInDirectory(root, BIBLE_ROOT, bookCode, chapter, 0, path);
  root.close();
  return found ? path : "";
}

bool LocalBibleService::findLooseChapterPathInDirectory(File dir, const String &dirPath, const String &bookCode, int chapter, uint8_t depth, String &pathOut) const
{
  if (!dir || depth > 5)
    return false;

  File entry = dir.openNextFile();
  while (entry)
  {
    String name = baseNameFromBiblePath(String(entry.name()));
    String path = dirPath + "/" + name;
    bool found = false;
    if (entry.isDirectory())
    {
      found = findLooseChapterPathInDirectory(entry, path, bookCode, chapter, depth + 1, pathOut);
    }
    else
    {
      String lower = name;
      lower.toLowerCase();
      if (lower.endsWith(".mp3"))
      {
        String candidateBook;
        int candidateChapter = 0;
        found = detectLooseChapter(path, candidateBook, candidateChapter) &&
                candidateBook.equalsIgnoreCase(bookCode) &&
                candidateChapter == chapter;
        if (found)
          pathOut = path;
      }
    }
    entry.close();
    if (found)
      return true;
    entry = dir.openNextFile();
  }
  return false;
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
  normalized.replace("-", " ");
  while (normalized.indexOf("  ") >= 0)
    normalized.replace("  ", " ");
  normalized.trim();

  String bookCode;
  int chapterNumber = 0;
  for (int i = 0; i < normalized.length(); i++)
  {
    if (!isDigit(normalized[i]))
      continue;

    int numberEnd = i;
    int parsedChapter = parseDigitsAt(normalized, i, &numberEnd);
    String bookText = normalized.substring(0, i);
    bookText.replace("verses", " ");
    bookText.replace("verse", " ");
    bookText.replace("chapters", " ");
    bookText.replace("chapter", " ");
    bookText = normalizeBookText(bookText);

    String candidateBook = resolveBook(bookText);
    if (candidateBook.length() && hasChapter(candidateBook, parsedChapter))
    {
      bookCode = candidateBook;
      chapterNumber = parsedChapter;
      break;
    }

    i = numberEnd > i ? numberEnd - 1 : i;
  }

  if (!bookCode.length() || chapterNumber < 1)
  {
    _lastError = "Please tell me the Bible book and chapter.";
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
