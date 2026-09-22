// ============================================================
// 4KHDHub Provider — Deobfuscated & Final Version
// ============================================================

const cheerio = require("cheerio-without-node-native");

const PROVIDER_NAME = "4KHDHub";
const BASE_URL = "https://4khdhub.one";
const TMDB_URL = "https://api.themoviedb.org/3";
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": USER_AGENT,
  Referer: BASE_URL + "/",
};

// ==================== Settings ====================

function getInvertedSortTag(num, max = 999999) {
  const n = Math.max(0, parseInt(num, 10) || 0);
  const inverted = Math.max(0, max - n);
  const bin = inverted.toString(2).padStart(20, "0");
  return bin
    .split("")
    .map((c) => (c === "1" ? "\uFEFF" : "\u200B"))
    .join("");
}

function resolveSettings(settings) {
  let result = { sortBy: "quality" };
  try {
    let s = settings;
    if (!s && typeof globalThis !== "undefined")
      s =
        globalThis.SCRAPER_SETTINGS ||
        globalThis.SETTINGS ||
        globalThis.settings;
    if (!s && typeof global !== "undefined")
      s = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!s && typeof window !== "undefined")
      s = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;

    if (s) {
      let raw = s.sortBy || s.sort_by || s.sort || "";
      if (typeof raw === "object" && raw !== null)
        raw = raw.value || raw.name || "";
      const val = String(raw).toLowerCase();
      if (val.includes("largest") || val.includes("size"))
        result.sortBy = "largest";
      else result.sortBy = "quality";
    }
  } catch (e) {
    console.error(`[${PROVIDER_NAME}] settings error`, e);
  }
  return result;
}

function onSettings() {
  return [
    {
      type: "select",
      key: "sortBy",
      name: "sort_by",
      label: "Sort By",
      options: [
        { label: "Quality", value: "quality" },
        { label: "Largest", value: "size" },
      ],
      default: "quality",
    },
  ];
}

// ==================== Fetch ====================

async function fetchText(url, referer = BASE_URL) {
  const res = await fetch(url, {
    headers: { ...HEADERS, Referer: referer + "/" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

function absoluteUrl(u, base = BASE_URL) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  try {
    return new URL(u, base).toString();
  } catch {
    return "";
  }
}

// ==================== Decoders ====================

function decodeBase64(s) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const clean = String(s || "").replace(/=+$/, "");
  let out = "",
    bc = 0,
    bs,
    buf,
    idx = 0;
  while ((buf = clean.charAt(idx++))) {
    buf = chars.indexOf(buf);
    if (buf < 0) continue;
    bs = bc % 4 ? bs * 64 + buf : buf;
    if (bc++ % 4)
      out += String.fromCharCode((bs >> ((-2 * bc) & 6)) & 0xff);
  }
  return out;
}

function rot13(s) {
  return String(s || "").replace(/[a-zA-Z]/g, (c) => {
    const code = c.charCodeAt(0) + 13;
    const limit = c <= "Z" ? 90 : 122;
    return String.fromCharCode(code <= limit ? code : code - 26);
  });
}

function decodeEntities(s) {
  if (!s) return "";
  const map = {
    nbsp: " ",
    amp: "&",
    quot: '"',
    lt: "<",
    gt: ">",
    "#038": "&",
  };
  return s
    .replace(/&(nbsp|amp|quot|lt|gt|#038);/g, (_, k) => map[k])
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d));
}

// ==================== Title / Size / Quality ====================

function normalizeTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\b(the|a|an|directors?|cut)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(a, b) {
  const ta = normalizeTitle(a).split(" ").filter(Boolean);
  const tb = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (!ta.length) return 0;
  return ta.filter((w) => tb.has(w)).length / ta.length;
}

function parseQuality(text) {
  const t = String(text || "").toLowerCase();
  if (t.indexOf("2160") >= 0 || t.indexOf("4k") >= 0) return "2160p";
  if (t.indexOf("1080") >= 0) return "1080p";
  if (t.indexOf("720") >= 0) return "720p";
  if (t.indexOf("480") >= 0) return "480p";
  return "1080p";
}

function getQualityRank(q) {
  const t = String(q).toLowerCase();
  if (t.includes("2160") || t.includes("4k") || t.includes("uhd")) return 4;
  if (t.includes("1080") || t.includes("fhd")) return 3;
  if (t.includes("720") || t.includes("hd")) return 2;
  if (t.includes("480") || t.includes("sd")) return 1;
  return 0;
}

function parseSize(text) {
  const m = String(text || "").match(/([\d.]+)\s*(GB|MB|KB)/i);
  return m ? m[1] + " " + m[2].toUpperCase() : "N/A";
}

function isDirectVideo(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith(".pixeldrain.dev") ||
      host.endsWith(".r2.cloudflarestorage.com")
    );
  } catch {
    return false;
  }
}

