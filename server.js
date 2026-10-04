"use strict";

try {
  require("dotenv").config();
} catch {
}

const express = require("express");
const compression = require("compression");
const cors = require("cors");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const zlib = require("zlib");
const { spawn, execFileSync } = require("child_process");

const ytdl = require("@distube/ytdl-core");
const ffmpeg = require("fluent-ffmpeg");
const db = require("./db");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const LOCALES_DIR = path.join(ROOT, "locales");
const CLIPS_DIR = path.join(ROOT, "storage", "clips");
const TMP_DIR = path.join(ROOT, "storage", "tmp");

for (const dir of [CLIPS_DIR, TMP_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  engine: (process.env.MEDIA_ENGINE || "auto").toLowerCase(),
  cacheTtlMs: (Number(process.env.CACHE_TTL_MINUTES) || 60) * 60 * 1000,
  maxClipSeconds: Number(process.env.MAX_CLIP_SECONDS) || 600,
  clipRetentionHours: Number(process.env.CLIP_RETENTION_HOURS) || 24,
  maxPlaylistItems: Number(process.env.MAX_PLAYLIST_ITEMS) || 400,
  maxTranscodeSeconds: Number(process.env.MAX_TRANSCODE_SECONDS) || 900,
  maxGifSeconds: Number(process.env.MAX_GIF_SECONDS) || 30,

  maxSpeechSeconds: Number(process.env.MAX_SPEECH_SECONDS) || 1800,
  studyModel: process.env.STUDY_MODEL || "claude-opus-5",
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  cookiesFile: process.env.COOKIES_FILE || "",
};

const SUPPORTED_LOCALES = ["en", "az", "ru", "tr"];

const RECOGNITION = {
  auddToken: process.env.AUDD_API_TOKEN || "",
  acr:
    process.env.ACR_HOST && process.env.ACR_ACCESS_KEY && process.env.ACR_ACCESS_SECRET
      ? {
          host: process.env.ACR_HOST,
          key: process.env.ACR_ACCESS_KEY,
          secret: process.env.ACR_ACCESS_SECRET,
        }
      : null,
};
const DEFAULT_LOCALE = "en";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/125.0.0.0 Safari/537.36";

function which(binary) {
  try {
    return (
      execFileSync(process.platform === "win32" ? "where" : "which", [binary], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim()
        .split(/\r?\n/)[0] || null
    );
  } catch {
    return null;
  }
}

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH))
    return process.env.FFMPEG_PATH;
  const system = which("ffmpeg");
  if (system) return system;
  try {
    const staticPath = require("ffmpeg-static");
    if (staticPath && fs.existsSync(staticPath)) return staticPath;
  } catch {
  }
  return null;
}

function resolveFfprobe() {
  if (process.env.FFPROBE_PATH && fs.existsSync(process.env.FFPROBE_PATH))
    return process.env.FFPROBE_PATH;
  return which("ffprobe");
}

function ytdlpWorks(candidate) {
  if (!candidate || !fs.existsSync(candidate)) return false;

  try {
    fs.accessSync(candidate, fs.constants.X_OK);
  } catch {
    try {
      fs.chmodSync(candidate, 0o755);
    } catch {
      return false;
    }
  }
  try {
    execFileSync(candidate, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20000,
    });
    return true;
  } catch {
    return false;
  }
}

function resolveYtdlp() {
  const candidates = [
    process.env.YTDLP_PATH,
    path.join(
      ROOT,
      "bin",
      process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
    ),
    which("yt-dlp"),
    which("yt-dlp.exe"),
    path.join(os.homedir(), ".local", "bin", "yt-dlp"),
  ].filter(Boolean);
  return candidates.find(ytdlpWorks) || null;
}

function resolveFont() {
  if (process.env.FONT_FILE && fs.existsSync(process.env.FONT_FILE))
    return process.env.FONT_FILE;
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const BIN = {
  ffmpeg: resolveFfmpeg(),
  ffprobe: resolveFfprobe(),
  ytdlp: resolveYtdlp(),
  font: resolveFont(),
};

let speechCache = null;
function speechEngine() {
  if (speechCache) return speechCache;
  const bin = [
    process.env.WHISPER_BIN,
    path.join(ROOT, "bin", process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"),
    which("whisper-cli"),
  ]
    .filter(Boolean)
    .find((p) => fs.existsSync(p));
  if (!bin) return null;
  try {
    fs.accessSync(bin, fs.constants.X_OK);
  } catch {
    try {
      fs.chmodSync(bin, 0o755);
    } catch {
      return null;
    }
  }

  const modelDir = path.join(ROOT, "models");
  const model = [
    process.env.WHISPER_MODEL_FILE,
    ...["medium", "small", "base", "tiny"].map((m) => path.join(modelDir, `ggml-${m}.bin`)),
  ]
    .filter(Boolean)
    .find((p) => fs.existsSync(p) && fs.statSync(p).size > 10 * 1024 * 1024);
  if (!model) return null;

  const vad = [
    process.env.WHISPER_VAD_MODEL,
    ...(fs.existsSync(modelDir)
      ? fs
          .readdirSync(modelDir)
          .filter((f) => /^ggml-silero.*\.bin$/.test(f))
          .sort()
          .reverse()
          .map((f) => path.join(modelDir, f))
      : []),
  ]
    .filter(Boolean)
    .find((p) => fs.existsSync(p));
  speechCache = { bin, model, vad: vad || null, name: path.basename(model, ".bin").replace(/^ggml-/, "") };
  return speechCache;
}

function isHallucination(text) {
  const compact = text.replace(/\s+/g, "");
  if (!compact) return true;
  const letters = (compact.match(/[\p{L}\p{M}]/gu) || []).length;
  if (letters / compact.length < 0.5) return true;
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 6 && new Set(words).size / words.length < 0.3) return true;
  const bytes = Buffer.byteLength(text);
  if (bytes >= 60 && bytes / zlib.deflateSync(text).length > 2.4) return true;
  return false;
}

let platformCount = null;
let platformCountPending = null;
function countPlatforms() {
  if (platformCount !== null || !BIN.ytdlp) return Promise.resolve(platformCount);

  platformCountPending ||= listExtractors().finally(() => {
    platformCountPending = null;
  });
  return platformCountPending;
}
async function listExtractors() {
  try {
    const out = await run(BIN.ytdlp, ["--list-extractors"], { timeout: 60000 });
    const sites = new Set();
    for (const line of out.split("\n")) {
      if (!line.trim() || /CURRENTLY BROKEN/i.test(line)) continue;
      sites.add(line.split(":")[0].split(" ")[0].trim().toLowerCase());
    }
    platformCount = sites.size;
  } catch (err) {
    warn("could not count yt-dlp extractors:", err.message);
  }
  return platformCount;
}

if (BIN.ffmpeg) ffmpeg.setFfmpegPath(BIN.ffmpeg);
if (BIN.ffprobe) ffmpeg.setFfprobePath(BIN.ffprobe);

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
const warn = (...args) =>
  console.warn(`[${new Date().toISOString()}]`, ...args);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function parseVideoId(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1, 12);
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  if (url.pathname === "/watch") {
    const v = url.searchParams.get("v");
    return v && /^[\w-]{11}$/.test(v) ? v : null;
  }
  const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
  return m ? m[1] : null;
}

function parsePlaylistId(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (/^(?:PL|UU|LL|FL|OL|RD)[\w-]{10,}$/.test(raw)) return raw;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const list = url.searchParams.get("list");

    if (list && /^[\w-]{12,}$/.test(list) && !/^RD/.test(list)) return list;
  } catch {
  }
  return null;
}

function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

const PLATFORMS = [
  {
    id: "youtube",
    domains: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
    label: "YouTube",
    hosts: [
      /^(?:www\.|m\.|music\.)?youtube\.com$/,
      /^youtu\.be$/,
      /^(?:www\.)?youtube-nocookie\.com$/,
    ],
    auth: false,
  },
  {
    id: "facebook",
    domains: ["facebook.com", "fb.watch", "fb.com"],
    label: "Facebook",
    hosts: [/(^|\.)facebook\.com$/, /^fb\.watch$/, /(^|\.)fb\.com$/],
    auth: true,
  },
  {
    id: "ok",
    domains: ["ok.ru", "odnoklassniki.ru"],
    label: "OK.ru",
    hosts: [/(^|\.)ok\.ru$/, /(^|\.)odnoklassniki\.ru$/],
    auth: false,
  },
  {
    id: "twitter",
    domains: ["twitter.com", "x.com"],
    label: "X",
    hosts: [/(^|\.)twitter\.com$/, /(^|\.)x\.com$/],
    auth: true,
  },
  {
    id: "tiktok",
    domains: ["tiktok.com"],
    label: "TikTok",
    hosts: [/(^|\.)tiktok\.com$/],
    auth: false,
  },
  {
    id: "instagram",
    domains: ["instagram.com", "instagr.am"],
    label: "Instagram",
    hosts: [/(^|\.)instagram\.com$/, /(^|\.)instagr\.am$/],
    auth: true,
  },
  {
    id: "twitch",
    domains: ["twitch.tv"],
    label: "Twitch",
    hosts: [/(^|\.)twitch\.tv$/],
    auth: false,
  },
  {
    id: "vk",
    domains: ["vk.com", "vkvideo.ru", "vk.ru"],
    label: "VK",
    hosts: [/(^|\.)vk\.com$/, /(^|\.)vkvideo\.ru$/, /(^|\.)vk\.ru$/],
    auth: false,
  },
];

const EXTRA_SITES = [
  { group: "video", items: ["Vimeo", "Dailymotion", "Rumble", "Odysee", "Streamable", "Kick", "BitChute", "PeerTube", "Niconico", "Bilibili", "Coub", "9GAG"] },
  { group: "social", items: ["Reddit", "Pinterest", "Tumblr", "LinkedIn", "Snapchat", "Telegram", "Weibo", "Douyin", "Bluesky", "Mastodon"] },
  { group: "audio", items: ["SoundCloud", "Bandcamp", "Mixcloud", "Audiomack", "Audius", "Jamendo"] },
  { group: "learning", items: ["TED", "Khan Academy", "MIT OpenCourseWare", "Internet Archive", "C-SPAN"] },
  { group: "news", items: ["BBC", "CNN", "NBC News", "Bloomberg", "Arte", "France 24", "Al Jazeera", "VICE"] },
  { group: "live", items: ["TwitCasting", "Trovo", "AfreecaTV", "Nimo TV"] },
];

function identifySource(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const youtubeId = parseVideoId(raw);
  const playlistId = parsePlaylistId(raw);
  if (youtubeId || playlistId) {
    return {
      platform: "youtube",
      label: "YouTube",
      id: youtubeId,
      playlistId,
      url: youtubeId
        ? watchUrl(youtubeId)
        : `https://www.youtube.com/playlist?list=${playlistId}`,
      isYouTube: true,
      needsAuth: false,
    };
  }

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;

  const host = url.hostname.toLowerCase();
  const known = PLATFORMS.find((p) => p.hosts.some((re) => re.test(host)));
  return {
    platform: known?.id || "generic",
    label: known?.label || host.replace(/^www\./, ""),
    id: null,
    playlistId: null,
    url: url.toString(),
    isYouTube: false,
    needsAuth: !!known?.auth,
  };
}

function mediaKey(source, probe) {
  if (source.isYouTube) return source.id || probe?.id || "";
  const id = probe?.id || crypto.createHash("sha1").update(source.url).digest("hex").slice(0, 16);
  return `${source.platform}:${id}`;
}

const VIDEO_EXTS = new Set([
  "mp4", "webm", "mkv", "mov", "avi", "flv", "ogv", "3gp", "m4v", "ts", "mpg", "mpeg",
]);
const AUDIO_EXTS = new Set([
  "m4a", "mp3", "opus", "ogg", "oga", "aac", "flac", "wav", "weba", "wma",
]);

function inferStreams(f) {
  const videoCodec = f.vcodec && f.vcodec !== "none" ? f.vcodec : "";
  const audioCodec = f.acodec && f.acodec !== "none" ? f.acodec : "";
  const videoKnown = f.vcodec !== undefined && f.vcodec !== null;
  const audioKnown = f.acodec !== undefined && f.acodec !== null;
  const ext = String(f.ext || "").toLowerCase();

  let hasVideo = !!videoCodec;
  let hasAudio = !!audioCodec;

  if (!videoKnown && !audioKnown) {

    if (f.height || f.width || VIDEO_EXTS.has(ext)) {
      hasVideo = true;
      hasAudio = true;
    } else if (AUDIO_EXTS.has(ext) || f.abr) {
      hasAudio = true;
    }
  } else {
    if (!videoKnown && (f.height || VIDEO_EXTS.has(ext))) hasVideo = true;
    if (!audioKnown && (f.abr || AUDIO_EXTS.has(ext))) hasAudio = true;
  }

  return { hasVideo, hasAudio, videoCodec, audioCodec };
}

function vorbisQuality(abr) {
  const points = [
    [64, 0], [80, 1], [96, 2], [112, 3], [128, 4],
    [160, 5], [192, 6], [224, 7], [256, 8], [320, 9],
  ];
  const hit = points.find(([rate]) => abr <= rate);
  return hit ? hit[1] : 10;
}

const AUDIO_TARGETS = {
  mp3: {
    ext: "mp3",
    format: "mp3",
    mime: "audio/mpeg",
    lossless: false,
    args: (abr) => ["-c:a", "libmp3lame", "-b:a", `${abr}k`, "-id3v2_version", "3"],
  },
  aac: {
    ext: "aac",
    format: "adts",
    mime: "audio/aac",
    lossless: false,
    args: (abr) => ["-c:a", "aac", "-b:a", `${abr}k`],
  },
  m4a: {
    ext: "m4a",
    format: "ipod",
    mime: "audio/mp4",
    lossless: false,
    args: (abr) => [
      "-c:a", "aac", "-b:a", `${abr}k`,
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    ],
  },
  alac: {
    ext: "m4a",
    format: "ipod",
    mime: "audio/mp4",
    lossless: true,
    args: () => [
      "-c:a", "alac",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    ],
  },
  flac: {
    ext: "flac",
    format: "flac",
    mime: "audio/flac",
    lossless: true,
    streamable: false,
    args: () => ["-c:a", "flac", "-compression_level", "5"],
  },
  wav: {
    ext: "wav",
    format: "wav",
    mime: "audio/wav",
    lossless: true,
    args: () => ["-c:a", "pcm_s16le"],
  },
  opus: {
    ext: "opus",
    format: "opus",
    mime: "audio/opus",
    lossless: false,
    args: (abr) => ["-c:a", "libopus", "-b:a", `${Math.min(abr, 256)}k`, "-vbr", "on"],
  },
  ogg: {
    ext: "ogg",
    format: "ogg",
    mime: "audio/ogg",
    lossless: false,
    args: (abr) => ["-c:a", "libvorbis", "-q:a", String(vorbisQuality(abr))],
  },
};

const VIDEO_TARGETS = {
  mp4: {
    ext: "mp4",
    format: "mp4",
    mime: "video/mp4",
    vcodec: "libx264",
    acodec: "aac",
    copyVideo: /avc1|h264|hev1|hvc1|mp4v/i,
    copyAudio: /mp4a|aac|mp3/i,
    pipeArgs: ["-movflags", "frag_keyframe+empty_moov+default_base_moof"],
  },
  mkv: {
    ext: "mkv",
    format: "matroska",
    mime: "video/x-matroska",
    vcodec: "libx264",
    acodec: "aac",
    copyVideo: /./,
    copyAudio: /./,
  },
  webm: {
    ext: "webm",
    format: "webm",
    mime: "video/webm",
    vcodec: "libvpx-vp9",
    acodec: "libopus",
    copyVideo: /vp0?[89]|av01/i,
    copyAudio: /opus|vorbis/i,
  },
  mov: {
    ext: "mov",
    format: "mov",
    mime: "video/quicktime",
    vcodec: "libx264",
    acodec: "aac",
    copyVideo: /avc1|h264|hev1|hvc1/i,
    copyAudio: /mp4a|aac/i,
    pipeArgs: ["-movflags", "frag_keyframe+empty_moov+default_base_moof"],
  },
  avi: {
    ext: "avi",
    format: "avi",
    mime: "video/x-msvideo",
    vcodec: "mpeg4",
    acodec: "libmp3lame",
    copyVideo: /mpeg4|divx|xvid/i,
    copyAudio: /mp3/i,
    streamable: false,
  },
  flv: {
    ext: "flv",
    format: "flv",
    mime: "video/x-flv",
    vcodec: "libx264",
    acodec: "aac",
    copyVideo: /avc1|h264/i,
    copyAudio: /mp4a|aac|mp3/i,
  },
};

const GIF_TARGET = { ext: "gif", format: "gif", mime: "image/gif", clipOnly: true };

const CLIP_FORMATS = ["mp4", "webm", "mkv", "mov", "gif"];

