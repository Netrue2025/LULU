#include "arduino_secrets.h"
#include "SDFileManager.h"
#include <SD.h>
#include <WebServer.h>
#include <WiFi.h>
#include <ctype.h>

#ifndef SD_FILE_MANAGER_ENABLED
#define SD_FILE_MANAGER_ENABLED 1
#endif

#ifndef SD_FILE_MANAGER_PORT
#define SD_FILE_MANAGER_PORT 80
#endif

#ifndef SD_FILE_MANAGER_CHUNK_BYTES
#define SD_FILE_MANAGER_CHUNK_BYTES 1024
#endif

static WebServer storageServer(SD_FILE_MANAGER_PORT);
static File uploadFile;
static bool storageServerRunning = false;
static bool storageSdReady = false;

static const char *defaultFolders[] = {
    "/Music",
    "/Stories",
    "/Languages",
    "/Images",
    "/Config",
    "/Voices"};

static String htmlEscape(const String &value)
{
  String escaped;
  escaped.reserve(value.length() + 8);
  for (uint16_t i = 0; i < value.length(); i++)
  {
    char c = value[i];
    if (c == '&')
      escaped += F("&amp;");
    else if (c == '<')
      escaped += F("&lt;");
    else if (c == '>')
      escaped += F("&gt;");
    else if (c == '"')
      escaped += F("&quot;");
    else
      escaped += c;
  }
  return escaped;
}

static String jsonEscape(const String &value)
{
  String escaped;
  escaped.reserve(value.length() + 8);
  for (uint16_t i = 0; i < value.length(); i++)
  {
    char c = value[i];
    if (c == '\\')
      escaped += F("\\\\");
    else if (c == '"')
      escaped += F("\\\"");
    else if (c == '\n')
      escaped += F("\\n");
    else if (c == '\r')
      escaped += F("\\r");
    else
      escaped += c;
  }
  return escaped;
}

static String urlEncode(const String &value)
{
  const char *hex = "0123456789ABCDEF";
  String encoded;
  encoded.reserve(value.length() + 8);
  for (uint16_t i = 0; i < value.length(); i++)
  {
    uint8_t c = (uint8_t)value[i];
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~')
      encoded += (char)c;
    else
    {
      encoded += '%';
      encoded += hex[c >> 4];
      encoded += hex[c & 0x0F];
    }
  }
  return encoded;
}

static String normalizePath(String path)
{
  path.trim();
  path.replace('\\', '/');

  if (path.length() == 0)
    path = "/";
  if (!path.startsWith("/"))
    path = "/" + path;

  while (path.indexOf("//") >= 0)
    path.replace("//", "/");

  if (path.indexOf("..") >= 0)
    return "/";

  if (path.length() > 1 && path.endsWith("/"))
    path.remove(path.length() - 1);

  return path;
}

static String joinPath(const String &dir, const String &name)
{
  String safeName = name;
  safeName.replace('\\', '/');
  int slash = safeName.lastIndexOf('/');
  if (slash >= 0)
    safeName = safeName.substring(slash + 1);
  safeName.trim();

  if (safeName.length() == 0 || safeName.indexOf("..") >= 0)
    return "";

  String base = normalizePath(dir);
  if (base == "/")
    return "/" + safeName;
  return base + "/" + safeName;
}

static String parentPath(const String &path)
{
  String normalized = normalizePath(path);
  if (normalized == "/")
    return "/";

  int slash = normalized.lastIndexOf('/');
  if (slash <= 0)
    return "/";
  return normalized.substring(0, slash);
}

static String baseNameFromPath(String path)
{
  path.replace('\\', '/');
  int slash = path.lastIndexOf('/');
  if (slash >= 0)
    return path.substring(slash + 1);
  return path;
}

