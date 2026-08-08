"use client";

import { BookOpen, CheckCircle2, Download, Languages, MessageCircle, RefreshCw, Save, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SectionCard, StatCard, StatusBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";

type TutorEntry = {
  id: string;
  english: string;
  portuguese: string;
  pronunciation: string;
  category: string;
  difficulty: string;
  tags?: string[];
};

type TutorLesson = {
  id: string;
  lesson: number;
  title: string;
  level: string;
  category: string;
  summary: string;
  words: TutorEntry[];
};

type TutorPack = {
  lessons: TutorLesson[];
  vocabulary: TutorEntry[];
  grammar: Array<Record<string, unknown>>;
  conversations: Array<Record<string, unknown>>;
  quizzes: Array<Record<string, unknown>>;
  progress: Record<string, any>;
  mistakes: Array<Record<string, unknown>>;
  quiz_history: Array<Record<string, unknown>>;
  conversation_history: Array<Record<string, unknown>>;
};

const emptyPack: TutorPack = {
  lessons: [],
  vocabulary: [],
  grammar: [],
  conversations: [],
  quizzes: [],
  progress: {},
  mistakes: [],
  quiz_history: [],
  conversation_history: []
};

const tabs = ["Lessons", "Vocabulary", "Progress", "Quiz History", "Conversation", "Grammar", "Import"] as const;

export function PortugueseTutorPage() {
  const [pack, setPack] = useState<TutorPack>(emptyPack);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Lessons");
  const [selectedLessonId, setSelectedLessonId] = useState("");
  const [lessonText, setLessonText] = useState("{}");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [translation, setTranslation] = useState<Record<string, any> | null>(null);
  const [quiz, setQuiz] = useState<Record<string, any> | null>(null);
  const [answer, setAnswer] = useState("");
  const [conversationInput, setConversationInput] = useState("");
  const [conversationReply, setConversationReply] = useState<Record<string, any> | null>(null);
  const [packText, setPackText] = useState("");
  const [status, setStatus] = useState("");

  const selectedLesson = useMemo(
    () => pack.lessons.find((lesson) => lesson.id === selectedLessonId) ?? pack.lessons[0],
    [pack.lessons, selectedLessonId]
  );

  const filteredVocabulary = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return pack.vocabulary.slice(0, 80);
    return pack.vocabulary
      .filter((entry) =>
        [entry.english, entry.portuguese, entry.category, entry.difficulty, ...(entry.tags ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
      .slice(0, 120);
  }, [pack.vocabulary, filter]);

  async function loadPack() {
    const response = await fetch("/api/lulu/portuguese?action=pack", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.detail ?? "Could not load Portuguese tutor");
      return;
    }
    setPack({ ...emptyPack, ...data });
    setPackText(JSON.stringify(data, null, 2));
    setSelectedLessonId(data.lessons?.[0]?.id ?? "");
    setStatus("Portuguese tutor loaded");
  }

  async function postTutor(body: Record<string, unknown>) {
    const response = await fetch("/api/lulu/portuguese", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.detail ?? "Portuguese tutor request failed");
      return null;
    }
    return data;
  }

  async function translate() {
    const data = await postTutor({ action: "translate", text: query });
    if (data) {
      setTranslation(data);
      setStatus(`Translated from ${data.source ?? "tutor"}`);
      await loadPack();
    }
  }

  async function startQuiz() {
    const data = await postTutor({ action: "quiz" });
    if (data) {
      setQuiz(data.question);
      setAnswer("");
      setStatus("Quiz ready");
      await loadPack();
    }
  }

  async function checkAnswer() {
    if (!quiz) return;
    const data = await postTutor({ action: "check", question_id: quiz.id, answer });
    if (data) {
      setStatus(data.gentle_correction ?? "Answer checked");
      await loadPack();
    }
  }

  async function sendConversation() {
    const data = await postTutor({ action: "conversation", message: conversationInput });
    if (data) {
      setConversationReply(data);
      setConversationInput("");
      setStatus("Conversation updated");
      await loadPack();
    }
  }

  async function saveLesson() {
    if (!selectedLesson) return;
    try {
      const lesson = JSON.parse(lessonText);
      const nextLessons = pack.lessons.map((item) => (item.id === selectedLesson.id ? lesson : item));
      const data = await postTutor({ action: "pack", pack: { lessons: nextLessons } });
      if (data) {
        setPack({ ...emptyPack, ...data });
        setStatus("Lesson saved");
      }
    } catch {
      setStatus("Lesson editor must contain valid JSON");
    }
  }

  async function importPack() {
    try {
      const parsed = JSON.parse(packText);
      const data = await postTutor({ action: "pack", pack: parsed });
      if (data) {
        setPack({ ...emptyPack, ...data });
        setStatus("Language pack imported");
      }
    } catch {
      setStatus("Import must contain valid JSON");
    }
  }

  useEffect(() => {
    loadPack();
  }, []);

  useEffect(() => {
    if (selectedLesson) setLessonText(JSON.stringify(selectedLesson, null, 2));
  }, [selectedLesson]);

  return (
    <DashboardShell title="Portuguese Tutor" subtitle="Lessons, vocabulary, quizzes, conversation, and SD-backed progress">
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Lessons" value={String(pack.lessons.length)} detail="Structured lesson pack" icon={<BookOpen className="h-4 w-4" />} tone="info" />
        <StatCard label="Vocabulary" value={String(pack.vocabulary.length)} detail="Offline words and phrases" icon={<Languages className="h-4 w-4" />} tone="good" />
        <StatCard label="Level" value={String(pack.progress.current_level ?? "beginner")} detail={`Lesson ${pack.progress.current_lesson ?? 1}`} icon={<CheckCircle2 className="h-4 w-4" />} tone="neutral" />
        <StatCard label="Streak" value={String(pack.progress.daily_streak ?? 0)} detail="Practice days" icon={<RefreshCw className="h-4 w-4" />} tone="warn" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Button key={tab} variant={activeTab === tab ? "primary" : "secondary"} onClick={() => setActiveTab(tab)}>
            {tab}
          </Button>
        ))}
        <Button variant="ghost" onClick={loadPack}><RefreshCw className="h-4 w-4" />Refresh</Button>
        {status ? <StatusBadge status={status} /> : null}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[420px_1fr]">
        <div className="space-y-4">
          <SectionCard title="Practice">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder="How do you say thank you?" value={query} onChange={(event) => setQuery(event.target.value)} />
                <Button className="shrink-0" onClick={translate}>Ask</Button>
              </div>
              {translation ? (
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  <p className="font-medium">{translation.translation || "Not saved yet"}</p>
                  <p className="text-muted-foreground">{translation.pronunciation}</p>
                  <p className="mt-2 text-xs">{translation.grammar_explanation}</p>
                </div>
              ) : null}
              <Button variant="secondary" className="w-full" onClick={startQuiz}>Start Quiz</Button>
              {quiz ? (
                <div className="space-y-2 rounded-md border p-3 text-sm">
                  <p>{String(quiz.question ?? "")}</p>
                  <div className="flex gap-2">
                    <Input value={answer} onChange={(event) => setAnswer(event.target.value)} />
                    <Button onClick={checkAnswer}>Check</Button>
                  </div>
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Conversation">
            <div className="space-y-3">
              <Textarea value={conversationInput} onChange={(event) => setConversationInput(event.target.value)} placeholder="Type your Portuguese answer here" />
              <Button className="w-full" onClick={sendConversation}><MessageCircle className="h-4 w-4" />Send</Button>
              {conversationReply ? (
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  <p className="font-medium">{conversationReply.portuguese_reply}</p>
                  <p className="text-muted-foreground">{conversationReply.english_hint}</p>
                  {conversationReply.correction ? <p className="mt-2 text-xs">{conversationReply.correction}</p> : null}
                </div>
              ) : null}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-4">
          {activeTab === "Lessons" ? (
            <SectionCard
              title="Lesson Browser"
              action={<Button onClick={saveLesson}><Save className="h-4 w-4" />Save Lesson</Button>}
            >
              <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
                <Select value={selectedLesson?.id ?? ""} onChange={(event) => setSelectedLessonId(event.target.value)}>
                  {pack.lessons.map((lesson) => (
                    <option key={lesson.id} value={lesson.id}>{lesson.lesson}. {lesson.title}</option>
                  ))}
                </Select>
                <Textarea className="min-h-[480px] font-mono text-xs" value={lessonText} onChange={(event) => setLessonText(event.target.value)} />
              </div>
            </SectionCard>
          ) : null}

          {activeTab === "Vocabulary" ? (
            <SectionCard title="Vocabulary Manager" action={<Input className="w-64" placeholder="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />}>
              <div className="overflow-x-auto thin-scrollbar">
                <Table>
                  <thead><tr><Th>English</Th><Th>Portuguese</Th><Th>Pronunciation</Th><Th>Category</Th><Th>Level</Th></tr></thead>
                  <tbody>
                    {filteredVocabulary.map((entry) => (
                      <tr key={entry.id}>
                        <Td>{entry.english}</Td><Td>{entry.portuguese}</Td><Td>{entry.pronunciation}</Td><Td>{entry.category}</Td><Td>{entry.difficulty}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </SectionCard>
          ) : null}

          {activeTab === "Progress" ? (
            <SectionCard title="Progress Dashboard">
              <Textarea className="min-h-[420px] font-mono text-xs" value={JSON.stringify(pack.progress, null, 2)} readOnly />
            </SectionCard>
          ) : null}

          {activeTab === "Quiz History" ? (
            <SectionCard title="Quiz History">
              <Textarea className="min-h-[420px] font-mono text-xs" value={JSON.stringify(pack.quiz_history, null, 2)} readOnly />
            </SectionCard>
          ) : null}

          {activeTab === "Conversation" ? (
            <SectionCard title="Conversation History">
              <Textarea className="min-h-[420px] font-mono text-xs" value={JSON.stringify(pack.conversation_history, null, 2)} readOnly />
            </SectionCard>
          ) : null}

          {activeTab === "Grammar" ? (
            <SectionCard title="Grammar Topics">
              <Textarea className="min-h-[420px] font-mono text-xs" value={JSON.stringify(pack.grammar, null, 2)} readOnly />
            </SectionCard>
          ) : null}

          {activeTab === "Import" ? (
            <SectionCard
              title="Import / Export Language Pack"
              action={
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setPackText(JSON.stringify(pack, null, 2))}><Download className="h-4 w-4" />Export</Button>
                  <Button onClick={importPack}><Upload className="h-4 w-4" />Import</Button>
                </div>
              }
            >
              <Textarea className="min-h-[520px] font-mono text-xs" value={packText} onChange={(event) => setPackText(event.target.value)} />
            </SectionCard>
          ) : null}
        </div>
      </div>
    </DashboardShell>
  );
}
