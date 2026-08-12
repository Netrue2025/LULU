# LULU Offline Bible Audio

LULU Bible chapter audio is local SD content. Playback does not use Railway, HTTP, ElevenLabs, Bible audio APIs, WAV generation, or audio downloads.

## SD Structure

Prepare the SD card with:

```text
/lulu/bible/index.json
/lulu/bible/<translation>/GEN/001.mp3
/lulu/bible/<translation>/GEN/002.mp3
/lulu/bible/<translation>/JHN/003.mp3
```

`index.json` records the translation, language, audio format, books, and available chapters so the ESP32 does not scan the full SD card at boot.

## Import

After attaching or downloading the Faith Comes By Hearing ZIP, inspect and import it with:

```powershell
python tools/import_bible.py C:\path\to\bible.zip C:\path\to\sd\lulu\bible
```

Optional dry run:

```powershell
python tools/import_bible.py C:\path\to\bible.zip C:\path\to\sd\lulu\bible --dry-run
```

The importer detects book/chapter names from the actual ZIP filenames and paths, copies MP3 files into LULU's normalized layout, and writes `index.json`.

The inspected `ENGESHN1DA.zip` package contains New Testament chapter MP3 files under:

```text
English_eng_ESV_NT_Non-Drama/B01___01_Matthew_____ENGESHN1DA.mp3
```

The importer maps this Faith Comes By Hearing New Testament numbering to standard book IDs such as `MAT`, `MRK`, `LUK`, `JHN`, and `REV`.

## Validate

```powershell
python tools/import_bible.py --validate C:\path\to\sd\lulu\bible
```

Validation reports books, chapters, missing files, invalid MP3 headers, and total size.

## Firmware

Install an ESP32-compatible Helix MP3 decoder library that provides `MP3DecoderHelix.h`, then enable:

```cpp
#define ENABLE_BIBLE_MP3_HELIX 1
```

At boot, the firmware loads `/lulu/bible/index.json` and reports whether the offline Bible is available.

## Commands

Supported examples:

```text
Read Genesis chapter 1
Read John 3
Play Psalm 23
Read Matthew chapter 5
```

If a verse is requested but the package contains chapter-level MP3 files, LULU plays the chapter. It does not guess verse timestamps.

## Troubleshooting

If LULU says it cannot access the Bible, check SD initialization and `/lulu/bible/index.json`.

If LULU says the MP3 player is not ready, install/enable the Helix MP3 decoder library.

If a chapter is missing, rerun the importer and validator against the source ZIP.

## Licensing

The supplied Bible audio is third-party copyrighted/licensed content. Do not assume commercial redistribution is permitted. Use the local/offline architecture only according to the audio provider's applicable license and permissions.
