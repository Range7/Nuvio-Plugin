// language: JavaScript, file: index.js, target: Node.js (Stremio addon)
// 4KHDHub scraper — TMDB metadata + hubcloud/hubdrive resolution

const cheerio = require('cheerio');

const PROVIDER_NAME = '4KHDHub';
const BASE_URL = 'https://4khdhub.one';
const TMDB_URL = 'https://api.themoviedb.org/3';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': USER_AGENT,
  'Referer': BASE_URL + '/'
};

// Encodes a number into an invisible Unicode tag so stream order can be forced.
function getInvertedSortTag(value, max = 999999) {
  const clamped = Math.max(0, parseInt(value, 10) || 0);
  const inverted = Math.max(0, max - clamped);
  const binary = inverted.toString(2).padStart(20, '0');
  return binary.split('').map(c => c === '1' ? '\ufeff' : '\u200b').join('');
}

function resolveSettings(settings) {
  let result = { sortBy: 'quality' };
  try {
    let s = settings;
    if (!s && typeof globalThis !== 'undefined')
      s = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    if (!s && typeof global !== 'undefined')
      s = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!s && typeof window !== 'undefined')
      s = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    if (s) {
      let sortBy = s.sortBy || s.sort_by || s.sort || '';
      if (typeof sortBy === 'object' && sortBy !== null)
        sortBy = sortBy.value || sortBy.label || '';
      const normalized = String(sortBy).toLowerCase();
      if (normalized.includes('largest') || normalized.includes('largest'))
        result.sortBy = 'largest';
      else
        result.sortBy = 'quality';
    }
  } catch (e) {
    console.error('[' + PROVIDER_NAME + '] settings error:', e);
  }
  return result;
}

function onSettings() {
  return [{
    type: 'select',
    key: 'sortBy',
    name: 'sort_by',
    label: 'Sort By',
    options: [
      { label: 'Quality', value: 'quality' },
      { label: 'Size', value: 'size' }
    ],
    default: 'quality'
  }];
}

async function fetchText(url, referer = BASE_URL) {
  const res = await fetch(url, {
    headers: { ...HEADERS, 'Referer': referer + '/' }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + url);
  return res.text();
}

function absoluteUrl(href, base = BASE_URL) {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  try { return new URL(href, base).toString(); } catch { return ''; }
}

function decodeBase64(input) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
  const str = String(input || '').replace(/=+$/, '');
  let output = '', buffer = 0, count = 0;
  for (let i = 0; i < str.length; i++) {
    const idx = alphabet.indexOf(str.charAt(i));
    if (idx < 0) continue;
    buffer = (count % 4) ? buffer * 64 + idx : idx;
    count++;
    if (count % 4) {
      output += String.fromCharCode((buffer >> (-2 * count & 6)) & 0xff);
    }
  }
  return output;
}

function rot13(input) {
  return String(input || '').replace(/[a-zA-Z]/g, c => {
    const code = c.charCodeAt(0) + 13;
    const limit = c <= 'Z' ? 90 : 122;
    return String.fromCharCode(code <= limit ? code : code - 26);
  });
}

function decodeEntities(input) {
  if (!input) return '';
  const re = /&(nbsp|amp|quot|lt|gt|#038);/g;
  const map = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', '#038': '&' };
  return input.replace(re, (_, name) => map[name])
              .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code));
}

function normalizeTitle(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\b(the|a|an|directors?|cut)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleScore(a, b) {
  const aWords = normalizeTitle(a).split(' ').filter(Boolean);
  const bWords = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (!aWords.length) return 0;
  const matches = aWords.filter(w => bWords.has(w)).length;
  return matches / aWords.length;
}

function parseQuality(input) {
  const s = String(input || '').toLowerCase();
  if (s.indexOf('2160') >= 0 || s.indexOf('4k') >= 0) return '2160p';
  if (s.indexOf('1080') >= 0) return '1080p';
  if (s.indexOf('720') >= 0) return '720p';
  if (s.indexOf('480') >= 0) return '480p';
  return '1080p';
}

function getQualityRank(input) {
  const s = String(input).toLowerCase();
  if (s.includes('2160') || s.includes('4k') || s.includes('uhd')) return 4;
  if (s.includes('1080') || s.includes('fhd')) return 3;
  if (s.includes('720') || s.includes('hd')) return 2;
  if (s.includes('480') || s.includes('sd')) return 1;
  return 0;
}

function parseSize(input) {
  const m = String(input || '').match(/([\d.]+)\s*(GB|MB|KB)/i);
  return m ? m[1] + ' ' + m[2].toUpperCase() : 'N/A';
}

function isDirectVideo(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.r2.dev') || host.endsWith('.r2.cloudflarestorage.com');
  } catch { return false; }
}

