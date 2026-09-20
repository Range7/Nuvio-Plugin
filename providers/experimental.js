/**
 * Experimental Nuvio Provider
 * PenguPlay (pengu.uk) Stremio addon — Experimental source only
 * STRICT 4K & 1080p ONLY — Min 1GB — Rich server info
 * Order: 4K first, then 1080p. Each quality: largest → smallest.
 * Visible numbering 01, 02, 03... with fixed "Experimental" label.
 */

// ── Protected strings (Base64, split into chunks) ────────────────────────────
var _0xPFX = "aHR0cHM6Ly9wZW5ndS51aw==";

// ── Decoder ──────────────────────────────────────────────────────────────────
function b64decode(str) {
    if (typeof atob === "function") {
        try { return atob(str); } catch(e) {}
    }
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var output = "";
    str = String(str || "").replace(/=+$/, "");
    for (var bc = 0, bs, buffer, idx = 0; buffer = str.charAt(idx++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
        buffer = chars.indexOf(buffer);
    }
    return output;
}

// ── Assembled constants ──────────────────────────────────────────────────────
var ADDON_BASE = b64decode(_0xPFX);
var _0xC1 = "JTdCJTIyYXV0aF90b2tlbiUyMiUzQSUyMlZEWUxRdm9HRHFFODFnRlphd1VJZUxE";
var _0xC2 = "UXF6SWczVkJGd3M0VXg5Zi1jNVUlMjIlMkMlMjJzb3VyY2VfZXhwZXJpbWVudGFs";
var _0xC3 = "JTIyJTNBJTIyY2hlY2tlZCUyMiUyQyUyMnJlc18yMTYwJTIyJTNBJTIyY2hlY2tl";
var _0xC4 = "ZCUyMiUyQyUyMnJlc18xMDgwJTIyJTNBJTIyY2hlY2tlZCUyMiUyQyUyMnJlc183";
var _0xC5 = "MjAlMjIlM0ElMjJ1bmNoZWNrZWQlMjIlMkMlMjJyZXNfNDgwJTIyJTNBJTIydW5j";
var _0xC6 = "aGVja2VkJTIyJTJDJTIycmVzXzM2MCUyMiUzQSUyMnVuY2hlY2tlZCUyMiU3RA==";
var ADDON_CONFIG = b64decode(_0xC1 + _0xC2 + _0xC3 + _0xC4 + _0xC5 + _0xC6);
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
var MIN_SIZE_BYTES = 1024 * 1024 * 1024; // 1.0GB floor

function getTmdbKey() {
    try {
        if (typeof globalThis !== "undefined") {
            if (globalThis.TMDB_API_KEY) return globalThis.TMDB_API_KEY;
            if (globalThis.TMDB_KEY) return globalThis.TMDB_KEY;
        }
        if (typeof window !== "undefined") {
            if (window.TMDB_API_KEY) return window.TMDB_API_KEY;
            if (window.TMDB_KEY) return window.TMDB_KEY;
        }
        var s = null;
        if (typeof globalThis !== "undefined") s = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS;
        if (!s && typeof window !== "undefined") s = window.SCRAPER_SETTINGS || window.SETTINGS;
        if (s && (s.tmdbKey || s.tmdb_key || s.apiKey || s.api_key)) {
            return s.tmdbKey || s.tmdb_key || s.apiKey || s.api_key;
        }
    } catch(e) {}
    var pool = [
        "ZjE1YWFmOWNmMDVmMTRlY2UzMDliNjhjYWQwMWNlMjU=",
        "NDM5YzQ3OGE3NzFmMzVjMDUwMjJmOWZlYWJjY2EwMWM="
    ];
    return b64decode(pool[Math.floor(Math.random() * pool.length)]);
}

function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
}

function onSettings() {
    return [
        {
            type: "select",
            key: "qualityMode",
            name: "quality_mode",
            label: "Quality Filter",
            options: [
                { label: "4K + 1080p", value: "both" },
                { label: "4K ONLY", value: "4k" },
                { label: "1080p ONLY", value: "1080p" }
            ],
            default: "both"
        },
        {
            type: "text",
            key: "tmdbKey",
            name: "tmdb_key",
            label: "Custom TMDB API Key (Optional)",
            default: ""
        }
    ];
}

