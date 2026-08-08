import sys
import types
import unittest


fake_whisper = types.ModuleType("faster_whisper")


class WhisperModel:
    def __init__(self, *args, **kwargs):
        pass

    def transcribe(self, *args, **kwargs):
        return [], None


fake_whisper.WhisperModel = WhisperModel
sys.modules.setdefault("faster_whisper", fake_whisper)

import server


class IntentTests(unittest.TestCase):
    def test_exact_bible_references(self):
        cases = {
            "Read John 3:16.": "john 3:16",
            "Read John chapter 3 verse 16.": "john 3:16",
            "Read John chapter 3 and verse 16.": "john 3:16",
            "Read John chapter 3, verse 16.": "john 3:16",
            "Look up John 3 16.": "john 3:16",
            "Turn to Psalm 23.": "psalm 23",
            "Open Psalm chapter 23 verse 1.": "psalm 23:1",
            "Read Matthew chapter 5 verses 1 to 12.": "matthew 5:1-12",
            "Read Matthew 5 verses 1 through 12.": "matthew 5:1-12",
            "Read First John chapter 4 verse 8.": "1 john 4:8",
            "Read 1st John 4:8.": "1 john 4:8",
            "Please read Romans chapter 8 verse 28.": "romans 8:28",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(server.extract_bible_reference(text), expected)

    def test_volume_phrases(self):
        self.assertTrue(server.is_volume_down_request("reduce volume"))
        self.assertTrue(server.is_volume_down_request("Lulu reduce volume"))
        self.assertTrue(server.is_volume_down_request("make it quieter"))
        self.assertTrue(server.is_volume_down_request("less volume"))
        self.assertTrue(server.is_volume_up_request("increase volume"))
        self.assertTrue(server.is_volume_up_request("Hey Lulu increase volume"))
        self.assertTrue(server.is_volume_up_request("make it louder"))
        self.assertTrue(server.is_volume_up_request("more volume"))

    def test_name_prefixed_commands(self):
        self.assertTrue(server.is_stop_request("Lulu stop"))
        self.assertTrue(server.is_music_request("Lulu play music from my SD card"))

    def test_question_answers_get_related_follow_up(self):
        reply = server.generate_reply("can you play radio")
        self.assertIn("internet radio", reply.speech_text.lower())
        self.assertIn('Just say, "Play radio."', reply.speech_text)
        self.assertIn('Just say, "Play radio."', reply.display_text)

    def test_time_question_does_not_match_bible_qa(self):
        reply = server.generate_reply("Lulu what is the time?")
        self.assertTrue(server.is_time_question("Lulu what is the time?"))
        self.assertIn("The time is", reply.speech_text)
        self.assertNotIn("Please ask me to check", reply.speech_text)
        self.assertNotIn("The Bible is", reply.speech_text)
        self.assertNotIn("Bible", reply.speech_text)
        self.assertIn("What are my reminders?", reply.speech_text)

    def test_bible_follow_up_uses_requested_wording(self):
        reply = server.add_interactive_follow_up(
            server.TeddyReply(
                speech_text="John 3:16, KJV. For God so loved the world.",
                display_text="Reading John 3:16 (KJV).",
            ),
            "Read John 3:16",
        )
        self.assertIn(
            "Would you like me to read you more bible verse? Just say where you want me to read.",
            reply.speech_text,
        )

    def test_action_replies_do_not_get_spoken_follow_up(self):
        reply = server.generate_reply("Lulu play music from my SD card")
        self.assertEqual(reply.action, "music")
        self.assertEqual(reply.speech_text, "")
        self.assertEqual(reply.display_text, "Playing music from SD card.")

    def test_local_fallback_is_not_identity_loop(self):
        reply = server.generate_local_fallback_reply("tell me something")
        self.assertNotIn("I am LULU", reply.speech_text)
        self.assertLessEqual(len(reply.speech_text), 120)

    def test_story_file_parser_and_intent(self):
        stories = server.parse_story_text(
            "# Format: title|story\n"
            "Moon Story|The moon smiled over the quiet room. The end.\n"
            "River Story|A small river learned to sing softly. The end.\n"
        )
        self.assertEqual(len(stories), 2)
        self.assertEqual(stories[0].title, "Moon Story")
        self.assertTrue(server.is_story_request("Lulu tell me a story"))
        self.assertTrue(server.is_story_request("read a bedtime story"))
        self.assertFalse(server.is_story_request("tell me a Bible story"))

    def test_story_reply_avoids_back_to_back_repeat(self):
        old_last_story_key = server.last_story_key
        try:
            server.last_story_key = None
            stories = [
                server.LocalStory(title="One", text="First story. The end."),
                server.LocalStory(title="Two", text="Second story. The end."),
            ]

            first = server.choose_random_story(stories)
            second = server.choose_random_story(stories)
            self.assertIsNotNone(first)
            self.assertIsNotNone(second)
            self.assertNotEqual(first.title, second.title)
        finally:
            server.last_story_key = old_last_story_key

    def test_story_request_routes_to_story_reply(self):
        old_loader = server.load_local_stories
        try:
            server.load_local_stories = lambda: [
                server.LocalStory(title="Moon", text="The moon shared a gentle bedtime story. The end.")
            ]
            reply = server.generate_reply("Lulu, tell me a story")
            self.assertIn("Story time. Moon.", reply.speech_text)
            self.assertIn('Just say, "Tell me a story."', reply.speech_text)
            self.assertEqual(reply.display_text, "Reading Moon.")
        finally:
            server.load_local_stories = old_loader

    def test_portuguese_tutor_intent_and_offline_translation(self):
        classified = server.portuguese_tutor.classify_intent("How do you say thank you in Portuguese?")
        self.assertEqual(classified["intent"], "translate")
        self.assertEqual(classified["query"], "thank you")

        translated = server.portuguese_tutor.translate("thank you")
        self.assertEqual(translated["source"], "offline")
        self.assertEqual(translated["translation"], "Obrigado")

        reply = server.generate_reply("How do you say thank you in Portuguese?")
        self.assertIn("Obrigado", reply.speech_text)
        self.assertEqual(reply.display_text, "Portuguese: Obrigado")

    def test_portuguese_mentions_route_to_related_tutor_actions(self):
        self.assertEqual(server.portuguese_tutor.classify_intent("portuges questions")["intent"], "quiz")
        lesson_intent = server.portuguese_tutor.classify_intent("teach me Portuguese greetings")
        self.assertEqual(lesson_intent["intent"], "lesson")
        self.assertEqual(lesson_intent["category"], "greetings")

        old_progress = server.portuguese_tutor.get_progress()
        try:
            reply = server.generate_reply("teach me Portuguese greetings")
            self.assertIn("Portuguese lesson", reply.speech_text)
            self.assertIn("Ola", reply.speech_text)
            self.assertIn("Bom dia", reply.speech_text)
            self.assertNotEqual(reply.speech_text.strip(), "Ola")
        finally:
            server.storage.save_json(server.portuguese_tutor.PROGRESS_PATH, old_progress)

    def test_portuguese_tutor_quiz_and_progress_shape(self):
        pack = server.portuguese_tutor.load_pack()
        self.assertGreater(len(pack["quizzes"]), 0)
        self.assertIn("current_level", pack["progress"])


if __name__ == "__main__":
    unittest.main()