const CLIP_ENCODERS = {
  mp4: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high",
        "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart"],
  mov: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high",
        "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart"],
  mkv: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k", "-ac", "2"],
  webm: ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-deadline", "good",
         "-cpu-used", "4", "-row-mt", "1", "-c:a", "libopus", "-b:a", "160k", "-ac", "2"],
};

const TARGET_ALIASES = { vorbis: "ogg" };

function normalizeTarget(requested, kind) {
  const raw = String(requested || "").toLowerCase();
  const id = TARGET_ALIASES[raw] || raw;
  if (!id || id === "original") return null;
  if (id === "gif") return { id, clipOnly: true, ...GIF_TARGET };
  const table = kind === "audio" ? AUDIO_TARGETS : VIDEO_TARGETS;
  const spec = table[id];
  if (!spec) return null;
  return { id, kind, ...spec };
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function formatClock(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function parseClock(value) {
  if (value === null || value === undefined) return NaN;
  const str = String(value).trim();
  if (!str) return NaN;
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str);
  const parts = str.split(":").map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return NaN;
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

function sanitizeFilename(name, fallback = "tubeforge") {
  const cleaned = String(name || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function fetchBuffer(url, headers = {}, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("http://") ? http : https;
    const req = lib.get(
      url,
      { headers: { "user-agent": UA, ...headers } },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirects > 0
        ) {
          res.resume();
          return resolve(
            fetchBuffer(
              new URL(res.headers.location, url).toString(),
              headers,
              redirects - 1,
            ),
          );
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(
            new HttpError(
              502,
              "upstream",
              `Upstream responded ${res.statusCode}`,
            ),
          );
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      },
    );
    req.setTimeout(30000, () =>
      req.destroy(new HttpError(504, "timeout", "Upstream timed out")),
    );
    req.on("error", reject);
  });
}

const fetchText = async (url, headers) =>
  (await fetchBuffer(url, headers)).toString("utf8");

function run(
  binary,
  args,
  { timeout = 120000, maxBuffer = 64 * 1024 * 1024 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let size = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (d) => {
      size += d.length;
      if (size <= maxBuffer) out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString().slice(0, 8000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else
        reject(
          new Error(
            err.trim() || `${path.basename(binary)} exited with code ${code}`,
          ),
        );
    });
  });
}

let ytdlAgent = null;
if (
  CONFIG.cookiesFile &&
  fs.existsSync(CONFIG.cookiesFile) &&
  CONFIG.cookiesFile.endsWith(".json")
) {
  try {
    ytdlAgent = ytdl.createAgent(
      JSON.parse(fs.readFileSync(CONFIG.cookiesFile, "utf8")),
    );
    log("Loaded cookies for ytdl-core from", CONFIG.cookiesFile);
  } catch (err) {
    warn("Could not load cookie file:", err.message);
  }
}

const ytdlOptions = () => (ytdlAgent ? { agent: ytdlAgent } : {});

const AUDIO_TIERS = [
  { abr: 320, label: "320 kbps", tier: "high" },
  { abr: 256, label: "256 kbps", tier: "medium" },
  { abr: 128, label: "128 kbps", tier: "standard" },
];

const VIDEO_LADDER = [2160, 1440, 1080, 720, 480, 360, 240, 144];

function qualityLabelFor(height) {
  if (!height) return "";
  if (height >= 2160) return "2160p";
  if (height >= 1440) return "1440p";
  return `${height}p`;
}

function shortCodec(codecString) {
  const c = String(codecString || "").toLowerCase();
  if (c.includes("av01")) return "AV1";
  if (c.includes("vp9") || c.includes("vp09")) return "VP9";
  if (c.includes("vp8")) return "VP8";
  if (c.includes("avc1") || c.includes("h264")) return "H.264";
  if (c.includes("hev1") || c.includes("hvc1")) return "HEVC";
  if (c.includes("mp4a")) return "AAC";
  if (c.includes("opus")) return "Opus";
  if (c.includes("vorbis")) return "Vorbis";
  if (c.includes("ec-3") || c.includes("ac-3")) return "AC3";
  return codecString ? String(codecString).split(".")[0].toUpperCase() : "";
}

function compareAudio(a, b) {
  return (
    (a.drc ? 1 : 0) - (b.drc ? 1 : 0) ||
    (b.audioBitrate || 0) - (a.audioBitrate || 0)
  );
}

function estimateBytes(bitrateBitsPerSecond, durationSeconds) {
  if (!bitrateBitsPerSecond || !durationSeconds) return 0;
  return Math.round((bitrateBitsPerSecond * durationSeconds) / 8);
}

async function probeWithYtdl(videoId) {
  const info = await ytdl.getInfo(watchUrl(videoId), ytdlOptions());
  const d = info.videoDetails;
  const duration = Number(d.lengthSeconds) || 0;

  const formats = (info.formats || []).map((f) => ({
    itag: String(f.itag),
    url: f.url,
    container:
      f.container || (f.mimeType || "").split("/")[1]?.split(";")[0] || "",
    hasVideo: !!f.hasVideo,
    hasAudio: !!f.hasAudio,
    height: Number(f.height) || 0,
    width: Number(f.width) || 0,
    fps: Number(f.fps) || 0,
    bitrate: Number(f.bitrate) || 0,
    audioBitrate: Number(f.audioBitrate) || 0,
    contentLength: Number(f.contentLength) || 0,
    videoCodec: f.codecs && f.hasVideo ? f.codecs.split(",")[0].trim() : "",
    audioCodec: f.codecs && f.hasAudio ? f.codecs.split(",").pop().trim() : "",
    headers: { "user-agent": UA },
  }));

  const tracks =
    info.player_response?.captions?.playerCaptionsTracklistRenderer
      ?.captionTracks || [];

  const chapters = (info.videoDetails.chapters || []).map((c) => ({
    start: Math.round(Number(c.start_time) || 0),
    title: decodeEntities(c.title || ""),
  }));

  return {
    engine: "ytdl",
    id: videoId,
    title: decodeEntities(d.title || ""),
    description: d.description || "",
    channel: decodeEntities(d.author?.name || d.ownerChannelName || ""),
    channelUrl: d.author?.channel_url || "",
    channelAvatar: d.author?.thumbnails?.slice(-1)[0]?.url || "",
    duration,
    viewCount: Number(d.viewCount) || 0,
    likes: Number(d.likes) || 0,
    uploadDate: d.publishDate || d.uploadDate || "",
    isLive: !!d.isLiveContent && !duration,
    thumbnails: (d.thumbnails || []).map((t) => ({
      url: t.url,
      width: t.width,
      height: t.height,
    })),
    captions: tracks.map((t) => ({
      lang: t.languageCode,
      name: decodeEntities(
        t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
      ),
      isAuto: t.kind === "asr",
      url: t.baseUrl,
    })),
    chapters,
    formats,
  };
}

function ytdlpBaseArgs({ playlist = false } = {}) {
  const args = ["--no-warnings", "--no-progress", "--user-agent", UA];
  if (!playlist) args.push("--no-playlist");
  if (CONFIG.cookiesFile && fs.existsSync(CONFIG.cookiesFile)) {
    args.push("--cookies", CONFIG.cookiesFile);
  }
  return args;
}

async function probeWithYtdlp(target) {
  if (!BIN.ytdlp)
    throw new HttpError(
      503,
      "engineMissing",
      "yt-dlp is not installed on this server",
    );

  const url = /^https?:\/\//i.test(target) ? target : watchUrl(target);
  const stdout = await run(BIN.ytdlp, [...ytdlpBaseArgs(), "-J", url], {
    timeout: 120000,
  });
  const j = JSON.parse(stdout);

  const formats = (j.formats || [])
    .filter((f) => f.url && f.protocol && !String(f.protocol).includes("m3u8"))
    .map((f) => ({
      itag: String(f.format_id),
      url: f.url,
      container: f.ext || "",
      ...inferStreams(f),
      note: f.format_note || f.resolution || "",
      height: Number(f.height) || 0,
      width: Number(f.width) || 0,
      fps: Math.round(Number(f.fps) || 0),
      bitrate: Math.round((Number(f.tbr) || 0) * 1000),
      audioBitrate: Math.round(Number(f.abr) || 0),
      contentLength: Number(f.filesize || f.filesize_approx) || 0,

      exactSize: Number(f.filesize) || 0,
      chunkSize: Number(f.downloader_options?.http_chunk_size) || 0,

      drc: /-drc$/i.test(String(f.format_id)) || f.format_note === "DRC",
      headers: f.http_headers || { "user-agent": UA },
    }));

  const captions = [];
  for (const [lang, list] of Object.entries(j.subtitles || {})) {
    const pick = list.find((t) => t.ext === "json3") || list[0];
    if (pick)
      captions.push({
        lang,
        name: pick.name || lang,
        isAuto: false,
        url: pick.url,
      });
  }
  for (const [lang, list] of Object.entries(j.automatic_captions || {})) {
    if (captions.some((c) => c.lang === lang)) continue;
    const pick = list.find((t) => t.ext === "json3") || list[0];
    if (pick)
      captions.push({
        lang,
        name: pick.name || lang,
        isAuto: true,
        url: pick.url,
      });
  }

  return {
    engine: "ytdlp",
    id: String(j.id || target),
    webpageUrl: j.webpage_url || url,
    extractor: j.extractor_key || j.extractor || "",
    title: j.title || "",
    description: j.description || "",
    channel: j.uploader || j.channel || "",
    channelUrl: j.channel_url || j.uploader_url || "",
    channelAvatar: "",
    duration: Number(j.duration) || 0,
    viewCount: Number(j.view_count) || 0,
    likes: Number(j.like_count) || 0,
    uploadDate: j.upload_date
      ? `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}`
      : "",
    isLive: !!j.is_live,
    thumbnails: (j.thumbnails || []).map((t) => ({
      url: t.url,
      width: t.width,
      height: t.height,
    })),
    captions,
    chapters: (j.chapters || []).map((c) => ({
      start: Math.round(Number(c.start_time) || 0),
      title: c.title || "",
    })),
    formats,
  };
}

const ENGINE_FAIL_LIMIT = 3;
const ENGINE_COOLDOWN_MS = 10 * 60 * 1000;
const engineHealth = {
  ytdl: { failures: 0, parkedUntil: 0 },
  ytdlp: { failures: 0, parkedUntil: 0 },
};

function engineAvailable(engine) {
  return Date.now() >= (engineHealth[engine]?.parkedUntil || 0);
}

function noteEngineResult(engine, ok) {
  const health = engineHealth[engine];
  if (!health) return;
  if (ok) {
    health.failures = 0;
    health.parkedUntil = 0;
    return;
  }
  health.failures += 1;
  if (health.failures >= ENGINE_FAIL_LIMIT) {
    health.parkedUntil = Date.now() + ENGINE_COOLDOWN_MS;
    health.failures = 0;
    warn(
      `engine "${engine}" parked for ${ENGINE_COOLDOWN_MS / 60000} minutes after repeated failures`,
    );
  }
}

async function sweepEngineDebris() {
  try {
    for (const name of await fsp.readdir(ROOT)) {
      if (/^\d+-player-script\.js$/.test(name))
        await fsp.rm(path.join(ROOT, name), { force: true });
    }
  } catch {
  }
}

async function probeVideo(videoId) {
  const configured =
    CONFIG.engine === "ytdl"
      ? ["ytdl"]
      : CONFIG.engine === "ytdlp"
        ? ["ytdlp"]
        : ["ytdl", "ytdlp"];

  const order = [...configured].sort(
    (a, b) => Number(engineAvailable(b)) - Number(engineAvailable(a)),
  );

  let lastError = null;
  for (const engine of order) {
    try {
      const probe =
        engine === "ytdl"
          ? await probeWithYtdl(videoId)
          : await probeWithYtdlp(watchUrl(videoId));
      if (!probe.formats.length) throw new Error("engine returned no formats");
      noteEngineResult(engine, true);
      return probe;
    } catch (err) {
      lastError = err;
      noteEngineResult(engine, false);
      warn(`engine "${engine}" failed for ${videoId}: ${err.message}`);
      if (engine === "ytdl") sweepEngineDebris();
    }
  }
  throw translateEngineError(lastError);
}

function translateEngineError(err, source) {
  const msg = String(err?.message || err || "").toLowerCase();
  const site = source?.label ? `${source.label}: ` : "";

  if (
    msg.includes("confirm you're not a bot") ||
    msg.includes("confirm you are not a bot") ||
    msg.includes("cookies") ||
    msg.includes("captcha")
  ) {
    return new HttpError(
      403,
      "needsCookies",
      `${site}the site wants proof this server is not a bot`,
    );
  }
  if (
    msg.includes("log in") ||
    msg.includes("logged in") ||
    msg.includes("login required") ||
    msg.includes("logging in") ||
    msg.includes("sign in") ||
    msg.includes("authentication") ||
    msg.includes("account") ||
    msg.includes("empty media response")
  ) {
    return new HttpError(
      403,
      "authRequired",
      `${site}this post needs a signed-in account`,
    );
  }
  if (
    msg.includes("unsupported url") ||
    msg.includes("no suitable extractor") ||
    msg.includes("is not a valid url")
  ) {
    return new HttpError(
      422,
      "unsupportedSite",
      "The extraction engine does not support that site",
    );
  }
  if (
    msg.includes("geo") ||
    msg.includes("not available in your country") ||
    msg.includes("blocked it in your country") ||
    msg.includes("region")
  ) {
    return new HttpError(
      451,
      "geoBlocked",
      `${site}blocked in this server's region`,
    );
  }
  if (/\b403\b/.test(msg) || msg.includes("forbidden")) {
    return new HttpError(403, "blocked", `${site}the site refused this server (HTTP 403)`);
  }
  if (msg.includes("private"))
    return new HttpError(403, "private", `${site}this media is private`);
  if (msg.includes("age") && msg.includes("restrict"))
    return new HttpError(403, "private", `${site}age restricted`);
  if (
    msg.includes("429") ||
    msg.includes("too many requests") ||
    msg.includes("rate-limit") ||
    msg.includes("rate limit")
  ) {
    return new HttpError(429, "rateLimited", `${site}rate-limiting this server`);
  }
  if (msg.includes("unavailable") || msg.includes("not available")) {
    return new HttpError(404, "unavailable", `${site}this media is unavailable`);
  }
  if (
    msg.includes("no longer exists") ||
    msg.includes("not exist") ||
    msg.includes("not found") ||
    msg.includes("404")
  ) {
    return new HttpError(404, "notFound", `${site}media not found`);
  }
  if (msg.includes("is live") || msg.includes("live stream")) {
    return new HttpError(422, "live", "Live streams are not supported");
  }
  return new HttpError(502, "generic", err?.message || "Media engine failed");
}

function buildFormatCatalogue(probe) {
  const duration = probe.duration || 0;
  const all = probe.formats;

  const audioOnly = all.filter((f) => f.hasAudio && !f.hasVideo);
  const bestAudio =
    audioOnly.slice().sort(compareAudio)[0] ||
    all.find((f) => f.hasAudio) ||
    null;
  const bestAudioBytes = bestAudio
    ? bestAudio.contentLength ||
      estimateBytes(bestAudio.audioBitrate * 1000, duration)
    : 0;

  const byHeight = new Map();
  const heightless = [];
  for (const f of all) {
    if (!f.hasVideo) continue;
    if (!f.height) {
      heightless.push(f);
      continue;
    }
    const height = VIDEO_LADDER.find((h) => f.height >= h - 20) || f.height;
    const existing = byHeight.get(height);

    const score =
      (f.hasAudio ? 2_000_000_000 : 0) +
      (f.bitrate || 0) +
      (f.container === "mp4" ? 50_000 : 0);
    if (!existing || score > existing.score)
      byHeight.set(height, { format: f, score });
  }

  if (!byHeight.size) {
    for (const f of heightless) {
      byHeight.set(`x:${f.itag}`, {
        format: f,
        score: 0,
        label: f.note || f.container,
      });
    }
  }

  const video = [...byHeight.entries()]
    .sort((a, b) => (Number(b[0]) || 0) - (Number(a[0]) || 0))
    .map(([height, { format, label }]) => {
      const needsMerge = !format.hasAudio;
      const own =
        format.contentLength || estimateBytes(format.bitrate, duration);
      const size = needsMerge ? own + bestAudioBytes : own;
      return {
        key: `v:${format.itag}`,
        itag: format.itag,
        kind: "video",
        height: Number(height) || 0,
        qualityLabel:
          qualityLabelFor(Number(height) || 0) ||
          label ||
          (format.container || "video").toUpperCase(),
        container: needsMerge
          ? mergeContainerFor(format.videoCodec)
          : format.container || "mp4",
        sourceContainer: format.container || "",
        fps: format.fps || 0,
        codec: shortCodec(format.videoCodec),
        audioCodec: shortCodec(
          needsMerge ? bestAudio?.audioCodec : format.audioCodec,
        ),
        bitrate: format.bitrate || 0,
        size,
        sizeLabel: formatBytes(size),
        estimated: !format.contentLength,
        needsMerge,
        hdr: /pq|hlg|hdr/i.test(format.videoCodec || ""),
        audioItag: needsMerge ? bestAudio?.itag || "" : "",
      };
    })

    .filter((f) => f.height === 0 || f.height >= 144);

  const audio = [];
  const seenNative = new Set();
  for (const f of audioOnly.slice().sort(compareAudio)) {
    const container = f.container === "mp4" ? "m4a" : f.container || "webm";
    if (seenNative.has(container)) continue;
    seenNative.add(container);
    const size =
      f.contentLength || estimateBytes(f.audioBitrate * 1000, duration);
    audio.push({
      key: `a:${f.itag}`,
      itag: f.itag,
      kind: "audio",
      container,
      transcode: false,
      qualityLabel: `${Math.round(f.audioBitrate)} kbps`,
      abr: Math.round(f.audioBitrate),
      codec: shortCodec(f.audioCodec),
      size,
      sizeLabel: formatBytes(size),
      estimated: !f.contentLength,
      needsMerge: false,
    });
  }

  if (bestAudio) {
    for (const tier of AUDIO_TIERS) {
      const size = estimateBytes(tier.abr * 1000, duration);
      audio.push({
        key: `mp3:${tier.abr}`,
        itag: bestAudio.itag,
        kind: "audio",
        container: "mp3",
        transcode: true,
        abr: tier.abr,
        sourceAbr: Math.round(bestAudio.audioBitrate || 0),
        qualityLabel: tier.label,
        codec: "MP3",
        size,
        sizeLabel: formatBytes(size),
        estimated: true,
        needsMerge: false,
      });
    }
  }

  audio.sort(
    (a, b) =>
      (b.abr || 0) - (a.abr || 0) || a.container.localeCompare(b.container),
  );
  return { video, audio };
}