async function getMetadata(tmdbId, type) {
  const kind = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
  const res = await fetch(
    TMDB_URL + '/' + kind + '/' + encodeURIComponent(tmdbId) +
    '?api_key=' + TMDB_KEY + '&language=en-US',
    { headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT } }
  );
  if (!res.ok) throw new Error('TMDB ' + res.status);
  const data = await res.json();
  const date = kind === 'tv' ? data.first_air_date : data.release_date;
  return {
    title: kind === 'tv' ? data.name : data.title,
    year: date ? Number(date.slice(0, 4)) : null
  };
}

async function findPage(meta, isSeries, season) {
  const query = isSeries && season
    ? meta.title + ' season ' + season
    : (meta.title + ' ' + (meta.year || '')).trim();
  const html = await fetchText(BASE_URL + '/?s=' + encodeURIComponent(query));
  const $ = cheerio.load(html);
  let best = null;
  $('.movie-card, article, .post').each((i, el) => {
    const $el = $(el);
    const title = $el.find('h2, .entry-title, .title').text().trim().toLowerCase();
    const type = $el.find('.category, .type').text().trim().toLowerCase();
    const metaText = $el.find('.meta, .year').text().trim();
    const href = $el.attr('href') || $el.find('a[href]').first().attr('href');
    if (!title || !href) return;
    if (isSeries && !/series/i.test(type)) return;
    if (!isSeries && !/movies?/i.test(type)) return;
    const ym = metaText.match(/\b(19|20)\d{2}\b/);
    const year = ym ? Number(ym[0]) : null;
    let score = titleScore(meta.title, title);
    if (meta.year && year === meta.year) score += 0.35;
    else if (meta.year && year && Math.abs(year - meta.year) > 1) score -= 0.5;
    if (isSeries && season) {
      const sm = title.match(/(?:season\s*|s)(\d+)/i);
      if (sm && Number(sm[1]) === Number(season)) score += 0.4;
      else if (sm) score -= 0.6;
    }
    if (!best || score > best.score) best = { url: absoluteUrl(href), score, title };
  });
  return best && best.score >= 0.7 ? best.url : '';
}

async function decodeRedirect(url) {
  if (/hubcloud|hubdrive/i.test(url)) return url;
  try {
    const html = await fetchText(url);
    const encoded =
      html.match(/['"]o['"]\s*,\s*['"]([^'"]+)['"]/)?.[1] ||
      html.match(/'o','([^']+)'/)?.[1];
    if (!encoded) return url;
    const decoded = decodeBase64(rot13(decodeBase64(decodeBase64(encoded))));
    const parsed = JSON.parse(decoded);
    return parsed.o ? decodeBase64(parsed.o).trim() : url;
  } catch { return url; }
}

async function findHubCloud($el, baseUrl, $) {
  const links = $el.find('a[href]').get();
  for (const link of links) {
    const $link = $(link);
    const href = $link.attr('href');
    const text = $link.text();
    if (!href) continue;
    if (/hubcloud/i.test(text) || /hubcloud/i.test(href))
      return decodeRedirect(absoluteUrl(href, baseUrl));
    if (/hubdrive/i.test(text) || /hubdrive/i.test(href)) {
      const hubUrl = await decodeRedirect(absoluteUrl(href, baseUrl));
      try {
        const html = await fetchText(hubUrl, baseUrl);
        const $hub = cheerio.load(html);
        const hcHref = $hub('a[href]').filter((i, el) => {
          const $e = $hub(el);
          return /hubcloud/i.test($e.text() + ' ' + ($e.attr('href') || ''));
        }).first().attr('href');
        if (hcHref) return absoluteUrl(hcHref, hubUrl);
      } catch {}
    }
  }
  return '';
}

async function extractHubCloud(url, meta) {
  try {
    let html = await fetchText(url, url);
    let currentUrl = url;
    const varUrl =
      html.match(/var url\s*=\s*['"]([^'"]+)['"]/)?.[1] ||
      cheerio.load(html)('a[href]').attr('href');
    if (varUrl) {
      currentUrl = absoluteUrl(varUrl, url);
      html = await fetchText(currentUrl, url);
    }
    const $ = cheerio.load(html);
    const title =
      $('div.card-header').text().replace(/\s+/g, ' ').trim() ||
      $('title').text().trim() ||
      meta.title;
    const sizeText = parseSize($('.size, .card-body').first().text());
    const size = sizeText !== 'N/A' ? sizeText : meta.size;
    const quality = parseQuality(title);
    const streams = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (!href || !isDirectVideo(href)) return;
      streams.push({ url: href, title, quality, size });
    });
    return streams;
  } catch { return []; }
}

