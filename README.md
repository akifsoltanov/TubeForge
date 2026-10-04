# TubeForge

**Endir. Oyren. Kes.**

Oz kompyuterinde isleyen media studiyasi. YouTube ve 1000+ saytdan video/audio endirir, muhazireni ders materialina cevirir, FFmpeg ile klip kesir, mahini tanidir. Fayllar kenar cloud-a getmir — her sey bu mashinda qalir.

| | | | |
| --- | --- | --- | --- |
| **Diller** | **Platformalar** | **Konteynerler** | **Harada** |
| EN, AZ, RU, TR | yt-dlp extractor siyahisi | MP4, WebM, MKV, MOV, GIF | Yalniz senin mashinin |

---

## Mundericat

1. [Ne is gorur](#ne-is-gorur)
2. [Nece axir](#nece-axir)
3. [Modullar](#modullar)
4. [Formatlar](#formatlar)
5. [Texnologiya](#texnologiya)
6. [Qurashdirma](#qurashdirma)
7. [Konfiqurasiya](#konfiqurasiya)
8. [Layihe strukturu](#layihe-strukturu)
9. [Huquqi qeyd](#huquqi-qeyd)

---

## Ne is gorur

TubeForge ucuncu terefin "cloud downloader"-i **deyil**. Linki yapishdirirsan, server metadata-ni **yt-dlp** ve ya **ytdl-core** ile chixarir, **FFmpeg** chevirir ve kesir. Fayllar, transkriptler ve tarikhe **SQLite + lokal disk**-de qalir.

Brauzerde [http://localhost:3000](http://localhost:3000) ach — eyni interfeysdən endirme, playlist novbesi, ders paketi, klip ve mahni tanima.

| Modul | Qisa izah |
| --- | --- |
| Downloader | Keyfiyyet, kodek, olchunu gor; original ve ya chevrilmish fayl endir |
| Playlist | Siyahini yukle, videolari sech, novbe ile endir |
| Study Mode | Xulase, esas anlayishlar, quiz, axtarila bilen transkript |
| Clip Studio | Vaxt kesimi, bashliq, watermark, subtitr, progress bar, GIF |
| Audio ID | Mikrofon ve ya sistem sesi ile mahni tani |
| Tarikhe | Tamamlanmish endirmeler lokal bazada |

---

## Nece axir

```
  [ Link yapishdir ]
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
 Endir  Playlist  Study  Klip  Audio ID
    |               |
    v               v
 SQLite        Whisper (subtitr yoxdursa)
```

```
  Brauzer (public/)  -->  Express (server.js)
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

YouTube, TikTok, Instagram, Facebook, X, Twitch, VK, OK.ru ve yt-dlp-nin tanidighi minlerle sayt.

- Format cedveli: keyfiyyet, kodek, FPS, bitrate, olchu
- Video ve audio ayri gelende FFmpeg merge
- Yash / bot mehdudiyyeti uchun `COOKIES_FILE` (Netscape `.txt` ve ya JSON)

### Playlist

Siyahini ach, hamisini ve ya sechilmishleri novbeye qoy. Keyfiyyeti ve konteyneri bir defe sech. Dayandir, kech, temizlemek. Uzun siyahilar `MAX_PLAYLIST_ITEMS` ile kesilir (standart **400**).

### AI Study Mode

```
  Subtitr ----+
              +---->  xulase  |  anlayishlar  |  quiz  |  transkript
  Whisper ----+
```

| Menbe | Ne bash verir |
| --- | --- |
| Caption track | Hazir subtitr oxunur |
| Caption yoxdur | `npm run setup:whisper` — ses bu serverde yaziya chevrilir |
| `ANTHROPIC_API_KEY` | Claude ders paketi yazar |
| Achar yoxdur | Offline analyser shebekesiz ishleyir |

Setirde klikle — pleyer hemin saniyeye tullanir.

### FFmpeg Clip Studio

| Parametr | Ne edir |
| --- | --- |
| Vaxt aralighi | Standart max 10 deqiqe (`MAX_CLIP_SECONDS`) |
| Overlay | Bashliq metni, watermark, progress bar |
| Subtitr | Movcud caption yandirilir |
| Chixish | mp4, webm, mkv, mov, gif |
| Omur | Klipler `CLIP_RETENTION_HOURS` sonra silinir (standart 24 saat) |

GIF uchun ayrica qisa limit var (`MAX_GIF_SECONDS`, standart 30 saniye), chunki her kadr shekil kimi aghirdir.

### Audio ID

Mikrofon ve ya sistem sesi. Brauzer yalniz **HTTPS** ve ya **localhost**-da capture icazesi verir.

| Prioritet | Xidmet |
| --- | --- |
| 1 (acharlar doludursa) | ACRCloud |
| 2 / default | AudD (pulsuz kvota; token limiti artirir) |

---

## Formatlar

**Video**

| Konteyner | Tipik kodek | Qeyd |
| --- | --- | --- |
| MP4 | H.264 | Universal |
| WebM | VP9 / VP8 | Veb |
| MKV | muxtelif | Chevik konteyner |
| MOV | H.264 | Apple |
| GIF | animasiya | Sessiz, Clip Studio |

**Audio**

| Lossy | Lossless / xususi |
| --- | --- |
| MP3, AAC, M4A, Opus, OGG | FLAC, ALAC, WAV |

Original stream yeniden encode olunmur. Chevrilme sechende FFmpeg transcode edir ve daha uzun chekir.

---

## Texnologiya

```
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
| Server | Node.js 18.17+, Express |
| Media | `@distube/ytdl-core`, yt-dlp, FFmpeg (`fluent-ffmpeg`) |
| Verilenler | better-sqlite3 |
| Nitq (opsional) | whisper.cpp |
| AI (opsional) | Anthropic Claude |
| Frontend | `public/` — HTML, CSS, JS |

---

## Qurashdirma

Lazimdir:

- [Node.js](https://nodejs.org/) 18.17+
- [FFmpeg](https://ffmpeg.org/) (ve ya `ffmpeg-static`)
- YouTube-dan kenar saytlar uchun yt-dlp

```bash
git clone <repo-url>
cd TubeForge
npm install
npm run setup:ytdlp
cp .env.example .env
npm start
```

Sonra ach: [http://localhost:3000](http://localhost:3000)

| Emr | Meqsed |
| --- | --- |
| `npm start` | Production server |
| `npm run dev` | Watch ile yeniden bashlat |
| `npm run setup:ytdlp` | `./bin` ichinde yt-dlp |
| `npm run setup:whisper` | Lokal nitq-yazi (Study Mode) |
| `npm run reset-db` | SQLite-i sifirla |

Azerbaycan / turk nitqi uchun daha yaxshi Whisper modeli:

```bash
WHISPER_MODEL=small npm run setup:whisper
```

Saghlamliq yoxlamasi: `GET /api/health`

---

## Konfiqurasiya

`.env.example` faylini `.env` kimi kopyala. Hamisi opsionaldir.

| Deyishen | Rol | Standart |
| --- | --- | --- |
| `PORT` | HTTP port | `3000` |
| `MEDIA_ENGINE` | `auto`, `ytdl` ve ya `ytdlp` | `auto` |
| `YTDLP_PATH` / `FFMPEG_PATH` | Binar yolu | avto-tapilir |
| `COOKIES_FILE` | Mehdud / bot-gated media | — |
| `ANTHROPIC_API_KEY` | Claude ders paketi | offline analyser |
| `MAX_CLIP_SECONDS` | Klip limiti | `600` |
| `MAX_GIF_SECONDS` | GIF limiti | `30` |
| `MAX_TRANSCODE_SECONDS` | Aghir encode tavani | `900` |
| `CLIP_RETENTION_HOURS` | Klip saxlama | `24` |
| `MAX_PLAYLIST_ITEMS` | Playlist tavani | `400` |
| `WHISPER_*` | Lokal transkripsiya | `bin/` + `models/` |
| `AUDD_API_TOKEN` / `ACR_*` | Mahni tanima | AudD pulsuz kvota |

---

## Layihe strukturu

```
TubeForge/
  server.js           API: resolve, download, study, clips, audio-id
  db.js               SQLite sxema ve sorgular
  public/             UI (index.html, style.css, script.js)
  locales/            en, az, ru, tr
  scripts/            whisper qurashdirma
  storage/clips/      hazir klipler
  storage/tmp/        muveqqeti fayllar
  data/               tubeforge.db (gitignore)
```

---

## Huquqi qeyd

TubeForge shexsi, self-hosted aletdir. Her platformanin istifade shertleri, muellif huququ ve yerli qanun sene aiddir. Huquq pozuntusu ve ya sene mexsus olmayan girish uchun istifade etme.

**MIT** lisenziya — `package.json`.