function publicVideoPayload(probe, source) {
  const thumbs = probe.thumbnails || [];
  const best = thumbs
    .slice()
    .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  const isYouTube = source ? source.isYouTube : true;
  return {
    id: probe.id,
    key: source ? mediaKey(source, probe) : probe.id,
    platform: source?.platform || "youtube",
    platformLabel: source?.label || "YouTube",
    sourceUrl: source?.url || watchUrl(probe.id),
    url: isYouTube ? watchUrl(probe.id) : probe.webpageUrl || source?.url || "",
    title: probe.title,
    channel: probe.channel,
    channelUrl: probe.channelUrl,
    channelAvatar: probe.channelAvatar,
    duration: probe.duration,
    durationLabel: formatClock(probe.duration),
    viewCount: probe.viewCount,
    likes: probe.likes,
    uploadDate: probe.uploadDate,
    isLive: probe.isLive,
    engine: probe.engine,
    thumbnail:
      best?.url ||
      (isYouTube ? `https://i.ytimg.com/vi/${probe.id}/maxresdefault.jpg` : ""),
    description: (probe.description || "").slice(0, 5000),
    chapters: probe.chapters || [],
    captions: (probe.captions || []).map(({ lang, name, isAuto }) => ({
      lang,
      name,
      isAuto,
    })),
    hasCaptions: (probe.captions || []).length > 0,
    formats: buildFormatCatalogue(probe),
  };
}

async function probeMedia(source) {
  if (source.isYouTube) return probeVideo(source.id);
  if (!BIN.ytdlp) {
    throw new HttpError(
      503,
      "engineMissing",
      "yt-dlp is required for this platform but is not installed",
    );
  }
  try {
    const probe = await probeWithYtdlp(source.url);
    if (!probe.formats.length) throw new Error("engine returned no formats");
    return probe;
  } catch (err) {
    warn(`engine "ytdlp" failed for ${source.url}: ${err.message}`);
    throw translateEngineError(err, source);
  }
}

async function getMedia(source, { fresh = false } = {}) {
  const cacheKey = source.isYouTube
    ? `video:${source.id}`
    : `media:${source.platform}:${source.url}`;
  if (!fresh) {
    const hit = db.cacheGet(cacheKey);
    if (hit) return hit;
  }
  const probe = await probeMedia(source);
  if (probe.isLive)
    throw new HttpError(422, "live", "Live streams are not supported");
  const payload = publicVideoPayload(probe, source);

  db.cacheSet(cacheKey, payload, CONFIG.cacheTtlMs);
  return payload;
}

function sliceBalancedJson(source, from) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  return null;
}

function extractInitialData(html) {
  const markers = [
    "var ytInitialData = ",
    'window["ytInitialData"] = ',
    "ytInitialData = ",
  ];
  for (const marker of markers) {
    const at = html.indexOf(marker);
    if (at === -1) continue;
    const start = html.indexOf("{", at + marker.length);
    const json = start === -1 ? null : sliceBalancedJson(html, start);
    if (!json) continue;
    try {
      return JSON.parse(json);
    } catch {
    }
  }
  return null;
}

function collectByKey(node, key, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectByKey(item, key, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === key) out.push(v);
    else collectByKey(v, key, out);
  }
  return out;
}

function runsToText(node) {
  if (!node) return "";
  if (typeof node === "string") return decodeEntities(node);
  if (node.simpleText) return decodeEntities(node.simpleText);
  if (Array.isArray(node.runs))
    return decodeEntities(node.runs.map((r) => r.text).join(""));
  return "";
}

function mapPlaylistItem(renderer) {
  const id = renderer.videoId;
  if (!id) return null;
  const seconds =
    Number(renderer.lengthSeconds) ||
    parseClock(runsToText(renderer.lengthText)) ||
    0;
  return {
    id,
    url: watchUrl(id),
    index: Number(renderer.index?.simpleText) || 0,
    title: runsToText(renderer.title) || "Untitled",
    channel:
      runsToText(renderer.shortBylineText) ||
      runsToText(renderer.ownerText) ||
      "",
    duration: Number.isFinite(seconds) ? seconds : 0,
    durationLabel: formatClock(Number.isFinite(seconds) ? seconds : 0),
    thumbnail:
      renderer.thumbnail?.thumbnails?.slice(-1)[0]?.url ||
      `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    available: renderer.isPlayable !== false,
  };
}

function mapLockupItem(lockup) {
  if (!lockup || lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO")
    return null;
  const id = lockup.contentId;
  if (!id || !/^[\w-]{11}$/.test(id)) return null;

  const meta = lockup.metadata?.lockupMetadataViewModel || {};
  const thumb = lockup.contentImage?.thumbnailViewModel || {};
  const sources = thumb.image?.sources || [];

  let seconds = 0;
  for (const overlay of thumb.overlays || []) {
    for (const badge of overlay.thumbnailBottomOverlayViewModel?.badges || []) {
      const text = badge.thumbnailBadgeViewModel?.text;
      const parsed = parseClock(text);
      if (Number.isFinite(parsed) && parsed > 0) seconds = parsed;
    }
  }

  const rows = meta.metadata?.contentMetadataViewModel?.metadataRows || [];
  const channel =
    rows
      .flatMap((row) => row.metadataParts || [])
      .map((part) => part.text?.content)
      .find((text) => text && !/^\d|views?$|ago$/i.test(text)) || "";

  return {
    id,
    url: watchUrl(id),
    index: 0,
    title: decodeEntities(meta.title?.content || "Untitled"),
    channel: decodeEntities(channel),
    duration: seconds,
    durationLabel: formatClock(seconds),
    thumbnail:
      sources[sources.length - 1]?.url ||
      `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    available: true,
  };
}

async function fetchPlaylistContinuation(token, apiKey, context) {
  const body = JSON.stringify({ context, continuation: token });
  const options = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": UA,
      "x-youtube-client-name": "1",
      "x-youtube-client-version":
        context?.client?.clientVersion || "2.20240101.00.00",
    },
  };
  const url = `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`;
  const payload = await new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (err) {
          reject(err);
        }
      });
      res.on("error", reject);
    });
    req.setTimeout(20000, () =>
      req.destroy(new Error("continuation timed out")),
    );
    req.on("error", reject);
    req.end(body);
  });
  return payload;
}

