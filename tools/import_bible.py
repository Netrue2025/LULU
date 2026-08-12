#!/usr/bin/env python3
"""Inspect, import, and validate offline Bible MP3 packages for LULU SD cards."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


BOOKS: list[tuple[str, str, int, tuple[str, ...]]] = [
    ("GEN", "Genesis", 50, ("genesis", "gen")),
    ("EXO", "Exodus", 40, ("exodus", "exo", "exod")),
    ("LEV", "Leviticus", 27, ("leviticus", "lev")),
    ("NUM", "Numbers", 36, ("numbers", "num")),
    ("DEU", "Deuteronomy", 34, ("deuteronomy", "deut", "deu")),
    ("JOS", "Joshua", 24, ("joshua", "josh", "jos")),
    ("JDG", "Judges", 21, ("judges", "judg", "jdg")),
    ("RUT", "Ruth", 4, ("ruth", "rut")),
    ("1SA", "1 Samuel", 31, ("1 samuel", "1samuel", "1 sam", "first samuel")),
    ("2SA", "2 Samuel", 24, ("2 samuel", "2samuel", "2 sam", "second samuel")),
    ("1KI", "1 Kings", 22, ("1 kings", "1kings", "1 kin", "first kings")),
    ("2KI", "2 Kings", 25, ("2 kings", "2kings", "2 kin", "second kings")),
    ("1CH", "1 Chronicles", 29, ("1 chronicles", "1chronicles", "1 chron", "first chronicles")),
    ("2CH", "2 Chronicles", 36, ("2 chronicles", "2chronicles", "2 chron", "second chronicles")),
    ("EZR", "Ezra", 10, ("ezra", "ezr")),
    ("NEH", "Nehemiah", 13, ("nehemiah", "neh")),
    ("EST", "Esther", 10, ("esther", "est")),
    ("JOB", "Job", 42, ("job",)),
    ("PSA", "Psalms", 150, ("psalm", "psalms", "psa", "ps")),
    ("PRO", "Proverbs", 31, ("proverbs", "proverb", "prov", "pro")),
    ("ECC", "Ecclesiastes", 12, ("ecclesiastes", "eccl", "ecc")),
    ("SNG", "Song of Solomon", 8, ("song of solomon", "song of songs", "songs", "sng")),
    ("ISA", "Isaiah", 66, ("isaiah", "isa")),
    ("JER", "Jeremiah", 52, ("jeremiah", "jer")),
    ("LAM", "Lamentations", 5, ("lamentations", "lam")),
    ("EZK", "Ezekiel", 48, ("ezekiel", "ezek", "ezk")),
    ("DAN", "Daniel", 12, ("daniel", "dan")),
    ("HOS", "Hosea", 14, ("hosea", "hos")),
    ("JOL", "Joel", 3, ("joel", "jol")),
    ("AMO", "Amos", 9, ("amos", "amo")),
    ("OBA", "Obadiah", 1, ("obadiah", "oba")),
    ("JON", "Jonah", 4, ("jonah", "jon")),
    ("MIC", "Micah", 7, ("micah", "mic")),
    ("NAM", "Nahum", 3, ("nahum", "nah", "nam")),
    ("HAB", "Habakkuk", 3, ("habakkuk", "hab")),
    ("ZEP", "Zephaniah", 3, ("zephaniah", "zep")),
    ("HAG", "Haggai", 2, ("haggai", "hag")),
    ("ZEC", "Zechariah", 14, ("zechariah", "zec")),
    ("MAL", "Malachi", 4, ("malachi", "mal")),
    ("MAT", "Matthew", 28, ("matthew", "matt", "mat")),
    ("MRK", "Mark", 16, ("mark", "mrk")),
    ("LUK", "Luke", 24, ("luke", "luk")),
    ("JHN", "John", 21, ("john", "jhn")),
    ("ACT", "Acts", 28, ("acts", "act")),
    ("ROM", "Romans", 16, ("romans", "rom")),
    ("1CO", "1 Corinthians", 16, ("1 corinthians", "1corinthians", "1 cor", "first corinthians")),
    ("2CO", "2 Corinthians", 13, ("2 corinthians", "2corinthians", "2 cor", "second corinthians")),
    ("GAL", "Galatians", 6, ("galatians", "gal")),
    ("EPH", "Ephesians", 6, ("ephesians", "eph")),
    ("PHP", "Philippians", 4, ("philippians", "phil", "php")),
    ("COL", "Colossians", 4, ("colossians", "col")),
    ("1TH", "1 Thessalonians", 5, ("1 thessalonians", "1thessalonians", "1 thess", "first thessalonians")),
    ("2TH", "2 Thessalonians", 3, ("2 thessalonians", "2thessalonians", "2 thess", "second thessalonians")),
    ("1TI", "1 Timothy", 6, ("1 timothy", "1timothy", "1 tim", "first timothy")),
    ("2TI", "2 Timothy", 4, ("2 timothy", "2timothy", "2 tim", "second timothy")),
    ("TIT", "Titus", 3, ("titus", "tit")),
    ("PHM", "Philemon", 1, ("philemon", "phm")),
    ("HEB", "Hebrews", 13, ("hebrews", "heb")),
    ("JAS", "James", 5, ("james", "jas")),
    ("1PE", "1 Peter", 5, ("1 peter", "1peter", "1 pet", "first peter")),
    ("2PE", "2 Peter", 3, ("2 peter", "2peter", "2 pet", "second peter")),
    ("1JN", "1 John", 5, ("1 john", "1john", "first john")),
    ("2JN", "2 John", 1, ("2 john", "2john", "second john")),
    ("3JN", "3 John", 1, ("3 john", "3john", "third john")),
    ("JUD", "Jude", 1, ("jude", "jud")),
    ("REV", "Revelation", 22, ("revelation", "revelations", "rev")),
]

BOOK_BY_CODE = {code: (name, expected) for code, name, expected, _ in BOOKS}
ALIAS_TO_CODE = {}
for code, _, _, aliases in BOOKS:
    ALIAS_TO_CODE[code.lower()] = code
    for alias in aliases:
        ALIAS_TO_CODE[re.sub(r"[^a-z0-9]", "", alias.lower())] = code

FCBH_NT_BOOKS = {
    1: "MAT",
    2: "MRK",
    3: "LUK",
    4: "JHN",
    5: "ACT",
    6: "ROM",
    7: "1CO",
    8: "2CO",
    9: "GAL",
    10: "EPH",
    11: "PHP",
    12: "COL",
    13: "1TH",
    14: "2TH",
    15: "1TI",
    16: "2TI",
    17: "TIT",
    18: "PHM",
    19: "HEB",
    20: "JAS",
    21: "1PE",
    22: "2PE",
    23: "1JN",
    24: "2JN",
    25: "3JN",
    26: "JUD",
    27: "REV",
}


@dataclass(frozen=True)
class ChapterFile:
    source: str
    book: str
    chapter: int
    size: int


def clean_translation(value: str) -> str:
    value = re.sub(r"\.zip$", "", Path(value).name, flags=re.I)
    value = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")
    return value[:40] or "BIBLE"


def detect_book(text: str) -> str | None:
    path_text = text.lower()
    fcbh_match = re.search(r"(?:^|/)B(\d{1,3})_{2,}\d{1,3}_", text, re.IGNORECASE)
    if fcbh_match and ("_nt_" in path_text or "newtestament" in path_text or "nt_" in path_text):
        code = FCBH_NT_BOOKS.get(int(fcbh_match.group(1)))
        if code:
            return code

    compact = re.sub(r"[^a-z0-9]", "", text.lower())
    for alias, code in sorted(ALIAS_TO_CODE.items(), key=lambda item: len(item[0]), reverse=True):
        if alias and alias in compact:
            return code
    return None


def detect_chapter(text: str, book: str | None) -> int | None:
    stem = Path(text).stem
    fcbh_match = re.match(r"^B\d{1,3}_{2,}(\d{1,3})_", stem, re.IGNORECASE)
    if fcbh_match:
        chapter = int(fcbh_match.group(1))
        expected = BOOK_BY_CODE.get(book or "", ("", 150))[1]
        if 1 <= chapter <= expected:
            return chapter

    tokens = re.findall(r"\d{1,3}", stem)
    if not tokens:
        return None
    expected = BOOK_BY_CODE.get(book or "", ("", 150))[1]
    plausible = [int(token) for token in tokens if 1 <= int(token) <= expected]
    if plausible:
        return plausible[-1]
    return None


def inspect_zip(zip_path: Path) -> tuple[list[zipfile.ZipInfo], list[ChapterFile], list[str]]:
    unmapped: list[str] = []
    chapters: list[ChapterFile] = []
    with zipfile.ZipFile(zip_path) as archive:
        infos = [info for info in archive.infolist() if not info.is_dir()]
        for info in infos:
            if not info.filename.lower().endswith(".mp3"):
                continue
            book = detect_book(info.filename)
            chapter = detect_chapter(info.filename, book)
            if not book or not chapter:
                unmapped.append(info.filename)
                continue
            chapters.append(ChapterFile(info.filename, book, chapter, info.file_size))
    return infos, chapters, unmapped


def import_zip(zip_path: Path, output_root: Path, translation: str | None, language: str, dry_run: bool = False) -> dict:
    infos, chapters, unmapped = inspect_zip(zip_path)
    translation_id = clean_translation(translation or zip_path.name)
    target_root = output_root / translation_id
    duplicates: list[str] = []
    seen: set[tuple[str, int]] = set()
    by_book: dict[str, list[ChapterFile]] = defaultdict(list)

    for chapter in chapters:
        key = (chapter.book, chapter.chapter)
        if key in seen:
            duplicates.append(f"{chapter.book} {chapter.chapter:03d}: {chapter.source}")
            continue
        seen.add(key)
        by_book[chapter.book].append(chapter)

    if not dry_run:
        target_root.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as archive:
            for book, items in by_book.items():
                book_dir = target_root / book
                book_dir.mkdir(parents=True, exist_ok=True)
                for item in items:
                    target = book_dir / f"{item.chapter:03d}.mp3"
                    with archive.open(item.source) as src, target.open("wb") as dst:
                        shutil.copyfileobj(src, dst)

    books_json = {}
    for book, items in sorted(by_book.items(), key=lambda item: list(BOOK_BY_CODE).index(item[0]) if item[0] in BOOK_BY_CODE else 999):
        chapters_found = sorted(item.chapter for item in items)
        name, _ = BOOK_BY_CODE.get(book, (book, max(chapters_found)))
        books_json[book] = {"name": name, "chapters": max(chapters_found), "availableChapters": chapters_found}

    index = {
        "version": 1,
        "translation": translation_id,
        "language": language,
        "audioFormat": "mp3",
        "sourceZip": zip_path.name,
        "books": books_json,
    }
    if not dry_run:
        output_root.mkdir(parents=True, exist_ok=True)
        (output_root / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")

    return {
        "zip": str(zip_path),
        "translation": translation_id,
        "language": language,
        "files": len(infos),
        "mp3_files": len([info for info in infos if info.filename.lower().endswith(".mp3")]),
        "mapped_chapters": sum(len(items) for items in by_book.values()),
        "books": len(by_book),
        "total_size": sum(item.size for items in by_book.values() for item in items),
        "duplicates": duplicates,
        "unmapped": unmapped,
        "index": index,
    }


def validate_bible(root: Path) -> dict:
    index_path = root / "index.json"
    if not index_path.exists():
        raise SystemExit(f"Missing index: {index_path}")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    translation = index["translation"]
    translation_root = root / translation
    missing: list[str] = []
    invalid: list[str] = []
    total_size = 0
    chapters = 0

    for book, meta in index.get("books", {}).items():
        available = meta.get("availableChapters") or list(range(1, int(meta.get("chapters", 0)) + 1))
        for chapter in available:
            path = translation_root / book / f"{int(chapter):03d}.mp3"
            if not path.exists():
                missing.append(str(path))
                continue
            size = path.stat().st_size
            total_size += size
            chapters += 1
            with path.open("rb") as handle:
                header = handle.read(3)
            if header != b"ID3" and not (len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0):
                invalid.append(str(path))

    return {
        "translation": translation,
        "language": index.get("language", ""),
        "books": len(index.get("books", {})),
        "chapters": chapters,
        "missing": missing,
        "invalid_mp3": invalid,
        "total_size": total_size,
    }


def print_summary(summary: dict) -> None:
    print("Bible Import")
    print("------------")
    print(f"ZIP inspected: {summary['zip']}")
    print(f"Translation: {summary['translation']}")
    print(f"Language: {summary['language']}")
    print(f"MP3 files: {summary['mp3_files']}")
    print(f"Mapped chapters: {summary['mapped_chapters']}")
    print(f"Books: {summary['books']}")
    print(f"Total mapped size: {summary['total_size'] / 1024 / 1024:.1f} MB")
    if summary["duplicates"]:
        print(f"Duplicates: {len(summary['duplicates'])}")
    if summary["unmapped"]:
        print(f"Unmapped MP3 files: {len(summary['unmapped'])}")
        for item in summary["unmapped"][:20]:
            print(f"  - {item}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip", nargs="?", type=Path, help="Bible MP3 ZIP to inspect/import")
    parser.add_argument("output", nargs="?", type=Path, help="Target /lulu/bible directory")
    parser.add_argument("--translation", help="Override translation folder id")
    parser.add_argument("--language", default="en", help="Language code for index.json")
    parser.add_argument("--dry-run", action="store_true", help="Inspect and map without writing files")
    parser.add_argument("--validate", type=Path, help="Validate an existing /lulu/bible directory")
    args = parser.parse_args(argv)

    if args.validate:
      result = validate_bible(args.validate)
      print("Bible Validation")
      print("----------------")
      print(f"Translation: {result['translation']}")
      print(f"Books: {result['books']}")
      print(f"Chapters: {result['chapters']}")
      print(f"Missing: {len(result['missing'])}")
      print(f"Invalid MP3: {len(result['invalid_mp3'])}")
      print(f"Total size: {result['total_size'] / 1024 / 1024:.1f} MB")
      return 0 if not result["missing"] and not result["invalid_mp3"] else 2

    if not args.zip or not args.output:
        parser.error("zip and output are required unless --validate is used")
    if not args.zip.exists():
        raise SystemExit(f"ZIP not found: {args.zip}")
    summary = import_zip(args.zip, args.output, args.translation, args.language, args.dry_run)
    print_summary(summary)
    if not args.dry_run:
        result = validate_bible(args.output)
        print()
        print("Validation")
        print("----------")
        print(f"Missing: {len(result['missing'])}")
        print(f"Invalid MP3: {len(result['invalid_mp3'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
