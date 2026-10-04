"use strict";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [
  ...scope.querySelectorAll(selector),
];

const SVG_NS = "http://www.w3.org/2000/svg";

const dom = {
  make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  },
  clone(templateId) {
    const tpl = document.getElementById(templateId);
    return tpl.content.firstElementChild.cloneNode(true);
  },
  clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  },
  show(node, visible = true) {
    if (node) node.hidden = !visible;
  },
  on(node, type, handler, options) {
    node.addEventListener(type, handler, options);
    return () => node.removeEventListener(type, handler, options);
  },

  icon(id, className = "") {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (className) svg.setAttribute("class", className);
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#${id}`);
    svg.append(use);
    return svg;
  },

  svg(markup) {
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    return document.importNode(doc.documentElement, true);
  },

  download(href, filename = "") {
    const link = dom.make("a");
    link.href = href;
    link.download = filename;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  },
};

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
    }
  },
};

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const fmt = {
  get locale() {
    return i18n.lang || "en";
  },

  clock(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  },

  hms(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  },

  parseClock(value) {
    const text = String(value ?? "").trim();
    if (!text) return NaN;
    if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
    if (!/^[\d:]+(\.\d+)?$/.test(text)) return NaN;
    const parts = text.split(":").map(Number);
    if (parts.length > 3 || parts.some(Number.isNaN)) return NaN;
    return parts.reduce((acc, part) => acc * 60 + part, 0);
  },

  bytes(value) {
    const n = Number(value) || 0;
    if (n <= 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = n;
    let i = 0;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i += 1;
    }
    const digits = size >= 100 || i === 0 ? 0 : 1;
    return `${size.toFixed(digits)} ${units[i]}`;
  },

  number(value) {
    const n = Number(value) || 0;
    try {
      return n.toLocaleString(fmt.locale);
    } catch {
      return String(n);
    }
  },

  count(value) {
    const n = Number(value) || 0;
    try {
      return n.toLocaleString(fmt.locale, {
        notation: n >= 10000 ? "compact" : "standard",
      });
    } catch {
      return String(n);
    }
  },

  date(value, withTime = true) {
    if (!value) return "—";
    const date = new Date(
      String(value).includes("T") ? value : `${value}Z`.replace(" ", "T"),
    );
    if (Number.isNaN(date.getTime())) return String(value);
    try {
      return date.toLocaleString(fmt.locale, {
        dateStyle: "medium",
        ...(withTime ? { timeStyle: "short" } : {}),
      });
    } catch {
      return date.toISOString().slice(0, 16).replace("T", " ");
    }
  },

  uploadDate(value) {
    const m = String(value || "").match(/^(\d{4})(\d{2})(\d{2})$/);
    return m
      ? fmt.date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`, false)
      : fmt.date(value, false);
  },
};

const flags = {
  seq: 0,

  star(cx, cy, outer, inner, points, rotation = -90) {
    const step = Math.PI / points;
    const start = (rotation * Math.PI) / 180;
    let d = "";
    for (let i = 0; i < points * 2; i += 1) {
      const r = i % 2 === 0 ? outer : inner;
      const a = start + i * step;
      d += `${i ? "L" : "M"}${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    }
    return `${d}Z`;
  },

  body(code, id) {
    switch (code) {
      case "az":
        return (
          '<rect width="30" height="20" fill="#00B5E2"/>' +
          '<rect y="6.667" width="30" height="6.667" fill="#EF3340"/>' +
          '<rect y="13.333" width="30" height="6.667" fill="#509E2F"/>' +
          '<circle cx="14" cy="10" r="3" fill="#fff"/>' +
          '<circle cx="14.75" cy="10" r="2.5" fill="#EF3340"/>' +
          `<path fill="#fff" d="${this.star(17.6, 10, 1.25, 0.55, 8, -90)}"/>`
        );
      case "ru":
        return (
          '<rect width="30" height="20" fill="#fff"/>' +
          '<rect y="6.667" width="30" height="6.667" fill="#0039A6"/>' +
          '<rect y="13.333" width="30" height="6.667" fill="#D52B1E"/>'
        );
      case "tr":
        return (
          '<rect width="30" height="20" fill="#E30A17"/>' +
          '<circle cx="10.5" cy="10" r="5" fill="#fff"/>' +
          '<circle cx="11.75" cy="10" r="4" fill="#E30A17"/>' +
          `<path fill="#fff" d="${this.star(16.4, 10, 2.5, 1.0, 5, 180)}"/>`
        );
      case "en":
      default:
        return (
          `<clipPath id="uk-s-${id}"><path d="M0,0v20h30V0z"/></clipPath>` +
          `<clipPath id="uk-t-${id}"><path d="M15,10h15v10zv10H0zH0V0zV0h15z"/></clipPath>` +
          `<g clip-path="url(#uk-s-${id})">` +
          '<path d="M0,0v20h30V0z" fill="#012169"/>' +
          '<path d="M0,0 30,20M30,0 0,20" stroke="#fff" stroke-width="4"/>' +
          `<path d="M0,0 30,20M30,0 0,20" clip-path="url(#uk-t-${id})" stroke="#C8102E" stroke-width="2.6"/>` +
          '<path d="M15,0v20M0,10h30" stroke="#fff" stroke-width="6.6"/>' +
          '<path d="M15,0v20M0,10h30" stroke="#C8102E" stroke-width="4"/>' +
          "</g>"
        );
    }
  },

  svg(code) {
    this.seq += 1;
    return dom.svg(
      `<svg xmlns="${SVG_NS}" class="flag__svg" viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${this.body(code, this.seq)}</svg>`,
    );
  },

  node(code) {
    const span = dom.make("span", "flag");
    span.setAttribute("aria-hidden", "true");
    span.append(this.svg(code));
    return span;
  },
};

const i18n = {
  lang: "en",
  dict: {},
  available: ["en", "az", "ru", "tr"],
  meta: {
    en: { native: "English" },
    az: { native: "Azərbaycan" },
    ru: { native: "Русский" },
    tr: { native: "Türkçe" },
  },
  cache: new Map(),
  listeners: new Set(),

  detect() {
    const stored = storage.get("tf:lang");
    if (stored && this.available.includes(stored)) return stored;
    for (const tag of navigator.languages || [navigator.language || "en"]) {
      const base = String(tag).toLowerCase().split("-")[0];
      if (this.available.includes(base)) return base;
    }
    return "en";
  },

  async load(lang) {
    if (this.cache.has(lang)) return this.cache.get(lang);
    const response = await fetch(`/api/locales/${lang}`);
    if (!response.ok) throw new Error(`locale ${lang} unavailable`);
    const dict = await response.json();
    this.cache.set(lang, dict);
    return dict;
  },

  async use(lang) {
    const target = this.available.includes(lang) ? lang : "en";
    this.dict = await this.load(target);
    this.lang = target;
    storage.set("tf:lang", target);

    const meta = this.dict.meta || {};
    document.documentElement.lang = target;
    document.documentElement.dir = meta.dir || "ltr";
    this.apply();
    this.listeners.forEach((fn) => {
      try {
        fn(target);
      } catch (error) {
        console.error(error);
      }
    });
    return target;
  },

  onChange(fn) {
    this.listeners.add(fn);
  },

  has(key) {
    return this.t(key) !== key;
  },

  t(key, vars) {
    const value = String(key)
      .split(".")
      .reduce(
        (node, part) =>
          node && typeof node === "object" ? node[part] : undefined,
        this.dict,
      );
    let text = typeof value === "string" ? value : key;
    if (vars) {
      for (const [name, replacement] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(replacement));
      }
    }
    return text;
  },

  apply(root = document) {
    $$("[data-i18n]", root).forEach((node) => {
      node.textContent = this.t(node.dataset.i18n);
    });
    $$("[data-i18n-attr]", root).forEach((node) => {
      for (const pair of node.dataset.i18nAttr.split(";")) {
        const at = pair.indexOf(":");
        if (at < 0) continue;
        node.setAttribute(
          pair.slice(0, at).trim(),
          this.t(pair.slice(at + 1).trim()),
        );
      }
    });
    if (root === document) {
      $("#footerCopyright").textContent = this.t("footer.copyright", {
        year: new Date().getFullYear(),
      });
      document.title = `${this.t("app.name")} — ${this.t("app.tagline")}`;
      $('meta[name="description"]')?.setAttribute(
        "content",
        this.t("app.description"),
      );
    }
  },
};

const theme = {
  init() {
    const stored = storage.get("tf:theme");
    const system = matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
    this.set(stored || system, false);

    dom.on($("#themeToggle"), "click", () => {
      const next =
        document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      this.set(next, true);
    });

    matchMedia("(prefers-color-scheme: light)").addEventListener(
      "change",
      (event) => {
        if (!storage.get("tf:theme"))
          this.set(event.matches ? "light" : "dark", false);
      },
    );
  },

  set(value, announce) {
    document.documentElement.dataset.theme = value;
    $('meta[name="theme-color"]').setAttribute(
      "content",
      value === "dark" ? "#070811" : "#f5f6fb",
    );
    if (announce) {
      storage.set("tf:theme", value);
      toast.show(
        i18n.t(value === "dark" ? "toast.themeDark" : "toast.themeLight"),
        "info",
      );
    }
  },
};

const toast = {
  icons: {
    success: "ic-check",
    error: "ic-close",
    warning: "ic-warn",
    info: "ic-info",
  },
  MAX: 4,

  show(message, kind = "info", duration = 4200) {
    const host = $("#toasts");

    while (host.children.length >= this.MAX) host.firstElementChild.remove();

    const node = dom.make("div", `toast toast--${kind}`);
    node.setAttribute("role", kind === "error" ? "alert" : "status");

    const icon = dom.make("span", "toast__icon");
    icon.append(dom.icon(this.icons[kind] || this.icons.info));

    const close = dom.make("button", "toast__close");
    close.type = "button";
    close.setAttribute("aria-label", i18n.t("common.close"));
    close.append(dom.icon("ic-close"));

    const bar = dom.make("span", "toast__bar");
    bar.style.animationDuration = `${duration}ms`;

    node.append(icon, dom.make("div", "toast__body", message), close, bar);
    host.append(node);

    let timer = null;
    const dismiss = () => {
      clearTimeout(timer);
      if (!node.isConnected || node.classList.contains("is-leaving")) return;
      node.classList.add("is-leaving");

      setTimeout(() => node.remove(), 400);
    };
    timer = setTimeout(dismiss, duration);
    dom.on(close, "click", dismiss);
    return dismiss;
  },

  success(message) {
    return this.show(message, "success");
  },
  error(message) {
    return this.show(message, "error", 5600);
  },
  warn(message) {
    return this.show(message, "warning");
  },

  message(error, fallbackKey = "errors.generic") {
    const code = error?.code;
    if (code && i18n.has(`errors.${code}`)) return i18n.t(`errors.${code}`);
    return error?.message || i18n.t(fallbackKey);
  },

  fromError(error, fallbackKey = "errors.generic") {
    if (error?.name === "AbortError") return;
    this.error(this.message(error, fallbackKey));
  },
};

class ApiError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

const api = {
  async request(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: {
          ...(typeof options.body === "string"
            ? { "content-type": "application/json" }
            : {}),
          ...options.headers,
        },
      });
    } catch (cause) {
      if (cause?.name === "AbortError") throw cause;
      throw new ApiError("network", i18n.t("errors.network"), 0);
    }
    const isJson = (response.headers.get("content-type") || "").includes(
      "application/json",
    );
    const payload = isJson ? await response.json().catch(() => null) : null;
    if (!response.ok) {
      throw new ApiError(
        payload?.error?.code || "generic",
        payload?.error?.message,
        response.status,
      );
    }
    return payload;
  },

  get(path, options) {
    return this.request(path, options);
  },
  post(path, body) {
    return this.request(path, {
      method: "POST",
      body: JSON.stringify(body || {}),
    });
  },
  del(path) {
    return this.request(path, { method: "DELETE" });
  },

  config() {
    return this.get("/api/config");
  },
  resolve(url, prefer) {
    return this.post("/api/resolve", { url, prefer });
  },

  study(media, lang, fresh) {
    const query = new URLSearchParams({ src: media.sourceUrl || media.url });
    if (lang) query.set("lang", lang);
    if (fresh) query.set("fresh", "1");
    return this.get(
      `/api/study/${encodeURIComponent(media.id || "media")}?${query}`,
    );
  },
  createClip(body) {
    return this.post("/api/clips", body);
  },
  clip(id) {
    return this.get(`/api/clips/${id}`);
  },
  clips() {
    return this.get("/api/clips");
  },
  cancelClip(id) {
    return this.post(`/api/clips/${id}/cancel`);
  },
  deleteClip(id) {
    return this.del(`/api/clips/${id}`);
  },
  history() {
    return this.get("/api/history");
  },
  clearHistory() {
    return this.del("/api/history");
  },
  removeHistory(id) {
    return this.del(`/api/history/${id}`);
  },
  recognize(blob, input, signal) {
    return this.request(
      `/api/audioid/recognize?input=${encodeURIComponent(input)}`,
      {
        method: "POST",
        body: blob,
        headers: { "content-type": blob.type || "application/octet-stream" },
        signal,
      },
    );
  },
  recognitions() {
    return this.get("/api/audioid/history");
  },
  removeRecognition(id) {
    return this.del(`/api/audioid/history/${id}`);
  },
  clearRecognitions() {
    return this.del("/api/audioid/history");
  },

  downloadUrl(src, key, { to, h, abr, c, kind } = {}) {
    const query = new URLSearchParams({ src, key: key || "" });
    if (to) query.set("to", to);
    if (h) query.set("h", String(h));
    if (abr) query.set("abr", String(abr));
    if (c) query.set("c", c);
    if (kind) query.set("kind", kind);
    return `/api/download?${query}`;
  },

  previewUrl(src) {
    return `/api/preview?${new URLSearchParams({ src })}`;
  },
};

const store = {
  config: null,
  media: null,
  playlist: null,
  formatTab: "video",
  clipJobId: null,
  queueRunning: false,
};