async function getPlaylistViaYtdlp(playlistId) {
  if (!BIN.ytdlp)
    throw new HttpError(
      503,
      "engineMissing",
      "yt-dlp is not installed on this server",
    );
  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
  const stdout = await run(
    BIN.ytdlp,
    [
      ...ytdlpBaseArgs({ playlist: true }),
      "--flat-playlist",
      "--playlist-end",
      String(CONFIG.maxPlaylistItems),
      "-J",
      url,
    ],
    { timeout: 240000, maxBuffer: 192 * 1024 * 1024 },
  );

  const j = JSON.parse(stdout);
  const entries = (j.entries || []).filter(
    (e) => e && e.id && /^[\w-]{11}$/.test(e.id),
  );
  if (!entries.length)
    throw new HttpError(
      404,
      "notFound",
      "Playlist contains no playable videos",
    );

  const videos = entries.map((e, i) => {
    const seconds = Math.round(Number(e.duration) || 0);
    const thumbs = e.thumbnails || [];
    return {
      id: e.id,
      url: watchUrl(e.id),
      index: i + 1,
      title: e.title || "Untitled",
      channel: e.channel || e.uploader || j.channel || "",
      duration: seconds,
      durationLabel: formatClock(seconds),
      thumbnail:
        thumbs[thumbs.length - 1]?.url ||
        `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
      available:
        e.live_status !== "is_upcoming" && e.availability !== "private",
    };
  });

  const totalSeconds = videos.reduce((sum, v) => sum + v.duration, 0);
  const total = Number(j.playlist_count) || videos.length;
  const thumbs = j.thumbnails || [];

  return {
    id: playlistId,
    url: j.webpage_url || url,
    title: j.title || "Playlist",
    channel: j.channel || j.uploader || videos[0]?.channel || "",
    description: (j.description || "").slice(0, 2000),
    thumbnail: thumbs[thumbs.length - 1]?.url || videos[0]?.thumbnail || "",
    count: videos.length,
    totalAvailable: total,
    truncated: videos.length < total,
    totalDuration: totalSeconds,
    totalDurationLabel: formatClock(totalSeconds),
    videos,
    engine: "ytdlp",
  };
}

async function getPlaylistViaHtml(playlistId) {
  const html = await fetchText(
    `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`,
    { "accept-language": "en-US,en;q=0.9" },
  );
  const data = extractInitialData(html);
  if (!data)
    throw new HttpError(502, "generic", "Could not read the playlist page");

  if (
    collectByKey(data, "alerts")
      .flat()
      .some((a) => /does not exist|private/i.test(JSON.stringify(a)))
  ) {
    throw new HttpError(404, "notFound", "Playlist is unavailable");
  }

  const apiKey = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
  const clientVersion =
    (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] ||
    "2.20240101.00.00";
  const context = {
    client: { clientName: "WEB", clientVersion, hl: "en", gl: "US" },
  };

  const items = [];
  const seen = new Set();
  const absorb = (tree) => {
    const push = (item) => {
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    };
    for (const renderer of collectByKey(tree, "playlistVideoRenderer"))
      push(mapPlaylistItem(renderer));
    for (const lockup of collectByKey(tree, "lockupViewModel"))
      push(mapLockupItem(lockup));
    const tokens = collectByKey(tree, "continuationItemRenderer")
      .map((c) => c?.continuationEndpoint?.continuationCommand?.token)
      .filter(Boolean);
    return tokens[tokens.length - 1] || null;
  };

  let token = absorb(data);
  let guard = 0;
  while (
    token &&
    apiKey &&
    items.length < CONFIG.maxPlaylistItems &&
    guard < 20
  ) {
    guard += 1;
    try {
      const next = await fetchPlaylistContinuation(token, apiKey, context);
      const nextToken = absorb(next);
      if (nextToken === token) break;
      token = nextToken;
    } catch (err) {
      warn("playlist continuation stopped:", err.message);
      break;
    }
  }

  if (!items.length)
    throw new HttpError(
      404,
      "notFound",
      "Playlist contains no playable videos",
    );
  items.forEach((item, i) => {
    item.index = i + 1;
  });

  const header =
    collectByKey(data, "playlistHeaderRenderer")[0] ||
    collectByKey(data, "pageHeaderRenderer")[0] ||
    {};
  const microformat = collectByKey(data, "microformatDataRenderer")[0] || {};
  const pageHeader = collectByKey(data, "pageHeaderViewModel")[0] || {};
  const headerTitle =
    pageHeader.title?.dynamicTextViewModel?.text?.content || "";
  const headerOwner =
    collectByKey(pageHeader, "attributionViewModel")
      .flatMap((a) => a.suffix?.content || a.text?.content || [])
      .find(Boolean) || "";
  const totalSeconds = items.reduce((sum, v) => sum + (v.duration || 0), 0);

  return {
    id: playlistId,
    url: `https://www.youtube.com/playlist?list=${playlistId}`,
    engine: "html",
    title:
      runsToText(header.title) ||
      headerTitle ||
      microformat.title ||
      "Playlist",
    channel:
      runsToText(header.ownerText) ||
      runsToText(header.subtitle) ||
      headerOwner ||
      items[0]?.channel ||
      "",
    description:
      runsToText(header.descriptionText) || microformat.description || "",
    thumbnail:
      header.playlistHeaderBanner?.heroPlaylistThumbnailRenderer?.thumbnail?.thumbnails?.slice(
        -1,
      )[0]?.url ||
      microformat.thumbnail?.thumbnails?.slice(-1)[0]?.url ||
      items[0]?.thumbnail ||
      "",
    count: items.length,
    totalAvailable: items.length,
    truncated: items.length >= CONFIG.maxPlaylistItems,
    totalDuration: totalSeconds,
    totalDurationLabel: formatClock(totalSeconds),
    videos: items,
  };
}

async function getPlaylist(playlistId) {
  const cacheKey = `playlist:${playlistId}`;
  const hit = db.cacheGet(cacheKey);
  if (hit) return hit;

  const order =
    CONFIG.engine === "ytdl"
      ? ["html"]
      : CONFIG.engine === "ytdlp"
        ? ["ytdlp"]
        : ["ytdlp", "html"];

  let lastError = null;
  for (const engine of order) {
    try {
      const payload =
        engine === "ytdlp"
          ? await getPlaylistViaYtdlp(playlistId)
          : await getPlaylistViaHtml(playlistId);
      db.cacheSet(cacheKey, payload, CONFIG.cacheTtlMs);
      return payload;
    } catch (err) {
      lastError = err;
      warn(
        `playlist engine "${engine}" failed for ${playlistId}: ${err.message}`,
      );
    }
  }
  throw lastError instanceof HttpError
    ? lastError
    : translateEngineError(lastError);
}

function parseJson3(raw) {
  const data = JSON.parse(raw);
  return (data.events || [])
    .filter((e) => Array.isArray(e.segs))
    .map((e) => ({
      start: (e.tStartMs || 0) / 1000,
      dur: (e.dDurationMs || 0) / 1000,
      text: e.segs
        .map((s) => s.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((e) => e.text && e.text !== "\n");
}

function parseTimedTextXml(raw) {
  const out = [];
  const re =
    /<text[^>]*start="([\d.]+)"[^>]*?(?:dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(raw))) {
    const text = decodeEntities(m[3].replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push({ start: Number(m[1]), dur: Number(m[2] || 0), text });
  }
  return out;
}

function parseVtt(raw) {
  const out = [];
  const blocks = raw.replace(/\r/g, "").split("\n\n");
  const toSeconds = (stamp) => {
    const parts = stamp.trim().split(":").map(Number);
    return parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1];
  };
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const timing = lines.find((l) => l.includes("-->"));
    if (!timing) continue;
    const [from, to] = timing.split("-->").map((s) => s.trim().split(" ")[0]);
    const text = lines
      .slice(lines.indexOf(timing) + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const start = toSeconds(from);
    out.push({ start, dur: Math.max(0, toSeconds(to) - start), text });
  }
  return out;
}

function parseCaptionPayload(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      return parseJson3(trimmed);
    } catch {
    }
  }
  if (trimmed.startsWith("WEBVTT")) return parseVtt(trimmed);
  if (trimmed.startsWith("<")) return parseTimedTextXml(trimmed);
  return [];
}

function dedupeSegments(segments) {
  const out = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (prev && (prev.text === seg.text || seg.text.startsWith(prev.text))) {
      prev.text = seg.text;
      prev.dur = Math.max(prev.dur, seg.start + seg.dur - prev.start);
      continue;
    }
    out.push({ ...seg });
  }
  return out;
}

function pickCaptionTrack(tracks, wanted) {
  if (!tracks.length) return null;
  const exact = tracks.find((t) => t.lang === wanted && !t.isAuto);
  if (exact) return exact;
  const exactAuto = tracks.find((t) => t.lang === wanted);
  if (exactAuto) return exactAuto;
  const prefix = tracks.find(
    (t) => t.lang.split("-")[0] === String(wanted).split("-")[0],
  );
  if (prefix) return prefix;
  const manualEnglish = tracks.find(
    (t) => t.lang.startsWith("en") && !t.isAuto,
  );
  return manualEnglish || tracks.find((t) => !t.isAuto) || tracks[0];
}

class TranscriptionPending extends Error {
  constructor(job) {
    super("transcribing");
    this.job = job;
  }
}

const speechJobs = new Map();

async function runSpeechJob(job, probe, videoId) {
  const engine = speechEngine();
  const dir = await fsp.mkdtemp(path.join(TMP_DIR, "stt-"));
  try {
    const audio =
      probe.formats
        .filter((f) => f.hasAudio && !f.hasVideo && !/m3u8/.test(f.url || ""))
        .sort(compareAudio)[0] ||
      probe.formats
        .filter((f) => f.hasAudio && !/m3u8/.test(f.url || ""))
        .sort((a, b) => (a.height || 0) - (b.height || 0))[0];
    if (!audio) throw new HttpError(422, "speechFailed", "No audio stream to transcribe");

    const duration = probe.duration || CONFIG.maxSpeechSeconds;
    const limit = Math.min(duration, CONFIG.maxSpeechSeconds);
    job.truncated = duration > CONFIG.maxSpeechSeconds;

    job.stage = "downloading";
    const wav = path.join(dir, "audio.wav");
    await new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(audio.url)
        .inputOptions(HTTP_INPUT_OPTIONS)
        .outputOptions(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-t", String(limit)])
        .on("progress", (p) => {
          const done = parseClock(p.timemark);
          if (Number.isFinite(done) && limit) {
            job.progress = Math.min(30, Math.round((done / limit) * 30));
          }
        })
        .on("error", (err) =>
          reject(new HttpError(502, "speechFailed", `Could not fetch the audio: ${err.message}`)),
        )
        .on("end", resolve);
      job.kill = () => command.kill("SIGKILL");
      command.save(wav);
    });

    job.stage = "transcribing";
    job.progress = Math.max(job.progress, 30);
    const outBase = path.join(dir, "transcript");
    const threads = Math.max(2, os.cpus().length - 2);
    const args = ["-m", engine.model, "-f", wav, "-l", "auto", "-t", String(threads), "-oj", "-of", outBase, "-pp", "-np"];
    if (engine.vad) args.push("--vad", "-vm", engine.vad);
    await new Promise((resolve, reject) => {
      const child = spawn(engine.bin, args, { stdio: ["ignore", "ignore", "pipe"] });
      job.kill = () => child.kill("SIGKILL");
      let tail = "";
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        tail = (tail + text).slice(-2000);
        const hits = [...text.matchAll(/progress\s*=\s*(\d+)%/g)];
        if (hits.length) job.progress = 30 + Math.round(Number(hits[hits.length - 1][1]) * 0.69);
      });
      child.on("error", (err) => reject(new HttpError(500, "speechFailed", err.message)));
      child.on("close", (code) => {
        if (code === 0) return resolve();
        const last = tail.trim().split("\n").filter(Boolean).pop() || "";
        reject(new HttpError(500, "speechFailed", `whisper exited with ${code}${last ? `: ${last}` : ""}`));
      });
    });

    const json = JSON.parse(await fsp.readFile(`${outBase}.json`, "utf8"));
    const segments = (json.transcription || [])
      .map((t) => ({
        start: (t.offsets?.from || 0) / 1000,
        dur: Math.max(0, ((t.offsets?.to || 0) - (t.offsets?.from || 0)) / 1000),
        text: String(t.text || "").trim(),
      }))

      .filter((seg) => seg.text && !/^[[(].*[\])]$/.test(seg.text) && !isHallucination(seg.text));
    if (!segments.length) {
      throw new HttpError(422, "noSpeech", "No speech was detected in the audio");
    }

    const lang = json.result?.language || "und";
    const cleaned = dedupeSegments(segments).map((seg) => ({
      start: Math.round(seg.start * 100) / 100,
      dur: Math.round(seg.dur * 100) / 100,
      text: seg.text,
      label: formatClock(seg.start),
    }));
    db.writeTranscript({
      videoId,
      lang,
      isAuto: true,
      source: "whisper",
      segments: cleaned,
      plainText: cleaned.map((seg) => seg.text).join(" ").replace(/\s+/g, " ").trim(),
    });
    log(`speech: transcribed ${videoId} (${lang}, ${cleaned.length} segments, model ${engine.name})`);
  } finally {
    job.kill = null;
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function speechFallback(probe, videoId) {
  if (!speechEngine()) {
    throw new HttpError(
      404,
      "noCaptions",
      "This media has no caption track, and local speech-to-text is not installed (npm run setup:whisper)",
    );
  }
  let job = speechJobs.get(videoId);
  if (job && job.state === "failed") {
    speechJobs.delete(videoId);
    throw job.error;
  }
  if (!job) {
    job = { state: "running", stage: "queued", progress: 0, truncated: false, error: null, startedAt: Date.now() };
    speechJobs.set(videoId, job);
    runSpeechJob(job, probe, videoId)
      .then(() => speechJobs.delete(videoId))
      .catch((err) => {
        warn(`speech: ${videoId} failed — ${err.message}`);
        job.state = "failed";
        job.error = err instanceof HttpError ? err : new HttpError(500, "speechFailed", err.message);
        job.finishedAt = Date.now();
      });
  }
  throw new TranscriptionPending(job);
}

function cachedTranscript(videoId, requestedLang) {
  const cached = requestedLang
    ? db.readTranscript(videoId, requestedLang)
    : db.readTranscript(videoId, null);
  if (!cached) return null;
  return {
    videoId,
    lang: cached.lang,
    isAuto: !!cached.is_auto,
    source: cached.source,
    segments: cached.segments,
    plainText: cached.plain_text,
    cached: true,
  };
}

async function getTranscript(source, requestedLang, { allowSpeech = true, knownKey = null } = {}) {
  if (typeof source === "string") source = identifySource(source);
  if (!source) throw new HttpError(400, "invalidUrl", "Invalid media source");

  const earlyKey = knownKey || (source.isYouTube ? source.id : null);
  if (earlyKey) {
    const hit = cachedTranscript(earlyKey, requestedLang);
    if (hit) return hit;
    const job = speechJobs.get(earlyKey);
    if (job && job.state === "running") throw new TranscriptionPending(job);
  }

  const probe = await probeMedia(source);
  const videoId = mediaKey(source, probe);

  const cached = cachedTranscript(videoId, requestedLang);
  if (cached) return cached;

  const track = pickCaptionTrack(probe.captions || [], requestedLang || "en");
  if (!track) {
    if (allowSpeech) speechFallback(probe, videoId);
    throw new HttpError(404, "noCaptions", "This media has no caption track");
  }

  let segments = [];
  const attempts = [];
  if (track.url) {
    attempts.push(
      track.url.includes("fmt=") ? track.url : `${track.url}&fmt=json3`,
    );
    attempts.push(track.url);
  }
  if (source.isYouTube) {
    attempts.push(
      `https://www.youtube.com/api/timedtext?v=${source.id}&lang=${track.lang}&fmt=json3`,
    );
  }

  for (const url of attempts) {
    try {
      const raw = await fetchText(url, {
        "accept-language": `${track.lang},en;q=0.8`,
      });
      segments = parseCaptionPayload(raw);
      if (segments.length) break;
    } catch (err) {
      warn("caption fetch failed:", err.message);
    }
  }

  if (!segments.length && BIN.ytdlp) {

    const dir = await fsp.mkdtemp(path.join(TMP_DIR, "cap-"));
    try {
      await run(
        BIN.ytdlp,
        [
          ...ytdlpBaseArgs(),
          "--skip-download",
          track.isAuto ? "--write-auto-subs" : "--write-subs",
          "--sub-langs",
          track.lang,
          "--sub-format",
          "json3/vtt",
          "-o",
          path.join(dir, "cap.%(ext)s"),
          source.url,
        ],
        { timeout: 90000 },
      );
      for (const file of await fsp.readdir(dir)) {
        const raw = await fsp.readFile(path.join(dir, file), "utf8");
        const parsed = parseCaptionPayload(raw);
        if (parsed.length) {
          segments = parsed;
          break;
        }
      }
    } catch (err) {
      warn("yt-dlp caption fallback failed:", err.message);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }

  if (!segments.length) {

    if (allowSpeech) speechFallback(probe, videoId);
    throw new HttpError(404, "noCaptions", "Caption track could not be downloaded");
  }

  segments = dedupeSegments(segments).map((s) => ({
    start: Math.round(s.start * 100) / 100,
    dur: Math.round(s.dur * 100) / 100,
    text: s.text,
    label: formatClock(s.start),
  }));

  const plainText = segments
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  db.writeTranscript({
    videoId,
    lang: track.lang,
    isAuto: track.isAuto,
    source: "timedtext",
    segments,
    plainText,
  });

  return {
    videoId,
    lang: track.lang,
    isAuto: track.isAuto,
    source: "timedtext",
    segments,
    plainText,
    cached: false,
  };
}

const STOPWORDS = new Set([

  "a",
  "about",
  "above",
  "after",
  "again",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "back",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "come",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "done",
  "down",
  "during",
  "each",
  "even",
  "every",
  "few",
  "first",
  "for",
  "from",
  "further",
  "get",
  "go",
  "going",
  "got",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "know",
  "let",
  "like",
  "look",
  "made",
  "make",
  "many",
  "may",
  "me",
  "might",
  "more",
  "most",
  "much",
  "must",
  "my",
  "need",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "one",
  "only",
  "or",
  "other",
  "our",
  "out",
  "over",
  "own",
  "really",
  "right",
  "said",
  "same",
  "say",
  "see",
  "she",
  "should",
  "so",
  "some",
  "something",
  "still",
  "such",
  "take",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "thing",
  "things",
  "think",
  "this",
  "those",
  "through",
  "time",
  "to",
  "too",
  "two",
  "under",
  "until",
  "up",
  "us",
  "use",
  "used",
  "using",
  "very",
  "want",
  "was",
  "way",
  "we",
  "well",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "would",
  "yeah",
  "yes",
  "you",
  "your",
  "okay",
  "gonna",
  "actually",
  "basically",
  "kind",
  "sort",
  "lot",
  "bit",
  "maybe",
  "probably",
  "definitely",

  "və",
  "ki",
  "bu",
  "bir",
  "da",
  "də",
  "ilə",
  "üçün",
  "olan",
  "olaraq",
  "amma",
  "ancaq",
  "çünki",
  "daha",
  "çox",
  "az",
  "var",
  "yox",
  "mən",
  "sən",
  "o",
  "biz",
  "siz",
  "onlar",
  "nə",
  "necə",
  "harada",
  "niyə",
  "kimi",
  "indi",
  "sonra",
  "əvvəl",
  "hər",
  "bütün",
  "özü",
  "edir",
  "edən",
  "etmək",
  "olur",
  "oldu",
  "deyil",
  "isə",
  "ya",
  "həm",
  "yəni",
  "artıq",
  "bax",
  "budur",

  "bir",
  "bu",
  "şu",
  "o",
  "ve",
  "ile",
  "için",
  "olarak",
  "ama",
  "fakat",
  "çünkü",
  "daha",
  "çok",
  "az",
  "var",
  "yok",
  "ben",
  "sen",
  "biz",
  "siz",
  "onlar",
  "ne",
  "nasıl",
  "nerede",
  "neden",
  "gibi",
  "şimdi",
  "sonra",
  "önce",
  "her",
  "bütün",
  "kendi",
  "ediyor",
  "eden",
  "etmek",
  "oluyor",
  "oldu",
  "değil",
  "ise",
  "ya",
  "hem",
  "yani",
  "artık",
  "işte",
  "şey",
  "şekilde",
  "olan",
]);

const GENERIC_TERMS = new Set([

  "people",
  "person",
  "thing",
  "things",
  "stuff",
  "time",
  "times",
  "minute",
  "minutes",
  "second",
  "seconds",
  "hour",
  "hours",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
  "world",
  "life",
  "lives",
  "work",
  "part",
  "parts",
  "place",
  "places",
  "point",
  "points",
  "number",
  "numbers",
  "group",
  "groups",
  "kind",
  "kinds",
  "sort",
  "case",
  "cases",
  "fact",
  "facts",
  "idea",
  "ideas",
  "reason",
  "reasons",
  "result",
  "results",
  "example",
  "examples",
  "question",
  "questions",
  "answer",
  "answers",
  "problem",
  "problems",
  "level",
  "side",
  "end",
  "start",
  "beginning",
  "today",
  "tomorrow",
  "yesterday",
  "everybody",
  "everyone",
  "somebody",
  "someone",
  "anybody",
  "anyone",
  "nobody",
  "everything",
  "something",
  "anything",
  "nothing",
  "guys",
  "folks",
  "okay",

  "going",
  "want",
  "wants",
  "wanted",
  "need",
  "needs",
  "needed",
  "said",
  "says",
  "saying",
  "tell",
  "tells",
  "told",
  "know",
  "knows",
  "knew",
  "think",
  "thinks",
  "thought",
  "feel",
  "feels",
  "felt",
  "look",
  "looks",
  "looked",
  "make",
  "makes",
  "made",
  "making",
  "take",
  "takes",
  "took",
  "taking",
  "give",
  "gives",
  "gave",
  "come",
  "comes",
  "came",
  "coming",
  "start",
  "starts",
  "started",
  "happen",
  "happens",
  "happened",
  "become",
  "becomes",
  "became",
  "change",
  "changes",
  "changed",
  "show",
  "shows",
  "showed",
  "find",
  "finds",
  "found",
  "keep",
  "keeps",
  "kept",
  "seem",
  "seems",
  "turn",
  "turns",
  "turned",
  "mean",
  "means",
  "meant",
  "call",
  "calls",
  "called",
  "tries",
  "tried",
  "asks",
  "asked",
  "talk",
  "talks",
  "talked",
  "live",
  "lived",
  "believe",
  "believes",
  "understand",
  "remember",
  "happening",
  "doing",
  "getting",
  "saw",
  "seen",
  "put",
  "puts",
  "let",
  "lets",
  "gonna",
  "wanna",

  "actually",
  "really",
  "basically",
  "literally",
  "definitely",
  "probably",
  "maybe",
  "obviously",
  "exactly",
  "simply",
  "quite",
  "pretty",
  "little",
  "big",
  "small",
  "good",
  "great",
  "better",
  "best",
  "bad",
  "worse",
  "worst",
  "right",
  "wrong",
  "sure",
  "different",
  "important",
  "interesting",
  "amazing",
  "awesome",
  "whole",
  "entire",
  "other",
  "others",
  "another",
  "same",
  "next",
  "last",
  "first",
  "second",
  "again",
  "always",
  "never",
  "often",
  "sometimes",
  "usually",
  "already",
  "still",
  "even",
  "much",
  "many",
  "more",
  "less",
  "least",
  "most",
  "very",

  "olmaq",
  "etmək",
  "demək",
  "görmək",
  "bilmək",
  "istəmək",
  "vermək",
  "almaq",
  "gəlmək",
  "getmək",
  "şeylər",
  "insan",
  "insanlar",
  "vaxt",
  "zaman",
  "gün",
  "il",
  "həyat",
  "yer",
  "şəkildə",
  "əslində",
  "həqiqətən",
  "çünki",

  "olmak",
  "etmek",
  "demek",
  "görmek",
  "bilmek",
  "istemek",
  "vermek",
  "almak",
  "gelmek",
  "gitmek",
  "şeyler",
  "insan",
  "insanlar",
  "zaman",
  "vakit",
  "gün",
  "yıl",
  "hayat",
  "yer",
  "şekilde",
  "aslında",
  "gerçekten",
  "yani",
]);

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

function normalizeWord(word) {
  return String(word)
    .toLowerCase()
    .replace(/[’ʼ]/g, "'")
    .replace(/'(s|re|ve|ll|d|m|t)$/, "")
    .replace(/^[-']+|[-']+$/g, "");
}

function tokenize(text) {
  return (String(text).match(WORD_RE) || []).map(normalizeWord).filter(Boolean);
}

function isContentWord(word) {
  return word.length > 2 && !STOPWORDS.has(word) && !/^\d+$/.test(word);
}

function isConceptWord(word) {
  return word.length >= 4 && isContentWord(word) && !GENERIC_TERMS.has(word);
}

function seededRandom(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
}

function shuffle(list, rand) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function titleCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildSentences(segments) {
  const joined = segments.map((s) => s.text).join(" ");
  const punctuation = (joined.match(/[.!?]/g) || []).length;
  const words = tokenize(joined).length || 1;
  const punctuated = punctuation / words > 0.015;

  const sentences = [];
  if (punctuated) {
    let buffer = "";
    let start = segments[0]?.start || 0;
    for (const seg of segments) {
      if (!buffer) start = seg.start;
      buffer = buffer ? `${buffer} ${seg.text}` : seg.text;
      const pieces = buffer.split(/(?<=[.!?])\s+/);
      while (pieces.length > 1) {
        const piece = pieces.shift().trim();
        if (tokenize(piece).length >= 4) sentences.push({ text: piece, start });
        start = seg.start;
      }
      buffer = pieces[0] || "";
    }
    if (tokenize(buffer).length >= 4)
      sentences.push({ text: buffer.trim(), start });
  } else {
    let buffer = [];
    let start = segments[0]?.start || 0;
    let count = 0;
    for (const seg of segments) {
      if (!buffer.length) start = seg.start;
      buffer.push(seg.text);
      count += tokenize(seg.text).length;
      if (count >= 26) {
        sentences.push({ text: buffer.join(" ").trim(), start });
        buffer = [];
        count = 0;
      }
    }
    if (buffer.length) sentences.push({ text: buffer.join(" ").trim(), start });
  }
  return sentences.filter((s) => s.text.length > 20);
}

function termFrequencies(sentences) {
  const unigram = new Map();
  const bigram = new Map();
  const docFreq = new Map();

  for (const sentence of sentences) {
    const words = tokenize(sentence.text);
    const seenHere = new Set();
    for (let i = 0; i < words.length; i += 1) {
      const w = words[i];
      if (isContentWord(w)) {
        unigram.set(w, (unigram.get(w) || 0) + 1);
        seenHere.add(w);
      }
      const next = words[i + 1];
      if (next && isContentWord(w) && isContentWord(next)) {
        const pair = `${w} ${next}`;
        bigram.set(pair, (bigram.get(pair) || 0) + 1);
        seenHere.add(pair);
      }
    }
    for (const term of seenHere)
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
  }
  const tokenTotal = [...unigram.values()].reduce((a, b) => a + b, 0) || 1;
  return { unigram, bigram, docFreq, tokenTotal };
}

function rankSentences(sentences, unigram) {
  const max = Math.max(1, ...unigram.values());
  return sentences.map((sentence, index) => {
    const words = tokenize(sentence.text);
    const unique = new Set(words.filter(isContentWord));
    let score = 0;
    for (const w of unique) score += (unigram.get(w) || 0) / max;
    const density = unique.size / Math.max(6, words.length);
    const position = index < sentences.length * 0.12 ? 1.15 : 1;
    return { ...sentence, index, score: score * (0.6 + density) * position };
  });
}

function trimSentence(text, maxWords = 34) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const clipped =
    words.length > maxWords
      ? `${words.slice(0, maxWords).join(" ")}…`
      : words.join(" ");
  return titleCase(clipped.replace(/^[\s,;:-]+/, ""));
}

function deriveChapters(probeChapters, description, sentences, duration) {
  if (probeChapters?.length) {
    const named = probeChapters
      .filter((c) => c.title && !/^<untitled/i.test(c.title))
      .map((c) => ({
        start: c.start,
        label: formatClock(c.start),
        title: c.title,
      }));
    if (named.length) return named;
  }
  const fromDescription = [];
  const re =
    /(?:^|\n)\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:|]?\s*(.{2,80})/g;
  let m;
  while ((m = re.exec(description || ""))) {
    const start = parseClock(m[1]);
    const title = m[2].trim().replace(/\s+/g, " ");
    if (Number.isFinite(start) && title)
      fromDescription.push({ start, label: formatClock(start), title });
  }
  if (fromDescription.length >= 3) {
    return fromDescription.sort((a, b) => a.start - b.start).slice(0, 30);
  }

  if (!sentences.length) return [];
  const buckets = Math.min(8, Math.max(3, Math.round(duration / 240) || 3));
  const perBucket = Math.ceil(sentences.length / buckets);
  const chapters = [];
  for (let i = 0; i < sentences.length; i += perBucket) {
    const slice = sentences.slice(i, i + perBucket);
    if (!slice.length) continue;
    const counts = new Map();
    for (const s of slice) {
      for (const w of tokenize(s.text)) {
        if (isContentWord(w)) counts.set(w, (counts.get(w) || 0) + 1);
      }
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([w]) => w);
    chapters.push({
      start: slice[0].start,
      label: formatClock(slice[0].start),
      title: top.length
        ? top.map(titleCase).join(" · ")
        : `Part ${chapters.length + 1}`,
      synthetic: true,
    });
  }
  return chapters;
}

function analyseOffline(transcript, video) {
  const sentences = buildSentences(transcript.segments);

  if (sentences.length < 3) {
    const words = tokenize(transcript.plainText).length;
    return {
      provider: "offline",
      lang: transcript.lang,
      isAuto: transcript.isAuto,
      thin: true,
      summary: transcript.segments.slice(0, 8).map((seg) => ({
        text: trimSentence(seg.text),
        start: seg.start,
        label: formatClock(seg.start),
      })),
      concepts: [],
      quiz: [],
      chapters: deriveChapters(video?.chapters, video?.description, [], video?.duration || 0),
      stats: {
        words,
        segments: transcript.segments.length,
        readingMinutes: Math.max(1, Math.round(words / 200)),
      },
    };
  }

  const { unigram, bigram, docFreq, tokenTotal } = termFrequencies(sentences);
  const ranked = rankSentences(sentences, unigram);
  const rand = seededRandom(`${transcript.videoId}:${transcript.lang}`);
  const total = sentences.length;

  const summaryCount = Math.min(
    8,
    Math.max(4, Math.round(sentences.length / 12)),
  );
  const summary = ranked
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, summaryCount)
    .sort((a, b) => a.start - b.start)
    .map((s) => ({
      text: trimSentence(s.text),
      start: s.start,
      label: formatClock(s.start),
    }));

  const spread = (term) => (docFreq.get(term) || 1) / total;
  const informative = (term) => {
    const share = spread(term);
    return share <= 0.3 && Math.log(1 + total / (docFreq.get(term) || 1));
  };

  const phrases = [];
  for (const [term, count] of bigram) {
    const idf = informative(term);
    if (count < 3 || !idf) continue;

    const parts = term.split(" ");
    if (!parts.every((w) => w.length >= 4 && isContentWord(w))) continue;
    if (parts.every((w) => GENERIC_TERMS.has(w))) continue;

    const [left, right] = parts.map((w) => unigram.get(w) || 1);
    const pmi = Math.log((count * tokenTotal) / (left * right));
    if (pmi < 1.2) continue;
    phrases.push({ term, count, words: 2, score: count * idf * pmi });
  }
  const singles = [];
  for (const [term, count] of unigram) {
    const idf = informative(term);
    if (count < 3 || !idf || !isConceptWord(term)) continue;
    singles.push({ term, count, words: 1, score: count * idf });
  }
  phrases.sort((a, b) => b.score - a.score);
  singles.sort((a, b) => b.score - a.score);
  const candidates = [...phrases, ...singles];

  const termPattern = (term) => {
    const escaped = term
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "[\\s-]+");
    return new RegExp(`\\b${escaped}(?:['’]?s)?\\b`, "i");
  };

  const pool = [];
  const used = new Set();
  for (const candidate of candidates) {
    if (pool.length >= 14) break;
    const { term } = candidate;

    if ([...used].some((t) => t.includes(term) || term.includes(t))) continue;
    const pattern = termPattern(term);
    const host = ranked
      .filter((s) => pattern.test(s.text))
      .sort((a, b) => b.score - a.score)[0];
    if (!host) continue;
    used.add(term);
    pool.push({
      term: term.split(" ").map(titleCase).join(" "),
      explanation: trimSentence(host.text, 40),
      takeaway: trimSentence(host.text, 18),
      start: host.start,
      label: formatClock(host.start),
      mentions: candidate.count,
    });
  }
  const concepts = pool.slice(0, 6);

  const quiz = [];
  const quizTerms = pool.map((c) => c.term.toLowerCase());
  for (const term of quizTerms) {
    if (quiz.length >= 6) break;
    const pattern = termPattern(term);
    const host = ranked
      .filter((s) => {
        const length = tokenize(s.text).length;
        return length >= 10 && length <= 45 && pattern.test(s.text);
      })
      .sort((a, b) => b.score - a.score)[0];
    if (!host) continue;

    const blanked = trimSentence(host.text, 42).replace(pattern, "______");
    if (!blanked.includes("______")) continue;

    if (pattern.test(blanked.replace(/______/g, " "))) continue;

    const distractors = shuffle(
      quizTerms.filter((t) => t !== term),
      rand,
    ).slice(0, 3);
    if (distractors.length < 3) continue;

    const options = shuffle([term, ...distractors], rand).map((t) =>
      t.split(" ").map(titleCase).join(" "),
    );
    quiz.push({
      id: `q${quiz.length + 1}`,
      question: blanked,
      options,
      answerIndex: options.findIndex((o) => o.toLowerCase() === term),
      explanation: trimSentence(host.text, 40),
      start: host.start,
      label: formatClock(host.start),
    });
  }

  const words = tokenize(transcript.plainText).length;
  return {
    provider: "offline",
    lang: transcript.lang,
    isAuto: transcript.isAuto,
    summary,
    concepts,
    quiz,
    chapters: deriveChapters(
      video?.chapters,
      video?.description,
      sentences,
      video?.duration || 0,
    ),
    stats: {
      words,
      segments: transcript.segments.length,
      readingMinutes: Math.max(1, Math.round(words / 200)),
    },
  };
}