function resolveSettings(customSettings) {
    var qualityMode = "both";
    try {
        var s = customSettings;
        if (!s && typeof globalThis !== "undefined") s = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
        if (!s && typeof global !== "undefined") s = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
        if (!s && typeof window !== "undefined") s = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
        if (s) {
            var q = String(s.qualityMode || s.quality_mode || "both").toLowerCase();
            if (q === "4k" || q === "1080p") qualityMode = q;
        }
    } catch (e) {}
    return { qualityMode: qualityMode };
}

// ── Entry Point ───────────────────────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
    var rawId = tmdbId;
    if (typeof tmdbId === "object" && tmdbId !== null) {
        rawId = tmdbId.tmdbId || tmdbId.id || tmdbId.imdbId || tmdbId.imdb_id || tmdbId;
    }
    var cleanId = String(rawId || "").replace(/^(?:tmdb|imdb):/i, "").trim();

    var type = (mediaType === "tv" || mediaType === "series") ? "tv" : "movie";
    var ep   = parseInt(episode, 10) || 1;
    var sea  = parseInt(season, 10)  || 1;
    console.log("[experimental] " + type + " id=" + cleanId + (type === "tv" ? " S" + sea + "E" + ep : ""));

    if (cleanId.indexOf("tt") === 0) {
        return resolvePengu(cleanId, type, sea, ep);
    }

    var tmdbKey = getTmdbKey();
    var tmdbEndpoint = type === "tv" ? "tv" : "movie";
    var url = "https://api.themoviedb.org/3/" + tmdbEndpoint + "/" + cleanId +
              "?api_key=" + tmdbKey + "&append_to_response=external_ids";

    return fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } })
    .then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function(data) {
        var imdbId = (data.external_ids && data.external_ids.imdb_id) || "";
        var useId = imdbId || cleanId;
        console.log("[experimental] resolved imdb=" + imdbId + " — using " + useId);
        return resolvePengu(useId, type, sea, ep);
    })
    .catch(function(e) {
        console.log("[experimental] TMDB lookup failed (" + e.message + "), using raw id");
        return resolvePengu(cleanId, type, sea, ep);
    });
}

// ── PenguPlay (Experimental) Pipeline ────────────────────────────────────────

function resolvePengu(id, type, season, episode) {
    var settings = resolveSettings();

    var url = ADDON_BASE + "/" + ADDON_CONFIG + "/stream/" +
        (type === "tv" ? "series/" + id + ":" + season + ":" + episode : "movie/" + id) + ".json";

    console.log("[experimental] addon fetch");

    return fetch(url, {
        headers: {
            "User-Agent": UA,
            "Accept": "application/json"
        },
        redirect: "follow"
    })
    .then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function(data) {
        var streams = (data && data.streams) || [];
        console.log("[experimental] addon returned " + streams.length + " stream(s)");
        return finalizeStreams(streams, settings);
    })
    .catch(function(e) {
        console.log("[experimental] error: " + e.message);
        return [];
    });
}

// ── Parsers ──────────────────────────────────────────────────────────────────

function classifyQuality(s) {
    var text = [
        s.name || "",
        (s.behaviorHints && s.behaviorHints.bingeGroup) || "",
        (s.behaviorHints && s.behaviorHints.filename) || "",
        s.description || ""
    ].join(" ").toLowerCase();

    if (/4k|2160|uhd/.test(text)) return "4K";
    if (/1080|fhd/.test(text)) return "1080p";
    return "";
}