static String resolveExistingDirectory(const char *preferred)
{
  if (SD.exists(preferred))
    return String(preferred);

  String preferredName = baseNameFromPath(String(preferred));
  preferredName.toLowerCase();

  File root = SD.open("/", FILE_READ);
  if (!root || !root.isDirectory())
  {
    if (root)
      root.close();
    return String(preferred);
  }

  while (true)
  {
    File entry = root.openNextFile();
    if (!entry)
      break;

    if (entry.isDirectory())
    {
      String name = baseNameFromPath(String(entry.name()));
      String key = name;
      key.toLowerCase();
      if (key == preferredName)
      {
        String resolved = "/" + name;
        entry.close();
        root.close();
        return resolved;
      }
    }

    entry.close();
  }

  root.close();
  return String(preferred);
}

static String contentTypeFor(const String &path)
{
  String lower = path;
  lower.toLowerCase();

  if (lower.endsWith(".html"))
    return F("text/html");
  if (lower.endsWith(".txt") || lower.endsWith(".json") || lower.endsWith(".csv"))
    return F("text/plain");
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
    return F("image/jpeg");
  if (lower.endsWith(".png"))
    return F("image/png");
  if (lower.endsWith(".gif"))
    return F("image/gif");
  if (lower.endsWith(".wav"))
    return F("audio/wav");
  if (lower.endsWith(".mp3"))
    return F("audio/mpeg");
  return F("application/octet-stream");
}

static void sendRedirect(const String &dir)
{
  storageServer.sendHeader(F("Location"), "/?dir=" + urlEncode(normalizePath(dir)), true);
  storageServer.send(303, F("text/plain"), F("Redirecting"));
}

static void appendPageHeader(String &html, const String &dir)
{
  html += F("<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>");
  html += F("<title>LULU Storage</title><style>");
  html += F("body{font-family:Arial,sans-serif;margin:0;background:#f6f7fb;color:#16181d}main{max-width:760px;margin:auto;padding:18px}");
  html += F("h1{font-size:28px;margin:8px 0 4px}.ip{color:#5d6470;margin-bottom:18px}.panel{background:white;border:1px solid #dfe3ea;border-radius:8px;padding:14px;margin:12px 0}");
  html += F("a{color:#0b65c2;text-decoration:none}.grid{display:grid;gap:8px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid #edf0f5;padding:10px 0}");
  html += F("button,.btn{border:0;border-radius:6px;background:#155eef;color:white;padding:8px 10px;font-size:14px}.danger{background:#c62828}.muted{color:#667085}.name{flex:1 1 220px;word-break:break-word}");
  html += F("input{font-size:14px;max-width:100%}</style></head><body><main>");
  html += F("<h1>LULU Storage</h1><div class='ip'>");
  html += WiFi.localIP().toString();
  html += F("</div>");
  html += F("<div class='panel'><b>Folder:</b> ");
  html += htmlEscape(dir);
  html += F("</div>");
}

static void appendFolders(String &html, const String &dir)
{
  html += F("<div class='panel'><h2>Folders</h2><div class='grid'>");

  for (uint8_t i = 0; i < sizeof(defaultFolders) / sizeof(defaultFolders[0]); i++)
  {
    String path = resolveExistingDirectory(defaultFolders[i]);
    html += F("<a href='/?dir=");
    html += urlEncode(path);
    html += F("'>&#128193; ");
    html += htmlEscape(baseNameFromPath(path));
    html += F("</a>");
  }

  if (dir != "/")
  {
    html += F("<a href='/?dir=");
    html += urlEncode(parentPath(dir));
    html += F("'>&uarr; Parent Folder</a>");
  }

  File root = SD.open(dir, FILE_READ);
  if (root && root.isDirectory())
  {
    File entry = root.openNextFile();
    while (entry)
    {
      if (entry.isDirectory())
      {
        String path = String(entry.path());
        html += F("<a href='/?dir=");
        html += urlEncode(path);
        html += F("'>&#128193; ");
        html += htmlEscape(String(entry.name()));
        html += F("</a>");
      }
      entry.close();
      entry = root.openNextFile();
    }
  }
  if (root)
    root.close();

  html += F("</div><form method='POST' action='/mkdir'><input type='hidden' name='dir' value='");
  html += htmlEscape(dir);
  html += F("'><p><input name='name' placeholder='New folder name'> <button>Create Folder</button></p></form></div>");
}