let anthropicClient = null;
function getAnthropic() {
  if (!CONFIG.anthropicKey) return null;
  if (anthropicClient) return anthropicClient;
  try {
    const Anthropic = require("@anthropic-ai/sdk");
    anthropicClient = new Anthropic({ apiKey: CONFIG.anthropicKey });
    return anthropicClient;
  } catch (err) {
    warn(
      "@anthropic-ai/sdk is not installed — using the offline analyser:",
      err.message,
    );
    return null;
  }
}

const STUDY_SYSTEM_PROMPT = `You turn video transcripts into study material.
Reply with a single JSON object and nothing else — no prose, no markdown fences.

Shape:
{
  "summary":  [{"text": "one clear bullet", "start": 12.5}, ...],        // 5-8 items
  "concepts": [{"term": "Name", "explanation": "2 sentences max",
                "takeaway": "one actionable line", "start": 42.0}, ...], // 4-6 items
  "quiz":     [{"question": "…", "options": ["a","b","c","d"],
                "answerIndex": 0, "explanation": "why", "start": 60.0}, ...] // 4-6 items
}

Rules:
- Write in the same language as the transcript.
- "start" must be a timestamp in seconds taken from the numbered transcript lines.
- Every quiz question must be answerable from the transcript alone, with exactly
  four plausible options and exactly one correct answer.
- Never invent facts that are not in the transcript.`;

function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  if (start === -1) return null;
  const slice = sliceBalancedJson(body, start);
  if (!slice) return null;
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function transcriptForPrompt(transcript, budgetChars = 48000) {
  const lines = transcript.segments.map(
    (s) => `[${s.start.toFixed(1)}] ${s.text}`,
  );
  let text = lines.join("\n");
  if (text.length <= budgetChars) return text;

  const stride = Math.ceil(text.length / budgetChars);
  text = lines.filter((_, i) => i % stride === 0).join("\n");
  return text.slice(0, budgetChars);
}