// ==================== TMDB ====================

async function getMetadata(id, type) {
  const kind = type === "tv" || type === "series" ? "tv" : "movie";
  const res = await fetch(
    `${TMDB_URL}/${kind}/${encodeURIComponent(
      id
    )}?api_key=${TMDB_KEY}&append_to_response=external_ids`,
    { headers: { Accept: "application/json", "User-Agent": USER_AGENT } }
  );
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  const data = await res.json();
  const date = kind === "tv" ? data.first_air_date : data.release_date;
  return {
    title: kind === "tv" ? data.name : data.title,
    year: date ? Number(date.slice(0, 4)) : null,
  };
}

// ==================== Find Page ====================

async function findPage(meta, isSeries, season) {
  const query =
    isSeries && season
      ? meta.title + " season " + season
      : (meta.title + " " + (meta.year || "")).trim();
  const html = await fetchText(
    BASE_URL + "/?s=" + encodeURIComponent(query)
  );
  const $ = cheerio.load(html);
  let best = null;

  $("article").each((_, el) => {
    const $el = $(el);
    const title = $el.find(".entry-title").text().trim();
    const cat = $el.find(".category").text().trim();
    const yearText = $el.find(".year").text();
    const href =
      $el.attr("href") || $el.find("a[href]").first().attr("href");
    if (!title || !href) return;
    if (isSeries && !/series/i.test(cat)) return;
    if (!isSeries && !/movies?/i.test(cat)) return;

    const ym = yearText.match(/\b(19|20)\d{2}\b/);
    const year = ym ? Number(ym[0]) : null;

    let score = titleScore(meta.title, title);
    if (meta.year && year === meta.year) score += 0.35;
    else if (meta.year && year && Math.abs(year - meta.year) > 1)
      score -= 0.5;

    if (isSeries && season) {
      const sm = title.match(/(?:season\s*|s)(\d+)/i);
      if (sm && Number(sm[1]) === Number(season)) score += 0.4;
      else if (sm) score -= 0.6;
    }

    if (!best || score > best.score)
      best = { url: absoluteUrl(href), score, title };
  });

  return best && best.score >= 0.7 ? best.url : "";
}

// ==================== Redirect Decoding ====================

async function decodeRedirect(url) {
  if (/hubcloud|hubdrive/i.test(url)) return url;
  try {
    const html = await fetchText(url);
    const m = html.match(/['"]o['"]\s*,\s*['"]([^'"]+)['"]/)?.[1];
    if (!m) return url;
    const decoded = decodeBase64(rot13(decodeBase64(decodeBase64(m))));
    const parsed = JSON.parse(decoded);
    return parsed.o ? decodeBase64(parsed.o).trim() : url;
  } catch {
    return url;
  }
}

async function findHubCloud($, referer, $ctx) {
  const links = $("a[href]").get();
  for (const el of links) {
    const $a = $ctx(el);
    const href = $a.attr("href");
    const text = $a.text();
    if (!href) continue;

    if (/hubcloud/i.test(text) || /hubcloud/i.test(href))
      return decodeRedirect(absoluteUrl(href, referer));

    if (/hubdrive/i.test(text) || /hubdrive/i.test(href)) {
      const resolved = await decodeRedirect(absoluteUrl(href, referer));
      try {
        const inner = await fetchText(resolved, referer);
        const $$ = cheerio.load(inner);
        const hc = $$("a[href]")
          .filter((_, e) => {
            const $e = $$(e);
            return /hubcloud/i.test(
              $e.text() + " " + ($e.attr("href") || "")
            );
          })
          .first()
          .attr("href");
        if (hc) return absoluteUrl(hc, resolved);
      } catch {}
    }
  }
  return "";
}

// ==================== HubCloud Extract ====================

async function extractHubCloud(url, meta) {
  try {
    let html = await fetchText(url, url);
    let base = url;

    const redirect = html.match(/var url\s*=\s*['"]([^'"]+)['"]/)?.[1];
    const btn = redirect || cheerio.load(html)("a.btn").attr("href");
    if (btn) {
      base = absoluteUrl(btn, url);
      html = await fetchText(base, url);
    }

    const $ = cheerio.load(html);
    const title =
      $("div.card-header").text().replace(/\s+/g, " ").trim() ||
      $("title").text().trim() ||
      meta.title;
    const sizeTxt = parseSize($("i.fa-file").first().text());
    const size = sizeTxt !== "N/A" ? sizeTxt : meta.size;
    const quality = parseQuality(title);

    const out = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href || !isDirectVideo(href)) return;
      out.push({ url: href, title, quality, size });
    });
    return out;
  } catch {
    return [];
  }
}