const media = {
  listeners: new Set(),

  onChange(fn) {
    this.listeners.add(fn);
  },

  set(video) {
    store.media = video;
    this.listeners.forEach((fn) => {
      try {
        fn(video);
      } catch (error) {
        console.error(error);
      }
    });
  },

  isYouTube(video) {
    return (
      !!video &&
      video.platform === "youtube" &&
      /^[\w-]{11}$/.test(video.id || "")
    );
  },
};

const player = {
  kind: null,
  instance: null,
  host: null,
  mediaKey: null,
  ready: false,
  apiPromise: null,
  ticker: null,
  onTick: null,
  onDuration: null,
  token: 0,

  loadApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (this.apiPromise) return this.apiPromise;
    this.apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      const timer = setTimeout(
        () => reject(new Error("YouTube IFrame API timed out")),
        12000,
      );
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timer);
        if (typeof previous === "function") previous();
        resolve();
      };
      const script = dom.make("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(new Error("YouTube IFrame API blocked"));
      };
      document.head.append(script);
    }).catch((error) => {

      this.apiPromise = null;
      throw error;
    });
    return this.apiPromise;
  },

  ensure(node, video) {
    if (!node || !video) return;
    if (this.host === node && this.mediaKey === video.key && node.firstChild)
      return;
    const carry = this.mediaKey === video.key ? this.currentTime() || 0 : 0;
    this.mount(node, video, { start: carry });
  },

  async mount(node, video, { start = 0, autoplay = false } = {}) {
    this.destroy();
    const token = ++this.token;
    this.host = node;
    this.mediaKey = video.key;
    dom.clear(node);

    if (media.isYouTube(video)) {
      const host = dom.make("div");
      node.append(host);
      try {
        await this.loadApi();
      } catch {
        if (token !== this.token) return;

        const frame = dom.make("iframe");
        frame.src = `https://www.youtube-nocookie.com/embed/${video.id}?start=${Math.floor(start)}`;
        frame.allow =
          "accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture";
        frame.allowFullscreen = true;
        frame.title = video.title || "YouTube";
        dom.clear(node).append(frame);
        this.kind = "embed";
        return;
      }
      if (token !== this.token) return;
      this.kind = "youtube";
      await new Promise((resolve) => {
        this.instance = new window.YT.Player(host, {
          videoId: video.id,
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            autoplay: autoplay ? 1 : 0,
            start: Math.floor(start) || undefined,
            origin: location.origin,
          },
          events: {
            onReady: () => {
              if (token === this.token) {
                this.ready = true;
                this.startTicker();
              }
              resolve();
            },
          },
        });
      });
      return;
    }

    const element = dom.make("video", "player-frame__video");
    element.controls = true;
    element.preload = "metadata";
    element.playsInline = true;
    if (video.thumbnail) element.poster = video.thumbnail;
    element.src = api.previewUrl(video.sourceUrl || video.url);
    if (start > 0) {
      element.addEventListener(
        "loadedmetadata",
        () => {
          element.currentTime = start;
        },
        { once: true },
      );
    }
    element.addEventListener("timeupdate", () => {
      if (typeof this.onTick === "function") this.onTick(element.currentTime);
    });

    element.addEventListener("loadedmetadata", () => {
      if (typeof this.onDuration === "function")
        this.onDuration(element.duration);
    });
    node.append(element);
    this.kind = "html5";
    this.instance = element;
    this.ready = true;
    if (autoplay) element.play().catch(() => {});
  },

  startTicker() {
    clearInterval(this.ticker);
    this.ticker = setInterval(() => {
      if (!this.ready || typeof this.onTick !== "function") return;
      const time = this.currentTime();
      if (time !== null) this.onTick(time);
    }, 400);
  },

  seek(seconds, play = true) {
    if (!this.ready || !this.instance) return false;
    const target = Math.max(0, Number(seconds) || 0);
    try {
      if (this.kind === "html5") {
        this.instance.currentTime = target;
        if (play) this.instance.play().catch(() => {});
      } else {
        this.instance.seekTo(target, true);
        if (play) this.instance.playVideo();
      }
      return true;
    } catch {
      return false;
    }
  },

  currentTime() {
    if (!this.ready || !this.instance) return null;
    try {
      return this.kind === "html5"
        ? this.instance.currentTime || 0
        : this.instance.getCurrentTime() || 0;
    } catch {
      return null;
    }
  },

  pause() {
    try {
      if (this.kind === "html5") this.instance?.pause();
      else this.instance?.pauseVideo?.();
    } catch {
    }
  },

  destroy() {
    this.token += 1;
    clearInterval(this.ticker);
    this.ticker = null;
    this.ready = false;
    try {
      if (this.kind === "html5" && this.instance) {

        this.instance.pause();
        this.instance.removeAttribute("src");
        this.instance.load();
      } else {
        this.instance?.destroy?.();
      }
    } catch {
    }
    if (this.host) dom.clear(this.host);
    this.instance = null;
    this.kind = null;
    this.host = null;
    this.mediaKey = null;
  },
};

const modal = {
  active: null,
  onClose: null,
  lastFocus: null,

  init() {
    $$(".modal").forEach((node) => {
      $$("[data-close-modal]", node).forEach((closer) =>
        dom.on(closer, "click", () => this.close()),
      );
    });
    dom.on(document, "keydown", (event) => {
      if (event.key === "Escape" && this.active) this.close();
    });
  },

  open(node, onClose) {
    if (this.active) this.close();
    this.lastFocus = document.activeElement;
    this.active = node;
    this.onClose = onClose || null;
    node.hidden = false;
    document.body.classList.add("is-locked");
    $("[data-close-modal].icon-btn", node)?.focus({ preventScroll: true });
  },

  close() {
    const node = this.active;
    if (!node) return;
    node.hidden = true;
    this.active = null;
    document.body.classList.remove("is-locked");
    const done = this.onClose;
    this.onClose = null;
    done?.();
    this.lastFocus?.focus?.({ preventScroll: true });
  },
};

const VIEWS = [
  "downloader",
  "playlist",
  "study",
  "clips",
  "audioid",
  "history",
];

const nav = {
  view: null,
  hooks: {},

  init() {
    dom.on(window, "hashchange", () => this.fromHash());

    const drawer = $("#drawer");
    const backdrop = $("#drawerBackdrop");
    const toggle = $("#drawerToggle");

    const close = (restoreFocus = true) => {
      if (drawer.hidden) return;
      drawer.classList.add("is-closing");
      setTimeout(() => {
        drawer.hidden = true;
        drawer.classList.remove("is-closing");
      }, 180);
      backdrop.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", i18n.t("a11y.openMenu"));
      document.body.classList.remove("is-locked");
      if (restoreFocus) toggle.focus();
    };

    const open = () => {
      drawer.hidden = false;
      backdrop.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", i18n.t("a11y.closeMenu"));
      document.body.classList.add("is-locked");
      $("#drawerClose").focus();
    };

    dom.on(toggle, "click", () => (drawer.hidden ? open() : close()));
    dom.on($("#drawerClose"), "click", () => close());
    dom.on(backdrop, "click", () => close());
    $$(".drawer__link").forEach((link) =>
      dom.on(link, "click", () => close(false)),
    );
    dom.on(document, "keydown", (event) => {
      if (event.key === "Escape" && !drawer.hidden) close();
    });

    matchMedia("(min-width: 1101px)").addEventListener("change", (event) => {
      if (event.matches) close(false);
    });

    const header = $("#siteHeader");
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        header.classList.toggle("is-stuck", window.scrollY > 8);
        ticking = false;
      });
    };
    dom.on(window, "scroll", onScroll, { passive: true });
    onScroll();
  },

  register(view, hooks) {
    this.hooks[view] = hooks;
  },

  fromHash() {
    const name = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
    this.show(VIEWS.includes(name) ? name : "downloader");
  },

  go(view) {
    const hash = `#/${view}`;
    if (location.hash !== hash) location.hash = hash;
    else this.show(view);
  },

  show(view) {
    if (view === this.view) return;
    const previous = this.view;
    if (previous) {
      try {
        this.hooks[previous]?.leave?.();
      } catch (error) {
        console.error(error);
      }
    }
    this.view = view;

    $$("[data-view]").forEach((section) => {
      section.hidden = section.dataset.view !== view;
    });
    $$("[data-nav]").forEach((link) => {
      const active = link.dataset.nav === view;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    formatsShowcase.syncVisibility();

    if (previous) window.scrollTo({ top: 0, behavior: "auto" });
    try {
      this.hooks[view]?.enter?.();
    } catch (error) {
      console.error(error);
    }
  },
};

const clipboard = {
  async read() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        toast.warn(i18n.t("input.pasteEmpty"));
        return null;
      }
      return text;
    } catch {
      toast.warn(i18n.t("input.pasteDenied"));
      return null;
    }
  },
};

class ToolForm {
  constructor(form, { onSubmit, hintKey }) {
    this.form = form;
    this.input = $(".tool-form__input", form);
    this.field = $(".tool-form__field", form);
    this.submit = $(".tool-form__submit", form);
    this.hintNode = $(".tool-form__hint", form);
    this.hintKey = hintKey;
    this.onSubmit = onSubmit;

    dom.on(form, "submit", (event) => {
      event.preventDefault();
      if (this.submit.disabled) return;
      const url = this.input.value.trim();
      const kind = downloader.detect(url);
      if (!url || kind === "invalid") {
        this.field.classList.remove("is-invalid");
        void this.field.offsetWidth;
        this.field.classList.add("is-invalid");
        this.hint(i18n.t(url ? "input.invalid" : "input.empty"), "error");
        this.input.focus();
        return;
      }
      this.onSubmit(url, kind);
    });
    dom.on(this.input, "input", () => {
      this.field.classList.remove("is-invalid");
      this.resetHint();
    });
    dom.on(this.input, "focus", () => this.field.classList.add("is-focused"));
    dom.on(this.input, "blur", () => this.field.classList.remove("is-focused"));
    dom.on($(".tool-form__paste", form), "click", async () => {
      const text = await clipboard.read();
      if (text === null) return;
      this.input.value = text;
      this.resetHint();
      this.form.requestSubmit();
    });
    i18n.onChange(() => {
      if (!this.hintNode.classList.contains("is-error")) this.resetHint();
      $(".btn__label", this.submit).textContent = i18n.t(
        this.submit.disabled ? "tools.loading" : "tools.load",
      );
    });
    this.resetHint();
  }

  hint(text, kind) {
    this.hintNode.textContent = text || "";
    this.hintNode.classList.toggle("is-error", kind === "error");
  }

  resetHint() {
    this.hint(i18n.t(this.hintKey));
  }

  busy(on) {
    this.submit.classList.toggle("is-busy", on);
    this.submit.disabled = on;
    $(".btn__label", this.submit).textContent = i18n.t(
      on ? "tools.loading" : "tools.load",
    );
  }

  set(url) {
    if (url) this.input.value = url;
  }

  focus() {
    if (matchMedia("(hover: hover)").matches)
      this.input.focus({ preventScroll: true });
  }
}

async function loadMedia(url, { form, skeleton, workspace }) {
  form.busy(true);
  dom.show(skeleton, true);
  dom.show(workspace, false);
  try {
    const result = await api.resolve(url, "video");
    if (result.type === "playlist") {
      playlist.accept(result.playlist, url);
      nav.go("playlist");
      toast.success(i18n.t("toast.playlistLoaded"));
      return null;
    }
    media.set(result.video);
    toast.success(i18n.t("toast.metaLoaded"));
    return result.video;
  } catch (error) {
    form.hint(toast.message(error, "toast.metaFailed"), "error");
    toast.fromError(error, "toast.metaFailed");
    return null;
  } finally {
    form.busy(false);
    dom.show(skeleton, false);
    dom.show(workspace, !!store.media);
  }
}

function paintStrip(strip, video) {
  if (!strip || !video) return;
  const img = $(".media-strip__thumb", strip);
  img.src = video.thumbnail || "";
  img.hidden = !video.thumbnail;
  $(".media-strip__title", strip).textContent = video.title || video.url;
  $(".media-strip__meta", strip).textContent = [
    video.channel,
    video.duration ? video.durationLabel : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const badge = $(".media-strip__badge", strip);
  badge.textContent = video.platformLabel || "";
  badge.hidden = !video.platformLabel;
}

const langSwitch = {
  init() {
    const toggle = $("#langToggle");
    const menu = $("#langMenu");

    const render = () => {
      dom.clear(menu);
      for (const code of i18n.available) {
        const meta = i18n.meta[code] || {};
        const item = dom.make("li");
        item.setAttribute("role", "none");
        const button = dom.make("button");
        button.type = "button";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(code === i18n.lang));
        button.lang = code;
        button.append(
          flags.node(code),
          dom.make(
            "span",
            "lang-switch__name",
            meta.native || code.toUpperCase(),
          ),
          dom.make("span", "lang-switch__iso", code.toUpperCase()),
          dom.icon("ic-check", "tick"),
        );
        dom.on(button, "click", async () => {
          close();
          toggle.focus();
          if (code === i18n.lang) return;
          try {
            await i18n.use(code);
            toast.success(
              i18n.t("toast.languageChanged", {
                language: meta.native || code,
              }),
            );
          } catch {
            toast.error(i18n.t("errors.network"));
          }
        });
        item.append(button);
        menu.append(item);
      }
    };

    const options = () => $$("button[role=option]", menu);
    const close = () => {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      render();
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      (
        options().find((o) => o.getAttribute("aria-selected") === "true") ||
        options()[0]
      )?.focus();
    };

    dom.on(toggle, "click", (event) => {
      event.stopPropagation();
      menu.hidden ? open() : close();
    });
    dom.on(menu, "keydown", (event) => {
      const list = options();
      const index = list.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        list[(index + step + list.length) % list.length]?.focus();
      } else if (event.key === "Tab") {
        close();
      }
    });
    dom.on(document, "click", (event) => {
      if (!menu.hidden && !$("#langSwitch").contains(event.target)) close();
    });
    dom.on(document, "keydown", (event) => {
      if (event.key === "Escape" && !menu.hidden) {
        close();
        toggle.focus();
      }
    });

    const paintToggle = (lang) => {
      dom.clear($("#langFlag")).append(flags.svg(lang));
      $("#langCode").textContent = lang.toUpperCase();
    };
    paintToggle(i18n.lang);
    i18n.onChange((lang) => {
      paintToggle(lang);
      if (!menu.hidden) render();
    });
  },
};

