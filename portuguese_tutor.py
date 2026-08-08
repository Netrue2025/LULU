import hashlib
import json
import random
import re
import time
from datetime import datetime, timedelta
from typing import Any, Callable

import storage


LANGUAGE_ROOT = "languages/portuguese"
LESSONS_PATH = f"{LANGUAGE_ROOT}/lessons.json"
VOCABULARY_PATH = f"{LANGUAGE_ROOT}/vocabulary.json"
GRAMMAR_PATH = f"{LANGUAGE_ROOT}/grammar.json"
CONVERSATIONS_PATH = f"{LANGUAGE_ROOT}/conversations.json"
QUIZZES_PATH = f"{LANGUAGE_ROOT}/quizzes.json"
PRONUNCIATION_PATH = f"{LANGUAGE_ROOT}/pronunciation.json"
PROGRESS_PATH = f"{LANGUAGE_ROOT}/progress.json"
MISTAKES_PATH = f"{LANGUAGE_ROOT}/mistakes.json"
TRANSLATION_CACHE_PATH = f"{LANGUAGE_ROOT}/cache/translations.json"
CONVERSATION_HISTORY_PATH = f"{LANGUAGE_ROOT}/conversation_history.json"
QUIZ_HISTORY_PATH = f"{LANGUAGE_ROOT}/quiz_history.json"