static void appendUpload(String &html, const String &dir)
{
  html += F("<div class='panel'><h2>Upload Files</h2>");
  html += F("<form method='POST' action='/upload?dir=");
  html += urlEncode(dir);
  html += F("' enctype='multipart/form-data'><input type='file' name='upload' multiple> <button>Upload</button></form></div>");
}

static void appendFiles(String &html, const String &dir)
{
  html += F("<div class='panel'><h2>Current Files</h2>");

  File root = SD.open(dir, FILE_READ);
  if (!root || !root.isDirectory())
  {
    html += F("<p class='muted'>Folder unavailable.</p></div>");
    if (root)
      root.close();
    return;
  }

  File entry = root.openNextFile();
  bool anyFile = false;
  while (entry)
  {
    if (!entry.isDirectory())
    {
      anyFile = true;
      String path = String(entry.path());
      String name = String(entry.name());
      html += F("<div class='row'><div class='name'>");
      html += htmlEscape(name);
      html += F("<br><span class='muted'>");
      html += String((uint32_t)entry.size());
      html += F(" bytes</span></div>");

      html += F("<a class='btn' href='/download?path=");
      html += urlEncode(path);
      html += F("'>Download</a>");

      html += F("<form method='POST' action='/delete'><input type='hidden' name='dir' value='");
      html += htmlEscape(dir);
      html += F("'><input type='hidden' name='path' value='");
      html += htmlEscape(path);
      html += F("'><button class='danger'>Delete</button></form>");

      html += F("<form method='POST' action='/rename'><input type='hidden' name='dir' value='");
      html += htmlEscape(dir);
      html += F("'><input type='hidden' name='path' value='");
      html += htmlEscape(path);
      html += F("'><input name='name' placeholder='New name'><button>Rename</button></form></div>");
    }
    entry.close();
    entry = root.openNextFile();
  }

  if (!anyFile)
    html += F("<p class='muted'>No files in this folder.</p>");

  root.close();
  html += F("</div>");
}

static void handleIndex()
{
  if (!storageSdReady)
  {
    storageServer.send(503, F("text/plain"), F("SD card is not ready"));
    return;
  }

  String dir = normalizePath(storageServer.arg(F("dir")));
  if (!SD.exists(dir))
    dir = "/";

  String html;
  html.reserve(7600);
  appendPageHeader(html, dir);
  appendFolders(html, dir);
  appendUpload(html, dir);
  appendFiles(html, dir);
  html += F("</main></body></html>");
  storageServer.send(200, F("text/html"), html);
}

static void handleList()
{
  if (!storageSdReady)
  {
    storageServer.send(503, F("application/json"), F("{\"detail\":\"SD card is not ready\"}"));
    return;
  }

  String dir = normalizePath(storageServer.arg("dir"));
  File root = SD.open(dir, FILE_READ);
  if (!root || !root.isDirectory())
  {
    if (root)
      root.close();
    storageServer.send(404, F("application/json"), F("{\"detail\":\"Folder unavailable\"}"));
    return;
  }

  String json;
  json.reserve(4096);
  json += F("{\"path\":\"");
  json += jsonEscape(dir);
  json += F("\",\"sdcard_active\":true,\"items\":[");

  bool first = true;
  File entry = root.openNextFile();
  while (entry)
  {
    String name = baseNameFromPath(String(entry.name()));
    if (name.length() > 0)
    {
      String path = joinPath(dir, name);
      if (!first)
        json += ',';
      first = false;
      json += F("{\"name\":\"");
      json += jsonEscape(name);
      json += F("\",\"path\":\"");
      json += jsonEscape(path);
      json += F("\",\"type\":\"");
      json += entry.isDirectory() ? F("directory") : F("file");
      json += F("\",\"size\":");
      json += String((uint32_t)entry.size());
      json += F(",\"modified\":\"\",\"editable\":false}");
    }
    entry.close();
    entry = root.openNextFile();
  }

  root.close();
  json += F("]}");
  storageServer.send(200, F("application/json"), json);
}