const platforms = {
  list: [],
  active: "youtube",

  init() {
    i18n.onChange(() => {
      this.render();
      this.applyPlaceholder();
      this.renderSites();
    });
  },

  load(config) {
    this.list = Array.isArray(config?.platforms) ? config.platforms : [];
    dom.show($("#platformBar"), this.list.length > 0);
    if (!this.list.length) return;
    this.render();
    this.applyPlaceholder();
  },

  render() {
    const wrap = dom.clear($("#platformChips"));
    if (!this.list.length) return;

    for (const platform of this.list) {
      const chip = dom.make("button", "platform-chip");
      chip.type = "button";
      chip.dataset.platform = platform.id;
      chip.setAttribute("aria-pressed", String(platform.id === this.active));
      chip.classList.toggle("is-active", platform.id === this.active);
      chip.append(
        dom.icon(`pi-${platform.id}`),
        dom.make("span", "", platform.label),
      );
      dom.on(chip, "click", () => this.select(platform.id, true));
      wrap.append(chip);
    }

    const more = dom.make("button", "platform-chip platform-chip--more");
    more.type = "button";
    more.id = "morePlatforms";
    more.setAttribute("aria-haspopup", "dialog");
    more.setAttribute("aria-label", i18n.t("a11y.moreSites"));
    more.append(
      dom.icon("pi-more"),
      dom.make("span", "", i18n.t("platforms.more")),
    );
    dom.on(more, "click", () => this.openSites());
    wrap.append(more);
  },

  select(id, fromClick) {
    this.active = id;
    $$("#platformChips .platform-chip").forEach((chip) => {
      const on = chip.dataset.platform === id;
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-pressed", String(on));
    });
    this.applyPlaceholder();

    const platform = this.list.find((p) => p.id === id);
    const note = $("#platformNote");
    if (platform?.auth) {
      note.textContent = i18n.t("platforms.authNote");
      dom.show(note, true);
    } else {
      dom.show(note, false);
    }

    if (fromClick) {
      const input = $("#urlInput");
      input.focus();
      if (!input.value.trim()) downloader.hint(null);
    }
  },

  applyPlaceholder() {
    const key = `platforms.hints.${this.active}`;
    const text = i18n.has(key)
      ? i18n.t(key)
      : i18n.t("platforms.hints.generic");
    const input = $("#urlInput");
    input.placeholder = text;
    input.setAttribute("aria-label", text);
  },

  detect(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    let host;
    try {
      host = new URL(
        /^https?:\/\//i.test(raw) ? raw : `https://${raw}`,
      ).hostname.toLowerCase();
    } catch {
      return null;
    }
    const hit = this.list.find((p) =>
      (p.domains || []).some((d) => host === d || host.endsWith(`.${d}`)),
    );
    return hit ? hit.id : null;
  },

  openSites() {
    this.renderSites();
    modal.open($("#sitesModal"));
  },

  renderSites() {
    const grid = $("#sitesGrid");
    if (!grid) return;
    dom.clear(grid);
    for (const group of store.config?.extraSites || []) {
      const box = dom.make("div", "site-group");
      box.append(
        dom.make(
          "h4",
          "site-group__title",
          i18n.t(`platforms.groups.${group.group}`),
        ),
      );
      const list = dom.make("ul", "site-group__list");
      for (const name of group.items) list.append(dom.make("li", "", name));
      box.append(list);
      grid.append(box);
    }
  },
};