function stripEmoji(text) {
    return String(text || "")
        .replace(/[\p{Extended_Pictographic}\uFE0F\u20E3]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}

function formatBytes(bytes) {
    var n = parseInt(bytes, 10);
    if (!n || n <= 0) return "";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
    return n + " B";
}

function parseServerInfo(description) {
    var d = String(description || "");
    var info = {};

    // 🎬 العنوان — يقف عند 🎧 S## / 📼 / 🎥 / سطر جديد
    var mTitle = d.match(/🎬\s*(.+?)(?=\s*🎧\s*S\d|\s*📼|\s*🎥|\n|$)/);
    if (mTitle) info.titleLine = mTitle[1].trim();

    // 🎧 الموسم — فقط إذا تلاه S##
    var mSeason = d.match(/🎧\s*(S\d+)\b/);
    if (mSeason) info.season = mSeason[1].trim();

    // 📼 الحلقة — فقط إذا تلاه E##
    var mEpisode = d.match(/📼\s*(E\d+)\b/);
    if (mEpisode) info.episode = mEpisode[1].trim();

    // 🎥 المصدر (WEB-DL, WEBRip, BluRay…)
    var mSource = d.match(/🎥\s*([^\n]+)/);
    if (mSource) info.source = mSource[1].trim();

    // 📦 الحجم
    var mSize = d.match(/📦\s*([\d.]+\s*(?:GB|MB|TB))/i);
    if (mSize) info.size = mSize[1].toUpperCase().replace(/\s+/g, " ");

    // 📊 البِت ريت
    var mRate = d.match(/📊\s*([\d.]+\s*Mbps)/i);
    if (mRate) info.bitrate = mRate[1];

    // 🏷️ المجموعة / المنصة — يقبل أكثر من واحد
    var groups = [];
    var groupRe = /🏷️\s*([^\n🏷️💻🔍]+)/g;
    var gm;
    while ((gm = groupRe.exec(d)) !== null) {
        var g = gm[1].trim();
        if (g) groups.push(g);
    }
    if (groups.length) info.group = groups.join("  •  ");

    // 💻 الويب
    var mWeb = d.match(/💻\s*([^\n🔍]+)/);
    if (mWeb) info.web = mWeb[1].trim();

    // 🔍 مصدر الفحص
    var mTest = d.match(/🔍\s*([^\n]+)/);
    if (mTest) info.testSource = mTest[1].trim();

    // 🔊 الصوت — يلتقط Atmos | DD+ ومعه بقية السطر
    var mAudio = d.match(/🎧\s*((?:Atmos|DD\+|DDP|AAC|TrueHD|DTS)[^\n]+?)(?=\s*🔊|\s*📦|\n|$)/i);
    if (mAudio) info.audio = mAudio[1].trim();

    // إذا ما فيه Atmos/DDP بالوصف، خذ من 🔊
    if (!info.audio) {
        var mAudioLine = d.match(/🔊\s*([^\n]+)/);
        if (mAudioLine) info.audio = mAudioLine[1].trim();
    }

    // 🔊 القنوات (5.1, 7.1, 2.0)
    var mChan = d.match(/🔊\s*(\d+\.\d+)\b/);
    if (mChan) info.channels = mChan[1];

    return info;
}

// ── Quality Filter + Size Floor + Stream Building ────────────────────────────

function finalizeStreams(streams, settings) {
    var seen = {};
    var filtered = [];

    for (var i = 0; i < streams.length; i++) {
        var s = streams[i] || {};

        var url = s.url || "";
        if (!/^https?:\/\//i.test(url)) continue;
        if (/donate|support the project/i.test((s.name || "") + " " + (s.description || ""))) continue;

        var bh = s.behaviorHints || {};
        var fullText = (s.name || "") + "\n" + (s.description || "") + "\n" +
            (bh.bingeGroup || "") + "\n" + (bh.filename || "") + "\n" + url;

        if (!/experimental/i.test(fullText)) continue;

        var q = classifyQuality(s);
        if (!q) continue;
        if (settings.qualityMode === "4k" && q !== "4K") continue;
        if (settings.qualityMode === "1080p" && q !== "1080p") continue;

        var sizeBytes = parseInt(bh.videoSize, 10) || 0;
        if (!sizeBytes) {
            var srv = parseServerInfo(s.description);
            if (srv.size) {
                var m = srv.size.match(/([\d.]+)\s*(GB|MB|TB)/i);
                if (m) {
                    var mult = /tb/i.test(m[2]) ? 1e12 : (/gb/i.test(m[2]) ? 1e9 : 1e6);
                    sizeBytes = parseFloat(m[1]) * mult;
                }
            }
        }
        if (sizeBytes > 0 && sizeBytes < MIN_SIZE_BYTES) {
            console.log("[experimental] dropped (<1GB): " + (s.name || url));
            continue;
        }

        if (seen[url]) continue;
        seen[url] = true;

        filtered.push({ stream: s, url: url, quality: q, sizeBytes: sizeBytes });
    }

    filtered.sort(function(a, b) {
        if (a.quality !== b.quality) return a.quality === "4K" ? -1 : 1;
        return (b.sizeBytes || 0) - (a.sizeBytes || 0);
    });

    console.log("[experimental] final streams (STRICT " + settings.qualityMode + ", min 1GB): " + filtered.length);

    return filtered.map(function(entry, idx) {
        return makeStream(entry, idx);
    });
}

function makeStream(entry, rank) {
    var s = entry.stream;
    var q = entry.quality;
    var qUp = q.toUpperCase();

    var serverInfo = parseServerInfo(s.description);
    var size = formatBytes(entry.sizeBytes) || serverInfo.size || "";

    var host = pickHost(entry.url);
    var typeTag = /\.m3u8(\?|$)/i.test(entry.url) ? "HLS" : (/\.mkv(\?|$)/i.test(entry.url) ? "MKV" : "MP4");

    // اسم ظاهر: رقم • Experimental • جودة • حجم
    var numStr = pad2((rank || 0) + 1);
    var nameParts = [numStr, "Experimental"];
    if (q === "4K") nameParts.push("4K");
    else if (q === "1080p") nameParts.push("1080p");
    if (size) nameParts.push(size);
    var visibleName = nameParts.join(" • ");

    // ── السطر التفصيلي: 6 أسطر تغطي كل الحقول ──
    // سطر 1: 🎬 العنوان  🎧 S##  📼 E##
    var l1 = "";
    if (serverInfo.titleLine) {
        l1 = "🎬 " + serverInfo.titleLine;
        if (serverInfo.season) l1 += "  🎧 " + serverInfo.season;
        if (serverInfo.episode) l1 += "  📼 " + serverInfo.episode;
    }

    // سطر 2: 🎥 المصدر  •  📊 البِت ريت
    var l2parts = [];
    if (serverInfo.source) l2parts.push("🎥 " + serverInfo.source);
    if (serverInfo.bitrate) l2parts.push("📊 " + serverInfo.bitrate);
    var l2 = l2parts.join("  •  ");

    // سطر 3: 🔊 الصوت  •  📦 الحجم
    var l3parts = [];
    if (serverInfo.audio) l3parts.push("🔊 " + serverInfo.audio);
    if (serverInfo.channels) l3parts.push(serverInfo.channels);
    if (serverInfo.size) l3parts.push("📦 " + serverInfo.size);
    var l3 = l3parts.join("  •  ");

    // سطر 4: 🏷️ المجموعة
    var l4 = serverInfo.group ? "🏷️ " + serverInfo.group : "";

    // سطر 5: 💻 الويب  •  🔍 مصدر الفحص
    var l5parts = [];
    if (serverInfo.web) l5parts.push("💻 " + serverInfo.web);
    if (serverInfo.testSource) l5parts.push("🔍 " + serverInfo.testSource);
    var l5 = l5parts.join("  •  ");

    // سطر 6: نوع الملف • المضيف
    var l6 = [typeTag, host].filter(Boolean).join(" • ");

    var streamTitle = [l1, l2, l3, l4, l5, l6].filter(Boolean).join("\n");
    if (!streamTitle) streamTitle = visibleName;

    return {
        name: visibleName,
        title: visibleName,
        size: streamTitle,
        url: entry.url,
        quality: qUp,
        headers: {
            "User-Agent": UA,
            "Referer": ADDON_BASE + "/",
            "Accept": "*/*"
        },
        _host: host
    };
}

function pickHost(url) {
    try {
        if (typeof URL === "function") {
            return new URL(url).hostname.replace(/^www\./, "");
        }
        var m = String(url).match(/^https?:\/\/([^\/]+)/i);
        return m ? m[1].replace(/^www\./, "") : "CDN";
    } catch (e) {
        return "CDN";
    }
}

// ── Export ────────────────────────────────────────────────────────────────────

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams, onSettings: onSettings };
} else if (typeof globalThis !== "undefined") {
    globalThis.getStreams = getStreams;
    globalThis.onSettings = onSettings;
} else if (typeof window !== "undefined") {
    window.getStreams = getStreams;
    window.onSettings = onSettings;
}
