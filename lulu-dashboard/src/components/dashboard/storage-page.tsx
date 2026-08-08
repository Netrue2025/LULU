"use client";

import { BookOpen, Check, File, Folder, FolderPlus, Languages, Mic, Music, RefreshCw, Save, SendToBack, Trash2, Upload, X } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SectionCard, StatusBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";

type StorageItem = {
  name: string;
  path: string;
  type: "directory" | "file";
  size: number;
  modified: string;
  editable: boolean;
};

type FileListing = {
  path: string;
  items: StorageItem[];
  active_data_dir: string;
  fallback_data_dir: string;
  sdcard_data_dir: string;
  sdcard_active: boolean;
  fallback_active: boolean;
};

type OpenFile = {
  path: string;
  name: string;
  content: string;
  encoding: string;
  editable: boolean;
};

type Lesson = {
  lesson: number;
  title: string;
  completed: boolean;
  words: Array<Record<string, string>>;
};

type UploadTarget = "Music" | "Stories" | "Voices" | "Current";
type StorageSource = "lulu_sd" | "server";
type UploadResponseData = {
  count?: number;
  detail?: string;
};

const DEFAULT_LULU_STORAGE_URL = process.env.NEXT_PUBLIC_LULU_SD_URL ?? "http://192.168.43.73";
const LULU_STORAGE_URL_KEY = "lulu-storage-url";

const emptyListing: FileListing = {
  path: "",
  items: [],
  active_data_dir: "",
  fallback_data_dir: "",
  sdcard_data_dir: "",
  sdcard_active: false,
  fallback_active: true
};