const metrics = {
  animated: false,

  init() {
    i18n.onChange(() => this.render(false));
  },

  shown(name, n) {
    return name === "platforms" && n >= 100 ? Math.floor(n / 100) * 100 : n;
  },

  label(name, n) {
    const text = fmt.number(n);
    return name === "platforms" ? `${text}+` : text;
  },

  render(animate = true) {
    const counts = store.config?.counts;
    if (!counts) return;
    const flagsBox = $("#metricFlags");
    if (flagsBox && !flagsBox.childElementCount) {
      for (const code of i18n.available) flagsBox.append(flags.node(code));
    }

    $$("[data-metric]").forEach((node) => {
      const name = node.dataset.metric;
      if (counts[name] === null || counts[name] === undefined) {
        node.textContent = "—";
        return;
      }
      const end = this.shown(name, Number(counts[name]) || 0);
      if (!animate || this.animated || reducedMotion() || end < 2) {
        node.textContent = this.label(name, end);
        return;
      }
      const started = performance.now();
      const duration = 900;
      const step = (now) => {
        const t = Math.min(1, (now - started) / duration);
        const eased = 1 - (1 - t) ** 3;
        node.textContent = this.label(name, Math.round(end * eased));
        if (t < 1 && node.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    this.animated = true;
  },
};

const formatsShowcase = {
  family: "audio",

  init() {
    $$("[data-formatfamily]").forEach((tab) => {
      dom.on(tab, "click", () => {
        this.family = tab.dataset.formatfamily;
        $$("[data-formatfamily]").forEach((other) => {
          const on = other === tab;
          other.classList.toggle("is-active", on);
          other.setAttribute("aria-selected", String(on));
        });
        this.render();
      });
    });
    i18n.onChange(() => this.render());
  },

  syncVisibility() {
    dom.show($("#panelFormats"), !!store.config && nav.view === "downloader");
  },

  ids(family) {
    const targets =
      family === "audio"
        ? store.config?.audioTargets || []
        : store.config?.videoTargets || [];
    const ids = targets.map((t) => t.id);

    if (family === "video" && !ids.includes("gif")) ids.push("gif");
    return { ids, targets };
  },

  render() {
    const grid = $("#formatCards");
    this.syncVisibility();
    if (!grid || !store.config) return;
    dom.clear(grid);

    $("#countAudioFormats").textContent = this.ids("audio").ids.length;
    $("#countVideoFormats").textContent = this.ids("video").ids.length;

    const { ids, targets } = this.ids(this.family);
    ids.forEach((id, index) => {
      const base = `formatsSection.${this.family}.${id}`;
      if (!i18n.has(`${base}.name`)) return;

      const card = dom.clone("tpl-format-card");
      card.style.animationDelay = `${Math.min(index * 45, 420)}ms`;
      const spec = targets.find((t) => t.id === id);

      $(".fcard__ext", card).textContent = `.${spec?.ext || id}`;
      $(".fcard__name", card).textContent = i18n.t(`${base}.name`);
      $(".fcard__tagline", card).textContent = i18n.t(`${base}.tagline`);
      $(".fcard__desc", card).textContent = i18n.t(`${base}.desc`);

      const badges = $(".fcard__badges", card);
      if (this.family === "audio") {
        badges.append(
          dom.make(
            "span",
            `fbadge ${spec?.lossless ? "fbadge--lossless" : ""}`.trim(),
            i18n.t(
              spec?.lossless
                ? "formatsSection.lossless"
                : "formatsSection.lossy",
            ),
          ),
        );
      } else if (id === "mkv") {
        badges.append(
          dom.make(
            "span",
            "fbadge fbadge--remux",
            i18n.t("formatsSection.remux"),
          ),
        );
      }
      badges.append(
        dom.make("span", "fbadge", (spec?.ext || id).toUpperCase()),
      );
      grid.append(card);
    });
  },
};

const scrollTop = {
  threshold: 300,

  init() {
    const button = $("#toTop");
    if (!button) return;

    let ticking = false;
    const update = () => {
      button.classList.toggle("is-visible", window.scrollY > this.threshold);
      ticking = false;
    };
    dom.on(
      window,
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
      },
      { passive: true },
    );
    dom.on(button, "click", () => {
      window.scrollTo({
        top: 0,
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    });
    update();
  },
};

const downloader = {
  loading: null,

  init() {
    const form = $("#urlForm");
    const input = $("#urlInput");
    const field = $("#urlField");

    dom.on(form, "submit", (event) => {
      event.preventDefault();
      this.analyze(input.value);
    });

    dom.on(input, "focus", () => field.classList.add("is-focused"));
    dom.on(input, "blur", () => field.classList.remove("is-focused"));
    dom.on(input, "input", () => {
      dom.show($("#urlClear"), input.value.length > 0);
      field.classList.remove("is-invalid");
      const detected = platforms.detect(input.value);
      if (detected && detected !== platforms.active) platforms.select(detected);
      this.hint(this.detect(input.value));
    });

    dom.on($("#urlClear"), "click", () => {
      input.value = "";
      dom.show($("#urlClear"), false);
      this.hint(null);
      input.focus();
    });

    dom.on($("#pasteBtn"), "click", async () => {
      const text = await clipboard.read();
      if (text === null) return;
      input.value = text;
      dom.show($("#urlClear"), true);
      this.hint(this.detect(text));
      if (this.detect(text) !== "invalid") this.analyze(text);
    });

    $$("[data-formats]").forEach((tab) => {
      dom.on(tab, "click", () => this.selectTab(tab.dataset.formats));
    });

    dom.on($("#convertTarget"), "change", () => this.onConvertChange());
    dom.on($("#videoThumb"), "click", () => this.openPlayerModal());
    dom.on($('[data-action="copy-url"]'), "click", () => this.copyUrl());
    dom.on($('[data-action="to-study"]'), "click", () => {
      study.autoStart = true;
    });

    media.onChange((video) => this.renderVideo(video));
    i18n.onChange(() => {
      if (store.media) this.renderVideo(store.media);
    });
    nav.register("downloader", {
      enter: () => {
        dom.show($("#panelVideo"), !!store.media && !this.loading);
      },
    });
  },

  selectTab(name) {
    store.formatTab = name;
    $$("[data-formats]").forEach((other) => {
      const active = other.dataset.formats === name;
      other.classList.toggle("is-active", active);
      other.setAttribute("aria-selected", String(active));
    });
    this.renderConvertOptions();
    this.renderFormats();
  },

  detect(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    if (/^(?:PL|UU|LL|FL|OL)[\w-]{10,}$/.test(text)) return "playlist";
    if (/[?&]list=(?!RD)[\w-]{12,}/.test(text)) return "playlist";
    if (/^[\w-]{11}$/.test(text)) return "video";
    if (
      /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)[\w-]{11}/.test(text)
    )
      return "video";
    try {
      const url = new URL(
        /^https?:\/\//i.test(text) ? text : `https://${text}`,
      );
      const ok =
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname.includes(".") &&
        url.pathname.length > 1;
      return ok ? "video" : "invalid";
    } catch {
      return "invalid";
    }
  },

  hint(kind) {
    const node = $("#urlHint");
    node.classList.remove("is-error", "is-ok");
    if (!kind) {
      node.textContent = "";
      return;
    }
    if (kind === "invalid") {
      node.textContent = i18n.t("input.invalid");
      node.classList.add("is-error");
      return;
    }
    if (kind === "playlist") {
      node.textContent = i18n.t("input.detectedPlaylist");
    } else {
      const id = platforms.detect($("#urlInput").value);
      const label = platforms.list.find((p) => p.id === id)?.label;
      node.textContent = label
        ? i18n.t("platforms.detected", { platform: label })
        : i18n.t("input.detectedVideo");
    }
    node.classList.add("is-ok");
  },

  async analyze(rawUrl) {
    const url = String(rawUrl || "").trim();
    const field = $("#urlField");
    const input = $("#urlInput");
    if (input.value.trim() !== url) {
      input.value = url;
      dom.show($("#urlClear"), url.length > 0);
    }

    if (!url) {
      field.classList.add("is-invalid");
      const hint = $("#urlHint");
      hint.textContent = i18n.t("input.empty");
      hint.classList.add("is-error");
      return;
    }
    const kind = this.detect(url);
    if (kind === "invalid") {
      field.classList.remove("is-invalid");
      void field.offsetWidth;
      field.classList.add("is-invalid");
      this.hint("invalid");
      return;
    }
    if (kind === "playlist") {
      nav.go("playlist");
      playlist.load(url);
      return;
    }

    const token = Symbol("analyze");
    this.loading = token;
    const button = $("#analyzeBtn");
    button.classList.add("is-busy");
    button.disabled = true;
    $(".btn__label", button).textContent = i18n.t("hero.analyzing");
    dom.show($("#panelSkeleton"), true);
    dom.show($("#panelVideo"), false);

    try {
      const result = await api.resolve(url, "video");
      if (this.loading !== token) return;
      if (result.type === "playlist") {
        playlist.accept(result.playlist, url);
        nav.go("playlist");
        toast.success(i18n.t("toast.playlistLoaded"));
        return;
      }
      this.loading = null;
      media.set(result.video);
      if (nav.view !== "downloader") nav.go("downloader");
      toast.success(i18n.t("toast.metaLoaded"));
      requestAnimationFrame(() =>
        $("#panelVideo").scrollIntoView({
          behavior: reducedMotion() ? "auto" : "smooth",
          block: "start",
        }),
      );
    } catch (error) {
      if (this.loading !== token) return;
      const hint = $("#urlHint");
      hint.textContent = toast.message(error, "toast.metaFailed");
      hint.classList.remove("is-ok");
      hint.classList.add("is-error");
      toast.fromError(error, "toast.metaFailed");
    } finally {
      if (this.loading === token || this.loading === null) {
        this.loading = null;
        dom.show($("#panelSkeleton"), false);
        dom.show($("#panelVideo"), !!store.media);
        button.classList.remove("is-busy");
        button.disabled = false;
        $(".btn__label", button).textContent = i18n.t("hero.analyze");
      }
    }
  },

  renderVideo(video) {
    if (!video) return;
    $("#hero").classList.add("is-compact");
    const img = $("#videoThumbImg");
    img.src = video.thumbnail || "";
    img.alt = video.title || "";
    $("#videoTitle").textContent = video.title;
    $("#videoDuration").textContent = video.durationLabel;
    dom.show($("#videoDuration"), !!video.duration);
    $("#videoSourceLink").href = video.url || video.sourceUrl;
    $("#videoSourceLabel").textContent = media.isYouTube(video)
      ? i18n.t("video.openOnYoutube")
      : i18n.t("video.openSource", { platform: video.platformLabel || "" });

    const meta = dom.clear($("#videoMeta"));
    const chips = [

      video.platform && video.platform !== "youtube"
        ? { text: video.platformLabel, kind: "pill--glow" }
        : null,
      { text: video.channel, kind: "" },
      video.viewCount
        ? {
            text: `${fmt.count(video.viewCount)} · ${i18n.t("video.views")}`,
            kind: "pill--soft",
          }
        : null,
      video.likes
        ? {
            text: `${fmt.count(video.likes)} · ${i18n.t("video.likes")}`,
            kind: "pill--soft",
          }
        : null,
      video.uploadDate
        ? { text: fmt.uploadDate(video.uploadDate), kind: "pill--soft" }
        : null,
      {
        text: video.hasCaptions
          ? i18n.t("video.captions")
          : i18n.t("video.noCaptions"),
        kind: video.hasCaptions ? "pill--ok" : "pill--warn",
      },
    ].filter(Boolean);
    for (const chip of chips) {
      if (!chip.text) continue;
      meta.append(dom.make("span", `pill ${chip.kind}`.trim(), chip.text));
    }

    $("#countVideo").textContent = video.formats.video.length;
    $("#countAudio").textContent = video.formats.audio.length;

    const tab =
      !video.formats.video.length && video.formats.audio.length
        ? "audio"
        : store.formatTab;
    this.selectTab(tab);
  },

  renderConvertOptions() {
    const select = $("#convertTarget");
    if (!select) return;
    const previous = select.value;
    const family = store.formatTab === "audio" ? "audio" : "video";
    const targets =
      family === "audio"
        ? store.config?.audioTargets || []
        : store.config?.videoTargets || [];

    dom.clear(select);
    const original = dom.make("option", "", i18n.t("video.convertOriginal"));
    original.value = "";
    select.append(original);

    for (const target of targets) {
      const key = `formatsSection.${family}.${target.id}.name`;
      const name = i18n.has(key) ? i18n.t(key) : target.id.toUpperCase();
      const option = dom.make("option", "", `${name} (.${target.ext})`);
      option.value = target.id;
      select.append(option);
    }

    select.value = [...select.options].some((o) => o.value === previous)
      ? previous
      : "";
    this.onConvertChange();
  },

  onConvertChange() {
    const select = $("#convertTarget");
    const picker = select?.closest(".convert-picker");
    const converting = !!select?.value;
    picker?.classList.toggle("is-converting", converting);
    $("#formatNote").textContent = converting
      ? i18n.t("video.convertHint")
      : store.formatTab === "video"
        ? i18n.t("video.mergeHint")
        : "";
  },

  renderFormats() {
    const video = store.media;
    if (!video) return;
    const list = dom.clear($("#formatList"));
    const items =
      store.formatTab === "audio" ? video.formats.audio : video.formats.video;

    if (!items.length) {
      list.append(dom.make("p", "muted", i18n.t("video.noFormats")));
      $("#formatNote").textContent = "";
      return;
    }

    items.forEach((format, index) => {
      const row = dom.clone("tpl-format");
      row.style.animationDelay = `${Math.min(index * 35, 400)}ms`;
      if (index === 0) row.classList.add("format--top");

      $(".format__badge", row).textContent =
        format.kind === "audio"
          ? format.container.toUpperCase()
          : format.qualityLabel;

      $(".format__quality", row).textContent =
        format.kind === "audio"
          ? `${format.container.toUpperCase()} · ${format.qualityLabel}`
          : `${format.qualityLabel}${format.fps > 30 ? ` ${format.fps}fps` : ""}`;

      const details = [];
      if (format.codec) details.push(format.codec);
      if (format.kind === "video") {
        details.push(format.container.toUpperCase());
        details.push(
          i18n.t(format.needsMerge ? "video.merge" : "video.progressive"),
        );
      } else if (format.transcode) {
        details.push(`${i18n.t("video.bitrate")}: ${format.abr} kbps`);
      }
      if (index === 0) details.push(i18n.t("video.best"));
      $(".format__detail", row).textContent = details.join(" · ");

      $(".format__size", row).textContent = format.size
        ? `${format.estimated ? `${i18n.t("video.estimated")} ` : ""}${fmt.bytes(format.size)}`
        : "—";

      const button = $(".format__btn", row);
      $(".btn__label", button).textContent = i18n.t("video.download");
      dom.on(button, "click", () => this.startDownload(format, button));
      list.append(row);
    });

    this.onConvertChange();
  },

  startDownload(format, button) {
    const video = store.media;
    if (!video || button.classList.contains("is-busy")) return;

    const target = $("#convertTarget")?.value || "";
    dom.download(
      api.downloadUrl(video.sourceUrl || video.url, format.key, {
        to: target,
        kind: format.kind,
        h: format.kind === "video" ? format.height : 0,
        abr: format.kind === "audio" ? format.abr : 0,
        c: format.container,
      }),
    );

    button.classList.add("is-busy");
    $(".btn__label", button).textContent = i18n.t("video.downloading");
    setTimeout(() => {
      button.classList.remove("is-busy");
      $(".btn__label", button).textContent = i18n.t("video.download");
    }, 2600);

    toast.success(i18n.t("toast.downloadStarted"));
  },

  async copyUrl() {
    if (!store.media) return;
    try {
      await navigator.clipboard.writeText(
        store.media.url || store.media.sourceUrl,
      );
      toast.success(i18n.t("toast.copied"));
    } catch {
      toast.error(i18n.t("toast.copyFailed"));
    }
  },

  openPlayerModal() {
    const video = store.media;
    if (!video) return;
    $("#playerModalTitle").textContent = video.title;
    const frame = dom.make("div", "player-frame");
    dom.clear($("#modalPlayer")).append(frame);
    modal.open($("#playerModal"), () => {
      player.destroy();
      dom.clear($("#modalPlayer"));
    });
    player.mount(frame, video, { autoplay: true });
  },
};

const playlist = {
  selected: new Set(),
  queue: [],
  abort: null,
  shownId: null,
  AUTO_SELECT_LIMIT: 25,

  init() {
    this.form = new ToolForm($("#playlistForm"), {
      hintKey: "tools.hintPlaylist",
      onSubmit: (url) => this.load(url),
    });
    dom.on($("#selectAll"), "click", () => this.setAll(true));
    dom.on($("#deselectAll"), "click", () => this.setAll(false));
    dom.on($("#queueStart"), "click", () => this.start());
    dom.on($("#queueStop"), "click", () => this.stop());
    dom.on($("#queueClear"), "click", () => {
      if (store.queueRunning) return;
      this.queue = [];
      this.renderQueue();
    });
    i18n.onChange(() => {
      if (store.playlist) this.render();
      else this.renderQueue();
    });
    nav.register("playlist", {
      enter: () => {
        if (!store.playlist) this.form.focus();
      },
    });
    this.renderQueue();
  },

  async load(url) {
    this.form.set(url);
    this.form.busy(true);
    dom.show($("#playlistSkeleton"), true);
    dom.show($("#panelPlaylist"), false);
    try {
      const result = await api.resolve(url, "playlist");
      if (result.type === "playlist") {
        this.accept(result.playlist, url);
        toast.success(i18n.t("toast.playlistLoaded"));
      } else {

        media.set(result.video);
        nav.go("downloader");
        toast.success(i18n.t("toast.metaLoaded"));
      }
    } catch (error) {
      this.form.hint(toast.message(error, "toast.playlistFailed"), "error");
      toast.fromError(error, "toast.playlistFailed");
    } finally {
      this.form.busy(false);
      dom.show($("#playlistSkeleton"), false);
      dom.show($("#panelPlaylist"), !!store.playlist);
    }
  },

  accept(data, url) {
    store.playlist = data;
    this.form.set(url || data.url);
    this.form.resetHint();
    this.render();
    dom.show($("#panelPlaylist"), true);
  },

  render() {
    const data = store.playlist;
    if (!data) return;

    if (this.shownId !== data.id) {
      this.shownId = data.id;
      const playable = data.videos.filter((v) => v.available !== false);
      this.selected = new Set(
        playable.length <= this.AUTO_SELECT_LIMIT
          ? playable.map((v) => v.id)
          : [],
      );
    }

    $("#playlistThumb").src = data.thumbnail || "";
    $("#playlistTitle").textContent = data.title;
    $("#playlistMeta").textContent =
      `${data.channel ? `${i18n.t("playlist.by")} ${data.channel} · ` : ""}` +
      `${i18n.t("playlist.videos", { count: data.count })} · ` +
      `${i18n.t("playlist.totalDuration")} ${data.totalDurationLabel}`;

    const truncated = $("#playlistTruncated");
    dom.show(truncated, !!data.truncated);
    if (data.truncated)
      truncated.textContent = i18n.t("playlist.truncated", {
        count: data.count,
      });

    const list = dom.clear($("#playlistItems"));
    const fragment = document.createDocumentFragment();
    data.videos.forEach((video, index) => {
      const row = dom.clone("tpl-playlist-item");
      row.style.animationDelay = `${Math.min(index * 12, 500)}ms`;
      const unavailable = video.available === false;
      row.classList.toggle("is-unavailable", unavailable);

      const check = $(".pl-item__check", row);
      check.checked = this.selected.has(video.id);
      check.disabled = unavailable;
      check.dataset.id = video.id;
      check.setAttribute(
        "aria-label",
        `${i18n.t("a11y.selectVideo")}: ${video.title}`,
      );
      dom.on(check, "change", () => {
        if (check.checked) this.selected.add(video.id);
        else this.selected.delete(video.id);
        this.updateCount();
      });

      $(".pl-item__index", row).textContent = video.index || index + 1;
      $(".pl-item__thumb", row).src = video.thumbnail;
      $(".pl-item__title", row).textContent = video.title;
      $(".pl-item__meta", row).textContent = unavailable
        ? i18n.t("playlist.unavailable")
        : video.channel;
      $(".pl-item__duration", row).textContent = video.duration
        ? video.durationLabel
        : "";
      fragment.append(row);
    });
    list.append(fragment);

    this.updateCount();
    this.renderQueue();
  },

  setAll(value) {
    const playable = (store.playlist?.videos || []).filter(
      (v) => v.available !== false,
    );
    this.selected = value ? new Set(playable.map((v) => v.id)) : new Set();
    $$(".pl-item__check").forEach((check) => {
      check.checked = this.selected.has(check.dataset.id);
    });
    this.updateCount();
  },

  updateCount() {
    $("#selectedCount").textContent = i18n.t("playlist.selected", {
      count: this.selected.size,
    });
  },

  start() {
    if (store.queueRunning) return;
    const videos = (store.playlist?.videos || []).filter((v) =>
      this.selected.has(v.id),
    );
    if (!videos.length) return toast.warn(i18n.t("playlist.nothingSelected"));

    const quality = $("#queueQuality").value;
    this.queue = videos.map((video) => ({
      id: video.id,
      url: video.url,
      title: video.title,
      state: "pending",
      progress: 0,
      received: 0,
      quality,
      row: null,
    }));
    this.renderQueue();
    this.run();
  },

  stop() {
    store.queueRunning = false;
    this.abort?.abort();
    for (const item of this.queue) {
      if (item.state === "pending" || item.state === "downloading")
        item.state = "skipped";
      this.paintItem(item);
    }
    this.toggleButtons(false);
  },

  toggleButtons(running) {
    dom.show($("#queueStop"), running);
    $("#queueStart").disabled = running;
    $("#queueClear").disabled = running;
    $("#queueQuality").disabled = running;
  },

  itemUrl(item) {
    if (item.quality === "audio") {
      return api.downloadUrl(item.url, "mp3:320", {
        kind: "audio",
        abr: 320,
        c: "mp3",
      });
    }
    return api.downloadUrl(item.url, "", {
      kind: "video",
      h: Number(item.quality) || 720,
    });
  },

  async run() {
    store.queueRunning = true;
    this.toggleButtons(true);
    let done = 0;
    let failed = 0;

    for (const item of this.queue) {
      if (!store.queueRunning) break;
      if (item.state !== "pending") continue;
      item.state = "downloading";
      item.progress = 0;
      item.received = 0;
      this.paintItem(item);
      item.row?.scrollIntoView({ block: "nearest" });

      this.abort = new AbortController();
      try {
        await downloadStream(
          this.itemUrl(item),
          this.abort.signal,
          (received, total, expected) => {
            item.received = received;
            item.progress = total
              ? received / total
              : expected
                ? Math.min(0.99, received / expected)
                : 0;
            this.schedulePaint(item);
          },
        );
        item.state = "done";
        done += 1;
      } catch (error) {
        item.state = error.name === "AbortError" ? "skipped" : "failed";
        item.error = toast.message(error);
        if (item.state === "failed") failed += 1;
      }
      this.paintItem(item);
    }

    store.queueRunning = false;
    this.abort = null;
    this.toggleButtons(false);
    if (done || failed) {
      const text = i18n.t("toast.queueFinished", { done, failed });
      if (failed) toast.warn(text);
      else toast.success(text);
    }
  },

  schedulePaint(item) {
    if (item.paintQueued) return;
    item.paintQueued = true;
    requestAnimationFrame(() => {
      item.paintQueued = false;
      this.paintItem(item);
    });
  },

  paintItem(item) {
    const row = item.row;
    if (!row) return;
    row.classList.toggle("is-active", item.state === "downloading");
    row.classList.toggle("is-done", item.state === "done");
    row.classList.toggle("is-failed", item.state === "failed");
    row.classList.toggle("is-skipped", item.state === "skipped");
    let label = i18n.t(`playlist.status.${item.state}`);
    if (item.state === "downloading" && item.received > 0) {
      label =
        item.progress > 0
          ? `${Math.round(item.progress * 100)}%`
          : fmt.bytes(item.received);
    }
    $(".queue-item__state", row).textContent = label;
    row.title = item.state === "failed" && item.error ? item.error : "";
    $(".queue-item__bar span", row).style.width =
      item.state === "done"
        ? "100%"
        : `${Math.round((item.progress || 0) * 100)}%`;
    row.classList.toggle(
      "is-indeterminate",
      item.state === "downloading" && !item.progress,
    );
  },

  renderQueue() {
    const list = dom.clear($("#queueList"));
    if (!this.queue.length) {
      list.append(dom.make("p", "muted small", i18n.t("playlist.queueEmpty")));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of this.queue) {
      const row = dom.clone("tpl-queue-item");
      $(".queue-item__title", row).textContent = item.title;
      item.row = row;
      this.paintItem(item);
      fragment.append(row);
    }
    list.append(fragment);
  },
};

async function downloadStream(url, signal, onProgress) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      payload?.error?.code || "generic",
      payload?.error?.message,
      response.status,
    );
  }

  const disposition = response.headers.get("content-disposition") || "";
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = disposition.match(/filename="([^"]+)"/i);
  let filename = "tubeforge-download";
  try {
    if (utf8) filename = decodeURIComponent(utf8[1]);
    else if (plain) filename = plain[1];
  } catch {
  }

  const total = Number(response.headers.get("content-length")) || 0;

  const expected = Number(response.headers.get("x-expected-length")) || 0;
  const TOO_BIG = 1_500_000_000;
  const FOLD_AT = 32 * 1024 * 1024;

  if (total > TOO_BIG || !response.body) {
    await response.body?.cancel().catch(() => {});
    dom.download(url, filename);
    return;
  }

  const type =
    response.headers.get("content-type") || "application/octet-stream";
  const reader = response.body.getReader();
  const parts = [];
  let pending = [];
  let pendingBytes = 0;
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending.push(value);
    pendingBytes += value.length;
    received += value.length;
    if (pendingBytes >= FOLD_AT) {
      parts.push(new Blob(pending));
      pending = [];
      pendingBytes = 0;
    }
    onProgress?.(received, total, expected);
  }
  if (pending.length) parts.push(new Blob(pending));

  if (!received || (total && received < total)) {
    throw new ApiError(
      "upstream",
      i18n.t("toast.downloadFailed"),
      response.status,
    );
  }
  const blob = new Blob(parts, { type });
  parts.length = 0;
  pending = [];

  const blobUrl = URL.createObjectURL(blob);
  dom.download(blobUrl, filename);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}

