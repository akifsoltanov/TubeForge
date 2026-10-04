# TubeForge

**Endir. Öyrən. Kəs.**

Öz kompüterində işləyən lokal media studiyası. YouTube və 1000+ saytdan video/audio endirir, mühazirəni dərs materialına çevirir, FFmpeg ilə kliplər kəsir və mahnıları tanıyır. Fayllar xarici buluda göndərilmir — hər şey bu kompüterdə qalır.

| | | | |
| --- | --- | --- | --- |
| **Dillər** | **Platformalar** | **Konteynerlər** | **Harada** |
| EN, AZ, RU, TR | yt-dlp extractor siyahısı | MP4, WebM, MKV, MOV, GIF | Yalnız sənin kompüterində |

---

## Mündəricat

1. [Nə iş görür](#nə-iş-görür)
2. [Necə işləyir](#necə-işləyir)
3. [Modullar](#modullar)
4. [Formatlar](#formatlar)
5. [Texnologiya](#texnologiya)
6. [Quraşdırma](#quraşdırma)
7. [Konfiqurasiya](#konfiqurasiya)
8. [Layihə strukturu](#layihə-strukturu)
9. [Hüquqi qeyd](#hüquqi-qeyd)

---

## Nə iş görür

TubeForge üçüncü tərəfin **cloud downloader** xidməti deyil. Linki yapışdırırsan, server metadata-nı **yt-dlp** və ya **ytdl-core** ilə çıxarır, **FFmpeg** isə faylları çevirir və kəsir. Fayllar, transkriptlər və tarixçə **SQLite + lokal diskdə** saxlanılır.

Brauzerdə [http://localhost:3000](http://localhost:3000) ünvanını aç — eyni interfeysdən endirmə, playlist növbəsi, dərs paketi, klip və mahnı tanıma funksiyalarından istifadə et.

| Modul | Qısa izah |
| --- | --- |
| **Downloader** | Keyfiyyət, kodek və ölçünü göstərir; orijinal və ya çevrilmiş faylı endirir |
| **Playlist** | Siyahını yükləyir, videoları seçir və növbə ilə endirir |
| **Study Mode** | Xülasə, əsas anlayışlar, quiz və axtarıla bilən transkript yaradır |
| **Clip Studio** | Vaxt kəsimi, başlıq, watermark, subtitr, progress bar və GIF imkanları verir |
| **Audio ID** | Mikrofon və ya sistem səsi ilə mahnını tanıyır |
| **Tarixçə** | Tamamlanmış endirmələri lokal bazada saxlayır |

---

## Necə işləyir

```text
  [ Linki yapışdır ]
           |
           v
     +-----------+
     |  Engine   |
     +-----------+
        /     \
       v       v
  ytdl-core   yt-dlp
        \     /
         v   v
    metadata + stream
         |
    +----+----+----+----+
    |    |    |    |    |
    v    v    v    v    v
  Endir Playlist Study Klip Audio ID
    |               |
    v               v
 SQLite        Whisper (subtitr yoxdursa)
```

```text
  Brauzer (public/) --> Express (server.js)
                                |
              +-----------------+-----------------+
              |                 |                 |
         /api/resolve      /api/download     /api/study
              |                 |                 |
           yt-dlp            FFmpeg         captions/Whisper
                                |
                         tubeforge.db
                         storage/clips
```

---

## Modullar

### Downloader

YouTube, TikTok, Instagram, Facebook, X, Twitch, VK, OK.ru və yt-dlp tərəfindən tanınan minlərlə sayt.

- Format cədvəli: keyfiyyət, kodek, FPS, bitrate və ölçü
- Video və audio ayrı gəldikdə FFmpeg ilə birləşdirmə
- Yaş və bot məhdudiyyətləri üçün `COOKIES_FILE` (`.txt` Netscape formatı və ya JSON)

### Playlist

Siyahını aç, hamısını və ya seçilmiş videoları növbəyə qoy. Keyfiyyəti və konteyneri bir dəfə seç.

Növbəni dayandırmaq, elementləri keçmək və təmizləmək mümkündür. Uzun siyahılar `MAX_PLAYLIST_ITEMS` ilə məhdudlaşdırılır. Standart limit **400 elementdir**.

### AI Study Mode

```text
  Subtitr ----+
              +----> xülasə | anlayışlar | quiz | transkript
  Whisper ----+
```

| Mənbə | Nə baş verir |
| --- | --- |
| **Caption track** | Hazır subtitr oxunur |
| **Caption yoxdur** | `npm run setup:whisper` ilə audio bu serverdə mətnə çevrilir |
| `ANTHROPIC_API_KEY` | Claude dərs paketi yaradır |
| **API açarı yoxdur** | Offline analyser şəbəkəsiz işləyir |

Transkript sətrinə klik et — pleyer həmin saniyəyə keçir.

### FFmpeg Clip Studio

| Parametr | Nə edir |
| --- | --- |
| **Vaxt aralığı** | Standart maksimum 10 dəqiqə (`MAX_CLIP_SECONDS`) |
| **Overlay** | Başlıq mətni, watermark və progress bar əlavə edir |
| **Subtitr** | Mövcud caption trekini videoya yandırır |
| **Çıxış** | MP4, WebM, MKV, MOV, GIF |
| **Ömür** | Kliplər `CLIP_RETENTION_HOURS` müddətindən sonra silinir (standart 24 saat) |

GIF üçün ayrıca daha qısa limit var: `MAX_GIF_SECONDS` standart olaraq **30 saniyədir**. Bunun səbəbi hər kadrın ayrıca şəkil kimi emal olunmasıdır.

### Audio ID

Mikrofon və ya sistem səsi ilə işləyir. Brauzer yalnız **HTTPS** və ya **localhost** üzərindən capture icazəsi verir.

| Prioritet | Xidmət |
| --- | --- |
| **1** | ACRCloud, əgər açarlar doldurulubsa |
| **2 / standart** | AudD (pulsuz kvota; token ilə limit artırılır) |

---

## Formatlar

### Video

| Konteyner | Tipik kodek | Qeyd |
| --- | --- | --- |
| **MP4** | H.264 | Universal |
| **WebM** | VP9 / VP8 | Veb üçün |
| **MKV** | Müxtəlif | Çevik konteyner |
| **MOV** | H.264 | Apple ekosistemi |
| **GIF** | Animasiya | Səssiz, Clip Studio üçün |

### Audio

| Lossy | Lossless / xüsusi |
| --- | --- |
| MP3, AAC, M4A, Opus, OGG | FLAC, ALAC, WAV |

Orijinal stream yenidən kodlaşdırılmır. Çevrilmə seçildikdə FFmpeg transcode edir və proses daha uzun çəkə bilər.

---

## Texnologiya

```text
                    TubeForge
                        |
     +----------+-------+--------+----------+
     |          |       |        |          |
  Server     Media    Data    Opsional     UI
     |          |       |        |          |
  Node 18+   ytdl    SQLite  whisper.cpp  public/
  Express    yt-dlp          Claude       locales
             FFmpeg          AudD/ACR
```

| Qat | Texnologiya |
| --- | --- |
| **Server** | Node.js 18.17+, Express |
| **Media** | `@distube/ytdl-core`, yt-dlp, FFmpeg (`fluent-ffmpeg`) |
| **Verilənlər** | better-sqlite3 |
| **Nitq (opsional)** | whisper.cpp |
| **AI (opsional)** | Anthropic Claude |
| **Frontend** | `public/` — HTML, CSS, JavaScript |

---

## Quraşdırma

### Tələblər

- [Node.js](https://nodejs.org/) 18.17+
- [FFmpeg](https://ffmpeg.org/) və ya `ffmpeg-static`
- YouTube-dan kənar saytlar üçün yt-dlp

### Quraşdırma addımları

```bash
git clone <repo-url>
cd TubeForge
npm install
npm run setup:ytdlp
cp .env.example .env
npm start
```

Sonra brauzerdə aç:

[http://localhost:3000](http://localhost:3000)

### Əsas əmrlər

| Əmr | Məqsəd |
| --- | --- |
| `npm start` | Production server-i işə salır |
| `npm run dev` | Watch rejimində serveri yenidən başladır |
| `npm run setup:ytdlp` | yt-dlp-ni `./bin` qovluğuna quraşdırır |
| `npm run setup:whisper` | Lokal nitq → mətn dəstəyini quraşdırır |
| `npm run reset-db` | SQLite verilənlər bazasını sıfırlayır |

Azərbaycan və türk nitqi üçün daha yaxşı nəticə almaq məqsədilə Whisper üçün `small` modeli seçə bilərsən:

```bash
WHISPER_MODEL=small npm run setup:whisper
```

Sağlamlıq yoxlaması:

```text
GET /api/health
```

---

## Konfiqurasiya

`.env.example` faylını `.env` kimi kopyala. Bütün dəyişənlər opsionaldır.

| Dəyişən | Rol | Standart |
| --- | --- | --- |
| `PORT` | HTTP portu | `3000` |
| `MEDIA_ENGINE` | `auto`, `ytdl` və ya `ytdlp` | `auto` |
| `YTDLP_PATH` / `FFMPEG_PATH` | Binar faylların yolu | Avtomatik tapılır |
| `COOKIES_FILE` | Məhdud və ya bot-gated media | — |
| `ANTHROPIC_API_KEY` | Claude dərs paketi | Offline analyser |
| `MAX_CLIP_SECONDS` | Klip limiti | `600` |
| `MAX_GIF_SECONDS` | GIF limiti | `30` |
| `MAX_TRANSCODE_SECONDS` | Ağır encode üçün maksimum müddət | `900` |
| `CLIP_RETENTION_HOURS` | Kliplərin saxlanma müddəti | `24` |
| `MAX_PLAYLIST_ITEMS` | Playlist limiti | `400` |
| `WHISPER_*` | Lokal transkripsiya parametrləri | `bin/` + `models/` |
| `AUDD_API_TOKEN` / `ACR_*` | Mahnı tanıma | AudD pulsuz kvota |

---

## Layihə strukturu

```text
TubeForge/
  server.js           API: resolve, download, study, clips, audio-id
  db.js               SQLite sxemi və sorğular
  public/             UI (index.html, style.css, script.js)
  locales/            en, az, ru, tr
  scripts/            Whisper quraşdırma skriptləri
  storage/clips/      Hazır kliplər
  storage/tmp/        Müvəqqəti fayllar
  data/               tubeforge.db (gitignore)
```

---

## Hüquqi qeyd

TubeForge şəxsi, self-hosted alətdir. Hər platformanın istifadə şərtlərinə, müəllif hüquqlarına və yerli qanunvericiliyə riayət etmək istifadəçinin məsuliyyətindədir.

Müəllif hüququnu pozan və ya sənə məxsus olmayan giriş məlumatları ilə istifadə etmə.

**MIT lisenziyası** — `package.json`.