TOPICS: dict[str, list[tuple[str, str, str]]] = {
    "greetings": [
        ("Hello", "Ola", "oh-LAH"), ("Good morning", "Bom dia", "bohm JEE-ah"),
        ("Good afternoon", "Boa tarde", "BOH-ah TAR-jee"), ("Good evening", "Boa noite", "BOH-ah NOY-chee"),
        ("Goodbye", "Adeus", "ah-DEH-oosh"), ("See you later", "Ate logo", "ah-TEH LOH-goo"),
        ("Please", "Por favor", "por fah-VOR"), ("Thank you", "Obrigado", "oh-bree-GAH-doo"),
        ("You are welcome", "De nada", "jee NAH-dah"), ("Excuse me", "Com licenca", "kohm lee-SEN-sah"),
    ],
    "introductions": [
        ("My name is Jeremiah", "Meu nome e Jeremiah", "meh-oo NOH-mee eh Jeremiah"),
        ("What is your name?", "Como voce se chama?", "KOH-moo voh-SEH see SHAH-mah"),
        ("Nice to meet you", "Prazer em conhecer voce", "prah-ZER eng koh-nyeh-SER voh-SEH"),
        ("I am from Nigeria", "Eu sou da Nigeria", "eh-oo soh-oo dah Nigeria"),
        ("I speak a little Portuguese", "Eu falo um pouco de portugues", "eh-oo FAH-loo oom POH-koo jee por-too-GEZ"),
        ("Do you speak English?", "Voce fala ingles?", "voh-SEH FAH-lah een-GLEZ"),
        ("I do not understand", "Eu nao entendo", "eh-oo now en-TEN-doo"),
        ("Can you repeat?", "Pode repetir?", "POH-jee heh-peh-CHEER"),
    ],
    "dates": [
        ("Today", "Hoje", "OH-zhee"), ("Tomorrow", "Amanha", "ah-mah-NYAH"), ("Yesterday", "Ontem", "ON-teng"),
        ("Week", "Semana", "seh-MAH-nah"), ("Month", "Mes", "mehs"), ("Year", "Ano", "AH-noo"),
        ("Monday", "Segunda-feira", "seh-GOON-dah FAY-rah"), ("Tuesday", "Terca-feira", "TER-sah FAY-rah"),
        ("Wednesday", "Quarta-feira", "KWAR-tah FAY-rah"), ("Thursday", "Quinta-feira", "KEEN-tah FAY-rah"),
        ("Friday", "Sexta-feira", "SESH-tah FAY-rah"), ("Weekend", "Fim de semana", "feeng jee seh-MAH-nah"),
    ],
    "family": [
        ("Father", "Pai", "pie"), ("Mother", "Mae", "my"), ("Brother", "Irmao", "eer-MOW"),
        ("Sister", "Irma", "eer-MAH"), ("Child", "Crianca", "kree-AHN-sah"), ("Friend", "Amigo", "ah-MEE-goo"),
        ("Husband", "Marido", "mah-REE-doo"), ("Wife", "Esposa", "es-POH-zah"),
        ("Family", "Familia", "fah-MEE-lyah"), ("Home", "Casa", "KAH-zah"),
    ],
    "food": [
        ("Water", "Agua", "AH-gwah"), ("Coffee", "Cafe", "kah-FEH"), ("Tea", "Cha", "shah"),
        ("Bread", "Pao", "pow"), ("Rice", "Arroz", "ah-HOZ"), ("Beans", "Feijao", "fay-ZHOW"),
        ("Chicken", "Frango", "FRAHN-goo"), ("Fish", "Peixe", "PAY-shee"), ("Meat", "Carne", "KAR-nee"),
        ("Fruit", "Fruta", "FROO-tah"), ("I am hungry", "Estou com fome", "es-TOH kohm FOH-mee"),
    ],
    "shopping": [
        ("How much does it cost?", "Quanto custa?", "KWAHN-too KOOS-tah"),
        ("It is expensive", "E caro", "eh KAH-roo"), ("It is cheap", "E barato", "eh bah-RAH-too"),
        ("I am just looking", "Estou so olhando", "es-TOH soh oh-LYAHN-doo"),
        ("I want to buy this", "Quero comprar isto", "KEH-roo kohm-PRAR EES-too"),
        ("Do you accept card?", "Aceita cartao?", "ah-SAY-tah kar-TOW"),
        ("Discount", "Desconto", "des-KON-too"), ("Cash", "Dinheiro", "jee-NYEH-roo"),
    ],
    "travel": [
        ("I am lost", "Estou perdido", "es-TOH per-JEE-doo"),
        ("Where is the bathroom?", "Onde fica o banheiro?", "OHN-jee FEE-kah oo bah-NYEH-roo"),
        ("Where is the taxi?", "Onde fica o taxi?", "OHN-jee FEE-kah oo TAK-see"),
        ("Airport", "Aeroporto", "ah-eh-roh-POR-too"), ("I need a ticket", "Preciso de uma passagem", "preh-SEE-zoo jee OO-mah pah-SAH-zheng"),
        ("Go straight", "Siga em frente", "SEE-gah eng FREN-chee"), ("Turn left", "Vire a esquerda", "VEE-ree ah es-KER-dah"),
        ("Turn right", "Vire a direita", "VEE-ree ah jee-RAY-tah"),
    ],
    "hotels": [
        ("I have a reservation", "Tenho uma reserva", "TEN-yoo OO-mah heh-ZER-vah"),
        ("One room, please", "Um quarto, por favor", "oom KWAR-too por fah-VOR"),
        ("What is the Wi-Fi password?", "Qual e a senha do Wi-Fi?", "kwal eh ah SEN-yah doo why-fy"),
        ("Is breakfast included?", "O cafe da manha esta incluido?", "oo kah-FEH dah mah-NYAH es-TAH een-kloo-EE-doo"),
        ("I need a towel", "Preciso de uma toalha", "preh-SEE-zoo jee OO-mah toh-AH-lyah"),
        ("Check in", "Entrada", "en-TRAH-dah"), ("Check out", "Saida", "sah-EE-dah"), ("Key", "Chave", "SHAH-vee"),
    ],
    "airports": [
        ("Passport", "Passaporte", "pah-sah-POR-chee"), ("Boarding pass", "Cartao de embarque", "kar-TOW jee em-BAR-kee"),
        ("Flight", "Voo", "voh"), ("Gate", "Portao", "por-TOW"), ("Luggage", "Bagagem", "bah-GAH-zheng"),
        ("My luggage is missing", "Minha bagagem sumiu", "MEEN-yah bah-GAH-zheng soo-MEE-oo"),
        ("The flight is delayed", "O voo esta atrasado", "oo voh es-TAH ah-trah-ZAH-doo"),
    ],
    "restaurants": [
        ("The menu, please", "O cardapio, por favor", "oo kar-dah-PEE-oh por fah-VOR"),
        ("I would like this", "Eu gostaria disto", "eh-oo go-stah-REE-ah JEES-too"),
        ("The bill, please", "A conta, por favor", "ah KON-tah por fah-VOR"),
        ("No meat", "Sem carne", "seng KAR-nee"), ("No sugar", "Sem acucar", "seng ah-SOO-kar"),
        ("Very delicious", "Muito gostoso", "MOY-too goh-STOH-zoo"), ("A table for two", "Uma mesa para dois", "OO-mah MEH-zah PAH-rah doys"),
    ],
    "emergencies": [
        ("Help", "Socorro", "soh-KOH-hoo"), ("I need help", "Preciso de ajuda", "preh-SEE-zoo jee ah-ZHOO-dah"),
        ("Call a doctor", "Chame um medico", "SHAH-mee oom MEH-jee-koo"), ("Call the police", "Chame a policia", "SHAH-mee ah poh-lee-SEE-ah"),
        ("It hurts here", "Doi aqui", "doy ah-KEE"), ("I am sick", "Estou doente", "es-TOH doh-EN-chee"),
        ("Hospital", "Hospital", "os-pee-TAW"), ("Pharmacy", "Farmacia", "far-MAH-see-ah"),
    ],
    "work": [
        ("Work", "Trabalho", "trah-BAH-lyoo"), ("Meeting", "Reuniao", "heh-oo-nee-OW"),
        ("Email", "E-mail", "EE-mail"), ("Computer", "Computador", "kohm-poo-tah-DOR"),
        ("I am busy", "Estou ocupado", "es-TOH oh-koo-PAH-doo"),
        ("I have a meeting", "Tenho uma reuniao", "TEN-yoo OO-mah heh-oo-nee-OW"),
        ("Can you help me?", "Pode me ajudar?", "POH-jee mee ah-zhoo-DAR"),
    ],
    "romance": [
        ("I like you", "Eu gosto de voce", "eh-oo GOH-stoo jee voh-SEH"), ("I love you", "Eu te amo", "eh-oo chee AH-moo"),
        ("You are beautiful", "Voce e bonita", "voh-SEH eh boh-NEE-tah"), ("You are kind", "Voce e gentil", "voh-SEH eh zhen-CHEEL"),
        ("I miss you", "Sinto sua falta", "SEEN-too SOO-ah FAHL-tah"),
    ],
    "daily conversation": [
        ("How are you?", "Como voce esta?", "KOH-moo voh-SEH es-TAH"), ("I am fine", "Estou bem", "es-TOH beng"),
        ("I am tired", "Estou cansado", "es-TOH kan-SAH-doo"), ("I am happy", "Estou feliz", "es-TOH feh-LEEZ"),
        ("What time is it?", "Que horas sao?", "kee OH-rahs sow"), ("I need to go", "Preciso ir", "preh-SEE-zoo eer"),
        ("See you tomorrow", "Ate amanha", "ah-TEH ah-mah-NYAH"),
    ],
    "idioms": [
        ("Piece of cake", "Moleza", "moh-LEH-zah"), ("Little by little", "Pouco a pouco", "POH-koo ah POH-koo"),
        ("No way", "De jeito nenhum", "jee ZHAY-too neh-NYOOM"), ("Stay calm", "Fique calmo", "FEE-kee KAL-moo"),
        ("Everything is fine", "Tudo bem", "TOO-doo beng"), ("Let's go", "Vamos la", "VAH-moos lah"),
    ],
}