const study = {
  pack: null,
  quizState: null,
  token: 0,
  pollTimer: null,
  pending: false,
  busyFresh: false,
  autoStart: false,
  lines: [],
  starts: [],
  activeIndex: -1,
  userScrollUntil: 0,

  init() {
    this.form = new ToolForm($("#studyForm"), {
      hintKey: "tools.hintStudy",
      onSubmit: (url) => this.load(url),
    });
    dom.on($("#studyGenerate"), "click", () => this.generate(false));
    dom.on($("#studyRegenerate"), "click", () => this.generate(true));

    $$("[data-study]").forEach((tab) => {
      dom.on(tab, "click", () => this.selectTab(tab.dataset.study));
    });

    let searchTimer = null;
    dom.on($("#transcriptSearch"), "input", (event) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(
        () => this.filterTranscript(event.target.value),
        120,
      );
    });

    const pauseFollow = () => {
      this.userScrollUntil = Date.now() + 4000;
    };
    dom.on($("#transcript"), "wheel", pauseFollow, { passive: true });
    dom.on($("#transcript"), "touchmove", pauseFollow, { passive: true });

    media.onChange((video) => this.onMedia(video));
    i18n.onChange(() => {
      if (!store.media) return;
      this.paintSourceNote();
      this.fillLanguages();
      if (this.pack) this.render(this.pack, { keepQuiz: true });
    });
    nav.register("study", {
      enter: () => this.enter(),
      leave: () => player.pause(),
    });
  },

  async load(url) {
    const video = await loadMedia(url, {
      form: this.form,
      skeleton: $("#studySkeleton"),
      workspace: $("#studyWorkspace"),
    });
    if (video && nav.view === "study") this.generate(false);
  },

  enter() {
    if (!store.media) {
      this.form.focus();
      return;
    }
    if (this.autoStart && !this.pack && !this.pending) {
      this.autoStart = false;
      this.generate(false);
    }
    if (this.pack) this.mountPlayer();
  },

  onMedia(video) {
    this.reset();
    this.form.set(video.url || video.sourceUrl);
    this.form.resetHint();
    paintStrip($("#studyWorkspace [data-strip]"), video);
    dom.show($("#studyWorkspace"), true);
    $('.capabilities[data-for="study"]').classList.add("is-compact");
    this.fillLanguages();
    this.paintSourceNote();
  },

  reset() {
    this.token += 1;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pending = false;
    this.busyFresh = false;
    this.pack = null;
    this.quizState = null;
    this.lines = [];
    this.starts = [];
    this.activeIndex = -1;
    if (player.host === $("#studyPlayer")) player.destroy();
    dom.show($("#studyBody"), false);
    dom.show($("#studyIntro"), true);
    dom.show($("#studyProgress"), false);
    dom.show($("#studyNotice"), false);
    this.setBusy(false);
  },

  fillLanguages() {
    const tracks = store.media?.captions || [];
    const select = $("#studyLang");
    const previous = select.value;
    dom.clear(select);
    dom.show($("#studyLangField"), tracks.length > 1);
    for (const track of tracks) {
      const option = dom.make("option");
      option.value = track.lang;
      option.textContent = track.isAuto
        ? `${track.name} (${i18n.t("study.autoCaptions")})`
        : track.name;
      select.append(option);
    }
    select.value = tracks.some((t) => t.lang === previous)
      ? previous
      : this.defaultTrack(tracks);
  },

  selectedLang() {
    return (
      $("#studyLang").value ||
      this.defaultTrack(store.media?.captions || []) ||
      null
    );
  },

  canGenerate() {
    return (
      !!store.media &&
      (store.media.hasCaptions || !!store.config?.speech?.available)
    );
  },

  paintSourceNote() {
    const video = store.media;
    const note = $("#studySourceNote");
    if (!video) return;
    const speech = store.config?.speech;
    note.classList.remove("is-warn");
    if (video.hasCaptions) {
      note.textContent = i18n.t("study.sourceCaptions");
    } else if (speech?.available) {
      note.textContent = i18n.t("study.speech.note", { model: speech.model });
    } else {
      note.textContent = i18n.t("study.speech.unavailable");
      note.classList.add("is-warn");
    }
    this.setBusy(this.pending, this.busyFresh);
  },

  defaultTrack(tracks) {
    if (!tracks.length) return "";
    const sameLang = (track, code) =>
      track.lang === code || track.lang.split("-")[0] === code;
    const pick =
      tracks.find((t) => sameLang(t, i18n.lang) && !t.isAuto) ||
      tracks.find((t) => sameLang(t, i18n.lang)) ||
      tracks.find((t) => sameLang(t, "en") && !t.isAuto) ||
      tracks.find((t) => sameLang(t, "en")) ||
      tracks.find((t) => !t.isAuto) ||
      tracks[0];
    return pick.lang;
  },

  mountPlayer() {
    if (!store.media || $("#studyBody").hidden) return;
    player.ensure($("#studyPlayer"), store.media);
    player.onTick = (time) => this.highlight(time);
    player.onDuration = null;
  },

  setBusy(on, fresh = false) {
    const generate = $("#studyGenerate");
    const regenerate = $("#studyRegenerate");
    generate.classList.toggle("is-busy", on && !fresh);
    regenerate.classList.toggle("is-busy", on && fresh);
    generate.disabled = on || !this.canGenerate();
    regenerate.disabled = on;
    $(".btn__label", generate).textContent = i18n.t(
      on && !fresh ? "study.generating" : "study.generate",
    );
  },

  async generate(fresh, { polling = false } = {}) {
    const video = store.media;
    if (!video) return;
    if (!this.canGenerate()) {
      this.paintSourceNote();
      return;
    }
    if (this.pending && !polling) return;

    const token = this.token;
    this.pending = true;
    if (!polling) this.busyFresh = !!fresh;
    this.setBusy(true, this.busyFresh);
    dom.show($("#studyNotice"), false);

    try {
      const payload = await api.study(
        video,
        video.hasCaptions ? this.selectedLang() : null,
        fresh && !polling,
      );
      if (token !== this.token) return;

      if (payload?.state === "transcribing") {
        this.paintProgress(payload);
        this.pollTimer = setTimeout(
          () => this.generate(false, { polling: true }),
          1500,
        );
        return;
      }

      this.pending = false;
      this.busyFresh = false;
      dom.show($("#studyProgress"), false);
      this.pack = payload;
      this.render(payload);
      dom.show($("#studyIntro"), false);
      dom.show($("#studyBody"), true);
      this.mountPlayer();
      this.setBusy(false);
      toast.success(i18n.t("toast.studyReady"));
    } catch (error) {
      if (token !== this.token) return;
      this.pending = false;
      this.busyFresh = false;
      this.setBusy(false);
      dom.show($("#studyProgress"), false);
      const text =
        error.code === "noCaptions" && !store.config?.speech?.available
          ? i18n.t("study.speech.unavailable")
          : toast.message(error, "toast.studyFailed");
      $("#studyNoticeText").textContent = text;
      dom.show($("#studyNotice"), true);
      toast.error(text);
    }
  },

  paintProgress(state) {
    dom.show($("#studyProgress"), true);
    const pct = Math.max(0, Math.min(100, Math.round(state.progress || 0)));
    const stage = ["downloading", "transcribing"].includes(state.stage)
      ? state.stage
      : "queued";
    $("#studyProgressLabel").textContent = i18n.t(`study.speech.${stage}`, {
      progress: pct,
    });
    $("#studyProgressPct").textContent = `${pct}%`;
    $("#studyProgressBar").style.width = `${pct}%`;
    $("#studyProgressBar").parentElement.setAttribute(
      "aria-valuenow",
      String(pct),
    );
    const notes = [
      i18n.t("study.speech.note", {
        model: state.engine || store.config?.speech?.model || "",
      }),
    ];
    if (state.truncated)
      notes.push(
        i18n.t("study.speech.truncated", {
          minutes: Math.round((state.maxSeconds || 1800) / 60),
        }),
      );
    $("#studyProgressNote").textContent = notes.join(" ");
  },

  selectTab(name) {
    $$("[data-study]").forEach((other) => {
      const active = other.dataset.study === name;
      other.classList.toggle("is-active", active);
      other.setAttribute("aria-selected", String(active));
    });
    $$("[data-study-pane]").forEach((pane) => {
      const active = pane.dataset.studyPane === name;
      pane.classList.toggle("is-active", active);
      pane.hidden = !active;
    });
  },

  render(pack, { keepQuiz = false } = {}) {
    const transcript = pack.transcript || {};
    $("#studyProvider").textContent =
      `${i18n.t("study.providerLabel")}: ${i18n.t(`study.provider.${pack.provider}`)}`;
    $("#studySource").textContent =
      transcript.source === "whisper"
        ? i18n.t("study.speech.source")
        : `${i18n.t("study.sourceCaptions")}${transcript.isAuto ? ` · ${i18n.t("study.autoCaptions")}` : ""}`;
    $("#studyWords").textContent =
      `${fmt.count(pack.stats?.words)} ${i18n.t("study.stats.words")}`;
    $("#studyReading").textContent =
      `${pack.stats?.readingMinutes || 1} ${i18n.t("common.minute")} · ${i18n.t("study.stats.readingTime")}`;

    dom.show($("#studyThin"), !!pack.thin);
    const maxSpeech = store.config?.speech?.maxSeconds || 0;
    const truncated =
      transcript.source === "whisper" &&
      maxSpeech > 0 &&
      (store.media?.duration || 0) > maxSpeech;
    dom.show($("#studyTruncated"), truncated);
    if (truncated)
      $("#studyTruncated").textContent = i18n.t("study.speech.truncated", {
        minutes: Math.round(maxSpeech / 60),
      });

    const summary = dom.clear($("#summaryList"));
    (pack.summary || []).forEach((item, index) => {
      const li = dom.make("li");
      li.style.animationDelay = `${Math.min(index * 45, 400)}ms`;
      const stamp = dom.make(
        "button",
        "timestamp",
        item.label || fmt.clock(item.start),
      );
      stamp.type = "button";
      dom.on(stamp, "click", () => this.jump(item.start));
      li.append(stamp, dom.make("p", "", item.text));
      summary.append(li);
    });

    const concepts = dom.clear($("#conceptGrid"));
    (pack.concepts || []).forEach((concept, index) => {
      const card = dom.clone("tpl-concept");
      card.style.animationDelay = `${Math.min(index * 55, 400)}ms`;
      $(".concept__term", card).textContent = concept.term;
      $(".concept__explanation", card).textContent = concept.explanation;
      $(".concept__takeaway-label", card).textContent = i18n.t(
        "study.conceptTakeaway",
      );
      $(".concept__takeaway-text", card).textContent = concept.takeaway;
      const stamp = $(".timestamp", card);
      stamp.textContent = concept.label || fmt.clock(concept.start);
      dom.on(stamp, "click", () => this.jump(concept.start));
      concepts.append(card);
    });
    const hasConcepts = (pack.concepts || []).length > 0;
    const hasQuiz = (pack.quiz || []).length > 0;
    dom.show($('[data-study="concepts"]'), hasConcepts);
    dom.show($('[data-study="quiz"]'), hasQuiz);
    const current = $("[data-study].is-active")?.dataset.study;
    if (
      (current === "concepts" && !hasConcepts) ||
      (current === "quiz" && !hasQuiz)
    )
      this.selectTab("summary");

    const chapters = pack.chapters || [];
    dom.show($("#chaptersBox"), chapters.length > 0);
    const chapterList = dom.clear($("#chaptersList"));
    for (const chapter of chapters) {
      const li = dom.make("li");
      const button = dom.make("button");
      button.type = "button";
      const time = dom.make(
        "time",
        "",
        chapter.label || fmt.clock(chapter.start),
      );
      time.dateTime = `PT${Math.round(chapter.start)}S`;
      button.append(time, dom.make("span", "", chapter.title));
      dom.on(button, "click", () => this.jump(chapter.start));
      li.append(button);
      chapterList.append(li);
    }

    this.renderTranscript(transcript);
    if (keepQuiz && this.quizState) this.renderQuiz();
    else this.startQuiz(pack.quiz);
  },

  renderTranscript(transcript) {
    const list = dom.clear($("#transcript"));
    const segments = transcript?.segments || [];
    this.lines = [];
    this.starts = [];
    this.activeIndex = -1;
    $("#transcriptSearch").value = "";
    $("#transcriptHits").textContent = "";
    if (!segments.length) {
      list.append(dom.make("li", "muted small", i18n.t("study.noTranscript")));
      return;
    }
    const fragment = document.createDocumentFragment();
    segments.forEach((segment) => {
      const li = dom.make("li");
      const button = dom.make("button", "transcript__line");
      button.type = "button";
      const time = dom.make(
        "time",
        "",
        segment.label || fmt.clock(segment.start),
      );
      time.dateTime = `PT${Math.round(segment.start)}S`;
      button.append(time, dom.make("span", "transcript__text", segment.text));
      dom.on(button, "click", () => this.jump(segment.start));
      li.append(button);
      fragment.append(li);
      this.lines.push(button);
      this.starts.push(Number(segment.start) || 0);
    });
    list.append(fragment);
  },

  filterTranscript(query) {
    const needle = String(query || "")
      .trim()
      .toLowerCase();
    let hits = 0;

    for (const line of this.lines) {
      const textNode = $(".transcript__text", line);
      const original = textNode.dataset.raw ?? textNode.textContent;
      textNode.dataset.raw = original;

      if (!needle) {
        textNode.textContent = original;
        line.parentElement.classList.remove("is-hidden");
        continue;
      }

      const index = original.toLowerCase().indexOf(needle);
      if (index === -1) {
        line.parentElement.classList.add("is-hidden");
        textNode.textContent = original;
        continue;
      }

      hits += 1;
      line.parentElement.classList.remove("is-hidden");
      dom.clear(textNode);
      textNode.append(
        document.createTextNode(original.slice(0, index)),
        dom.make("mark", "", original.slice(index, index + needle.length)),
        document.createTextNode(original.slice(index + needle.length)),
      );
    }

    $("#transcriptHits").textContent = needle
      ? i18n.t("study.transcriptHits", { count: hits })
      : "";
  },

  highlight(currentTime) {
    const starts = this.starts;
    if (!starts.length) return;
    let lo = 0;
    let hi = starts.length - 1;
    let index = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= currentTime + 0.25) {
        index = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (index === this.activeIndex) return;
    this.lines[this.activeIndex]?.classList.remove("is-active");
    this.activeIndex = index;
    const line = this.lines[index];
    if (!line) return;
    line.classList.add("is-active");

    const box = $("#transcript");
    if (box.offsetParent === null || Date.now() < this.userScrollUntil) return;
    const boxRect = box.getBoundingClientRect();
    const rect = line.getBoundingClientRect();
    if (rect.top < boxRect.top || rect.bottom > boxRect.bottom) {
      box.scrollTop += rect.top - boxRect.top - box.clientHeight / 3;
    }
  },

  jump(seconds) {
    this.mountPlayer();
    if (!player.seek(seconds)) {
      setTimeout(() => player.seek(seconds), 900);
    }
  },

  startQuiz(questions) {
    this.quizState = {
      questions: questions || [],
      index: 0,
      answers: [],
      finished: false,
    };
    this.renderQuiz();
  },

  renderQuiz() {
    const box = dom.clear($("#quiz"));
    const state = this.quizState;
    if (!state || !state.questions.length) {
      box.append(dom.make("p", "muted", i18n.t("study.thinNote")));
      return;
    }

    if (state.finished) return this.renderQuizResult(box);

    const question = state.questions[state.index];
    const answer = state.answers[state.index];

    const head = dom.make("div", "quiz-head");
    head.append(
      dom.make(
        "span",
        "pill pill--soft",
        i18n.t("study.quizProgress", {
          current: state.index + 1,
          total: state.questions.length,
        }),
      ),
    );
    const progress = dom.make("div", "quiz-progress");
    const fill = dom.make("span");
    fill.style.width = `${((state.index + (answer !== undefined ? 1 : 0)) / state.questions.length) * 100}%`;
    progress.append(fill);
    head.append(progress);

    const card = dom.make("div", "quiz-card glass");
    card.append(dom.make("p", "quiz-card__q", question.question));

    const options = dom.make("div", "quiz-options");
    question.options.forEach((text, optionIndex) => {
      const button = dom.make("button", "quiz-option");
      button.type = "button";
      button.append(
        dom.make(
          "span",
          "quiz-option__key",
          String.fromCharCode(65 + optionIndex),
        ),
        dom.make("span", "", text),
      );

      if (answer !== undefined) {
        button.disabled = true;
        if (optionIndex === question.answerIndex)
          button.classList.add("is-correct");
        else if (optionIndex === answer) button.classList.add("is-wrong");
      } else {
        dom.on(button, "click", () => {
          state.answers[state.index] = optionIndex;
          this.renderQuiz();
        });
      }
      options.append(button);
    });
    card.append(options);

    if (answer !== undefined) {
      const correct = answer === question.answerIndex;
      const feedback = dom.make(
        "div",
        `quiz-feedback ${correct ? "is-correct" : "is-wrong"}`,
      );
      feedback.append(
        dom.make(
          "strong",
          "",
          i18n.t(correct ? "study.quizCorrect" : "study.quizWrong"),
        ),
      );
      if (!correct) {
        feedback.append(
          dom.make(
            "p",
            "",
            `${i18n.t("study.quizAnswerWas")} ${question.options[question.answerIndex]}`,
          ),
        );
      }
      if (question.explanation)
        feedback.append(dom.make("p", "", question.explanation));
      card.append(feedback);
    }

    const foot = dom.make("div", "quiz-foot");
    const prev = dom.make(
      "button",
      "btn btn--ghost btn--sm",
      i18n.t("study.quizPrev"),
    );
    prev.type = "button";
    prev.disabled = state.index === 0;
    dom.on(prev, "click", () => {
      state.index -= 1;
      this.renderQuiz();
    });

    const last = state.index === state.questions.length - 1;
    const next = dom.make(
      "button",
      "btn btn--primary btn--sm",
      i18n.t(last ? "study.quizFinish" : "study.quizNext"),
    );
    next.type = "button";
    next.disabled = answer === undefined;
    dom.on(next, "click", () => {
      if (last) state.finished = true;
      else state.index += 1;
      this.renderQuiz();
    });

    const stamp = dom.make(
      "button",
      "timestamp",
      question.label || fmt.clock(question.start),
    );
    stamp.type = "button";
    dom.on(stamp, "click", () => this.jump(question.start));

    foot.append(prev, stamp, next);
    card.append(foot);
    box.append(head, card);
  },

  renderQuizResult(box) {
    const state = this.quizState;
    const total = state.questions.length;
    const score = state.answers.reduce(
      (sum, answer, index) =>
        sum + (answer === state.questions[index].answerIndex ? 1 : 0),
      0,
    );
    const pct = Math.round((score / total) * 100);

    const card = dom.make("div", "quiz-card glass quiz-result");
    const ring = dom.make("div", "quiz-score");
    ring.style.setProperty("--pct", pct);
    ring.append(dom.make("span", "", `${pct}%`));

    const verdict =
      pct === 100
        ? "study.quizPerfect"
        : pct >= 60
          ? "study.quizGood"
          : "study.quizPoor";

    const again = dom.make(
      "button",
      "btn btn--primary",
      i18n.t("study.quizRestart"),
    );
    again.type = "button";
    dom.on(again, "click", () => this.startQuiz(state.questions));

    card.append(
      ring,
      dom.make("h4", "", i18n.t("study.quizScore", { score, total })),
      dom.make("p", "muted", i18n.t(verdict)),
      again,
    );
    box.append(card);
  },
};