// ==================== Extract Streams ====================

async function extractStreams(pageUrl, isSeries, season, episode) {
  const html = await fetchText(pageUrl);
  const $ = cheerio.load(html);
  const nodes = [];

  if (isSeries && season && episode) {
    const sTag = "S" + String(season).padStart(2, "0");
    const eTag = "Episode-" + String(episode).padStart(2, "0");

    $(".episode-item").each((_, el) => {
      const $el = $(el);
      if (!$el.find(".episode-title").text().includes(sTag)) return;
      $el.find(".episode-download-item").each((_, d) => {
        if ($(d).text().includes(eTag)) nodes.push($(d));
      });
    });
  } else {
    $(".download-item").each((_, el) => nodes.push($(el)));
  }

  const results = await Promise.all(
    nodes.map(async (n) => {
      const text = n.text().replace(/\s+/g, " ").trim();
      const meta = {
        title: n.find("a[href^='http']").text().trim() || text,
        quality: parseQuality(text),
        size: parseSize(text),
      };
      const hc = await findHubCloud(n, pageUrl, $);
      return hc ? extractHubCloud(hc, meta) : [];
    })
  );
  return results.flat();
}

// ==================== Build Stream ====================

function buildStreamObject(
  mediaTitle,
  descRaw,
  urlRaw,
  qualityIn,
  sizeIn,
  headers,
  seasonTag,
  meta,
  sortBy
) {
  let url = "";
  try {
    url = decodeURIComponent(urlRaw || "");
  } catch {
    url = urlRaw || "";
  }

  const desc = decodeEntities(descRaw || "")
    .replace(/[\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const blob = (desc + " " + url).toLowerCase();
  let quality = qualityIn;
  const qm = blob.match(/\b(2160p|4k|1080p|720p|480p)\b/i);
  if (qm) {
    const q = qm[1].toLowerCase();
    if (q === "4k" || q === "2160p") quality = "2160p";
    else if (q === "1080p") quality = "1080p";
    else if (q === "720p") quality = "720p";
    else if (q === "480p") quality = "480p";
  }
  if (!quality || quality === "N/A") quality = parseQuality(blob);

  // فلترة الجودات: فقط 4k و 1080p
  const t = String(quality).toLowerCase();
  const is4k = t.includes("2160") || t.includes("4k") || t.includes("uhd");
  const is1080 = t.includes("1080") || t.includes("fhd");
  if (!is4k && !is1080) return null;

  const qRank = getQualityRank(quality);

  let audio = "Single-Audio";
  if (/\b(multi|multi\-audio)\b/i.test(blob)) audio = "Multi-Audio";
  else if (
    /\b(dual|dual\-audio|dubbed|hindi)\b/i.test(blob) ||
    decodeEntities(mediaTitle || "").toLowerCase().includes("dual")
  )
    audio = "Dual-Audio";

  let size = sizeIn && sizeIn !== "N/A" ? sizeIn : "N/A";
  const sm =
    desc.match(/\[\s*(\d+(?:\.\d+)?\s*[MG]B)\s*\]/i) ||
    desc.match(/(\d+(?:\.\d+)?\s*[MG]B)/i) ||
    url.match(/(\d+(?:\.\d+)?\s*[MG]B)/i);
  if (sm) size = sm[1].toUpperCase().replace(/\s+/g, "");

  let sizeMB = 0;
  if (size !== "N/A") {
    const m = size.match(/([\d.]+)\s*(GB|MB)/i);
    if (m) {
      const val = parseFloat(m[1]);
      sizeMB = Math.floor(
        m[2].toUpperCase().includes("GB") ? val * 1024 : val
      );
    }
  }

  const sortTag =
    sortBy === "largest"
      ? getInvertedSortTag(sizeMB, 999999)
      : getInvertedSortTag(qRank * 100000 + sizeMB, 999999);

  // إضافة الحجم إلى اسم المزود
  const name = `${sortTag}${PROVIDER_NAME} | ${quality} | ${size} | ${audio}`;

  const title = meta && meta.title ? meta.title : mediaTitle;
  const year = meta && meta.year ? meta.year : "N/A";
  const epTag =
    seasonTag && (seasonTag.startsWith("S") || seasonTag.includes("E"))
      ? `🎬 ${title} - (${year}) ${seasonTag
          .replace(/E0*(\d+)/i, "$1")
          .replace(/S0*(\d+)/i, "$2")}`
      : `🎬 ${title} (${year})`;

  const qIcon = quality === "2160p" ? "⚡" : quality === "720p" ? "💎" : "🔥";
  const ext =
    /\.mp4($|\?)/i.test(url) || /\.mp4\b/i.test(desc) ? "MP4" : "MKV";
  const line1 = `${qIcon} ${quality} | ${size} | 📼 ${ext}`;

  const hdr = /\bhdr10\+/i.test(blob)
    ? "HDR10+"
    : /\bhdr10\b/i.test(blob)
    ? "HDR10"
    : "HDR";
  const codec = /\b(h\.?265|x265|hevc)\b/i.test(blob) ? "H.265" : "H.264";
  const tags = [`🌈 ${hdr}`, `🎞️ ${codec}`];
  if (
    /\b(dolby\s*vision|dovi|\.dv\.)\b/i.test(blob) ||
    /[\.\-_]dv[\.\-_]/i.test(blob)
  )
    tags.push("👁️ DV");
  const line2 = tags.join(" | ");

  const audioCodec = /\btruehd\s*7\.1\b/i.test(blob)
    ? "TrueHD 7.1"
    : /\bddp5\.1\b/i.test(blob) || /\beac3\b/i.test(blob)
    ? "DDP5.1"
    : "DD5.1";
  const atmos = /\batmos\b/i.test(blob) ? " Atmos" : "";
  const line3 = `🎧 ${audio} | 🎧 ${audioCodec}${atmos}`;

  const src = /\b(bluray|blu\-ray)\b/i.test(blob) ? "BluRay" : "WEB-DL";
  const line4 = `📡 ${src}`;

  const fullTitle = [epTag, line1, line2, line3, line4].join("\n");

  return {
    qualityRank: qRank,
    sizeInMB: sizeMB,
    data: {
      name,
      title: fullTitle,
      size: fullTitle,
      description: fullTitle,
      url: urlRaw || "",
      behaviorHints: {
        notWebReady: true,
        proxyHeaders: {
          request: headers || { Referer: BASE_URL + "/" },
        },
      },
    },
  };
}

// ==================== Public Entrypoint ====================

async function getStreams(
  tmdbId,
  type,
  season = null,
  episode = null,
  settings = {}
) {
  const isSeries = type === "tv" || type === "series";
  if (!tmdbId || (!isSeries && type !== "movie")) return [];

  try {
    const cfg = resolveSettings(settings);
    console.log(
      `[${PROVIDER_NAME}] Searching: ${tmdbId} type=${type} S=${season} E=${episode} sort=${cfg.sortBy}`
    );

    const meta = await getMetadata(tmdbId, type);
    const page = await findPage(meta, isSeries, season);
    if (!page) return [];

    const raw = await extractStreams(page, isSeries, season, episode);

    let tag = "";
    if (isSeries) {
      const s = parseInt(season, 10) || 1;
      const e = parseInt(episode, 10) || 1;
      tag = `S${s < 10 ? "0" : ""}${s}E${e < 10 ? "0" : ""}${e}`;
    }

    const seen = {};
    const allBuilt = [];
    for (const s of raw) {
      if (!isDirectVideo(s.url) || seen[s.url]) continue;
      seen[s.url] = true;

      const desc = `${s.title} [${s.quality}] ${s.size}`;
      const built = buildStreamObject(
        meta.title,
        desc,
        s.url,
        s.quality,
        s.size,
        { Referer: BASE_URL + "/", "User-Agent": USER_AGENT },
        tag.trim(),
        meta,
        cfg.sortBy
      );

      if (built) allBuilt.push(built);
    }

    // فلترة 1080p: احذف الأصغر فقط إذا كان العدد 3 أو أكثر
    const isFourK = (item) => {
      const n = (item.data.name || "").toLowerCase();
      return n.includes("2160") || n.includes("4k") || n.includes("uhd");
    };
    const is1080p = (item) => {
      const n = (item.data.name || "").toLowerCase();
      return n.includes("1080") || n.includes("fhd");
    };

    const fourK = allBuilt.filter(isFourK);
    let fullHD = allBuilt.filter(is1080p);

    if (fullHD.length >= 3) {
      let smallest = fullHD[0];
      for (const item of fullHD) {
        if (item.sizeInMB < smallest.sizeInMB) smallest = item;
      }
      fullHD = fullHD.filter((item) => item !== smallest);
    }

    const out = [...fourK, ...fullHD];

    out.sort((a, b) => {
      if (cfg.sortBy === "largest") return b.sizeInMB - a.sizeInMB;
      if (b.qualityRank !== a.qualityRank)
        return b.qualityRank - a.qualityRank;
      return b.sizeInMB - a.sizeInMB;
    });

    console.log(
      `[${PROVIDER_NAME}] Returning ${out.length} stream(s) (4k untouched, 1080p keeps 1-2, drops smallest when 3+)`
    );
    return out.map((s) => s.data);
  } catch (e) {
    console.error(`[${PROVIDER_NAME}] Error: ${e.message}`);
    return [];
  }
}

module.exports = { getStreams, onSettings };