NUMBERS = [
    ("Zero", "Zero", "ZEH-roo"), ("One", "Um", "oom"), ("Two", "Dois", "doys"), ("Three", "Tres", "trehs"),
    ("Four", "Quatro", "KWAH-troo"), ("Five", "Cinco", "SEEN-koo"), ("Six", "Seis", "says"), ("Seven", "Sete", "SEH-chee"),
    ("Eight", "Oito", "OY-too"), ("Nine", "Nove", "NOH-vee"), ("Ten", "Dez", "dehs"), ("Eleven", "Onze", "ON-zee"),
    ("Twelve", "Doze", "DOH-zee"), ("Thirteen", "Treze", "TREH-zee"), ("Fourteen", "Quatorze", "kah-TOR-zee"),
    ("Fifteen", "Quinze", "KEEN-zee"), ("Sixteen", "Dezesseis", "deh-zeh-SAYS"), ("Seventeen", "Dezessete", "deh-zeh-SEH-chee"),
    ("Eighteen", "Dezoito", "deh-ZOY-too"), ("Nineteen", "Dezenove", "deh-zeh-NOH-vee"), ("Twenty", "Vinte", "VEEN-chee"),
    ("Thirty", "Trinta", "TREEN-tah"), ("Forty", "Quarenta", "kwah-REN-tah"), ("Fifty", "Cinquenta", "seen-KWEN-tah"),
    ("Sixty", "Sessenta", "seh-SEN-tah"), ("Seventy", "Setenta", "seh-TEN-tah"), ("Eighty", "Oitenta", "oy-TEN-tah"),
    ("Ninety", "Noventa", "noh-VEN-tah"), ("One hundred", "Cem", "seng"),
]

VERBS = [
    ("to be permanent", "ser", "ser"), ("to be temporary", "estar", "es-TAR"), ("to have", "ter", "tehr"),
    ("to go", "ir", "eer"), ("to do", "fazer", "fah-ZER"), ("to speak", "falar", "fah-LAR"),
    ("to eat", "comer", "koh-MER"), ("to drink", "beber", "beh-BER"), ("to want", "querer", "keh-RER"),
    ("to need", "precisar", "preh-see-ZAR"), ("to like", "gostar", "gohs-TAR"), ("to know", "saber", "sah-BER"),
    ("to buy", "comprar", "kohm-PRAR"), ("to see", "ver", "vehr"), ("to come", "vir", "veer"),
    ("to learn", "aprender", "ah-pren-DER"), ("to work", "trabalhar", "trah-bah-LYAR"), ("to live", "morar", "moh-RAR"),
]

GRAMMAR_TOPICS = [
    {
        "id": "ser-vs-estar",
        "title": "Ser vs estar",
        "level": "beginner",
        "explanation": "Use ser for identity or permanent traits. Use estar for temporary states and location.",
        "examples": [
            {"portuguese": "Eu sou Jeremiah.", "english": "I am Jeremiah."},
            {"portuguese": "Estou feliz.", "english": "I am happy."},
        ],
        "tags": ["verbs", "identity", "state"],
    },
    {
        "id": "gender",
        "title": "Gender of nouns",
        "level": "beginner",
        "explanation": "Many Portuguese nouns are masculine or feminine. Articles often show the gender: o for masculine and a for feminine.",
        "examples": [
            {"portuguese": "o livro", "english": "the book"},
            {"portuguese": "a casa", "english": "the house"},
        ],
        "tags": ["nouns", "articles"],
    },
    {
        "id": "present-tense-ar",
        "title": "Present tense AR verbs",
        "level": "beginner",
        "explanation": "For regular AR verbs, use endings like eu falo, voce fala, nos falamos.",
        "examples": [
            {"portuguese": "Eu falo portugues.", "english": "I speak Portuguese."},
            {"portuguese": "Nos falamos ingles.", "english": "We speak English."},
        ],
        "tags": ["verbs", "present"],
    },
    {
        "id": "word-order",
        "title": "Basic word order",
        "level": "beginner",
        "explanation": "Simple Portuguese sentences often use subject, verb, object, like English.",
        "examples": [
            {"portuguese": "Eu quero agua.", "english": "I want water."},
            {"portuguese": "Voce fala portugues.", "english": "You speak Portuguese."},
        ],
        "tags": ["sentences"],
    },
    {
        "id": "past-intro",
        "title": "Simple past introduction",
        "level": "intermediate",
        "explanation": "The simple past talks about completed actions. Common forms include fui, tive, falei, comi.",
        "examples": [
            {"portuguese": "Eu fui ao mercado.", "english": "I went to the market."},
            {"portuguese": "Eu falei com ela.", "english": "I spoke with her."},
        ],
        "tags": ["verbs", "past"],
    },
]


