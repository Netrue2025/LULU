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
  static const uint8_t MAX_TRACKED_CHAPTERS = 150;
  BookEntry _books[MAX_BOOKS];
  bool _looseChapters[MAX_BOOKS][MAX_TRACKED_CHAPTERS + 1] = {};
  uint8_t _bookCount = 0;
  uint16_t _chapterCount = 0;
  String _translation;
  String _language;
  String _lastError;
  bool _available = false;
  bool _looseMode = false;

  String normalizeBookText(String value) const;
  String canonicalBookCode(const String &normalized) const;
  int findBookIndex(const String &bookCode) const;
  bool beginLooseScan();
  void scanLooseDirectory(File dir, const String &dirPath, uint8_t depth);
  bool addLooseChapter(const String &bookCode, int chapter);
  bool detectLooseChapter(const String &path, String &bookCode, int &chapter) const;
  String findLooseChapterPath(const String &bookCode, int chapter) const;
  bool findLooseChapterPathInDirectory(File dir, const String &dirPath, const String &bookCode, int chapter, uint8_t depth, String &pathOut) const;
};