const clip = {
  duration: 0,
  poller: null,
  corner: "br",

  init() {
    this.form = new ToolForm($("#clipForm"), {
      hintKey: "tools.hintClip",
      onSubmit: (url) => this.load(url),
    });

    const start = $("#rangeStart");
    const end = $("#rangeEnd");

    const onSlide = (moved) => {
      let a = Number(start.value);
      let b = Number(end.value);
      if (a >= b) {
        if (moved === "start") a = Math.max(0, b - 1);
        else b = Math.min(this.duration, a + 1);
        start.value = a;
        end.value = b;
      }
      $("#startTime").value = fmt.hms(a);
      $("#endTime").value = fmt.hms(b);
      this.syncLabels();
    };

    dom.on(start, "input", () => onSlide("start"));
    dom.on(end, "input", () => onSlide("end"));

    dom.on(start, "change", () => player.seek(Number(start.value), false));

    const onType = (which) => {
      const a = fmt.parseClock($("#startTime").value);
      const b = fmt.parseClock($("#endTime").value);
      if (Number.isFinite(a))
        start.value = Math.min(Math.max(0, a), this.duration);
      if (Number.isFinite(b))
        end.value = Math.min(Math.max(0, b), this.duration);
      onSlide(which);
    };
    dom.on($("#startTime"), "change", () => onType("start"));
    dom.on($("#endTime"), "change", () => onType("end"));

    dom.on($("#useCurrent"), "click", () => {
      const time = player.currentTime();
      if (time === null) return toast.warn(i18n.t("clip.errors.noVideo"));
      const length = Number(end.value) - Number(start.value);
      start.value = Math.floor(time);
      end.value = Math.min(
        this.duration,
        Math.floor(time) + Math.max(5, length),
      );
      onSlide("start");
    });

    $$("#cornerPicker button").forEach((button) => {
      dom.on(button, "click", () => {
        this.corner = button.dataset.corner;
        $$("#cornerPicker button").forEach((other) => {
          other.setAttribute("aria-checked", String(other === button));
        });
      });
    });

    dom.on($("#clipFormat"), "change", () => this.syncFormat());
    dom.on($("#clipRender"), "click", () => this.render());
    dom.on($("#clipCancel"), "click", () => this.cancel());

    media.onChange((video) => this.onMedia(video));
    i18n.onChange(() => {
      this.syncLabels();
      if (!store.clipJobId)
        $(".btn__label", $("#clipRender")).textContent = i18n.t("clip.render");
      if (nav.view === "clips") this.loadRecent();
    });
    nav.register("clips", {
      enter: () => {
        if (!store.media) {
          this.form.focus();
          return;
        }
        this.mountPlayer();
        this.loadRecent();
      },
      leave: () => player.pause(),
    });
  },

  async load(url) {
    await loadMedia(url, {
      form: this.form,
      skeleton: $("#clipSkeleton"),
      workspace: $("#clipWorkspace"),
    });
    if (store.media && nav.view === "clips") {
      this.mountPlayer();
      this.loadRecent();
    }
  },

  mountPlayer() {
    player.ensure($("#clipPlayer"), store.media);
    player.onTick = null;
    player.onDuration = (seconds) => this.adoptDuration(seconds);
  },

  adoptDuration(seconds) {
    if (store.media?.duration || !Number.isFinite(seconds) || seconds <= 0)
      return;
    this.duration = Math.max(1, Math.ceil(seconds));
    const start = $("#rangeStart");
    const end = $("#rangeEnd");
    start.max = this.duration;
    end.max = this.duration;
    if (Number(end.value) > this.duration) end.value = this.duration;
    if (Number(start.value) >= Number(end.value))
      start.value = Math.max(0, Number(end.value) - 1);
    $("#startTime").value = fmt.hms(start.value);
    $("#endTime").value = fmt.hms(end.value);
    this.syncLabels();
  },

  onMedia(video) {
    this.form.set(video.url || video.sourceUrl);
    this.form.resetHint();
    paintStrip($("#clipWorkspace [data-strip]"), video);
    dom.show($("#clipWorkspace"), true);
    $('.capabilities[data-for="clips"]').classList.add("is-compact");
    if (player.host === $("#clipPlayer")) player.destroy();
    this.reset(video);
  },

  reset(video) {

    this.duration = Math.max(1, Math.round(video.duration || 600));
    const defaultEnd = Math.min(this.duration, 20);

    const start = $("#rangeStart");
    const end = $("#rangeEnd");
    start.max = this.duration;
    end.max = this.duration;
    start.value = 0;
    end.value = defaultEnd;
    $("#startTime").value = fmt.hms(0);
    $("#endTime").value = fmt.hms(defaultEnd);

    $("#clipTitle").value = (video.title || "").slice(0, 90);
    $("#clipSubs").checked = false;

    const heights = video.formats.video.map((f) => f.height).filter(Boolean);
    const tallest = heights.length ? Math.max(...heights) : 0;
    const qualities = $$("#clipQuality option");
    qualities.forEach((option) => {
      option.disabled = tallest > 0 && Number(option.value) > tallest;
    });

    if (qualities.every((option) => option.disabled))
      qualities[qualities.length - 1].disabled = false;
    if ($("#clipQuality").selectedOptions[0]?.disabled) {
      const firstOk = $$("#clipQuality option").find((o) => !o.disabled);
      if (firstOk) $("#clipQuality").value = firstOk.value;
    }

    this.syncFormat();

    if (!store.clipJobId) {
      dom.show($("#renderStatus"), false);
      dom.show($("#clipDownload"), false);
    }
    this.syncLabels();
  },

  syncFormat() {
    const isGif = $("#clipFormat").value === "gif";
    dom.show($("#gifFpsField"), isGif);
    const subs = $("#clipSubs");
    subs.disabled = !store.media?.hasCaptions || isGif;
    if (subs.disabled) subs.checked = false;
    this.syncLabels();
  },

  syncLabels() {
    const a = Number($("#rangeStart").value) || 0;
    const b = Number($("#rangeEnd").value) || 0;
    const length = Math.max(0, b - a);
    const gifCap = store.config?.maxGifSeconds || 30;
    const overGif = $("#clipFormat")?.value === "gif" && length > gifCap;
    const label = $("#clipLength");
    label.textContent = `${i18n.t("clip.clipLength")}: ${fmt.clock(length)}`;
    label.classList.toggle("pill--warn", overGif);
    const span = Math.max(1, this.duration);
    $("#rangeFill").style.left = `${(a / span) * 100}%`;
    $("#rangeFill").style.width = `${Math.max(0, ((b - a) / span) * 100)}%`;
  },

  async render() {
    const video = store.media;
    if (!video) return toast.warn(i18n.t("clip.errors.noVideo"));
    if (store.clipJobId) return;

    const startSec = Number($("#rangeStart").value);
    const endSec = Number($("#rangeEnd").value);
    if (endSec <= startSec) return toast.error(i18n.t("clip.errors.range"));

    const max =
      $("#clipFormat").value === "gif"
        ? store.config?.maxGifSeconds || 30
        : store.config?.maxClipSeconds || 600;
    if (endSec - startSec > max) {
      return toast.error(
        i18n.t("clip.errors.tooLong", { max: fmt.clock(max) }),
      );
    }

    const button = $("#clipRender");
    button.classList.add("is-busy");
    button.disabled = true;
    $(".btn__label", button).textContent = i18n.t("clip.rendering");

    try {
      const job = await api.createClip({
        src: video.sourceUrl || video.url,
        start: fmt.hms(startSec),
        end: fmt.hms(endSec),
        options: {
          title: $("#clipTitle").value.trim(),
          watermark: $("#clipWatermark").value.trim(),
          watermarkPosition: this.corner,
          progressBar: $("#clipProgress").checked,
          subtitles: $("#clipSubs").checked,
          subtitleLang: $("#clipSubs").checked ? study.selectedLang() : null,
          quality: $("#clipQuality").value,
          format: $("#clipFormat").value,
          gifFps: Number($("#clipGifFps").value) || 15,
        },
      });

      store.clipJobId = job.id;
      dom.show($("#renderStatus"), true);
      dom.show($("#clipCancel"), true);
      dom.show($("#clipDownload"), false);
      this.paint(job);
      this.startPolling(job.id);
      toast.success(i18n.t("toast.clipQueued"));
    } catch (error) {
      button.classList.remove("is-busy");
      button.disabled = false;
      $(".btn__label", button).textContent = i18n.t("clip.render");
      const key = `clip.errors.${error.code}`;
      if (i18n.has(key)) toast.error(i18n.t(key, { max: fmt.clock(max) }));
      else toast.fromError(error, "toast.clipFailed");
    }
  },

  startPolling(id) {
    this.stopPolling();
    let failures = 0;
    const tick = async () => {
      try {
        const job = await api.clip(id);
        failures = 0;
        if (store.clipJobId !== id) return;
        this.paint(job);
        if (["done", "failed", "canceled"].includes(job.status)) {
          this.finish(job);
          return;
        }
      } catch (error) {

        failures += 1;
        if (failures >= 3) {
          this.finish({ status: "failed", error: toast.message(error) });
          return;
        }
      }
      this.poller = setTimeout(tick, 1200);
    };
    this.poller = setTimeout(tick, 1200);
  },

  stopPolling() {
    clearTimeout(this.poller);
    this.poller = null;
  },

  paint(job) {
    const percent = Math.round(job.progress || 0);
    const stageKey = `clip.stages.${job.stage || job.status}`;
    $("#renderStage").textContent = i18n.has(stageKey)
      ? i18n.t(stageKey)
      : job.status;
    $("#renderPercent").textContent = `${percent}%`;
    $("#renderBar").style.width = `${percent}%`;
    const progress = $("#renderBar").parentElement;
    progress.setAttribute("aria-valuenow", String(percent));
    progress.classList.toggle("is-done", job.status === "done");
  },

  finish(job) {
    this.stopPolling();
    const button = $("#clipRender");
    button.classList.remove("is-busy");
    button.disabled = !store.config?.ffmpeg;
    $(".btn__label", button).textContent = i18n.t("clip.render");
    dom.show($("#clipCancel"), false);

    if (job.status === "done") {
      const link = $("#clipDownload");
      link.href = `/api/clips/${job.id}/file`;
      link.textContent = `${i18n.t("clip.download")} · ${fmt.bytes(job.filesize)}`;
      dom.show(link, true);
      toast.success(i18n.t("toast.clipDone"));
      this.loadRecent();
    } else if (job.status === "canceled") {
      this.paint({ ...job, progress: 0, stage: "canceled" });
      toast.warn(i18n.t("toast.clipCanceled"));
    } else {
      this.paint({ ...job, stage: "failed" });
      toast.error(
        job.error
          ? `${i18n.t("toast.clipFailed")}: ${job.error}`
          : i18n.t("toast.clipFailed"),
      );
    }
    store.clipJobId = null;
  },

  async cancel() {
    const id = store.clipJobId;
    if (!id) return;
    try {
      await api.cancelClip(id);
      this.finish({ status: "canceled", id });
    } catch (error) {
      toast.fromError(error);
    }
  },

  async loadRecent() {
    let clips;
    try {
      ({ clips } = await api.clips());
    } catch {
      return;
    }
    const list = dom.clear($("#clipList"));
    const ready = clips.filter((item) => item.status === "done");
    if (!ready.length) {
      list.append(dom.make("p", "muted small", i18n.t("clip.noClips")));
      return;
    }
    for (const item of ready) {
      const card = dom.clone("tpl-clip-card");
      i18n.apply(card);
      const img = $(".clip-card__thumb", card);
      img.src = item.thumbnail || "";
      img.hidden = !item.thumbnail;
      $(".clip-card__title", card).textContent = item.title || item.video_id;
      $(".clip-card__meta", card).textContent = [
        `${fmt.clock(item.start_sec)}–${fmt.clock(item.end_sec)}`,
        String(item.format || "").toUpperCase(),
        fmt.bytes(item.filesize),
      ]
        .filter(Boolean)
        .join(" · ");
      $(".clip-card__dl", card).href = `/api/clips/${item.id}/file`;
      dom.on($(".clip-card__del", card), "click", async () => {
        try {
          await api.deleteClip(item.id);
          toast.success(i18n.t("toast.clipDeleted"));
          this.loadRecent();
        } catch (error) {
          toast.fromError(error);
        }
      });
      list.append(card);
    }
  },
};