INTENT_PATTERNS: list[tuple[str, str, float]] = [
    ("translate", r"\b(how do you say|translate|what'?s portuguese for|portuguese for)\b", 0.98),
    ("lesson", r"\b(teach me|today'?s lesson|give me.*lesson|continue my lesson|daily lesson)\b", 0.92),
    ("review", r"\b(review yesterday|review|revise|revision)\b", 0.9),
    ("quiz", r"\b(quiz me|test my portuguese|test me|give me a quiz|ask me.*question|portuguese question)\b", 0.95),
    ("grammar", r"\b(explain.*grammar|grammar|why do i say|when do i use)\b", 0.86),
    ("pronunciation", r"\b(pronounce|pronunciation|say this|how do i pronounce)\b", 0.9),
    ("example", r"\b(give another example|another example|example sentence)\b", 0.82),
    ("conversation", r"\b(start a conversation|conversation practice|speak portuguese|talk with me)\b", 0.92),
    ("check_answer", r"\b(correct my answer|check my answer|did i say|is this correct)\b", 0.9),
]

PORTUGUESE_WORD_RE = re.compile(r"\b(portuguese|portugeus|portuges|portugues)\b", re.IGNORECASE)


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def clean_translation_query(value: str) -> str:
    """Remove common trailing language words from translation prompts."""
    clean = normalize_text(value)
    clean = re.sub(r"\b(in|to|into)\s+(portuguese|portugeus|portuges|portugues)\b", "", clean).strip(" :?.!,")
    return clean


def stable_id(*parts: str) -> str:
    return hashlib.sha1(":".join(parts).lower().encode("utf-8")).hexdigest()[:12]


def make_entry(english: str, portuguese: str, pronunciation: str, category: str, difficulty: str = "beginner") -> dict[str, Any]:
    """Build one vocabulary record with the full tutor schema."""
    return {
        "id": stable_id(category, english, portuguese),
        "english": english,
        "portuguese": portuguese,
        "pronunciation": pronunciation,
        "example_sentence": f"Eu digo: {portuguese}.",
        "example_translation": f"I say: {english}.",
        "difficulty": difficulty,
        "category": category,
        "tags": [category, difficulty],
    }


def default_vocabulary() -> list[dict[str, Any]]:
    """Generate several hundred beginner-to-intermediate Portuguese records."""
    entries: list[dict[str, Any]] = []
    for category, phrases in TOPICS.items():
        for english, portuguese, pronunciation in phrases:
            entries.append(make_entry(english, portuguese, pronunciation, category))

    for english, portuguese, pronunciation in NUMBERS:
        entries.append(make_entry(english, portuguese, pronunciation, "numbers"))

    for english, portuguese, pronunciation in VERBS:
        entries.append(make_entry(english, portuguese, pronunciation, "common verbs"))
        entries.append(make_entry(f"I want {english.replace('to ', 'to ')}", f"Eu quero {portuguese}", f"eh-oo KEH-roo {pronunciation}", "common verbs", "intermediate"))
        entries.append(make_entry(f"I need {english.replace('to ', 'to ')}", f"Eu preciso {portuguese}", f"eh-oo preh-SEE-zoo {pronunciation}", "common verbs", "intermediate"))

    templates = [
        ("I need {item}", "Preciso de {pt}", "preh-SEE-zoo jee {pron}"),
        ("I want {item}", "Quero {pt}", "KEH-roo {pron}"),
        ("Where is {item}?", "Onde fica {pt}?", "OHN-jee FEE-kah {pron}"),
        ("I like {item}", "Eu gosto de {pt}", "eh-oo GOH-stoo jee {pron}"),
        ("Do you have {item}?", "Voce tem {pt}?", "voh-SEH teng {pron}"),
        ("Can I have {item}?", "Posso ter {pt}?", "POH-soo ter {pron}"),
        ("I am looking for {item}", "Estou procurando {pt}", "es-TOH proh-koo-RAHN-doo {pron}"),
        ("I found {item}", "Eu encontrei {pt}", "eh-oo en-kon-TRAY {pron}"),
        ("I forgot {item}", "Eu esqueci {pt}", "eh-oo es-keh-SEE {pron}"),
        ("I will use {item}", "Vou usar {pt}", "voh oo-ZAR {pron}"),
    ]
    useful_nouns = [
        ("water", "agua", "AH-gwah", "food"), ("coffee", "cafe", "kah-FEH", "food"),
        ("bread", "pao", "pow", "food"), ("ticket", "passagem", "pah-SAH-zheng", "travel"),
        ("hotel", "hotel", "oh-TEL", "hotels"), ("taxi", "taxi", "TAK-see", "travel"),
        ("doctor", "medico", "MEH-jee-koo", "emergencies"), ("pharmacy", "farmacia", "far-MAH-see-ah", "emergencies"),
        ("market", "mercado", "mer-KAH-doo", "shopping"), ("restaurant", "restaurante", "hes-tow-RAHN-chee", "restaurants"),
        ("airport", "aeroporto", "ah-eh-roh-POR-too", "airports"), ("work", "trabalho", "trah-BAH-lyoo", "work"),
    ]
    for english, portuguese, pronunciation, category in useful_nouns:
        for eng_template, pt_template, pron_template in templates:
            entries.append(
                make_entry(
                    eng_template.format(item=english),
                    pt_template.format(pt=portuguese),
                    pron_template.format(pron=pronunciation),
                    category,
                    "intermediate",
                )
            )

    seen: set[str] = set()
    unique_entries = []
    for entry in entries:
        if entry["id"] not in seen:
            seen.add(entry["id"])
            unique_entries.append(entry)
    return unique_entries


