import tempfile
import unittest
import zipfile
from pathlib import Path

from tools.import_bible import import_zip, validate_bible


class BibleImportTests(unittest.TestCase):
    def test_imports_chapter_mp3s_to_lulu_structure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            zip_path = root / "ENGTEST.zip"
            with zipfile.ZipFile(zip_path, "w") as archive:
                archive.writestr("audio/01_GEN_001.mp3", b"ID3" + b"\0" * 32)
                archive.writestr("audio/43_JHN_003.mp3", b"\xff\xfb" + b"\0" * 32)

            output = root / "lulu" / "bible"
            summary = import_zip(zip_path, output, "ENGTEST", "en")
            self.assertEqual(summary["mapped_chapters"], 2)
            self.assertTrue((output / "ENGTEST" / "GEN" / "001.mp3").exists())
            self.assertTrue((output / "ENGTEST" / "JHN" / "003.mp3").exists())

            result = validate_bible(output)
            self.assertEqual(result["books"], 2)
            self.assertEqual(result["chapters"], 2)
            self.assertEqual(result["missing"], [])
            self.assertEqual(result["invalid_mp3"], [])


if __name__ == "__main__":
    unittest.main()