async function analyseWithClaude(transcript, video, fallback) {
  const client = getAnthropic();
  if (!client) return null;
  try {
    const response = await client.messages.create({
      model: CONFIG.studyModel,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: STUDY_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `Video title: ${video?.title || "Unknown"}\n` +
            `Channel: ${video?.channel || "Unknown"}\n` +
            `Duration: ${formatClock(video?.duration || 0)}\n\n` +
            `Transcript (timestamps in seconds):\n${transcriptForPrompt(transcript)}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      warn("Claude declined the study request; using the offline analyser");
      return null;
    }

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const parsed = extractJsonObject(text);
    if (!parsed) {
      warn("Claude returned unparseable JSON; using the offline analyser");
      return null;
    }

    const clean = (items, mapper) =>
      (Array.isArray(items) ? items : []).map(mapper).filter(Boolean);

    const summary = clean(parsed.summary, (item) => {
      const body = typeof item === "string" ? item : item?.text;
      if (!body) return null;
      const start = Number(item?.start) || 0;
      return { text: String(body).trim(), start, label: formatClock(start) };
    });

    const concepts = clean(parsed.concepts, (item) => {
      if (!item?.term) return null;
      const start = Number(item.start) || 0;
      return {
        term: String(item.term).trim(),
        explanation: String(item.explanation || "").trim(),
        takeaway: String(item.takeaway || "").trim(),
        start,
        label: formatClock(start),
        mentions: 0,
      };
    });

    const quiz = clean(parsed.quiz, (item, i) => {
      const options = Array.isArray(item?.options)
        ? item.options.map((o) => String(o).trim())
        : [];
      const answerIndex = Number(item?.answerIndex);
      if (!item?.question || options.length < 3) return null;
      if (
        !Number.isInteger(answerIndex) ||
        answerIndex < 0 ||
        answerIndex >= options.length
      )
        return null;
      const start = Number(item.start) || 0;
      return {
        id: `q${i + 1}`,
        question: String(item.question).trim(),
        options,
        answerIndex,
        explanation: String(item.explanation || "").trim(),
        start,
        label: formatClock(start),
      };
    });

    if (!summary.length || !quiz.length) return null;

    return {
      ...fallback,
      provider: "anthropic",
      summary,
      concepts: concepts.length ? concepts : fallback.concepts,
      quiz,
    };
  } catch (err) {
    warn("Claude study generation failed, falling back offline:", err.message);
    return null;
  }
}

async function buildStudyPack(source, lang, { fresh = false } = {}) {
  if (typeof source === "string") source = identifySource(source);
  if (!source) throw new HttpError(400, "invalidUrl", "Invalid media source");

  const video = await getMedia(source);
  const transcript = await getTranscript(source, lang, { knownKey: video.key });
  const mediaId = video.key;
  const key = transcript.lang;

  if (!fresh) {
    const cached = db.readStudy(mediaId, key);
    if (cached) return { ...cached, transcript, video, cached: true };
  }

  const offline = analyseOffline(transcript, video);
  const enhanced = CONFIG.anthropicKey
    ? await analyseWithClaude(transcript, video, offline)
    : null;
  const pack = enhanced || offline;

  db.writeStudy(mediaId, key, pack.provider, pack);
  return { ...pack, transcript, video, cached: false };
}

const MIME = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  flv: "video/x-flv",
  gif: "image/gif",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  opus: "audio/opus",
  ogg: "audio/ogg",
};

function mergeContainerFor(videoCodec) {
  const codec = String(videoCodec || "").toLowerCase();
  if (codec.includes("avc1") || codec.includes("h264")) return "mp4";
  if (
    codec.includes("vp9") ||
    codec.includes("vp09") ||
    codec.includes("vp8") ||
    codec.includes("av01")
  )
    return "webm";
  return "mkv";
}

function pickAudioTrack(formats, container) {
  const audio = formats.filter(
    (f) => f.hasAudio && !f.hasVideo && f.audioBitrate > 0,
  );
  if (!audio.length) return null;
  const preferred =
    container === "mp4" ? "mp4" : container === "webm" ? "webm" : null;
  const pool = preferred ? audio.filter((f) => f.container === preferred) : [];
  const source = pool.length ? pool : audio;
  return source.slice().sort(compareAudio)[0];
}

const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
const STALL_MS = 20000;

function parseClientRange(header, total) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!m || !total) return null;
  let start;
  let end;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (!suffix) return null;
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
  }
  if (start >= total || end < start) return "unsatisfiable";
  return { start, end };
}

function probeLength(url, headers, redirects = 5) {
  return new Promise((resolve) => {
    const req = clientFor(url).get(url, { headers: { ...headers, "user-agent": UA, range: "bytes=0-0" } }, (up) => {
      up.resume();
      if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location && redirects > 0) {
        return resolve(probeLength(new URL(up.headers.location, url).toString(), headers, redirects - 1));
      }
      const total = /\/(\d+)$/.exec(up.headers["content-range"] || "");
      if (up.statusCode === 206 && total) return resolve({ total: Number(total[1]), ranged: true });
      if (up.statusCode >= 400) return resolve({ total: 0, ranged: false, refused: up.statusCode });
      resolve({ total: Number(up.headers["content-length"]) || 0, ranged: false });
    });
    req.setTimeout(20000, () => req.destroy());
    req.on("error", () => resolve({ total: 0, ranged: false }));
  });
}

function pipeRange(url, headers, start, end, res, counter, control, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = clientFor(url).get(
      url,
      { headers: { ...headers, "user-agent": UA, range: `bytes=${start}-${end}` } },
      (up) => {
        if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location && redirects > 0) {
          up.resume();
          return resolve(
            pipeRange(new URL(up.headers.location, url).toString(), headers, start, end, res, counter, control, redirects - 1),
          );
        }
        if (up.statusCode !== 206) {
          up.resume();
          const err = new HttpError(502, "upstream", `CDN answered a range request with ${up.statusCode}`);
          err.upstreamStatus = up.statusCode;
          return reject(err);
        }
        let stall = setTimeout(() => req.destroy(new Error("upstream stalled")), STALL_MS);
        up.on("data", (chunk) => {
          clearTimeout(stall);
          stall = setTimeout(() => req.destroy(new Error("upstream stalled")), STALL_MS);
          counter.written += chunk.length;
          if (!res.write(chunk)) {
            up.pause();
            res.once("drain", () => up.resume());
          }
        });
        up.on("end", () => {
          clearTimeout(stall);
          resolve();
        });
        up.on("error", (err) => {
          clearTimeout(stall);
          reject(err);
        });
      },
    );
    control.current = req;
    req.on("error", reject);
  });
}

function pipeWhole(url, headers, res, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = clientFor(url).get(url, { headers: { ...headers, "user-agent": UA } }, (up) => {
      if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location && redirects > 0) {
        up.resume();
        return resolve(pipeWhole(new URL(up.headers.location, url).toString(), headers, res, redirects - 1));
      }
      if (up.statusCode >= 400) {
        up.resume();
        return reject(new HttpError(502, "upstream", `CDN responded ${up.statusCode}`));
      }
      if (up.headers["content-length"] && !res.headersSent) {
        res.setHeader("Content-Length", up.headers["content-length"]);
      }
      let bytes = 0;
      let stall = setTimeout(() => req.destroy(new Error("upstream stalled")), STALL_MS);
      up.on("data", (chunk) => {
        bytes += chunk.length;
        clearTimeout(stall);
        stall = setTimeout(() => req.destroy(new Error("upstream stalled")), STALL_MS);
      });
      up.on("end", () => {
        clearTimeout(stall);
        resolve(bytes);
      });
      up.on("error", reject);
      up.pipe(res);
    });
    res.on("close", () => {
      if (!res.writableFinished) req.destroy();
    });
    req.on("error", reject);
  });
}

async function streamDirect(url, upstreamHeaders, req, res, { size = 0, chunkSize = 0, refresh = null } = {}) {
  let headers = { ...upstreamHeaders };
  let total = size;
  let ranged = true;
  let refreshes = 0;

  if (!total) {
    let probe = await probeLength(url, headers);
    if (probe.refused && refresh) {
      const next = await refresh().catch(() => null);
      if (next) {
        ({ url } = next);
        headers = { ...next.headers };
        refreshes += 1;
        probe = await probeLength(url, headers);
      }
    }
    ({ total, ranged } = probe);
  }

  if (!total || !ranged) {
    res.status(200);
    return pipeWhole(url, headers, res);
  }

  const range = parseClientRange(req.headers.range, total);
  if (range === "unsatisfiable") {
    res.status(416).setHeader("Content-Range", `bytes */${total}`);
    return 0;
  }
  const first = range ? range.start : 0;
  const last = range ? range.end : total - 1;
  res.status(range ? 206 : 200);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", String(last - first + 1));
  if (range) res.setHeader("Content-Range", `bytes ${first}-${last}/${total}`);

  const step = chunkSize > 0 ? Math.min(chunkSize, DEFAULT_CHUNK_BYTES) : DEFAULT_CHUNK_BYTES;
  const control = { current: null, aborted: false };
  res.on("close", () => {
    if (!res.writableFinished) {
      control.aborted = true;
      control.current?.destroy();
    }
  });

  let offset = first;
  let failures = 0;
  while (offset <= last && !control.aborted) {
    const counter = { written: 0 };
    try {
      await pipeRange(url, headers, offset, Math.min(offset + step - 1, last), res, counter, control);
      offset += counter.written;
      if (!counter.written) throw new Error("empty range response");
      failures = 0;
    } catch (err) {
      offset += counter.written;
      if (control.aborted) break;
      if (err.upstreamStatus === 403 && refresh && refreshes < 2) {
        const next = await refresh().catch(() => null);

        if (next && (!next.size || next.size === total)) {
          ({ url } = next);
          headers = { ...next.headers };
          refreshes += 1;
          warn(`stream: CDN refused the URL at byte ${offset}; resumed on a fresh one`);
          continue;
        }
      }
      failures += 1;
      if (failures > 4) throw err;
      warn(`stream: chunk at ${offset} failed (${err.message}); retry ${failures}/4`);
      await new Promise((r) => setTimeout(r, 400 * failures));
    }
  }
  return offset - first;
}

function ffmpegFailure(err, stderr) {
  const detail = String(stderr || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-4)
    .join(" | ");
  const refused = /\b40[134]\b|Forbidden|Server returned|Connection refused|timed out/i.test(detail);
  return {
    detail,
    error: new HttpError(
      refused ? 502 : 500,
      refused ? "upstream" : "transcode",
      detail ? `${err.message} — ${detail}` : err.message,
    ),
  };
}

function streamThroughFfmpeg(buildCommand, res) {
  return new Promise((resolve, reject) => {
    if (!BIN.ffmpeg)
      return reject(
        new HttpError(503, "ffmpeg", "FFmpeg is not installed on this server"),
      );

    let bytes = 0;
    let settled = false;
    let clientGone = false;
    let outputDrained = false;
    let ffmpegDone = false;
    const finish = (fn, arg) => {
      if (!settled) {
        settled = true;
        fn(arg);
      }
    };

    const maybeEnd = () => {
      if (outputDrained && ffmpegDone && !settled) {
        res.end();
        finish(resolve, bytes);
      }
    };

    const command = buildCommand();
    const stream = command
      .on("start", (cmd) => log("stream ffmpeg:", cmd))
      .on("error", (err, stdout, stderr) => {

        if (clientGone || /SIGKILL/i.test(err.message)) return finish(resolve, bytes);
        const { detail, error } = ffmpegFailure(err, stderr);
        warn("stream ffmpeg failed:", detail || err.message);

        if (res.headersSent) res.destroy(error);
        finish(reject, error);
      })
      .on("end", () => {
        ffmpegDone = true;
        maybeEnd();
      })
      .pipe();

    stream.on("data", (chunk) => {
      bytes += chunk.length;
    });
    stream.on("end", () => {
      outputDrained = true;
      maybeEnd();
    });
    stream.pipe(res, { end: false });

    res.on("close", () => {
      if (!res.writableFinished && !settled) {
        clientGone = true;
        try {
          command.kill("SIGKILL");
        } catch {
        }
        finish(resolve, bytes);
      }
    });
  });
}

async function renderToTempFile(buildCommand, res, filename, mime) {
  if (!BIN.ffmpeg)
    throw new HttpError(503, "ffmpeg", "FFmpeg is not installed on this server");

  const dir = await fsp.mkdtemp(path.join(TMP_DIR, "conv-"));
  const outPath = path.join(dir, filename);
  try {
    await new Promise((resolve, reject) => {
      const command = buildCommand();
      command
        .on("error", (err, stdout, stderr) => {
          const { detail, error } = ffmpegFailure(err, stderr);
          warn("render ffmpeg failed:", detail || err.message);
          reject(error);
        })
        .on("end", () => resolve())
        .save(outPath);
      res.on("close", () => {
        if (!res.writableFinished) {
          try {
            command.kill("SIGKILL");
          } catch {
          }
        }
      });
    });

    const stat = await fsp.stat(outPath);
    if (res.writableEnded) return stat.size;
    res.setHeader("Content-Length", String(stat.size));
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(outPath);
      stream.on("error", reject);
      stream.on("end", resolve);
      stream.pipe(res);
    });
    return stat.size;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const HTTP_INPUT_OPTIONS = [
  "-user_agent",
  UA,
  "-referer",
  "https://www.youtube.com/",
  "-reconnect",
  "1",
  "-reconnect_streamed",
  "1",
  "-reconnect_delay_max",
  "5",
];

const activeRenders = new Map();

function escapeFilterPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function secondsToSrtTime(seconds) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function segmentsToSrt(segments, start, end) {
  const lines = [];
  let index = 1;
  for (const seg of segments) {
    const segEnd = seg.start + (seg.dur || 2);
    if (segEnd <= start || seg.start >= end) continue;
    const from = Math.max(0, seg.start - start);
    const to = Math.max(from + 0.4, Math.min(segEnd, end) - start);
    lines.push(
      `${index}`,
      `${secondsToSrtTime(from)} --> ${secondsToSrtTime(to)}`,
      seg.text,
      "",
    );
    index += 1;
  }
  return lines.join("\n");
}

const WATERMARK_POSITIONS = {
  tl: (m, bar) => ({ x: `${m}`, y: `${m}` }),
  tr: (m, bar) => ({ x: `W-tw-${m}`, y: `${m}` }),
  bl: (m, bar) => ({ x: `${m}`, y: `H-th-${m + bar}` }),
  br: (m, bar) => ({ x: `W-tw-${m}`, y: `H-th-${m + bar}` }),
};

async function buildVideoGraph(job, workDir, duration, targetHeight) {
  const chain = ["setpts=PTS-STARTPTS"];
  const opts = job.options || {};
  const height = targetHeight || 720;
  const barHeight = Math.max(4, Math.round(height / 90));

  chain.push(`scale=-2:${height}:flags=bicubic`);

  if (opts.subtitles && job.subtitlePath) {
    const fontDir = BIN.font ? path.dirname(BIN.font) : null;
    const style = [
      `FontSize=${Math.round(height / 26)}`,
      "PrimaryColour=&H00FFFFFF",
      "OutlineColour=&H90000000",
      "BorderStyle=3",
      "Outline=1",
      "Shadow=0",
      `MarginV=${Math.round(height / 14)}`,
    ].join(",");
    const parts = [`subtitles='${escapeFilterPath(job.subtitlePath)}'`];
    if (fontDir) parts.push(`fontsdir='${escapeFilterPath(fontDir)}'`);
    parts.push(`force_style='${style}'`);
    chain.push(parts.join(":"));
  }

  if (opts.title && BIN.font) {
    const file = path.join(workDir, "title.txt");
    await fsp.writeFile(file, String(opts.title).slice(0, 160), "utf8");
    const size = Math.round(height / 20);
    chain.push(
      [
        "drawtext",
        `=fontfile='${escapeFilterPath(BIN.font)}'`,
        `:textfile='${escapeFilterPath(file)}'`,
        ":reload=0",
        `:fontsize=${size}`,
        ":fontcolor=white",
        ":box=1:boxcolor=black@0.45",
        `:boxborderw=${Math.round(size / 2)}`,
        `:x=(W-tw)/2:y=${Math.round(height / 22)}`,
      ].join(""),
    );
  }

  if (opts.watermark && BIN.font) {
    const file = path.join(workDir, "watermark.txt");
    await fsp.writeFile(file, String(opts.watermark).slice(0, 80), "utf8");
    const margin = Math.round(height / 28);
    const place = (
      WATERMARK_POSITIONS[opts.watermarkPosition] || WATERMARK_POSITIONS.br
    )(margin, opts.progressBar ? barHeight + 6 : 0);
    chain.push(
      [
        "drawtext",
        `=fontfile='${escapeFilterPath(BIN.font)}'`,
        `:textfile='${escapeFilterPath(file)}'`,
        ":reload=0",
        `:fontsize=${Math.round(height / 30)}`,
        ":fontcolor=white@0.82",
        ":shadowcolor=black@0.6:shadowx=2:shadowy=2",
        `:x=${place.x}:y=${place.y}`,
      ].join(""),
    );
  }

  if (!opts.progressBar) {
    chain.push("format=yuv420p");
    return [`[0:v]${chain.join(",")}[vout]`];
  }

  const seconds = Math.max(0.5, duration).toFixed(3);
  chain.push(
    `drawbox=x=0:y=ih-${barHeight}:w=iw:h=${barHeight}:color=black@0.55:t=fill`,
  );
  chain.push("split=2");

  return [
    `[0:v]${chain.join(",")}[base][barsrc]`,
    `[barsrc]drawbox=x=0:y=0:w=iw:h=ih:color=${PROGRESS_COLOR}:t=fill,crop=iw:${barHeight}:0:0[bar]`,
    `[base][bar]overlay=x='-w+w*min(1\\,t/${seconds})':y=H-h:eval=frame:format=auto,` +
      "format=yuv420p[vout]",
  ];
}

const CLIP_HEIGHTS = { 1080: 1080, 720: 720, 480: 480, 360: 360 };
const PROGRESS_COLOR = "0xff2d78";

async function renderClip(jobId) {
  const job = db.readClip(jobId);
  if (!job) return;

  const workDir = path.join(TMP_DIR, `clip-${jobId}`);
  await fsp.mkdir(workDir, { recursive: true });

  const cleanup = async () => {
    activeRenders.delete(jobId);
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    if (!BIN.ffmpeg)
      throw new HttpError(
        503,
        "ffmpeg",
        "FFmpeg is not installed on this server",
      );

    db.patchClip(jobId, {
      status: "downloading",
      stage: "downloading",
      progress: 3,
      error: null,
    });

    const source = identifySource(job.url) || identifySource(job.video_id);
    if (!source)
      throw new HttpError(400, "invalidUrl", "Clip source is no longer valid");
    const probe = await probeMedia(source);
    const start = job.start_sec;
    const duration = Math.max(0.5, job.end_sec - job.start_sec);
    const targetHeight = CLIP_HEIGHTS[String(job.options.quality)] || 720;

    const withVideo = probe.formats.filter((f) => f.hasVideo);
    const videoCandidates = withVideo
      .filter((f) => f.height)
      .sort((a, b) => a.height - b.height);

    const videoFormat =
      videoCandidates.find((f) => f.height >= targetHeight) ||
      videoCandidates[videoCandidates.length - 1] ||
      withVideo[0];
    if (!videoFormat)
      throw new HttpError(422, "generic", "No usable video stream");

    const audioFormat = videoFormat.hasAudio
      ? null
      : pickAudioTrack(
          probe.formats,
          mergeContainerFor(videoFormat.videoCodec),
        );

    const options = { ...job.options };
    let subtitlePath = null;
    if (options.subtitles) {
      try {
        const transcript = await getTranscript(
          source,
          options.subtitleLang || null,
          { allowSpeech: false },
        );
        const srt = segmentsToSrt(transcript.segments, start, job.end_sec);
        if (srt.trim()) {
          subtitlePath = path.join(workDir, "subs.srt");
          await fsp.writeFile(subtitlePath, srt, "utf8");
        } else {
          options.subtitles = false;
        }
      } catch (err) {
        warn(`clip ${jobId}: subtitles unavailable — ${err.message}`);
        options.subtitles = false;
      }
    }

    db.patchClip(jobId, {
      status: "processing",
      stage: "processing",
      progress: 8,
    });

    const container = CLIP_FORMATS.includes(options.format)
      ? options.format
      : "mp4";
    const isGif = container === "gif";
    const outputPath = path.join(CLIPS_DIR, `${jobId}.${container}`);
    const videoGraph = await buildVideoGraph(
      { options, subtitlePath },
      workDir,
      duration,
      targetHeight,
    );

    await new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(videoFormat.url)
        .inputOptions([...HTTP_INPUT_OPTIONS, "-ss", String(start)]);

      if (audioFormat && !isGif) {
        command
          .input(audioFormat.url)
          .inputOptions([...HTTP_INPUT_OPTIONS, "-ss", String(start)]);
      }

      const graph = [...videoGraph];
      if (isGif) {

        const fps = clampInt(options.gifFps, 5, 30, 15);
        const height = Math.min(targetHeight, 480);
        graph.push(
          `[vout]fps=${fps},scale=-2:${height}:flags=lanczos,split[gsrc][gpal]`,
          "[gpal]palettegen=stats_mode=diff[pal]",
          "[gsrc][pal]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[gout]",
        );
      } else {
        const audioLabel = audioFormat ? "1:a" : "0:a";
        graph.push(
          `[${audioLabel}]asetpts=PTS-STARTPTS,aresample=async=1[aout]`,
        );
      }
      command.complexFilter(graph);

      const outputOptions = isGif
        ? ["-map", "[gout]", "-an", "-t", String(duration), "-loop", "0"]
        : [
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-t",
            String(duration),
            ...(CLIP_ENCODERS[container] || CLIP_ENCODERS.mp4),
          ];

      command
        .outputOptions(outputOptions)
        .on("start", (cmd) => log(`clip ${jobId} ffmpeg:`, cmd))
        .on("progress", (progress) => {
          const done = parseClock(progress.timemark);
          const pct = Number.isFinite(done)
            ? Math.min(99, 8 + (done / duration) * 90)
            : null;
          if (pct !== null) db.patchClip(jobId, { progress: Math.round(pct) });
        })
        .on("error", (err, stdout, stderr) => {

          const detail = String(stderr || "")
            .trim()
            .split("\n")
            .filter(Boolean)
            .slice(-6)
            .join(" | ");
          reject(
            new Error(detail ? `${err.message} — ${detail}` : err.message),
          );
        })
        .on("end", () => resolve())
        .save(outputPath);

      activeRenders.set(jobId, { command, workDir });
    });

    const stat = await fsp.stat(outputPath);
    db.patchClip(jobId, {
      status: "done",
      stage: "done",
      progress: 100,
      outputPath,
      filesize: stat.size,
      error: null,
    });
    log(`clip ${jobId} rendered — ${formatBytes(stat.size)}`);
  } catch (err) {
    const current = db.readClip(jobId);
    if (current && current.status === "canceled") {
      log(`clip ${jobId} canceled`);
    } else {
      warn(`clip ${jobId} failed:`, err.message);
      db.patchClip(jobId, {
        status: "failed",
        stage: "failed",
        progress: 0,
        error: String(err.message).slice(0, 500),
      });
    }
  } finally {
    await cleanup();
  }
}

async function sweepClips() {

  for (const [key, job] of speechJobs) {
    if (job.state === "failed" && Date.now() - (job.finishedAt || 0) > 10 * 60 * 1000) {
      speechJobs.delete(key);
    }
  }
  try {
    for (const clip of db.expiredClips(CONFIG.clipRetentionHours)) {
      if (clip.output_path)
        await fsp.rm(clip.output_path, { force: true }).catch(() => {});
      db.removeClip(clip.id);
    }
    db.cacheSweep();
  } catch (err) {
    warn("clip sweep failed:", err.message);
  }
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    if (req.path.startsWith("/api")) {
      log(
        `${req.method} ${req.originalUrl.slice(0, 160)} → ${res.statusCode} (${Date.now() - started}ms)`,
      );
    }
  });
  next();
});

app.use(
  express.static(PUBLIC_DIR, {
    maxAge: 0,
    etag: true,
    lastModified: true,
    extensions: ["html"],
  }),
);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    node: process.version,
    ffmpeg: !!BIN.ffmpeg,
    ytdlp: !!BIN.ytdlp,
  });
});

app.get("/api/config", asyncRoute(async (req, res) => {

  if (platformCount === null && BIN.ytdlp) {
    await Promise.race([countPlatforms(), new Promise((r) => setTimeout(r, 6000))]);
  }
  res.json({
    locales: SUPPORTED_LOCALES,
    defaultLocale: DEFAULT_LOCALE,
    engine: CONFIG.engine,
    ffmpeg: !!BIN.ffmpeg,
    fonts: !!BIN.font,
    ytdlp: !!BIN.ytdlp,
    aiProvider: CONFIG.anthropicKey ? "anthropic" : "offline",
    maxClipSeconds: CONFIG.maxClipSeconds,
    maxPlaylistItems: CONFIG.maxPlaylistItems,
    maxTranscodeSeconds: CONFIG.maxTranscodeSeconds,
    maxGifSeconds: CONFIG.maxGifSeconds,
    clipFormats: CLIP_FORMATS,
    clipQualities: Object.keys(CLIP_HEIGHTS),

    platforms: PLATFORMS.map(({ id, label, auth, domains }) => ({
      id,
      label,
      auth,
      domains,
    })),
    extraSites: EXTRA_SITES,
    audioTargets: Object.entries(AUDIO_TARGETS).map(([id, t]) => ({
      id,
      ext: t.ext,
      mime: t.mime,
      lossless: t.lossless,
    })),
    videoTargets: Object.entries(VIDEO_TARGETS).map(([id, t]) => ({
      id,
      ext: t.ext,
      mime: t.mime,
      streamable: t.streamable !== false,
    })),

    counts: {
      videoFormats: Object.keys(VIDEO_TARGETS).length + 1,
      audioFormats: Object.keys(AUDIO_TARGETS).length,
      languages: SUPPORTED_LOCALES.length,
      platforms: platformCount,
    },
    speech: (() => {
      const engine = speechEngine();
      return engine
        ? {
            available: true,
            engine: "whisper.cpp",
            model: engine.name,
            vad: Boolean(engine.vad),
            maxSeconds: CONFIG.maxSpeechSeconds,
          }
        : { available: false };
    })(),
    audioId: {
      provider: RECOGNITION.acr ? "acrcloud" : "audd",
      keyed: !!(RECOGNITION.acr || RECOGNITION.auddToken),
    },
    stats: db.stats(),
  });
}));

app.get(
  "/api/locales/:lang",
  asyncRoute(async (req, res) => {
    const lang = String(req.params.lang || "").toLowerCase();
    if (!SUPPORTED_LOCALES.includes(lang))
      throw new HttpError(404, "notFound", "Unknown locale");
    const file = path.join(LOCALES_DIR, `${lang}.json`);
    const body = await fsp.readFile(file, "utf8");
    res
      .type("application/json")
      .set("Cache-Control", "public, max-age=300")
      .send(body);
  }),
);

app.post(
  "/api/resolve",
  asyncRoute(async (req, res) => {
    const input = String(req.body?.url || "").trim();
    if (!input) throw new HttpError(400, "invalidUrl", "A URL is required");

    const playlistId = parsePlaylistId(input);
    const videoId = parseVideoId(input);
    const prefer =
      req.body?.prefer === "playlist"
        ? "playlist"
        : req.body?.prefer === "video"
          ? "video"
          : null;

    if (playlistId && (prefer === "playlist" || !videoId)) {
      return res.json({
        type: "playlist",
        playlist: await getPlaylist(playlistId),
      });
    }

    const source = identifySource(input);
    if (!source)
      throw new HttpError(400, "invalidUrl", "Unsupported or malformed URL");

    return res.json({
      type: "video",
      video: await getMedia(source),
      playlistId: playlistId || null,
    });
  }),
);

app.get(
  "/api/video/:id",
  asyncRoute(async (req, res) => {

    const source = identifySource(req.query.src || req.params.id);
    if (!source) throw new HttpError(400, "invalidUrl", "Invalid media id");
    res.json(await getMedia(source, { fresh: req.query.fresh === "1" }));
  }),
);

app.get(
  "/api/playlist/:id",
  asyncRoute(async (req, res) => {
    const playlistId = parsePlaylistId(req.params.id);
    if (!playlistId)
      throw new HttpError(400, "invalidUrl", "Invalid playlist id");
    res.json(await getPlaylist(playlistId));
  }),
);

function clientFor(url) {
  return String(url).startsWith("http:") ? http : https;
}

function formatRefresher(source, itag) {
  return async () => {
    const fresh = await probeMedia(source);
    const f = fresh.formats.find((x) => String(x.itag) === String(itag));
    return f ? { url: f.url, headers: f.headers || {}, size: f.exactSize || 0 } : null;
  };
}

function pickCatalogueEntry(catalogue, { key, kind, height, abr, container }) {
  const all = [...catalogue.video, ...catalogue.audio];
  const exact = all.find((f) => f.key === key);
  if (exact) return exact;

  const wantAudio =
    kind === "audio" || /^(a|mp3):/.test(key || "") || (!height && abr > 0);

  if (wantAudio) {
    const pool = catalogue.audio;
    if (!pool.length) return null;
    const mp3 = /^mp3:(\d+)/.exec(key || "");
    if (mp3) {
      const hit = pool.find((f) => f.container === "mp3" && f.abr === Number(mp3[1]));
      if (hit) return hit;
    }
    const sameContainer = container ? pool.filter((f) => f.container === container) : [];
    const candidates = sameContainer.length ? sameContainer : pool.filter((f) => !f.transcode);
    const list = candidates.length ? candidates : pool;
    if (!abr) return list[0];
    return list.slice().sort((a, b) => Math.abs((a.abr || 0) - abr) - Math.abs((b.abr || 0) - abr))[0];
  }

  const pool = catalogue.video;
  if (!pool.length) return null;

  const target = height > 0 ? height : 720;
  const notAbove = pool.filter((f) => f.height > 0 && f.height <= target);
  if (notAbove.length) {

    const top = notAbove[0].height;
    return notAbove.find((f) => f.height === top && !f.needsMerge) || notAbove[0];
  }
  const above = pool.filter((f) => f.height > target);
  return above.length ? above[above.length - 1] : pool[pool.length - 1];
}

function planDownload({ probe, entry, raw, target, container }) {

  if (target && entry.kind === "audio") {
    const abr = Math.max(64, Math.round(entry.abr || raw.audioBitrate || 192));
    return {
      mode: "ffmpeg",
      streamable: target.streamable !== false,
      build: () =>
        ffmpeg(raw.url)
          .inputOptions(HTTP_INPUT_OPTIONS)
          .outputOptions(["-vn", "-map", "0:a:0", ...target.args(abr)])
          .format(target.format),
    };
  }

  if (target && entry.kind === "video") {
    const audio = entry.needsMerge ? pickAudioTrack(probe.formats, container) : null;
    if (entry.needsMerge && !audio)
      throw new HttpError(422, "generic", "No audio track to merge");

    const videoCodec = raw.videoCodec || "";
    const audioCodec = (audio || raw).audioCodec || "";
    const copyVideo = target.copyVideo.test(videoCodec);
    const copyAudio = target.copyAudio.test(audioCodec);

    if (!copyVideo && probe.duration > CONFIG.maxTranscodeSeconds) {
      throw new HttpError(
        422,
        "transcode",
        `Re-encoding to ${target.id.toUpperCase()} is limited to ` +
          `${Math.round(CONFIG.maxTranscodeSeconds / 60)} minutes — trim a clip instead`,
      );
    }

    const options = ["-map", "0:v:0", "-map", audio ? "1:a:0" : "0:a:0?"];
    if (copyVideo) {
      options.push("-c:v", "copy");
    } else if (target.vcodec === "libvpx-vp9") {
      options.push("-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0",
        "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1");
    } else if (target.vcodec === "mpeg4") {
      options.push("-c:v", "mpeg4", "-q:v", "4");
    } else {
      options.push("-c:v", target.vcodec, "-preset", "veryfast", "-crf", "22",
        "-pix_fmt", "yuv420p");
    }
    options.push("-c:a", copyAudio ? "copy" : target.acodec);
    if (!copyAudio) options.push("-b:a", "192k");
    options.push("-shortest");
    if (target.pipeArgs && target.streamable !== false) options.push(...target.pipeArgs);

    return {
      mode: "ffmpeg",
      streamable: target.streamable !== false,
      remux: copyVideo && copyAudio,
      build: () => {
        const command = ffmpeg()
          .input(raw.url)
          .inputOptions(HTTP_INPUT_OPTIONS);
        if (audio) command.input(audio.url).inputOptions(HTTP_INPUT_OPTIONS);
        return command.outputOptions(options).format(target.format);
      },
    };
  }

  if (entry.kind === "audio" && entry.transcode) {

    return {
      mode: "ffmpeg",
      streamable: true,
      build: () =>
        ffmpeg(raw.url)
          .inputOptions(HTTP_INPUT_OPTIONS)
          .outputOptions([
            "-vn", "-c:a", "libmp3lame", "-b:a", `${entry.abr}k`,
            "-id3v2_version", "3",
          ])
          .format("mp3"),
    };
  }

  if (entry.kind === "video" && entry.needsMerge) {
    const audio = pickAudioTrack(probe.formats, container);
    if (!audio) throw new HttpError(422, "generic", "No audio track to merge");
    const muxFormat =
      container === "mp4" ? "mp4" : container === "webm" ? "webm" : "matroska";
    return {
      mode: "ffmpeg",
      streamable: true,
      remux: true,
      build: () => {
        const command = ffmpeg()
          .input(raw.url)
          .inputOptions(HTTP_INPUT_OPTIONS)
          .input(audio.url)
          .inputOptions(HTTP_INPUT_OPTIONS)
          .outputOptions(["-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest"]);
        if (muxFormat === "mp4") {
          command.outputOptions([
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
          ]);
        }
        return command.format(muxFormat);
      },
    };
  }

  return { mode: "direct" };
}

app.get(
  "/api/download",
  asyncRoute(async (req, res) => {
    const source = identifySource(req.query.src || req.query.url || req.query.v);
    if (!source)
      throw new HttpError(400, "invalidUrl", "Unsupported or malformed URL");

    const probe = await probeMedia(source);
    if (probe.isLive)
      throw new HttpError(422, "live", "Live streams are not supported");

    const catalogue = buildFormatCatalogue(probe);
    const requested = String(req.query.key || "");
    const entry = pickCatalogueEntry(catalogue, {
      key: requested,
      kind: String(req.query.kind || ""),
      height: clampInt(req.query.h, 0, 4320, 0),
      abr: clampInt(req.query.abr, 0, 1000, 0),
      container: String(req.query.c || "").toLowerCase(),
    });
    if (entry && entry.key !== requested && requested) {
      log(`download: key ${requested} not in fresh probe, serving ${entry.key} (${entry.qualityLabel})`);
    }
    if (!entry)
      throw new HttpError(422, "generic", "No downloadable format is available");

    const raw = probe.formats.find(
      (f) => String(f.itag) === String(entry.itag),
    );
    if (!raw)
      throw new HttpError(
        422,
        "generic",
        "The selected format expired — reload the media",
      );

    const wanted = String(req.query.to || "").toLowerCase();
    const target = normalizeTarget(wanted, entry.kind);
    if (wanted && wanted !== "original" && !target) {
      throw new HttpError(400, "transcode", `Unknown target format "${wanted}"`);
    }
    if (target?.clipOnly) {
      throw new HttpError(
        400,
        "gifRange",
        "GIFs are produced from a clip range, not a whole download",
      );
    }
    if (target && !BIN.ffmpeg) {
      throw new HttpError(503, "ffmpeg", "FFmpeg is not installed on this server");
    }

    let container = entry.container;
    if (target) container = target.ext;
    else if (entry.kind === "video" && entry.needsMerge)
      container = mergeContainerFor(raw.videoCodec);

    const plan = planDownload({ probe, entry, raw, target, container });

    const baseName = sanitizeFilename(probe.title || probe.id, probe.id);
    const tag = target
      ? target.id.toUpperCase()
      : entry.qualityLabel.replace(/\s+/g, "");
    const filename = `${baseName} [${tag}].${container}`;

    const historyId = db.startDownload({
      videoId: mediaKey(source, probe),
      url: source.url,
      title: probe.title,
      channel: probe.channel,
      thumbnail: probe.thumbnails?.slice(-1)[0]?.url || "",
      duration: probe.duration,
      kind: entry.kind,
      quality: target ? `${entry.qualityLabel} → ${tag}` : entry.qualityLabel,
      container,
    });

    res.setHeader(
      "Content-Type",
      (target && target.mime) || MIME[container] || "application/octet-stream",
    );
    res.setHeader("Content-Disposition", contentDisposition(filename));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (plan.mode !== "direct" && !target && entry.size && !entry.estimated) {
      res.setHeader("X-Expected-Length", String(entry.size));
    }

    try {
      let bytes = 0;
      if (plan.mode === "direct") {
        bytes = await streamDirect(raw.url, raw.headers || {}, req, res, {
          size: raw.exactSize,
          chunkSize: raw.chunkSize,
          refresh: formatRefresher(source, raw.itag),
        });
      } else {

        let current = plan;
        for (let attempt = 1; ; attempt += 1) {
          try {
            bytes = current.streamable
              ? await streamThroughFfmpeg(current.build, res)
              : await renderToTempFile(current.build, res, filename);
            break;
          } catch (err) {
            if (err.code !== "upstream" || res.headersSent || attempt >= 3) throw err;
            warn(`download: CDN refused an FFmpeg input (attempt ${attempt}); re-probing`);

            const freshProbe = await probeMedia(source);
            const freshEntry = pickCatalogueEntry(buildFormatCatalogue(freshProbe), {
              key: entry.key,
              kind: entry.kind,
              height: entry.height || 0,
              abr: entry.abr || 0,
              container: entry.container,
            });
            const freshRaw =
              freshEntry && freshProbe.formats.find((f) => String(f.itag) === String(freshEntry.itag));
            if (!freshRaw) throw err;
            current = planDownload({ probe: freshProbe, entry: freshEntry, raw: freshRaw, target, container });
          }
        }
      }

      if (res.destroyed && !res.writableFinished) {
        log(`download: client left after ${formatBytes(bytes)} — not recorded as completed`);
        return;
      }
      if (!res.writableEnded) res.end();
      db.completeDownload(historyId, bytes);
    } catch (err) {
      db.failDownload(historyId, err.message);
      throw err;
    }
  }),
);

async function normaliseForRecognition(inputPath, outputPath) {
  if (!BIN.ffmpeg) throw new HttpError(503, "ffmpeg", "FFmpeg is not installed on this server");
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(["-vn", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", "-t", "20"])
      .format("mp3")
      .on("error", (err) => reject(new HttpError(422, "audioUnreadable", `Could not decode the recording: ${err.message}`)))
      .on("end", resolve)
      .save(outputPath);
  });
}

function normaliseAudd(result) {
  const apple = result.apple_music || {};
  const spotify = result.spotify || {};
  const cover =
    (apple.artwork?.url || "").replace("{w}", "400").replace("{h}", "400") ||
    spotify.album?.images?.[0]?.url ||
    "";
  return {
    title: result.title || "",
    artist: result.artist || "",
    album: result.album || "",
    releaseDate: result.release_date || "",
    timecode: result.timecode || "",
    cover,
    songLink: result.song_link || "",
    spotifyUrl: spotify.external_urls?.spotify || "",
    appleUrl: apple.url || "",
  };
}

async function recognitionFetch(url, init, attempts = 2) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
    } catch (err) {
      if (attempt >= attempts) {
        throw new HttpError(
          502,
          "recognitionFailed",
          `Recognition service unreachable: ${err.cause?.code || err.name || err.message}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
}

async function recogniseWithAudd(buffer) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/mpeg" }), "sample.mp3");
  form.append("return", "apple_music,spotify");
  if (RECOGNITION.auddToken) form.append("api_token", RECOGNITION.auddToken);

  const response = await recognitionFetch("https://api.audd.io/", { method: "POST", body: form });
  if (!response.ok) throw new HttpError(502, "recognitionFailed", `AudD responded ${response.status}`);
  const json = await response.json();

  if (json.status === "error") {
    const code = Number(json.error?.error_code) || 0;
    const message = json.error?.error_message || "AudD rejected the request";

    if (code === 901 || code === 902 || /limit/i.test(message)) {
      throw new HttpError(429, "recognitionLimited", message);
    }
    throw new HttpError(502, "recognitionFailed", message);
  }
  return json.result ? { provider: "audd", ...normaliseAudd(json.result) } : null;
}

async function recogniseWithAcr(buffer) {
  const { host, key, secret } = RECOGNITION.acr;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const toSign = ["POST", "/v1/identify", key, "audio", "1", timestamp].join("\n");
  const signature = crypto.createHmac("sha1", secret).update(toSign).digest("base64");

  const form = new FormData();
  form.append("sample", new Blob([buffer], { type: "audio/mpeg" }), "sample.mp3");
  form.append("sample_bytes", String(buffer.length));
  form.append("access_key", key);
  form.append("data_type", "audio");
  form.append("signature_version", "1");
  form.append("signature", signature);
  form.append("timestamp", timestamp);

  const response = await recognitionFetch(`https://${host}/v1/identify`, { method: "POST", body: form });
  if (!response.ok) throw new HttpError(502, "recognitionFailed", `ACRCloud responded ${response.status}`);
  const json = await response.json();
  const code = json.status?.code;
  if (code === 1001) return null;
  if (code === 3003 || code === 3015) throw new HttpError(429, "recognitionLimited", json.status?.msg || "ACRCloud limit");
  if (code !== 0) throw new HttpError(502, "recognitionFailed", json.status?.msg || "ACRCloud error");

  const music = json.metadata?.music?.[0];
  if (!music) return null;
  const vid = music.external_metadata?.youtube?.vid;
  const spotifyId = music.external_metadata?.spotify?.track?.id;
  const offset = Number(music.play_offset_ms) || 0;
  return {
    provider: "acrcloud",
    title: music.title || "",
    artist: (music.artists || []).map((a) => a.name).join(", "),
    album: music.album?.name || "",
    releaseDate: music.release_date || "",
    timecode: offset ? formatClock(offset / 1000) : "",
    cover: "",
    songLink: "",
    spotifyUrl: spotifyId ? `https://open.spotify.com/track/${spotifyId}` : "",
    appleUrl: "",
    youtubeUrl: vid ? watchUrl(vid) : "",
  };
}

async function findYouTubeMatch(artist, title) {
  if (!BIN.ytdlp || !title) return null;
  const query = `${artist} ${title}`.trim();
  try {
    const out = await run(
      BIN.ytdlp,
      [
        "--no-warnings",
        "--flat-playlist",
        "--print",
        "%(id)s\t%(title)s",
        `ytsearch1:${query}`,
      ],
      { timeout: 30000 },
    );
    const [id, videoTitle] = out.trim().split("\n")[0].split("\t");
    return /^[\w-]{11}$/.test(id || "") ? { url: watchUrl(id), title: videoTitle || query } : null;
  } catch (err) {
    warn("youtube match lookup failed:", err.message);
    return null;
  }
}

app.post(
  "/api/audioid/recognize",
  express.raw({ type: () => true, limit: "15mb" }),
  asyncRoute(async (req, res) => {
    const body = req.body;

    if (!Buffer.isBuffer(body) || body.length < 4000) {
      throw new HttpError(400, "audioTooShort", "The recording is too short to identify");
    }
    const input = ["mic", "system", "both"].includes(req.query.input) ? req.query.input : "mic";

    const dir = await fsp.mkdtemp(path.join(TMP_DIR, "aid-"));
    try {
      const rawPath = path.join(dir, "input.bin");
      const mp3Path = path.join(dir, "sample.mp3");
      await fsp.writeFile(rawPath, body);
      await normaliseForRecognition(rawPath, mp3Path);
      const sample = await fsp.readFile(mp3Path);

      let match = null;
      let lastError = null;
      const providers = [
        ...(RECOGNITION.acr ? [recogniseWithAcr] : []),
        recogniseWithAudd,
      ];
      for (const provider of providers) {
        try {
          match = await provider(sample);
          if (match) break;
        } catch (err) {
          lastError = err;
          warn("recognition provider failed:", err.message);
        }
      }
      if (!match) {
        if (lastError) throw lastError;
        return res.json({ match: false });
      }

      if (!match.youtubeUrl) {
        const yt = await findYouTubeMatch(match.artist, match.title);
        if (yt) {
          match.youtubeUrl = yt.url;
          match.youtubeTitle = yt.title;
        }
      }

      const row = db.addRecognition({ ...match, input });
      res.json({ match: true, recognition: row });
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }),
);

app.get("/api/audioid/history", (req, res) => {
  res.json({ items: db.recognitions(clampInt(req.query.limit, 1, 200, 50)) });
});

app.delete("/api/audioid/history/:id", (req, res, next) => {
  const changes = db.removeRecognition(clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0));
  if (!changes) return next(new HttpError(404, "notFound", "Entry not found"));
  res.json({ ok: true });
});

app.delete("/api/audioid/history", (req, res) => {
  res.json({ ok: true, removed: db.clearRecognitions() });
});

app.get(
  "/api/preview",
  asyncRoute(async (req, res) => {
    const source = identifySource(req.query.src);
    if (!source) throw new HttpError(400, "invalidUrl", "Invalid media source");
    const probe = await probeMedia(source);

    const progressive = probe.formats
      .filter((f) => f.hasVideo && f.hasAudio && !/m3u8/.test(f.url))
      .sort((a, b) => (a.height || 9999) - (b.height || 9999));

    const video =
      progressive.find((f) => (f.height || 0) >= 360) || progressive[progressive.length - 1];
    const audio = probe.formats
      .filter((f) => f.hasAudio && !f.hasVideo)
      .sort(compareAudio)[0];
    const pick = video || audio;
    if (!pick) throw new HttpError(422, "generic", "No previewable stream");

    const ext = pick.container || (video ? "mp4" : "m4a");
    res.setHeader("Content-Type", MIME[ext] || (video ? "video/mp4" : "audio/mp4"));
    res.setHeader("Cache-Control", "no-store");
    await streamDirect(pick.url, pick.headers || {}, req, res, {
      size: pick.exactSize,
      chunkSize: pick.chunkSize,
      refresh: formatRefresher(source, pick.itag),
    });
    if (!res.writableEnded) res.end();
  }),
);

function pendingPayload(job) {
  return {
    state: "transcribing",
    stage: job.stage,
    progress: job.progress,
    truncated: job.truncated,
    maxSeconds: CONFIG.maxSpeechSeconds,
    engine: speechEngine()?.name || null,
  };
}
app.get(
  "/api/transcript/:id",
  asyncRoute(async (req, res) => {
    const source = identifySource(req.query.src || req.params.id);
    if (!source) throw new HttpError(400, "invalidUrl", "Invalid media id");
    try {
      const media = await getMedia(source);
      const transcript = await getTranscript(
        source,
        req.query.lang ? String(req.query.lang) : null,
        { knownKey: media.key },
      );
      res.json(transcript);
    } catch (err) {
      if (err instanceof TranscriptionPending) return res.status(202).json(pendingPayload(err.job));
      throw err;
    }
  }),
);

app.get(
  "/api/study/:id",
  asyncRoute(async (req, res) => {
    const source = identifySource(req.query.src || req.params.id);
    if (!source) throw new HttpError(400, "invalidUrl", "Invalid media id");
    try {
      const pack = await buildStudyPack(
        source,
        req.query.lang ? String(req.query.lang) : null,
        {
          fresh: req.query.fresh === "1",
        },
      );
      res.json(pack);
    } catch (err) {
      if (err instanceof TranscriptionPending) return res.status(202).json(pendingPayload(err.job));
      throw err;
    }
  }),
);

app.post(
  "/api/clips",
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const source = identifySource(body.src || body.videoId || body.url);
    if (!source) throw new HttpError(400, "invalidUrl", "Invalid media source");
    if (!BIN.ffmpeg)
      throw new HttpError(
        503,
        "ffmpeg",
        "FFmpeg is not installed on this server",
      );

    const video = await getMedia(source);
    const start = parseClock(body.start ?? 0);
    const end = parseClock(body.end ?? 0);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new HttpError(
        400,
        "range",
        "Start and end must be valid timestamps",
      );
    }
    if (end <= start)
      throw new HttpError(
        400,
        "range",
        "The end time must be after the start time",
      );
    if (start < 0 || (video.duration && end > video.duration + 1)) {
      throw new HttpError(
        400,
        "bounds",
        "The range must sit inside the video duration",
      );
    }
    if (end - start > CONFIG.maxClipSeconds) {
      throw new HttpError(
        400,
        "tooLong",
        `Clips are limited to ${CONFIG.maxClipSeconds} seconds`,
      );
    }

    const raw = body.options || {};
    const options = {
      title: String(raw.title || "").slice(0, 160),
      watermark: String(raw.watermark || "").slice(0, 80),
      watermarkPosition: WATERMARK_POSITIONS[raw.watermarkPosition]
        ? raw.watermarkPosition
        : "br",
      progressBar: !!raw.progressBar,
      subtitles: !!raw.subtitles && video.hasCaptions,
      subtitleLang: raw.subtitleLang
        ? String(raw.subtitleLang).slice(0, 10)
        : null,
      quality: CLIP_HEIGHTS[String(raw.quality)] ? String(raw.quality) : "720",
      format: CLIP_FORMATS.includes(raw.format) ? raw.format : "mp4",
      gifFps: clampInt(raw.gifFps, 5, 30, 15),
    };

    if (options.format === "gif" && end - start > CONFIG.maxGifSeconds) {
      throw new HttpError(
        400,
        "tooLong",
        `GIFs are limited to ${CONFIG.maxGifSeconds} seconds`,
      );
    }

    const id = crypto.randomBytes(8).toString("hex");
    const clip = db.createClip({
      id,
      videoId: video.key,
      url: source.url,
      title: video.title,
      thumbnail: video.thumbnail,
      start,
      end,
      options,
    });

    setImmediate(() => renderClip(id));
    res.status(202).json(clip);
  }),
);