def default_lessons(vocabulary: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Create structured lessons by category from the vocabulary pack."""
    lessons = []
    for index, category in enumerate(TOPICS.keys(), start=1):
        words = [item for item in vocabulary if item["category"] == category][:14]
        lessons.append(
            {
                "id": f"pt-{index:03d}",
                "lesson": index,
                "title": category.title(),
                "level": "beginner" if index <= 9 else "intermediate",
                "category": category,
                "summary": f"Practice Portuguese for {category}.",
                "objectives": ["Learn useful phrases", "Practice pronunciation", "Answer one short prompt"],
                "words": words,
                "practice_prompt": f"Say one Portuguese phrase about {category}.",
                "completed": False,
            }
        )
    grammar_lesson_start = len(lessons) + 1
    for offset, topic in enumerate(GRAMMAR_TOPICS):
        lessons.append(
            {
                "id": f"pt-{grammar_lesson_start + offset:03d}",
                "lesson": grammar_lesson_start + offset,
                "title": topic["title"],
                "level": topic["level"],
                "category": "grammar",
                "summary": topic["explanation"],
                "objectives": ["Understand the rule", "Hear examples", "Use it in a sentence"],
                "words": [],
                "grammar_topic": topic["id"],
                "practice_prompt": f"Make one sentence using {topic['title']}.",
                "completed": False,
            }
        )
    return lessons


def default_progress() -> dict[str, Any]:
    return {
        "current_level": "beginner",
        "current_lesson": 1,
        "completed_lessons": [],
        "learned_vocabulary": [],
        "difficult_vocabulary": [],
        "quiz_scores": [],
        "daily_streak": 0,
        "last_practice_date": "",
        "grammar_weaknesses": [],
        "revision_schedule": [],
        "conversation_mode": {"active": False, "level": "beginner", "turns": 0},
        "updated": now_iso(),
    }


def default_conversations() -> list[dict[str, Any]]:
    return [
        {
            "id": "cafe-order",
            "title": "Ordering coffee",
            "level": "beginner",
            "turns": [
                {"speaker": "lulu", "portuguese": "Bom dia. O que voce quer?", "english": "Good morning. What do you want?"},
                {"speaker": "learner", "portuguese": "Quero um cafe, por favor.", "english": "I want a coffee, please."},
            ],
        },
        {
            "id": "hotel-checkin",
            "title": "Hotel check-in",
            "level": "intermediate",
            "turns": [
                {"speaker": "lulu", "portuguese": "Boa tarde. Voce tem uma reserva?", "english": "Good afternoon. Do you have a reservation?"},
                {"speaker": "learner", "portuguese": "Sim, tenho uma reserva.", "english": "Yes, I have a reservation."},
            ],
        },
    ]


def default_quizzes(vocabulary: list[dict[str, Any]]) -> list[dict[str, Any]]:
    quizzes = []
    for index, item in enumerate(vocabulary, start=1):
        quizzes.append(
            {
                "id": f"quiz-{index:03d}",
                "type": "translation",
                "level": item["difficulty"],
                "category": item["category"],
                "question": f"What is Portuguese for '{item['english']}'?",
                "answer": item["portuguese"],
                "pronunciation": item["pronunciation"],
                "choices": [],
            }
        )
    return quizzes


def merge_by_id(existing: list[dict[str, Any]], generated: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Preserve dashboard edits while adding new generated records."""
    records: dict[str, dict[str, Any]] = {}
    for item in existing if isinstance(existing, list) else []:
        if isinstance(item, dict):
            records[str(item.get("id") or stable_id(json.dumps(item, sort_keys=True)))] = item
    for item in generated:
        records.setdefault(str(item["id"]), item)
    return list(records.values())


def ensure_portuguese_tutor_database() -> dict[str, Any]:
    """Create the SD-backed Portuguese tutor database without overwriting edits."""
    for folder in (LANGUAGE_ROOT, f"{LANGUAGE_ROOT}/cache"):
        storage.make_directory(folder)

    vocabulary = merge_by_id(storage.load_json(VOCABULARY_PATH, []), default_vocabulary())
    lessons = merge_by_id(storage.load_json(LESSONS_PATH, []), default_lessons(vocabulary))
    quizzes = merge_by_id(storage.load_json(QUIZZES_PATH, []), default_quizzes(vocabulary))

    storage.save_json(VOCABULARY_PATH, vocabulary)
    storage.save_json(LESSONS_PATH, lessons)
    storage.create_if_missing(GRAMMAR_PATH, GRAMMAR_TOPICS)
    storage.create_if_missing(CONVERSATIONS_PATH, default_conversations())
    storage.save_json(QUIZZES_PATH, quizzes)
    storage.create_if_missing(PRONUNCIATION_PATH, {"tips": pronunciation_tips(), "sounds": []})
    storage.create_if_missing(PROGRESS_PATH, default_progress())
    storage.create_if_missing(MISTAKES_PATH, [])
    storage.create_if_missing(TRANSLATION_CACHE_PATH, {})
    storage.create_if_missing(CONVERSATION_HISTORY_PATH, [])
    storage.create_if_missing(QUIZ_HISTORY_PATH, [])

    return {
        "root": LANGUAGE_ROOT,
        "lessons": len(lessons),
        "vocabulary": len(vocabulary),
        "grammar": len(GRAMMAR_TOPICS),
        "quizzes": len(quizzes),
    }


def pronunciation_tips() -> list[dict[str, str]]:
    return [
        {"sound": "ao", "tip": "Often sounds like ow, as in pao."},
        {"sound": "lh", "tip": "Similar to lli in million, as in trabalho."},
        {"sound": "nh", "tip": "Similar to ny in canyon, as in amanha."},
        {"sound": "r", "tip": "At the start of words it can sound like h in many Brazilian accents."},
    ]


def load_pack() -> dict[str, Any]:
    ensure_portuguese_tutor_database()
    return {
        "status": storage.storage_status(),
        "lessons": storage.load_json(LESSONS_PATH, []),
        "vocabulary": storage.load_json(VOCABULARY_PATH, []),
        "grammar": storage.load_json(GRAMMAR_PATH, []),
        "conversations": storage.load_json(CONVERSATIONS_PATH, []),
        "quizzes": storage.load_json(QUIZZES_PATH, []),
        "pronunciation": storage.load_json(PRONUNCIATION_PATH, {}),
        "progress": storage.load_json(PROGRESS_PATH, default_progress()),
        "mistakes": storage.load_json(MISTAKES_PATH, []),
        "quiz_history": storage.load_json(QUIZ_HISTORY_PATH, []),
        "conversation_history": storage.load_json(CONVERSATION_HISTORY_PATH, []),
    }


def classify_intent(text: str) -> dict[str, Any]:
    """Classify Portuguese tutor requests and extract useful slots."""
    clean = normalize_text(text)
    if not clean:
        return {"intent": "none", "confidence": 0.0, "query": ""}

    best = {"intent": "none", "confidence": 0.0, "query": clean}
    for intent, pattern, confidence in INTENT_PATTERNS:
        match = re.search(pattern, clean, re.IGNORECASE)
        if match and confidence > best["confidence"]:
            query = clean[match.end() :].strip(" :?.!,")
            if intent == "translate":
                query = clean_translation_query(query)
            best = {"intent": intent, "confidence": confidence, "query": query}

    has_portuguese_word = bool(PORTUGUESE_WORD_RE.search(clean))
    if has_portuguese_word and best["intent"] == "none":
        if re.search(r"\b(question|questions|ask me|test|quiz)\b", clean):
            best = {"intent": "quiz", "confidence": 0.86, "query": clean}
        elif re.search(r"\b(conversation|talk|chat|speak)\b", clean):
            best = {"intent": "conversation", "confidence": 0.84, "query": clean}
        elif re.search(r"\b(pronounce|sound|say)\b", clean):
            best = {"intent": "pronunciation", "confidence": 0.82, "query": clean}
        elif re.search(r"\b(grammar|verb|verbs|noun|sentence|rule)\b", clean):
            best = {"intent": "grammar", "confidence": 0.82, "query": clean}
        else:
            best = {"intent": "lesson", "confidence": 0.78, "query": clean}

    category = detect_category(clean)
    if category:
        best["category"] = category

    if best["intent"] == "check_answer":
        answer = re.sub(r".*\b(?:answer is|i said|i say|correct my answer|check my answer)\b", "", clean).strip(" :?.!,")
        best["answer"] = answer or clean

    return best


def detect_category(text: str) -> str | None:
    """Find the closest lesson category mentioned in a learner request."""
    clean = normalize_text(text)
    aliases = {
        "numbers": ["number", "numbers", "count", "counting"],
        "dates": ["date", "dates", "day", "days", "calendar", "time"],
        "daily conversation": ["daily", "conversation", "small talk"],
        "common verbs": ["verb", "verbs", "action"],
        "restaurants": ["restaurant", "restaurants", "menu", "food order"],
        "emergencies": ["emergency", "emergencies", "doctor", "police", "help"],
        "airports": ["airport", "flight", "passport", "luggage"],
        "hotels": ["hotel", "room", "reservation"],
    }
    for category in TOPICS:
        if category in clean:
            return category
    for category, words in aliases.items():
        if any(re.search(rf"\b{re.escape(word)}\b", clean) for word in words):
            return category
    return None


def is_tutor_request(text: str) -> bool:
    classified = classify_intent(text)
    return classified["intent"] != "none" and classified["confidence"] >= 0.65


def find_vocabulary(query: str) -> dict[str, Any] | None:
    clean = clean_translation_query(query)
    if not clean:
        return None
    vocabulary = storage.load_json(VOCABULARY_PATH, [])
    for item in vocabulary if isinstance(vocabulary, list) else []:
        if not isinstance(item, dict):
            continue
        english = normalize_text(str(item.get("english", "")))
        portuguese = normalize_text(str(item.get("portuguese", "")))
        if clean in {english, portuguese}:
            return item
    for item in vocabulary if isinstance(vocabulary, list) else []:
        if isinstance(item, dict) and clean in normalize_text(str(item.get("english", ""))):
            return item
    return None


def translation_from_entry(query: str, item: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": "offline",
        "query": query,
        "translation": item.get("portuguese", ""),
        "pronunciation": item.get("pronunciation", ""),
        "grammar_explanation": "This is a saved Portuguese phrase from LULU's offline tutor pack.",
        "literal_meaning": item.get("english", query),
        "example_sentences": [
            {"portuguese": item.get("example_sentence", ""), "english": item.get("example_translation", "")}
        ],
        "suggested_response": item.get("portuguese", ""),
        "follow_up_practice_question": f"Can you say '{item.get('english', query)}' in Portuguese?",
        "category": item.get("category", ""),
        "difficulty": item.get("difficulty", "beginner"),
    }


def translate(query: str, ai_callback: Callable[[str, str], dict[str, Any] | None] | None = None) -> dict[str, Any]:
    """Translate from local SD cache first, then optionally ask AI and cache it."""
    ensure_portuguese_tutor_database()
    clean = clean_translation_query(query)
    cache = storage.load_json(TRANSLATION_CACHE_PATH, {})
    if isinstance(cache, dict) and clean in cache:
        cached = dict(cache[clean])
        cached["source"] = cached.get("source", "cache")
        return cached

    item = find_vocabulary(clean)
    if item:
        result = translation_from_entry(query, item)
        cache[clean] = result
        storage.save_json(TRANSLATION_CACHE_PATH, cache)
        return result

    if ai_callback:
        prompt = (
            "Return JSON for a Portuguese tutor translation with keys: translation, pronunciation, "
            "grammar_explanation, literal_meaning, example_sentences, suggested_response, "
            f"follow_up_practice_question. Translate this into Portuguese: {query}"
        )
        ai_result = ai_callback("translation", prompt)
        if ai_result:
            ai_result = {**ai_result, "source": "openai", "query": query}
            cache[clean] = ai_result
            storage.save_json(TRANSLATION_CACHE_PATH, cache)
            return ai_result

    fallback = {
        "source": "local-fallback",
        "query": query,
        "translation": "",
        "pronunciation": "",
        "grammar_explanation": "I do not have this phrase saved yet. Add it from the dashboard or enable OpenAI for richer tutoring.",
        "literal_meaning": query,
        "example_sentences": [],
        "suggested_response": "",
        "follow_up_practice_question": "Try asking for a saved phrase like 'How do you say thank you?'",
    }
    cache[clean] = fallback
    storage.save_json(TRANSLATION_CACHE_PATH, cache)
    return fallback


def get_progress() -> dict[str, Any]:
    ensure_portuguese_tutor_database()
    progress = storage.load_json(PROGRESS_PATH, default_progress())
    return progress if isinstance(progress, dict) else default_progress()


def save_progress(progress: dict[str, Any]) -> dict[str, Any]:
    progress["updated"] = now_iso()
    storage.save_json(PROGRESS_PATH, progress)
    return progress


def touch_progress(activity: str, score: int | None = None) -> dict[str, Any]:
    progress = get_progress()
    today = datetime.now().date().isoformat()
    if progress.get("last_practice_date") != today:
        yesterday = (datetime.now().date() - timedelta(days=1)).isoformat()
        progress["daily_streak"] = int(progress.get("daily_streak", 0)) + 1 if progress.get("last_practice_date") == yesterday else 1
        progress["last_practice_date"] = today
    if score is not None:
        progress.setdefault("quiz_scores", []).append({"score": score, "activity": activity, "time": now_iso()})
    return save_progress(progress)


def current_lesson(category: str | None = None) -> dict[str, Any]:
    ensure_portuguese_tutor_database()
    progress = get_progress()
    lessons = storage.load_json(LESSONS_PATH, [])
    if category:
        for lesson in lessons if isinstance(lessons, list) else []:
            if normalize_text(str(lesson.get("category", ""))) == normalize_text(category):
                return lesson
        return {"title": str(category).title(), "category": category, "words": []}
    lesson_number = int(progress.get("current_lesson", 1))
    for lesson in lessons if isinstance(lessons, list) else []:
        if int(lesson.get("lesson", 0)) == lesson_number:
            return lesson
    return lessons[0] if lessons else {}


def lesson_words_for_request(category: str | None = None, limit: int = 4) -> list[dict[str, Any]]:
    """Return a varied set of useful words for a lesson request."""
    lesson = current_lesson(category)
    words = lesson.get("words", []) if isinstance(lesson, dict) else []
    if words:
        return words[:limit]

    vocabulary = storage.load_json(VOCABULARY_PATH, [])
    if category:
        matches = [
            item for item in vocabulary
            if isinstance(item, dict) and normalize_text(str(item.get("category", ""))) == normalize_text(category)
        ]
        if matches:
            return matches[:limit]
    return vocabulary[:limit] if isinstance(vocabulary, list) else []


def format_lesson_speech(lesson: dict[str, Any], words: list[dict[str, Any]]) -> str:
    """Build a voice response with multiple Portuguese Q&A items."""
    title = lesson.get("title", "Portuguese practice") if isinstance(lesson, dict) else "Portuguese practice"
    parts = [f"Portuguese lesson: {title}."]
    for item in words[:4]:
        english = item.get("english", "")
        portuguese = item.get("portuguese", "")
        pronunciation = item.get("pronunciation", "")
        if english and portuguese:
            parts.append(f"{english} is {portuguese}. Say it like {pronunciation}.")
    parts.append("Ask me for Portuguese questions when you want a quiz.")
    return " ".join(parts)


def revision_items(limit: int = 12) -> dict[str, Any]:
    progress = get_progress()
    vocabulary = storage.load_json(VOCABULARY_PATH, [])
    difficult = set(str(item) for item in progress.get("difficult_vocabulary", []))
    scheduled = [item for item in vocabulary if isinstance(item, dict) and item.get("id") in difficult]
    if not scheduled:
        scheduled = vocabulary[:limit] if isinstance(vocabulary, list) else []
    return {"items": scheduled[:limit], "progress": progress}


def quiz(category: str | None = None) -> dict[str, Any]:
    ensure_portuguese_tutor_database()
    quizzes = storage.load_json(QUIZZES_PATH, [])
    if category:
        filtered = [item for item in quizzes if isinstance(item, dict) and item.get("category") == category]
        quizzes = filtered or quizzes
    question = random.choice(quizzes) if quizzes else {}
    history = storage.load_json(QUIZ_HISTORY_PATH, [])
    history.append({"time": now_iso(), "question": question, "answered": False})
    storage.save_json(QUIZ_HISTORY_PATH, history[-200:])
    return {"question": question, "progress": touch_progress("quiz")}


def check_answer(question_id: str, answer: str) -> dict[str, Any]:
    quizzes = storage.load_json(QUIZZES_PATH, [])
    question = next((item for item in quizzes if isinstance(item, dict) and item.get("id") == question_id), None)
    expected = str((question or {}).get("answer", ""))
    correct = normalize_text(answer) == normalize_text(expected)
    score = 100 if correct else 0
    if not correct:
        mistakes = storage.load_json(MISTAKES_PATH, [])
        mistakes.append({"time": now_iso(), "question_id": question_id, "answer": answer, "expected": expected})
        storage.save_json(MISTAKES_PATH, mistakes[-300:])
    progress = touch_progress("check-answer", score=score)
    return {
        "correct": correct,
        "score": score,
        "expected": expected,
        "gentle_correction": "Correct! Muito bem." if correct else f"Almost. A better answer is: {expected}. Try saying it slowly.",
        "progress": progress,
    }


def conversation(message: str = "", ai_callback: Callable[[str, str], dict[str, Any] | None] | None = None) -> dict[str, Any]:
    progress = get_progress()
    level = progress.get("current_level", "beginner")
    prompt = message.strip() or "start"
    if ai_callback and message:
        ai = ai_callback(
            "conversation",
            "Return JSON keys portuguese_reply, english_hint, correction, next_question for a short Portuguese practice chat. "
            f"Learner level: {level}. Learner said: {message}",
        )
    else:
        ai = None
    result = ai or {
        "portuguese_reply": "Ola! Vamos praticar portugues. Como voce esta?",
        "english_hint": "Hello! Let's practice Portuguese. How are you?",
        "correction": "",
        "next_question": "Responda em portugues: Estou bem.",
    }
    history = storage.load_json(CONVERSATION_HISTORY_PATH, [])
    history.append({"time": now_iso(), "learner": prompt, "lulu": result, "level": level})
    storage.save_json(CONVERSATION_HISTORY_PATH, history[-200:])
    progress.setdefault("conversation_mode", {})["active"] = True
    progress["conversation_mode"]["turns"] = int(progress["conversation_mode"].get("turns", 0)) + 1
    save_progress(progress)
    return {**result, "progress": progress}


def pronunciation(text: str) -> dict[str, Any]:
    found = find_vocabulary(text)
    if found:
        return {"text": text, "pronunciation": found.get("pronunciation", ""), "tips": pronunciation_tips(), "source": "offline"}
    translated = translate(text)
    return {"text": text, "pronunciation": translated.get("pronunciation", ""), "tips": pronunciation_tips(), "source": translated.get("source", "cache")}


def grammar(topic: str = "") -> dict[str, Any]:
    ensure_portuguese_tutor_database()
    topics = storage.load_json(GRAMMAR_PATH, [])
    clean = normalize_text(topic)
    for item in topics if isinstance(topics, list) else []:
        if clean and (clean in normalize_text(item.get("title", "")) or clean in normalize_text(item.get("id", ""))):
            return item
    return topics[0] if topics else {}


def tutor_reply(text: str, ai_callback: Callable[[str, str], dict[str, Any] | None] | None = None) -> dict[str, Any]:
    """Return a voice-friendly response for the main LULU conversation engine."""
    classified = classify_intent(text)
    intent = classified["intent"]
    query = classified.get("query") or text
    category = classified.get("category")
    if intent == "translate":
        result = translate(query, ai_callback)
        speech = (
            f"In Portuguese, say {result.get('translation') or 'I do not know that yet'}. "
            f"Pronunciation: {result.get('pronunciation') or 'not saved yet'}. "
            f"{result.get('follow_up_practice_question', '')}"
        )
        return {"speech": speech.strip(), "display": f"Portuguese: {result.get('translation', '')}", "data": result}
    if intent == "quiz":
        result = quiz(str(category) if category else None)
        question = result.get("question", {})
        return {"speech": question.get("question", "What does Ola mean?"), "display": "Portuguese quiz", "data": result}
    if intent == "conversation":
        result = conversation(query, ai_callback)
        return {"speech": f"{result.get('portuguese_reply')} {result.get('english_hint')}", "display": "Portuguese conversation", "data": result}
    if intent == "check_answer":
        result = check_answer(str(classified.get("question_id", "")), str(classified.get("answer", query)))
        return {"speech": result["gentle_correction"], "display": "Portuguese correction", "data": result}
    if intent == "pronunciation":
        result = pronunciation(query)
        return {"speech": f"Pronounce it like this: {result.get('pronunciation')}.", "display": "Portuguese pronunciation", "data": result}
    if intent == "grammar":
        result = grammar(query)
        return {"speech": result.get("explanation", "I have a grammar lesson ready."), "display": result.get("title", "Portuguese grammar"), "data": result}
    if intent == "review":
        result = revision_items()
        first = (result.get("items") or [{}])[0]
        return {"speech": f"Review time. Remember: {first.get('english')} is {first.get('portuguese')}.", "display": "Portuguese review", "data": result}

    lesson = current_lesson(str(category) if category else None)
    words = lesson_words_for_request(str(category) if category else None)
    speech = format_lesson_speech(lesson, words)
    touch_progress("lesson")
    return {"speech": speech, "display": f"Lesson: {lesson.get('title', 'Portuguese')}", "data": lesson}


def import_pack(pack: dict[str, Any]) -> dict[str, Any]:
    """Import dashboard-edited tutor files without touching other LULU data."""
    allowed = {
        "lessons": LESSONS_PATH,
        "vocabulary": VOCABULARY_PATH,
        "grammar": GRAMMAR_PATH,
        "conversations": CONVERSATIONS_PATH,
        "quizzes": QUIZZES_PATH,
        "pronunciation": PRONUNCIATION_PATH,
        "progress": PROGRESS_PATH,
        "mistakes": MISTAKES_PATH,
    }
    for key, path in allowed.items():
        if key in pack:
            storage.save_json(path, pack[key])
    return load_pack()