const audioId = {
  source: "mic",
  state: "idle",
  session: null,
  result: null,
  items: [],
  lastStatus: null,
  RECORD_SECONDS: 10,
  MIN_SECONDS: 3,

  init() {
    $$("[data-source]").forEach((button) => {
      dom.on(button, "click", () => {
        if (this.state !== "idle" || button.disabled) return;
        this.source = button.dataset.source;
        storage.set("tf:aid-source", this.source);
        this.paintSources();
      });
    });
    const saved = storage.get("tf:aid-source");
    if (["mic", "system", "both"].includes(saved)) this.source = saved;

    dom.on($("#aidButton"), "click", () => this.toggle());
    dom.on($("#aidClear"), "click", () => this.clearHistory());

    i18n.onChange(() => {
      this.lastStatus = null;
      this.paintSources();
      this.paintState();
      if (this.result) this.renderResult(this.result);
      this.renderHistory();
      if (nav.view === "audioid") this.checkSupport();
    });
    nav.register("audioid", {
      enter: () => {
        this.paintSources();
        this.checkSupport();
        this.loadHistory();
        requestAnimationFrame(() => this.drawIdle());
      },
      leave: () => {
        if (this.state === "listening") this.cancel();
      },
    });

    dom.on(window, "pagehide", () => this.cancel());
    this.paintSources();
  },

  support() {
    const md = navigator.mediaDevices;
    return {
      secure: window.isSecureContext,
      mic: !!md?.getUserMedia,
      system: !!md?.getDisplayMedia,
      recorder: typeof window.MediaRecorder === "function",
      audioContext: !!(window.AudioContext || window.webkitAudioContext),
    };
  },

  checkSupport() {
    const s = this.support();
    let problem = null;
    if (!s.secure) problem = "insecure";
    else if (!s.mic || !s.recorder || !s.audioContext) problem = "unsupported";
    this.notice(problem ? i18n.t(`audioId.errors.${problem}`) : null);
    $("#aidButton").disabled = !!problem || this.state === "identifying";
    const system = s.system && s.secure;
    for (const id of ["system", "both"]) {
      const button = $(`[data-source="${id}"]`);
      button.disabled = !system;
      button.title = system ? "" : i18n.t("audioId.errors.systemUnsupported");
    }
    if (!system && this.source !== "mic") {
      this.source = "mic";
      this.paintSources();
    }
    dom.show(
      $("#aidKeyless"),
      !!store.config?.audioId && !store.config.audioId.keyed,
    );
    return !problem;
  },

  notice(text) {
    $("#aidNoticeText").textContent = text || "";
    dom.show($("#aidNotice"), !!text);
  },

  paintSources() {
    $$("[data-source]").forEach((button) => {
      const on = button.dataset.source === this.source;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-checked", String(on));
    });
    $("#aidHint").textContent = i18n.t(`audioId.sourceHints.${this.source}`);
  },

  setState(state) {
    this.state = state;
    this.paintState();
  },

  paintState(seconds) {
    $("#aidStage").dataset.state = this.state;
    const button = $("#aidButton");
    const status = $("#aidStatus");
    $$("[data-source]").forEach((b) =>
      b.classList.toggle("is-locked", this.state !== "idle"),
    );
    if (this.state === "listening") {
      const elapsed = seconds ?? this.elapsed();
      status.textContent = i18n.t("audioId.listening", {
        seconds: Math.max(0, Math.ceil(this.RECORD_SECONDS - elapsed)),
      });
      button.setAttribute("aria-label", i18n.t("audioId.stop"));
    } else if (this.state === "identifying") {
      status.textContent = i18n.t("audioId.identifying");
      button.setAttribute("aria-label", i18n.t("audioId.identifying"));
    } else {
      status.textContent = this.lastStatus || i18n.t("audioId.listen");
      button.setAttribute("aria-label", i18n.t("a11y.listen"));
    }
    button.disabled = this.state === "identifying";
  },

  elapsed() {
    const s = this.session;
    return s && s.startedAt ? (performance.now() - s.startedAt) / 1000 : 0;
  },

  toggle() {
    if (this.state === "idle") this.start();
    else if (this.state === "listening") {

      if (this.elapsed() >= this.MIN_SECONDS) this.finish();
      else this.cancel();
    }
  },

  pickMime() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ];
    return (
      candidates.find((type) =>
        window.MediaRecorder?.isTypeSupported?.(type),
      ) || ""
    );
  },

  async start() {
    if (!this.checkSupport()) return;
    this.notice(null);
    this.lastStatus = null;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const session = {
      ctx,
      streams: [],
      startedAt: 0,
      peak: 0,
      chunks: [],
      canceled: false,
    };
    this.session = session;
    this.setState("listening");
    this.paintState(0);

    const constraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    const fail = (code) => Object.assign(new Error(code), { tf: code });
    try {

      if (this.source === "system" || this.source === "both") {
        if (!navigator.mediaDevices.getDisplayMedia)
          throw fail("systemUnsupported");
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: constraints,
          systemAudio: "include",
          selfBrowserSurface: "include",
          surfaceSwitching: "include",
        });
        display.getVideoTracks().forEach((track) => track.stop());
        if (!display.getAudioTracks().length) {
          display.getTracks().forEach((track) => track.stop());
          throw fail("noSystemAudio");
        }
        session.streams.push(display);

        display.getAudioTracks()[0].addEventListener("ended", () => {
          if (this.session === session && this.state === "listening")
            this.toggle();
        });
      }
      if (this.source === "mic" || this.source === "both") {
        session.streams.push(
          await navigator.mediaDevices.getUserMedia({ audio: constraints }),
        );
      }
      if (session.canceled || this.session !== session) throw fail("canceled");

      await ctx.resume().catch(() => {});
      const mix = ctx.createGain();
      for (const stream of session.streams)
        ctx.createMediaStreamSource(stream).connect(mix);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      mix.connect(analyser);
      const destination = ctx.createMediaStreamDestination();
      mix.connect(destination);
      session.analyser = analyser;

      const mimeType = this.pickMime();
      const recorder = new MediaRecorder(destination.stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 128000,
      });
      session.recorder = recorder;
      session.mimeType = recorder.mimeType || mimeType || "audio/webm";
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) session.chunks.push(event.data);
      });
      session.stopped = new Promise((resolve) =>
        recorder.addEventListener("stop", resolve, { once: true }),
      );
      recorder.start(250);
      session.startedAt = performance.now();

      session.timer = setInterval(() => {
        const elapsed = this.elapsed();
        this.paintState(elapsed);
        $("#aidStage").style.setProperty(
          "--aid-progress",
          String(Math.min(100, (elapsed / this.RECORD_SECONDS) * 100)),
        );
        if (elapsed >= this.RECORD_SECONDS) this.finish();
      }, 100);
      this.meterLoop(session);
    } catch (error) {
      let code = error.tf;
      if (!code)
        code =
          error.name === "NotAllowedError" || error.name === "SecurityError"
            ? "denied"
            : "unsupported";
      this.teardown(session);
      if (this.session === session) {
        this.session = null;
        this.setState("idle");
      }
      if (code !== "canceled") {
        const text = i18n.t(`audioId.errors.${code}`);
        this.notice(text);
        toast.warn(text);
      }
    }
  },

  meterLoop(session) {
    const canvas = $("#aidMeter");
    const g = canvas.getContext("2d");
    const freq = new Uint8Array(session.analyser.frequencyBinCount);
    const wave = new Uint8Array(session.analyser.fftSize);
    const draw = () => {
      if (this.session !== session || !session.analyser) return;
      session.analyser.getByteFrequencyData(freq);
      session.analyser.getByteTimeDomainData(wave);
      let sum = 0;
      for (let i = 0; i < wave.length; i += 1) {
        const v = (wave[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / wave.length);
      session.peak = Math.max(session.peak, rms);
      $("#aidStage").style.setProperty(
        "--aid-level",
        Math.min(1, rms * 4).toFixed(3),
      );
      this.drawBars(g, canvas, freq);
      session.raf = requestAnimationFrame(draw);
    };
    session.raf = requestAnimationFrame(draw);
  },

  sizeCanvas(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { width, height, dpr };
  },

  drawBars(g, canvas, freq) {
    const { width, height, dpr } = this.sizeCanvas(canvas);
    g.clearRect(0, 0, width, height);
    const bars = 40;
    const gap = 3 * dpr;
    const barWidth = Math.max(1, (width - gap * (bars - 1)) / bars);
    const gradient = g.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "#ff2d78");
    gradient.addColorStop(0.55, "#a855f7");
    gradient.addColorStop(1, "#22d3ee");
    g.fillStyle = gradient;

    const usable = Math.max(bars, Math.floor(freq.length * 0.4));
    for (let i = 0; i < bars; i += 1) {
      const from = Math.floor((i / bars) * usable);
      const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * usable));
      let peak = 0;
      for (let j = from; j < to && j < freq.length; j += 1)
        peak = Math.max(peak, freq[j]);
      const h = Math.max(2 * dpr, (peak / 255) * height);
      const x = i * (barWidth + gap);
      const y = (height - h) / 2;
      g.beginPath();
      if (g.roundRect)
        g.roundRect(x, y, barWidth, h, Math.min(barWidth / 2, 3 * dpr));
      else g.rect(x, y, barWidth, h);
      g.fill();
    }
  },

  drawIdle() {
    const canvas = $("#aidMeter");
    if (!canvas || canvas.offsetParent === null) return;
    this.drawBars(canvas.getContext("2d"), canvas, new Uint8Array(512));
  },

  async finish() {
    const session = this.session;
    if (!session || this.state !== "listening" || !session.recorder) return;
    clearInterval(session.timer);
    this.setState("identifying");
    try {
      if (session.recorder.state !== "inactive") session.recorder.stop();
      await session.stopped;
    } catch {
    }
    const blob = new Blob(session.chunks, { type: session.mimeType });
    const peak = session.peak;
    this.teardown(session);
    if (this.session !== session) return;

    if (peak < 0.008) {
      this.session = null;
      this.lastStatus = i18n.t("audioId.errors.silent");
      this.setState("idle");
      toast.warn(this.lastStatus);
      return;
    }
    await this.identify(blob, session);
  },

  async identify(blob, session) {
    try {
      const response = await api.recognize(blob, this.source);
      if (this.session !== session) return;
      if (!response?.match) {
        this.lastStatus = i18n.t("audioId.noMatch");
        toast.warn(i18n.t("toast.audioIdNoMatch"));
        this.result = null;
        dom.show($("#aidResult"), false);
      } else {
        const row = response.recognition;
        this.result = row;
        this.lastStatus = i18n.t("audioId.matched");
        this.renderResult(row);
        requestAnimationFrame(() =>
          $("#aidResult").scrollIntoView({
            behavior: reducedMotion() ? "auto" : "smooth",
            block: "nearest",
          }),
        );
        toast.success(
          i18n.t("toast.audioIdMatched", {
            title: [row.artist, row.title].filter(Boolean).join(" — "),
          }),
        );
        this.items = [row, ...this.items.filter((item) => item.id !== row.id)];
        this.renderHistory();
      }
    } catch (error) {
      if (this.session !== session) return;
      this.lastStatus = toast.message(error, "errors.recognitionFailed");
      toast.fromError(error, "errors.recognitionFailed");
    } finally {
      if (this.session === session) {
        this.session = null;
        this.setState("idle");
      }
    }
  },

  cancel() {
    const session = this.session;
    if (!session) return;
    session.canceled = true;
    try {
      if (session.recorder && session.recorder.state !== "inactive")
        session.recorder.stop();
    } catch {
    }
    this.teardown(session);
    this.session = null;
    this.setState("idle");
  },

  teardown(session) {
    clearInterval(session.timer);
    cancelAnimationFrame(session.raf);
    for (const stream of session.streams || [])
      stream.getTracks().forEach((track) => track.stop());
    session.streams = [];
    session.analyser = null;
    if (session.ctx && session.ctx.state !== "closed")
      session.ctx.close().catch(() => {});
    $("#aidStage").style.setProperty("--aid-level", "0");
    $("#aidStage").style.setProperty("--aid-progress", "0");
    this.drawIdle();
  },

  links(row, { compact = false } = {}) {
    const wrap = dom.make(
      "div",
      compact ? "aid-links aid-links--compact" : "aid-links",
    );
    const add = (href, key, className, icon) => {
      if (!href) return;
      const a = dom.make("a", `aid-link ${className}`);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = i18n.t(key);
      a.setAttribute("aria-label", `${i18n.t(key)}: ${row.title}`);
      a.append(dom.icon(icon));
      if (!compact) a.append(dom.make("span", "", i18n.t(key)));
      wrap.append(a);
    };
    add(row.youtube_url, "audioId.youtube", "aid-link--yt", "pi-youtube");
    add(row.spotify_url, "audioId.spotify", "aid-link--spotify", "ic-note");
    add(row.apple_url, "audioId.apple", "aid-link--apple", "ic-note");
    add(row.song_link, "audioId.songLink", "aid-link--all", "ic-globe");
    return wrap;
  },

  openInApp(row) {
    if (!row.youtube_url) return;
    nav.go("downloader");
    downloader.analyze(row.youtube_url);
  },

  cover(row, className) {
    const box = dom.make("div", className);
    if (row.cover) {
      const img = dom.make("img");
      img.src = row.cover;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      dom.on(img, "error", () => img.replaceWith(dom.icon("ic-note")), {
        once: true,
      });
      box.append(img);
    } else {
      box.append(dom.icon("ic-note"));
    }
    return box;
  },

  renderResult(row) {
    const card = dom.clear($("#aidResult"));
    card.append(this.cover(row, "aid-result__cover"));

    const body = dom.make("div", "aid-result__body");
    body.append(
      dom.make("span", "pill pill--ok", i18n.t("audioId.matched")),
      dom.make("h2", "aid-result__title", row.title),
      dom.make("p", "aid-result__artist", row.artist),
    );
    const meta = [
      row.album,
      row.release_date ? String(row.release_date).slice(0, 4) : null,
      i18n.t("audioId.via", {
        provider: row.provider === "acrcloud" ? "ACRCloud" : "AudD",
      }),
    ].filter(Boolean);
    body.append(dom.make("p", "aid-result__meta", meta.join(" · ")));

    const actions = dom.make("div", "aid-result__actions");
    if (row.youtube_url) {
      const open = dom.make("button", "btn btn--primary btn--sm");
      open.type = "button";
      open.append(
        dom.icon("ic-download"),
        dom.make("span", "", i18n.t("audioId.open")),
      );
      dom.on(open, "click", () => this.openInApp(row));
      actions.append(open);
    }
    actions.append(this.links(row));
    body.append(actions);
    card.append(body);
    dom.show(card, true);
  },

  async loadHistory() {
    try {
      const { items } = await api.recognitions();
      this.items = items || [];
    } catch {
    }
    this.renderHistory();
  },

  renderHistory() {
    const list = dom.clear($("#aidHistory"));
    dom.show($("#aidClear"), this.items.length > 0);
    if (!this.items.length) {
      const empty = dom.make("div", "empty-note glass");
      empty.append(
        dom.icon("ic-audioid"),
        dom.make("p", "", i18n.t("audioId.empty")),
      );
      list.append(empty);
      return;
    }
    for (const row of this.items) {
      const card = dom.clone("tpl-aid-item");
      i18n.apply(card);
      $(".aid-item__cover", card).replaceWith(
        this.cover(row, "aid-item__cover"),
      );
      $(".aid-item__title", card).textContent = row.title;
      $(".aid-item__artist", card).textContent = row.artist;
      $(".aid-item__meta", card).textContent = fmt.date(row.created_at);
      const links = $(".aid-item__links", card);
      if (row.youtube_url) {
        const open = dom.make("button", "icon-btn icon-btn--sm aid-item__open");
        open.type = "button";
        open.title = i18n.t("audioId.open");
        open.setAttribute(
          "aria-label",
          `${i18n.t("audioId.open")}: ${row.title}`,
        );
        open.append(dom.icon("ic-download"));
        dom.on(open, "click", () => this.openInApp(row));
        links.append(open);
      }
      links.append(this.links(row, { compact: true }));
      dom.on($(".aid-item__del", card), "click", async () => {
        try {
          await api.removeRecognition(row.id);
          this.items = this.items.filter((item) => item.id !== row.id);
          if (this.result?.id === row.id) {
            this.result = null;
            dom.show($("#aidResult"), false);
          }
          this.renderHistory();
          toast.success(i18n.t("toast.audioIdRemoved"));
        } catch (error) {
          toast.fromError(error);
        }
      });
      list.append(card);
    }
  },

  async clearHistory() {
    if (!confirm(i18n.t("audioId.confirmClear"))) return;
    try {
      await api.clearRecognitions();
      this.items = [];
      this.result = null;
      dom.show($("#aidResult"), false);
      this.renderHistory();
      toast.success(i18n.t("toast.audioIdCleared"));
    } catch (error) {
      toast.fromError(error);
    }
  },
};