app.get("/api/clips", (req, res) => {
  res.json({ clips: db.listClips(clampInt(req.query.limit, 1, 200, 30)) });
});

app.get("/api/clips/:id", (req, res, next) => {
  const clip = db.readClip(String(req.params.id));
  if (!clip) return next(new HttpError(404, "notFound", "Clip not found"));
  res.json(clip);
});

app.post("/api/clips/:id/cancel", (req, res, next) => {
  const id = String(req.params.id);
  const clip = db.readClip(id);
  if (!clip) return next(new HttpError(404, "notFound", "Clip not found"));
  if (!["queued", "downloading", "processing"].includes(clip.status)) {
    return res.json(clip);
  }
  db.patchClip(id, {
    status: "canceled",
    stage: "canceled",
    progress: 0,
    error: null,
  });
  const active = activeRenders.get(id);
  if (active) {
    try {
      active.command.kill("SIGKILL");
    } catch {
    }
  }
  res.json(db.readClip(id));
});

app.get(
  "/api/clips/:id/file",
  asyncRoute(async (req, res) => {
    const clip = db.readClip(String(req.params.id));
    if (!clip) throw new HttpError(404, "notFound", "Clip not found");
    if (clip.status !== "done" || !clip.output_path) {
      throw new HttpError(409, "generic", "This clip is not ready yet");
    }
    if (!fs.existsSync(clip.output_path))
      throw new HttpError(410, "notFound", "Clip file has expired");

    const ext = path.extname(clip.output_path).slice(1) || "mp4";
    const name = `${sanitizeFilename(clip.title, "clip")} [${formatClock(clip.start_sec)}-${formatClock(clip.end_sec)}].${ext}`;
    res.setHeader("Content-Disposition", contentDisposition(name));
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.sendFile(clip.output_path);
  }),
);