static void handleDownload()
{
  String path = normalizePath(storageServer.arg(F("path")));
  if (!storageSdReady || path == "/" || !SD.exists(path))
  {
    storageServer.send(404, F("text/plain"), F("File not found"));
    return;
  }

  File file = SD.open(path, FILE_READ);
  if (!file || file.isDirectory())
  {
    if (file)
      file.close();
    storageServer.send(404, F("text/plain"), F("File not found"));
    return;
  }

  storageServer.sendHeader(F("Content-Disposition"), "attachment; filename=\"" + String(file.name()) + "\"");
  storageServer.streamFile(file, contentTypeFor(path));
  file.close();
}

static void handleDelete()
{
  String dir = normalizePath(storageServer.arg(F("dir")));
  String path = normalizePath(storageServer.arg(F("path")));
  if (storageSdReady && path != "/" && SD.exists(path))
    SD.remove(path);
  sendRedirect(dir);
}

static void handleRename()
{
  String dir = normalizePath(storageServer.arg(F("dir")));
  String path = normalizePath(storageServer.arg(F("path")));
  String target = joinPath(parentPath(path), storageServer.arg(F("name")));

  if (storageSdReady && path != "/" && target.length() > 0 && SD.exists(path) && !SD.exists(target))
    SD.rename(path, target);

  sendRedirect(dir);
}

static void handleMkdir()
{
  String dir = normalizePath(storageServer.arg(F("dir")));
  String path = joinPath(dir, storageServer.arg(F("name")));
  if (storageSdReady && path.length() > 0 && !SD.exists(path))
    SD.mkdir(path);
  sendRedirect(dir);
}

static void handleUploadDone()
{
  sendRedirect(storageServer.arg(F("dir")));
}

static void handleUploadData()
{
  HTTPUpload &upload = storageServer.upload();
  String dir = normalizePath(storageServer.arg(F("dir")));
  if (dir.equalsIgnoreCase("/Stories") && SD.exists("/Story"))
    dir = "/Story";
  else
    dir = resolveExistingDirectory(dir.c_str());

  if (!storageSdReady)
    return;

  if (upload.status == UPLOAD_FILE_START)
  {
    if (!SD.exists(dir))
      SD.mkdir(dir);

    String path = joinPath(dir, upload.filename);
    if (path.length() == 0)
      return;

    if (SD.exists(path))
      SD.remove(path);
    uploadFile = SD.open(path, FILE_WRITE);
  }
  else if (upload.status == UPLOAD_FILE_WRITE)
  {
    if (uploadFile)
      uploadFile.write(upload.buf, upload.currentSize);
  }
  else if (upload.status == UPLOAD_FILE_END || upload.status == UPLOAD_FILE_ABORTED)
  {
    if (uploadFile)
      uploadFile.close();
  }
}

void beginSDFileManager(bool sdAvailable)
{
#if SD_FILE_MANAGER_ENABLED
  storageSdReady = sdAvailable;
  if (!storageSdReady || storageServerRunning || WiFi.status() != WL_CONNECTED)
    return;

  for (uint8_t i = 0; i < sizeof(defaultFolders) / sizeof(defaultFolders[0]); i++)
  {
    String path = resolveExistingDirectory(defaultFolders[i]);
    if (!SD.exists(path))
      SD.mkdir(defaultFolders[i]);
  }

  storageServer.on("/", HTTP_GET, handleIndex);
  storageServer.on("/list", HTTP_GET, handleList);
  storageServer.on("/download", HTTP_GET, handleDownload);
  storageServer.on("/delete", HTTP_POST, handleDelete);
  storageServer.on("/rename", HTTP_POST, handleRename);
  storageServer.on("/mkdir", HTTP_POST, handleMkdir);
  storageServer.on("/upload", HTTP_POST, handleUploadDone, handleUploadData);
  storageServer.enableCORS(true);
  storageServer.begin();
  storageServerRunning = true;

  Serial.print(F("[SDWEB] LULU Storage: http://"));
  Serial.println(WiFi.localIP());
#else
  (void)sdAvailable;
#endif
}

void handleSDFileManager()
{
#if SD_FILE_MANAGER_ENABLED
  if (storageServerRunning)
    storageServer.handleClient();
#endif
}

bool isSDFileManagerRunning()
{
  return storageServerRunning;
}
