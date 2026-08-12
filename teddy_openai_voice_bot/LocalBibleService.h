#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <SD.h>

struct LocalBibleChapter
{
  String bookCode;
  String bookName;
  int chapter = 0;
  String path;
};

class LocalBibleService
{
public:
  bool begin(bool sdAvailable);
  bool isAvailable() const;
  String translation() const;
  String language() const;
  uint16_t bookCount() const;
  uint16_t chapterCount() const;
  String lastError() const;
  String statusJson() const;

  bool resolveReference(const String &text, LocalBibleChapter &chapter);
  bool hasBook(const String &bookCode) const;
  bool hasChapter(const String &bookCode, int chapter) const;
  String resolveBook(const String &userBook) const;
  String getChapterPath(const String &bookCode, int chapter) const;

private:
  struct BookEntry
  {
    String code;
    String name;
    uint16_t chapters = 0;
  };

  static const uint8_t MAX_BOOKS = 66;
  BookEntry _books[MAX_BOOKS];
  uint8_t _bookCount = 0;
  uint16_t _chapterCount = 0;
  String _translation;
  String _language;
  String _lastError;
  bool _available = false;

  String normalizeBookText(String value) const;
  String canonicalBookCode(const String &normalized) const;
  int findBookIndex(const String &bookCode) const;
};