app.delete(
  "/api/clips/:id",
  asyncRoute(async (req, res) => {
    const clip = db.readClip(String(req.params.id));
    if (!clip) throw new HttpError(404, "notFound", "Clip not found");
    const active = activeRenders.get(clip.id);
    if (active) {
      try {
        active.command.kill("SIGKILL");
      } catch {
      }
    }
    if (clip.output_path)
      await fsp.rm(clip.output_path, { force: true }).catch(() => {});
    db.removeClip(clip.id);
    res.json({ ok: true });
  }),
);

app.get("/api/history", (req, res) => {

  const wanted = String(req.query.status || "completed").toLowerCase();
  const status = ["completed", "failed", "started"].includes(wanted) ? wanted : null;
  const rows = db.history(clampInt(req.query.limit, 1, 500, 100), status);
  res.json({
    items: rows.map((row) => ({
      id: row.id,
      videoId: row.video_id,
      url: row.url,
      title: row.title,
      channel: row.channel,
      thumbnail: row.thumbnail,
      duration: row.duration,
      durationLabel: formatClock(row.duration),
      kind: row.kind,
      quality: row.quality,
      container: row.container,
      filesize: row.filesize,
      sizeLabel: formatBytes(row.filesize),
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    })),
    stats: db.stats(),
  });
});

app.delete("/api/history/:id", (req, res, next) => {
  const changes = db.removeHistory(
    clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0),
  );
  if (!changes) return next(new HttpError(404, "notFound", "Entry not found"));
  res.json({ ok: true });
});

app.delete("/api/history", (req, res) => {
  res.json({ ok: true, removed: db.clearHistory() });
});

app.use("/api", (req, res) => {
  res
    .status(404)
    .json({ error: { code: "notFound", message: "Unknown endpoint" } });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  const code = err.code || "generic";
  if (status >= 500) warn("unhandled:", err.stack || err.message);
  if (res.headersSent) return res.destroy();

  for (const header of ["Content-Type", "Content-Disposition", "Content-Length", "Content-Range", "Accept-Ranges", "X-Expected-Length"])
    res.removeHeader(header);
  res
    .status(status)
    .json({
      error: { code, message: err.message || "Unexpected server error" },
    });
});

process.on("unhandledRejection", (reason) =>
  warn("unhandledRejection:", reason),
);
process.on("uncaughtException", (err) =>
  warn("uncaughtException:", err.stack || err.message),
);

const server = app.listen(CONFIG.port, () => {
  log(`TubeForge listening on http://0.0.0.0:${CONFIG.port}`);
  log(
    `  media engine : ${CONFIG.engine}${BIN.ytdlp ? " (yt-dlp available)" : ""}`,
  );
  log(
    `  ffmpeg       : ${BIN.ffmpeg || "NOT FOUND — clips and muxing are disabled"}`,
  );
  log(`  drawtext font: ${BIN.font || "NOT FOUND — overlays are disabled"}`);
  log(
    `  study engine : ${CONFIG.anthropicKey ? `Claude (${CONFIG.studyModel})` : "offline analyser"}`,
  );
});

countPlatforms().then((n) => n && log(`  platforms    : ${n} sites via yt-dlp`));

setInterval(sweepClips, 30 * 60 * 1000).unref();
sweepClips();

function shutdown(signal) {
  log(`${signal} received — shutting down`);
  for (const [, job] of speechJobs) {
    try {
      job.kill?.();
    } catch {
    }
  }
  for (const [, active] of activeRenders) {
    try {
      active.command.kill("SIGKILL");
    } catch {
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = { app, server };