const historyView = {
  init() {
    dom.on($("#historyClear"), "click", async () => {
      if (!confirm(i18n.t("history.confirmClear"))) return;
      try {
        await api.clearHistory();
        toast.success(i18n.t("toast.historyCleared"));
        this.refresh();
      } catch (error) {
        toast.fromError(error);
      }
    });
    i18n.onChange(() => {
      if (nav.view === "history") this.refresh();
    });
    nav.register("history", { enter: () => this.refresh() });
  },

  async refresh() {
    let payload;
    try {
      payload = await api.history();
    } catch (error) {
      toast.fromError(error);
      return;
    }

    const items = payload.items.filter((item) => item.status === "completed");
    const body = dom.clear($("#historyBody"));
    const empty = items.length === 0;
    dom.show($("#historyEmpty"), empty);
    dom.show($("#historyTableWrap"), !empty);
    dom.show($("#historyClear"), !empty);
    $("#historyTotals").textContent = empty
      ? ""
      : i18n.t("history.totals", {
          count: fmt.number(payload.stats?.completed ?? items.length),
          size: fmt.bytes(payload.stats?.bytes),
        });

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const row = dom.make("tr");

      const titleCell = dom.make("td", "table__cell--title");
      const wrap = dom.make("div", "table__title");
      if (item.thumbnail) {
        const img = dom.make("img");
        img.src = item.thumbnail;
        img.alt = "";
        img.loading = "lazy";
        dom.on(img, "error", () => img.remove(), { once: true });
        wrap.append(img);
      }
      const text = dom.make("div", "table__text");
      const title = dom.make(
        "a",
        "truncate table__link",
        item.title || item.videoId,
      );
      title.href = item.url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
      text.append(
        title,
        dom.make("div", "muted small truncate", item.channel || ""),
      );
      wrap.append(text);
      titleCell.append(wrap);

      const actions = dom.make("td", "table__cell--actions");
      const actionWrap = dom.make("div", "table__actions");

      const again = dom.make("button", "icon-btn icon-btn--sm");
      again.type = "button";
      again.title = i18n.t("history.again");
      again.setAttribute(
        "aria-label",
        `${i18n.t("history.again")}: ${item.title || ""}`,
      );
      again.append(dom.icon("ic-download"));
      dom.on(again, "click", () => {
        nav.go("downloader");
        downloader.analyze(item.url);
      });

      const remove = dom.make("button", "icon-btn icon-btn--sm");
      remove.type = "button";
      remove.title = i18n.t("history.remove");
      remove.setAttribute(
        "aria-label",
        `${i18n.t("history.remove")}: ${item.title || ""}`,
      );
      remove.append(dom.icon("ic-trash"));
      dom.on(remove, "click", async () => {
        try {
          await api.removeHistory(item.id);
          toast.success(i18n.t("toast.entryRemoved"));
          this.refresh();
        } catch (error) {
          toast.fromError(error);
        }
      });

      actionWrap.append(again, remove);
      actions.append(actionWrap);

      const cell = (label, value) => {
        const td = dom.make("td", "", value);
        td.dataset.label = i18n.t(label);
        return td;
      };
      row.append(
        titleCell,
        cell(
          "history.columns.type",
          item.kind === "audio"
            ? i18n.t("video.audioTab")
            : i18n.t("video.videoTab"),
        ),
        cell(
          "history.columns.quality",
          `${item.quality || "—"}${item.container ? ` · ${item.container.toUpperCase()}` : ""}`,
        ),
        cell(
          "history.columns.size",
          item.filesize ? fmt.bytes(item.filesize) : "—",
        ),
        cell(
          "history.columns.date",
          fmt.date(item.completedAt || item.createdAt),
        ),
        actions,
      );
      fragment.append(row);
    }
    body.append(fragment);
  },
};

async function boot() {
  try {
    await i18n.use(i18n.detect());
  } catch {
    document.documentElement.lang = "en";
  }

  theme.init();
  modal.init();
  nav.init();
  langSwitch.init();
  downloader.init();
  playlist.init();
  study.init();
  clip.init();
  audioId.init();
  historyView.init();
  platforms.init();
  metrics.init();
  formatsShowcase.init();
  scrollTop.init();

  nav.fromHash();

  try {
    store.config = await api.config();
    if (Array.isArray(store.config.locales) && store.config.locales.length) {
      i18n.available = store.config.locales.filter((code) => code in i18n.meta);
    }
    if (!store.config.ffmpeg) {
      toast.warn(i18n.t("errors.ffmpeg"));
      $("#clipRender").disabled = true;
    }
    if (!store.config.ytdlp) {

      toast.warn(i18n.t("errors.engineMissing"));
    }
    platforms.load(store.config);
    metrics.render();
    formatsShowcase.render();
    if (store.media) study.paintSourceNote();
    if (nav.view === "audioid") audioId.checkSupport();
  } catch {
    toast.error(i18n.t("errors.network"));
  }

  const params = new URLSearchParams(location.search);
  const deepLink = params.get("url") || params.get("v") || params.get("list");
  if (deepLink) downloader.analyze(deepLink);

  dom.on(window, "offline", () => toast.warn(i18n.t("toast.offline")));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
