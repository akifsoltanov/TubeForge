'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'tubeforge.db'));

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS downloads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id     TEXT    NOT NULL,
  url          TEXT    NOT NULL,
  title        TEXT    NOT NULL DEFAULT '',
  channel      TEXT    NOT NULL DEFAULT '',
  thumbnail    TEXT    NOT NULL DEFAULT '',
  duration     INTEGER NOT NULL DEFAULT 0,
  kind         TEXT    NOT NULL DEFAULT 'video',
  quality      TEXT    NOT NULL DEFAULT '',
  container    TEXT    NOT NULL DEFAULT '',
  filesize     INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'started',
  error        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_downloads_video   ON downloads (video_id);

CREATE TABLE IF NOT EXISTS transcripts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'en',
  is_auto     INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'timedtext',
  segments    TEXT NOT NULL,
  plain_text  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (video_id, lang)
);

CREATE TABLE IF NOT EXISTS study_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'en',
  provider    TEXT NOT NULL DEFAULT 'offline',
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (video_id, lang)
);

CREATE TABLE IF NOT EXISTS clips (
  id           TEXT PRIMARY KEY,
  video_id     TEXT NOT NULL,
  url          TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  thumbnail    TEXT NOT NULL DEFAULT '',
  start_sec    REAL NOT NULL DEFAULT 0,
  end_sec      REAL NOT NULL DEFAULT 0,
  options      TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'queued',
  stage        TEXT NOT NULL DEFAULT '',
  progress     REAL NOT NULL DEFAULT 0,
  output_path  TEXT,
  filesize     INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clips_created ON clips (created_at DESC);

CREATE TABLE IF NOT EXISTS recognitions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL DEFAULT '',
  artist        TEXT    NOT NULL DEFAULT '',
  album         TEXT    NOT NULL DEFAULT '',
  release_date  TEXT    NOT NULL DEFAULT '',
  cover         TEXT    NOT NULL DEFAULT '',
  timecode      TEXT    NOT NULL DEFAULT '',
  provider      TEXT    NOT NULL DEFAULT '',
  input         TEXT    NOT NULL DEFAULT 'mic',
  song_link     TEXT    NOT NULL DEFAULT '',
  spotify_url   TEXT    NOT NULL DEFAULT '',
  apple_url     TEXT    NOT NULL DEFAULT '',
  youtube_url   TEXT    NOT NULL DEFAULT '',
  youtube_title TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recognitions_created ON recognitions (created_at DESC);

CREATE TABLE IF NOT EXISTS meta_cache (
  key        TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

const S = {
  insertDownload: db.prepare(`
    INSERT INTO downloads (video_id,url,title,channel,thumbnail,duration,kind,quality,container,status)
    VALUES (@video_id,@url,@title,@channel,@thumbnail,@duration,@kind,@quality,@container,'started')`),
  finishDownload: db.prepare(`
    UPDATE downloads SET status='completed', filesize=?, completed_at=datetime('now') WHERE id=?`),
  failDownload: db.prepare(`
    UPDATE downloads SET status='failed', error=?, completed_at=datetime('now') WHERE id=?`),
  listDownloads: db.prepare(`SELECT * FROM downloads ORDER BY id DESC LIMIT ?`),
  listDownloadsByStatus: db.prepare(
    `SELECT * FROM downloads WHERE status = ? ORDER BY id DESC LIMIT ?`,
  ),

  insertRecognition: db.prepare(`
    INSERT INTO recognitions (title,artist,album,release_date,cover,timecode,provider,input,
                              song_link,spotify_url,apple_url,youtube_url,youtube_title)
    VALUES (@title,@artist,@album,@release_date,@cover,@timecode,@provider,@input,
            @song_link,@spotify_url,@apple_url,@youtube_url,@youtube_title)`),
  getRecognition: db.prepare(`SELECT * FROM recognitions WHERE id = ?`),
  listRecognitions: db.prepare(`SELECT * FROM recognitions ORDER BY id DESC LIMIT ?`),
  deleteRecognition: db.prepare(`DELETE FROM recognitions WHERE id = ?`),
  clearRecognitions: db.prepare(`DELETE FROM recognitions`),
  deleteDownload: db.prepare(`DELETE FROM downloads WHERE id=?`),
  clearDownloads: db.prepare(`DELETE FROM downloads`),

  getTranscript: db.prepare(`SELECT * FROM transcripts WHERE video_id=? AND lang=?`),
  anyTranscript: db.prepare(`SELECT * FROM transcripts WHERE video_id=? ORDER BY id DESC LIMIT 1`),
  putTranscript: db.prepare(`
    INSERT INTO transcripts (video_id,lang,is_auto,source,segments,plain_text)
    VALUES (@video_id,@lang,@is_auto,@source,@segments,@plain_text)
    ON CONFLICT(video_id,lang) DO UPDATE SET
      is_auto=excluded.is_auto, source=excluded.source,
      segments=excluded.segments, plain_text=excluded.plain_text,
      created_at=datetime('now')`),

  getStudy: db.prepare(`SELECT * FROM study_notes WHERE video_id=? AND lang=?`),
  putStudy: db.prepare(`
    INSERT INTO study_notes (video_id,lang,provider,payload)
    VALUES (@video_id,@lang,@provider,@payload)
    ON CONFLICT(video_id,lang) DO UPDATE SET
      provider=excluded.provider, payload=excluded.payload, created_at=datetime('now')`),
  deleteStudy: db.prepare(`DELETE FROM study_notes WHERE video_id=? AND lang=?`),

  insertClip: db.prepare(`
    INSERT INTO clips (id,video_id,url,title,thumbnail,start_sec,end_sec,options,status,stage)
    VALUES (@id,@video_id,@url,@title,@thumbnail,@start_sec,@end_sec,@options,'queued','queued')`),
  updateClip: db.prepare(`
    UPDATE clips SET status=@status, stage=@stage, progress=@progress,
      output_path=COALESCE(@output_path,output_path), filesize=COALESCE(@filesize,filesize),
      error=@error, updated_at=datetime('now')
    WHERE id=@id`),
  getClip: db.prepare(`SELECT * FROM clips WHERE id=?`),
  listClips: db.prepare(`SELECT * FROM clips ORDER BY created_at DESC LIMIT ?`),
  deleteClip: db.prepare(`DELETE FROM clips WHERE id=?`),
  staleClips: db.prepare(`
    SELECT * FROM clips WHERE created_at < datetime('now', ? || ' hours')`),
  orphanClips: db.prepare(`
    UPDATE clips SET status='failed', error='server restarted', updated_at=datetime('now')
    WHERE status IN ('queued','downloading','processing')`),

  countDownloads: db.prepare('SELECT COUNT(*) n FROM downloads'),
  countCompleted: db.prepare("SELECT COUNT(*) n FROM downloads WHERE status='completed'"),
  countTranscripts: db.prepare('SELECT COUNT(*) n FROM transcripts'),
  countClips: db.prepare('SELECT COUNT(*) n FROM clips'),
  sumBytes: db.prepare("SELECT COALESCE(SUM(filesize),0) n FROM downloads WHERE status='completed'"),

  getCache: db.prepare(`SELECT payload FROM meta_cache WHERE key=? AND expires_at > ?`),
  putCache: db.prepare(`
    INSERT INTO meta_cache (key,payload,expires_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, expires_at=excluded.expires_at`),
  sweepCache: db.prepare(`DELETE FROM meta_cache WHERE expires_at <= ?`)
};

const api = {
  raw: db,

  startDownload(row) {
    const info = S.insertDownload.run({
      video_id: row.videoId || '',
      url: row.url || '',
      title: row.title || '',
      channel: row.channel || '',
      thumbnail: row.thumbnail || '',
      duration: Math.round(row.duration || 0),
      kind: row.kind || 'video',
      quality: row.quality || '',
      container: row.container || ''
    });
    return info.lastInsertRowid;
  },
  completeDownload(id, bytes = 0) {
    if (id) S.finishDownload.run(Math.round(bytes), id);
  },
  failDownload(id, message = 'unknown error') {
    if (id) S.failDownload.run(String(message).slice(0, 500), id);
  },

  history(limit = 100, status = null) {
    const n = Math.min(Math.max(1, limit | 0), 500);
    return status ? S.listDownloadsByStatus.all(status, n) : S.listDownloads.all(n);
  },
  removeHistory(id) {
    return S.deleteDownload.run(id).changes;
  },
  clearHistory() {
    return S.clearDownloads.run().changes;
  },

  readTranscript(videoId, lang) {
    const row = lang ? S.getTranscript.get(videoId, lang) : S.anyTranscript.get(videoId);
    if (!row) return null;
    return { ...row, segments: JSON.parse(row.segments) };
  },
  writeTranscript(t) {
    S.putTranscript.run({
      video_id: t.videoId,
      lang: t.lang || 'en',
      is_auto: t.isAuto ? 1 : 0,
      source: t.source || 'timedtext',
      segments: JSON.stringify(t.segments || []),
      plain_text: t.plainText || ''
    });
    return api.readTranscript(t.videoId, t.lang || 'en');
  },

  readStudy(videoId, lang) {
    const row = S.getStudy.get(videoId, lang);
    if (!row) return null;
    return { provider: row.provider, createdAt: row.created_at, ...JSON.parse(row.payload) };
  },
  writeStudy(videoId, lang, provider, payload) {
    S.putStudy.run({
      video_id: videoId,
      lang,
      provider,
      payload: JSON.stringify(payload)
    });
  },
  dropStudy(videoId, lang) {
    S.deleteStudy.run(videoId, lang);
  },

  createClip(clip) {
    S.insertClip.run({
      id: clip.id,
      video_id: clip.videoId,
      url: clip.url,
      title: clip.title || '',
      thumbnail: clip.thumbnail || '',
      start_sec: clip.start,
      end_sec: clip.end,
      options: JSON.stringify(clip.options || {})
    });
    return api.readClip(clip.id);
  },
  patchClip(id, patch = {}) {
    const current = S.getClip.get(id);
    if (!current) return null;
    S.updateClip.run({
      id,
      status: patch.status ?? current.status,
      stage: patch.stage ?? current.stage,
      progress: patch.progress ?? current.progress,
      output_path: patch.outputPath ?? null,
      filesize: patch.filesize ?? null,
      error: patch.error !== undefined ? patch.error : current.error
    });
    return api.readClip(id);
  },
  readClip(id) {
    const row = S.getClip.get(id);
    if (!row) return null;
    return { ...row, options: JSON.parse(row.options || '{}') };
  },
  listClips(limit = 50) {
    return S.listClips.all(Math.min(Math.max(1, limit | 0), 200))
      .map((r) => ({ ...r, options: JSON.parse(r.options || '{}') }));
  },
  removeClip(id) {
    return S.deleteClip.run(id).changes;
  },
  expiredClips(hours = 24) {
    return S.staleClips.all(`-${Math.abs(Number(hours) || 24)}`)
      .map((r) => ({ ...r, options: JSON.parse(r.options || '{}') }));
  },
  markOrphanClips() {
    return S.orphanClips.run().changes;
  },

  addRecognition(r) {
    const info = S.insertRecognition.run({
      title: r.title || '',
      artist: r.artist || '',
      album: r.album || '',
      release_date: r.releaseDate || '',
      cover: r.cover || '',
      timecode: r.timecode || '',
      provider: r.provider || '',
      input: r.input || 'mic',
      song_link: r.songLink || '',
      spotify_url: r.spotifyUrl || '',
      apple_url: r.appleUrl || '',
      youtube_url: r.youtubeUrl || '',
      youtube_title: r.youtubeTitle || '',
    });
    return S.getRecognition.get(info.lastInsertRowid);
  },
  recognitions(limit = 50) {
    return S.listRecognitions.all(Math.min(Math.max(1, limit | 0), 200));
  },
  removeRecognition(id) {
    return S.deleteRecognition.run(id).changes;
  },
  clearRecognitions() {
    return S.clearRecognitions.run().changes;
  },

  cacheGet(key) {
    const row = S.getCache.get(key, Date.now());
    if (!row) return null;
    try { return JSON.parse(row.payload); } catch { return null; }
  },
  cacheSet(key, value, ttlMs) {
    S.putCache.run(key, JSON.stringify(value), Date.now() + ttlMs);
    return value;
  },
  cacheSweep() {
    return S.sweepCache.run(Date.now()).changes;
  },

  stats() {
    return {
      downloads: S.countDownloads.get().n,
      completed: S.countCompleted.get().n,
      transcripts: S.countTranscripts.get().n,
      clips: S.countClips.get().n,
      bytes: S.sumBytes.get().n
    };
  }
};

api.markOrphanClips();
api.cacheSweep();

module.exports = api;