async function extractStreams(pageUrl, isSeries, season, episode) {
  const html = await fetchText(pageUrl);
  const $ = cheerio.load(html);
  const items = [];
  if (isSeries && season && episode) {
    const sTag = 'S' + String(season).padStart(2, '0');
    const eTag = 'Episode-' + String(episode).padStart(2, '0');
    $('.episode-item').each((i, el) => {
      const $el = $(el);
      if (!$el.find('.season-title, .title').text().includes(sTag)) return;
      $el.find('.episode-download-item').each((j, e) => {
        if ($(e).text().includes(eTag)) items.push($(e));
      });
    });
  } else {
    $('.download-item, a[href]').each((i, el) => items.push($(el)));
  }
  const results = await Promise.all(items.map(async item => {
    const text = item.text().replace(/\s+/g, ' ').trim();
    const info = {
      title: item.find('.title, .name').text().trim() || text,
      quality: parseQuality(text),
      size: parseSize(text)
    };
    const hubUrl = await findHubCloud(item, pageUrl, $);
    return hubUrl ? extractHubCloud(hubUrl, info) : [];
  }));
  return results.flat();
}

function buildStreamObject(title, rawTitle, url, quality, size, headers, episodeTag, meta, sortBy) {
  let decodedUrl = '';
  try { decodedUrl = decodeURIComponent(url || ''); } catch { decodedUrl = url || ''; }
  const cleanTitle = decodeEntities(rawTitle || '')
    .replace(/[\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const haystack = (cleanTitle + ' ' + decodedUrl).toLowerCase();

  // Quality
  let resolvedQuality = quality;
  const qm = haystack.match(/\b(2160p|4k|1080p|720p|480p)\b/i);
  if (qm) {
    const q = qm[1].toLowerCase();
    if (q === '4k' || q === '2160p') resolvedQuality = '2160p';
    else if (q === '1080p') resolvedQuality = '1080p';
    else if (q === '720p') resolvedQuality = '720p';
    else if (q === '480p') resolvedQuality = '480p';
  }
  if (!resolvedQuality || resolvedQuality === 'N/A') resolvedQuality = parseQuality(haystack);
  const rank = getQualityRank(resolvedQuality);

  // Audio track classification
  let audio = 'Single-Audio';
  if (/\b(multi|multi\-audio)\b/i.test(haystack)) audio = 'Multi-Audio';
  else if (/\b(dual|dual\-audio|dubbed|hindi)\b/i.test(haystack) ||
           decodeEntities(title || '').toLowerCase().includes('hindi'))
    audio = 'Dual-Audio';

  // Size normalization (prefer bracketed size, then bare size, then URL size)
  let sizeStr = size && size !== 'N/A' ? size : 'N/A';
  const sizeMatch =
    cleanTitle.match(/\[\s*(\d+(?:\.\d+)?\s*[MG]B)\s*\]/i) ||
    cleanTitle.match(/(\d+(?:\.\d+)?\s*[MG]B)/i) ||
    decodedUrl.match(/(\d+(?:\.\d+)?\s*[MG]B)/i);
  if (sizeMatch) sizeStr = sizeMatch[1].toUpperCase().replace(/\s+/g, '');
  let sizeMB = 0;
  if (sizeStr !== 'N/A') {
    const m = sizeStr.match(/([\d.]+)\s*(GB|MB)/i);
    if (m) {
      const num = parseFloat(m[1]);
      const unit = m[2].toUpperCase();
      sizeMB = Math.round(unit.includes('GB') ? num * 1024 : num);
    }
  }

  // Invisible Unicode sort key forces Stremio ordering
  let sortTag;
  if (sortBy === 'largest') sortTag = getInvertedSortTag(sizeMB, 999999);
  else sortTag = getInvertedSortTag(rank * 100000 + sizeMB, 999999);

  const name = sortTag + PROVIDER_NAME + ' | ' + resolvedQuality + ' | ' + audio;
  const displayTitle = meta && meta.title ? meta.title : title;
  const displayYear = meta && meta.year ? meta.year : 'N/A';
  const emoji = resolvedQuality === '2160p' ? '⚡' : resolvedQuality === '720p' ? '💎' : '🔥';
  const container = /\.mp4($|\?)/i.test(decodedUrl) || /\.mp4\b/i.test(cleanTitle) ? 'MP4' : 'MKV';
  const sizeLine = emoji + ' ' + resolvedQuality + ' | 📦 ' + sizeStr + ' | 📼 ' + container;
  const hdr = /\bhdr10\+/i.test(haystack) ? 'HDR10+' : /\bhdr10\b/i.test(haystack) ? 'HDR10' : 'HDR';
  const codec = /\b(h\.?265|x265|hevc)\b/i.test(haystack) ? 'H.265' : 'H.264';
  const tags = ['🌈 ' + hdr, '🎞️ ' + codec];
  if (/\b(dolby\s*vision|dovi|\.dv\.)\b/i.test(haystack) || /[\.\-_]dv[\.\-_]/i.test(haystack))
    tags.push('👁️ DV');
  const tagLine = tags.join(' | ');
  const audioLine =
    /\btruehd\s*7\.1\b/i.test(haystack) ? 'TrueHD 7.1' :
    /\bddp5\.1\b/i.test(haystack) || /\beac3\b/i.test(haystack) ? 'DDP5.1' : 'DD5.1';
  const atmos = /\batmos\b/i.test(haystack) ? ' Atmos' : '';
  const audioInfo = '🎧 ' + audio + ' | 🎧 ' + audioLine + atmos;
  const source = /\b(bluray|blu\-ray)\b/i.test(haystack) ? 'BluRay' : 'WEB-DL';
  const sourceLine = '📀 ' + source;
  const episodeText = (episodeTag && (episodeTag.startsWith('S') || episodeTag.includes('E')))
    ? '🎬 ' + displayTitle + ' - (' + displayYear + ') ' +
      episodeTag.replace(/E0*(\d+)/i, 'E$1').replace(/S0*(\d+)/i, 'S$1')
    : '🎬 ' + displayTitle + ' (' + displayYear + ')';
  const fullTitle = episodeText + '\n' + sizeLine + '\n' + tagLine + '\n' + audioInfo + '\n' + sourceLine;

  return {
    qualityRank: rank,
    sizeInMB: sizeMB,
    data: {
      name,
      title: fullTitle,
      size: fullTitle,
      description: fullTitle,
      url: url || '',
      behaviorHints: {
        notWebReady: true,
        proxyHeaders: { request: headers || { 'Referer': BASE_URL + '/' } }
      }
    }
  };
}

async function getStreams(tmdbId, type, season = null, episode = null, settings = {}) {
  const isSeries = type === 'tv' || type === 'series';
  if (!tmdbId || (!isSeries && type !== 'movie')) return [];
  try {
    const opts = resolveSettings(settings);
    console.log('[' + PROVIDER_NAME + '] getStreams: ' + tmdbId +
      ' type=' + type + ' S=' + season + ' E=' + episode + ' sortBy=' + opts.sortBy);
    const meta = await getMetadata(tmdbId, type);
    const pageUrl = await findPage(meta, isSeries, season);
    if (!pageUrl) return [];
    const rawStreams = await extractStreams(pageUrl, isSeries, season, episode);

    let episodeTag = '';
    if (isSeries) {
      const s = parseInt(season, 10) || 1;
      const e = parseInt(episode, 10) || 1;
      episodeTag = 'S' + (s < 10 ? '0' : '') + s + 'E' + (e < 10 ? '0' : '') + e;
    }

    const seen = {};
    const out = [];
    for (const s of rawStreams) {
      if (!isDirectVideo(s.url) || seen[s.url]) continue;
      seen[s.url] = true;
      const rawTitle = s.title + ' [' + s.quality + '] ' + s.size;
      const obj = buildStreamObject(
        meta.title, rawTitle, s.url, s.quality, s.size,
        { 'Referer': BASE_URL + '/', 'User-Agent': USER_AGENT },
        episodeTag.trim(), meta, opts.sortBy
      );
      out.push(obj);
    }

    out.sort((a, b) => {
      if (opts.sortBy === 'largest') return b.sizeInMB - a.sizeInMB;
      if (b.qualityRank !== a.qualityRank) return b.qualityRank - a.qualityRank;
      return b.sizeInMB - a.sizeInMB;
    });

    console.log('[' + PROVIDER_NAME + '] Returning ' + out.length +
      ' stream(s) sorted by ' + opts.sortBy);
    return out.map(o => o.data);
  } catch (e) {
    console.error('[' + PROVIDER_NAME + '] error: ' + e.message);
    return [];
  }
}

module.exports = { getStreams, onSettings };