export function StoragePage() {
  const [listing, setListing] = useState<FileListing>(emptyListing);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [content, setContent] = useState("");
  const [newName, setNewName] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [status, setStatus] = useState("");
  const [language, setLanguage] = useState("portuguese");
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [lessonWordsText, setLessonWordsText] = useState("[]");
  const [luluStorageUrl, setLuluStorageUrl] = useState(() =>
    typeof window === "undefined" ? DEFAULT_LULU_STORAGE_URL : window.localStorage.getItem(LULU_STORAGE_URL_KEY) ?? DEFAULT_LULU_STORAGE_URL
  );
  const [storageSource, setStorageSource] = useState<StorageSource>("server");
  const [uploadTarget, setUploadTarget] = useState<UploadTarget>("Music");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState("");
  const [renamingPath, setRenamingPath] = useState("");
  const [renameValue, setRenameValue] = useState("");

  const parentPath = useMemo(() => {
    if (!listing.path) return "";
    const parts = listing.path.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
  }, [listing.path]);

  const uploadPath = uploadTarget === "Current" ? listing.path : uploadTarget;
  const uploadAccept = uploadTarget === "Music"
    ? ".wav,.mp3,audio/*"
    : uploadTarget === "Stories"
      ? ".txt,.json,.wav,audio/wav"
      : uploadTarget === "Voices"
        ? ".wav,audio/wav"
        : undefined;

  const visibleFolders = useMemo(() => {
    const preferred = ["Music", "Stories", "Voices", "Languages", "Images", "Config"];
    const folders = listing.items.filter((item) => item.type === "directory");
    return [
      ...preferred
        .map((name) => folders.find((item) => item.name.toLowerCase() === name.toLowerCase()))
        .filter((item): item is StorageItem => Boolean(item)),
      ...folders.filter((item) => !preferred.some((name) => item.name.toLowerCase() === name.toLowerCase()))
    ].slice(0, 8);
  }, [listing.items]);

  function directStorageUrl() {
    return luluStorageUrl.trim().replace(/\/$/, "");
  }

  async function loadFiles(path = listing.path) {
    const directUrl = directStorageUrl();
    if (directUrl) {
      try {
        const response = await fetch(`/api/lulu/sd?action=list&baseUrl=${encodeURIComponent(directUrl)}&path=${encodeURIComponent(path)}`, { cache: "no-store" });
        const data = await response.json();
        if (response.ok) {
          setListing({
            path: String(data.path ?? path).replace(/^\//, ""),
            items: data.items ?? [],
            active_data_dir: directUrl,
            fallback_data_dir: "",
            sdcard_data_dir: directUrl,
            sdcard_active: true,
            fallback_active: false
          });
          setStorageSource("lulu_sd");
          setStatus("LULU SD card storage active");
          return;
        }
      } catch {
        // Fall back to the Python server storage below.
      }
    }

    const response = await fetch(`/api/lulu/storage?action=files&path=${encodeURIComponent(path)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.detail ?? "Could not load storage");
      return;
    }
    setListing(data);
    setStorageSource("server");
    setStatus(data.sdcard_active ? "SD card storage active" : "Local fallback storage active");
  }

  async function openItem(item: StorageItem) {
    if (item.type === "directory") {
      await loadFiles(item.path);
      return;
    }
    if (storageSource === "lulu_sd") {
      window.open(`/api/lulu/sd?action=download&baseUrl=${encodeURIComponent(directStorageUrl())}&path=${encodeURIComponent(item.path)}`, "_blank");
      return;
    }
    const response = await fetch(`/api/lulu/storage?action=read&path=${encodeURIComponent(item.path)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.detail ?? "Could not open file");
      return;
    }
    setOpenFile(data);
    setContent(data.content ?? "");
    setStatus(`Opened ${item.path}`);
  }

  async function saveFile(path = openFile?.path, nextContent = content) {
    if (!path) return;
    const response = await fetch("/api/lulu/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content: nextContent })
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.detail ?? "Could not save file");
      return;
    }
    setOpenFile(data);
    setContent(data.content ?? "");
    setStatus(`Saved ${path}`);
    await loadFiles(listing.path);
  }

  async function createFile() {
    const name = newName.trim();
    if (!name) return;
    const path = [listing.path, name].filter(Boolean).join("/");
    await saveFile(path, name.endsWith(".json") ? "{}" : "");
    setNewName("");
  }

  async function createFolder() {
    const name = newFolder.trim();
    if (!name) return;
    const path = [listing.path, name].filter(Boolean).join("/");
    if (storageSource === "lulu_sd" && directStorageUrl()) {
      const response = await fetch("/api/lulu/sd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "folder", baseUrl: directStorageUrl(), dir: listing.path, name })
      });
      setStatus(response.ok ? `Created ${path} on LULU SD` : "Could not create folder on LULU SD");
      setNewFolder("");
      await loadFiles(listing.path);
      return;
    }
    const response = await fetch("/api/lulu/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "folder", path })
    });
    const data = await response.json();
    setStatus(response.ok ? `Created ${path}` : data.detail ?? "Could not create folder");
    setNewFolder("");
    await loadFiles(listing.path);
  }

  async function deleteItem(path: string) {
    if (storageSource === "lulu_sd" && directStorageUrl()) {
      const response = await fetch("/api/lulu/sd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", baseUrl: directStorageUrl(), dir: listing.path, path })
      });
      setStatus(response.ok ? `Deleted ${path} from LULU SD` : "Could not delete item from LULU SD");
      await loadFiles(listing.path);
      return;
    }
    const response = await fetch("/api/lulu/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", path })
    });
    const data = await response.json();
    setStatus(response.ok ? `Deleted ${path}` : data.detail ?? "Could not delete item");
    if (openFile?.path === path) {
      setOpenFile(null);
      setContent("");
    }
    await loadFiles(listing.path);
  }

  async function renameItem(path: string) {
    const name = renameValue.trim();
    if (!name) return;
    if (storageSource === "lulu_sd" && directStorageUrl()) {
      const response = await fetch("/api/lulu/sd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", baseUrl: directStorageUrl(), dir: listing.path, path, name })
      });
      setStatus(response.ok ? `Renamed ${path}` : "Could not rename item on LULU SD");
      setRenamingPath("");
      setRenameValue("");
      await loadFiles(listing.path);
      return;
    }
    setStatus("Rename is available for LULU SD card files");
  }

  function startRename(item: StorageItem) {
    setRenamingPath(item.path);
    setRenameValue(item.name);
  }

  function selectUploadFiles(event: ChangeEvent<HTMLInputElement>) {
    setPendingFiles(Array.from(event.target.files ?? []));
    setUploadProgress(0);
    setUploadPhase("");
  }

  function clearPendingFiles(resetProgress = true) {
    setPendingFiles([]);
    setFileInputKey((key) => key + 1);
    if (resetProgress) {
      setUploadProgress(0);
      setUploadPhase("");
    }
  }

  function uploadFormDataWithProgress(url: string, formData: FormData, processingLabel: string) {
    return new Promise<{ ok: boolean; data: UploadResponseData }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          setUploadProgress(Math.min(100, Math.max(1, Math.round((event.loaded / event.total) * 100))));
          return;
        }
        setUploadProgress((current) => current || 10);
      };

      xhr.upload.onload = () => {
        setUploadProgress(100);
        setUploadPhase(processingLabel);
      };

      xhr.onload = () => {
        let data: UploadResponseData = {};
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch {
          data = { detail: xhr.responseText };
        }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, data });
      };

      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.onabort = () => reject(new Error("Upload cancelled"));
      xhr.send(formData);
    });
  }

  async function uploadFiles(targetPath: string, files: File[]) {
    if (!files.length) {
      setStatus("Choose files before uploading");
      return;
    }

    const directUrl = directStorageUrl();
    setUploading(true);
    setUploadProgress(0);
    setUploadPhase("Preparing upload");

    try {
      if (directUrl) {
        const formData = new FormData();
        formData.append("baseUrl", directUrl);
        formData.append("path", targetPath || listing.path || "");
        files.forEach((file) => formData.append("files", file));
        setStatus(`Uploading ${files.length} file(s) to LULU /${targetPath || listing.path || ""}`);
        setUploadPhase("Uploading to LULU SD");
        try {
          const response = await uploadFormDataWithProgress("/api/lulu/sd", formData, "Processing on LULU SD");
          if (response.ok) {
            setStatus(`Uploaded ${files.length} file(s) to LULU SD`);
            setUploadProgress(100);
            setUploadPhase("Upload complete");
            clearPendingFiles(false);
            await loadFiles(targetPath || listing.path);
            return;
          }
        } catch {
          // Fall back to server storage below.
        }
        setStatus("LULU SD unavailable, uploading to server fallback");
      }

      const formData = new FormData();
      formData.append("path", targetPath);
      files.forEach((file) => formData.append("files", file));

      setStatus(`Uploading ${files.length} file(s) to /${targetPath || listing.path || ""}`);
      setUploadProgress(0);
      setUploadPhase("Uploading to server storage");
      const response = await uploadFormDataWithProgress("/api/lulu/storage", formData, "Saving files");
      const data = response.data;
      setStatus(response.ok ? `Uploaded ${data.count ?? files.length} file(s)` : data.detail ?? "Upload failed");
      if (response.ok) {
        setUploadProgress(100);
        setUploadPhase("Upload complete");
        clearPendingFiles(false);
        await loadFiles(targetPath || listing.path);
      }
    } finally {
      setUploading(false);
    }
  }

  async function syncToSd() {
    const response = await fetch("/api/lulu/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_to_sd" })
    });
    const data = await response.json();
    setStatus(response.ok ? `Synced ${data.copied_files ?? 0} file(s) to SD` : data.detail ?? "Sync failed");
    await loadFiles(listing.path);
  }

  async function syncFromSd() {
    const response = await fetch("/api/lulu/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_from_sd" })
    });
    const data = await response.json();
    setStatus(response.ok ? `Copied ${data.copied_files ?? 0} file(s) into fallback` : data.detail ?? "Sync failed");
    await loadFiles(listing.path);
  }

  async function loadLesson(nextLanguage = language) {
    const response = await fetch(`/api/lulu/storage?action=language&language=${encodeURIComponent(nextLanguage)}`, { cache: "no-store" });
    const data = await response.json();
    if (response.ok) {
      setLesson(data);
      setLessonWordsText(JSON.stringify(data.words ?? [], null, 2));
    }
  }

  async function saveLesson() {
    if (!lesson) return;
    let words: Lesson["words"];
    try {
      words = JSON.parse(lessonWordsText);
      if (!Array.isArray(words)) throw new Error("Words must be an array");
    } catch {
      setStatus("Lesson words must be a valid JSON array");
      return;
    }

    const response = await fetch("/api/lulu/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "language", language, lesson: { ...lesson, words } })
    });
    const data = await response.json();
    setStatus(response.ok ? `Saved ${language} lesson ${lesson.lesson}` : data.detail ?? "Could not save lesson");
    await loadFiles(`${language}/lessons`);
  }

  useEffect(() => {
    loadFiles("");
    loadLesson("portuguese");
  }, []);

  useEffect(() => {
    loadLesson(language);
  }, [language]);

  return (
    <DashboardShell title="Storage" subtitle="Upload and manage LULU files">
      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <SectionCard title="Quick Upload">
            <div className="space-y-4 text-sm">
              <Input
                placeholder="LULU SD address, e.g. http://192.168.43.73"
                value={luluStorageUrl}
                onChange={(event) => {
                  setLuluStorageUrl(event.target.value);
                  window.localStorage.setItem(LULU_STORAGE_URL_KEY, event.target.value);
                }}
              />

              <div className="grid grid-cols-2 gap-2">
                <UploadTargetButton active={uploadTarget === "Music"} icon={<Music className="h-4 w-4" />} label="Music" onClick={() => setUploadTarget("Music")} />
                <UploadTargetButton active={uploadTarget === "Stories"} icon={<BookOpen className="h-4 w-4" />} label="Stories" onClick={() => setUploadTarget("Stories")} />
                <UploadTargetButton active={uploadTarget === "Voices"} icon={<Mic className="h-4 w-4" />} label="Voices" onClick={() => setUploadTarget("Voices")} />
                <UploadTargetButton active={uploadTarget === "Current"} icon={<Folder className="h-4 w-4" />} label="Current" onClick={() => setUploadTarget("Current")} />
              </div>

              <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 p-4 text-center transition hover:bg-muted">
                <Upload className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium">{pendingFiles.length ? `${pendingFiles.length} file(s) selected` : "Choose files"}</span>
                <input key={fileInputKey} className="sr-only" type="file" multiple accept={uploadAccept} onChange={selectUploadFiles} />
              </label>

              {pendingFiles.length ? (
                <div className="max-h-28 space-y-1 overflow-y-auto rounded-md border bg-background p-2 text-xs">
                  {pendingFiles.map((file) => (
                    <div key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-2">
                      <span className="truncate">{file.name}</span>
                      <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Button disabled={!pendingFiles.length || uploading} onClick={() => uploadFiles(uploadPath, pendingFiles)}>
                  <Upload className="h-4 w-4" />{uploading ? "Uploading" : `Upload to ${uploadTarget}`}
                </Button>
                <Button variant="secondary" className="h-9 w-9 px-0" disabled={!pendingFiles.length || uploading} title="Clear selected files" onClick={() => clearPendingFiles()}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {(uploading || uploadProgress > 0) ? (
                <div className="space-y-2 rounded-md border bg-background p-3">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{uploadPhase || "Uploading"}</span>
                    <span className="shrink-0 tabular-nums">{uploadProgress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-200"
                      style={{ width: `${Math.min(100, Math.max(0, uploadProgress))}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {status ? <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{status}</p> : null}
            </div>
          </SectionCard>

          <SectionCard
            title="Storage"
            action={<Button variant="secondary" onClick={() => loadFiles(listing.path)}><RefreshCw className="h-4 w-4" />Refresh</Button>}
          >
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Active</span>
                <StatusBadge status={listing.sdcard_active ? "sd-card" : "fallback"} />
              </div>
              <p className="break-all text-xs text-muted-foreground">{listing.active_data_dir || "Not connected"}</p>
              <p className="break-all text-xs text-muted-foreground">Fallback: {listing.fallback_data_dir || "Not set"}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button className="w-full" onClick={syncToSd}><SendToBack className="h-4 w-4" />To SD</Button>
                <Button variant="secondary" className="w-full" onClick={syncFromSd}><RefreshCw className="h-4 w-4" />From SD</Button>
              </div>
            </div>
          </SectionCard>

          {visibleFolders.length ? (
            <SectionCard title="Folders">
              <div className="grid grid-cols-2 gap-2">
                {visibleFolders.map((folder) => (
                  <button key={folder.path} className="flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition hover:bg-muted" onClick={() => loadFiles(folder.path)}>
                    <Folder className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{folder.name}</span>
                  </button>
                ))}
              </div>
            </SectionCard>
          ) : null}
        </div>

        <div className="space-y-4">
          <SectionCard
            title={`Files /${listing.path}`}
            action={
              <div className="flex gap-2">
                <Button variant="ghost" className="h-9 w-9 px-0" title="Parent folder" onClick={() => loadFiles(parentPath)}><Folder className="h-4 w-4" /></Button>
                <Button variant="secondary" onClick={() => loadFiles("")}><BookOpen className="h-4 w-4" />Root</Button>
              </div>
            }
          >
            <div className="overflow-x-auto thin-scrollbar">
              <Table>
                <thead>
                  <tr><Th>Name</Th><Th>Type</Th><Th>Size</Th><Th>Modified</Th><Th>Actions</Th></tr>
                </thead>
                <tbody>
                  {listing.items.map((item) => (
                    <tr key={item.path}>
                      <Td>
                        {renamingPath === item.path ? (
                          <Input className="h-8 min-w-52" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
                        ) : (
                          <button className="flex items-center gap-2 text-left hover:text-primary" onClick={() => openItem(item)}>
                            {item.type === "directory" ? <Folder className="h-4 w-4" /> : <File className="h-4 w-4" />}
                            <span className="break-all">{item.name}</span>
                          </button>
                        )}
                      </Td>
                      <Td>{item.type}</Td>
                      <Td>{item.size}</Td>
                      <Td>{item.modified}</Td>
                      <Td>
                        <div className="flex gap-1">
                          {renamingPath === item.path ? (
                            <>
                              <Button variant="ghost" className="h-8 w-8 px-0" title="Save rename" onClick={() => renameItem(item.path)}>
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" className="h-8 w-8 px-0" title="Cancel rename" onClick={() => setRenamingPath("")}>
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <Button variant="ghost" className="h-8 w-8 px-0" title="Rename" onClick={() => startRename(item)}>
                              <Save className="h-4 w-4" />
                            </Button>
                          )}
                          <Button variant="ghost" className="h-8 w-8 px-0" title="Delete" onClick={() => deleteItem(item.path)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Create">
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input placeholder="new-file.json" value={newName} onChange={(event) => setNewName(event.target.value)} />
                  <Button className="h-9 w-9 px-0" title="Create file" onClick={createFile}><File className="h-4 w-4" /></Button>
                </div>
                <div className="flex gap-2">
                  <Input placeholder="folder-name" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} />
                  <Button variant="secondary" className="h-9 w-9 px-0" title="Create folder" onClick={createFolder}><FolderPlus className="h-4 w-4" /></Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Language Lessons">
              <div className="space-y-3">
                <Select value={language} onChange={(event) => setLanguage(event.target.value)}>
                  <option value="portuguese">Portuguese</option>
                  <option value="chinese">Chinese</option>
                </Select>
                {lesson ? (
                  <>
                    <Input value={lesson.title} onChange={(event) => setLesson({ ...lesson, title: event.target.value })} />
                    <Textarea
                      className="min-h-24 font-mono text-xs"
                      value={lessonWordsText}
                      onChange={(event) => setLessonWordsText(event.target.value)}
                    />
                    <Button className="w-full" onClick={saveLesson}><Languages className="h-4 w-4" />Save Lesson</Button>
                  </>
                ) : null}
              </div>
            </SectionCard>
          </div>

          <SectionCard
            title={openFile ? openFile.path : "Editor"}
            action={openFile?.editable ? <Button onClick={() => saveFile()}><Save className="h-4 w-4" />Save</Button> : null}
          >
            {openFile ? (
              <div className="space-y-3">
                <Textarea
                  className="min-h-[420px] font-mono text-xs"
                  disabled={!openFile.editable}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Check className="h-4 w-4" />
                  {openFile.encoding === "utf-8" ? "Editable text file" : "Binary file is read-only"}
                </div>
              </div>
            ) : (
              <div className="min-h-[420px]" />
            )}
          </SectionCard>
        </div>
      </div>
    </DashboardShell>
  );
}

function UploadTargetButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition ${
        active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
      }`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
