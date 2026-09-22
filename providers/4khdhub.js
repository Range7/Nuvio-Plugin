// language: JavaScript, file: providers/4khdhub.js
// 4KHDHub — 4khdhub.one | 4K + 1080p only | drop smallest 1080p, keep all 4K
// fix: correct search selectors, FSL/PixelServer resolution, redirect order

const cheerio = require('cheerio');

const PROVIDER_NAME = '4KHDHub';
const BASE_URL = 'https://4khdhub.one';
const TMDB_URL = 'https://api.themoviedb.org/3';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': USER_AGENT, 'Referer': BASE_URL + '/' };

function getInvertedSortTag(value, max = 999999) {
  const clamped = Math.max(0, parseInt(value, 10) || 0);
  const inverted = Math.max(0, max - clamped);
  return inverted.toString(2).padStart(20, '0').split('').map(c => c === '1' ? '\ufeff' : '\u200b').join('');
}

function resolveSettings(settings) {
  let result = { sortBy: 'quality' };
  try {
    let s = settings;
    if (!s && typeof globalThis !== 'undefined') s = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    if (!s && typeof global !== 'undefined') s = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!s && typeof window !== 'undefined') s = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    if (s) {
      let sortBy = s.sortBy || s.sort_by || s.sort || '';
      if (typeof sortBy === 'object' && sortBy !== null) sortBy = sortBy.value || sortBy.label || '';
      result.sortBy = String(sortBy).toLowerCase().includes('largest') ? 'largest' : 'quality';
    }
  } catch (e) { console.error('[' + PROVIDER_NAME + '] settings:', e); }
  return result;
}

function onSettings() {
  return [{ type: 'select', key: 'sortBy', name: 'sort_by', label: 'Sort By',
    options: [{ label: 'Quality', value: 'quality' }, { label: 'Size', value: 'size' }], default: 'quality' }];
}

async function fetchText(url, referer = BASE_URL) {
  const res = await fetch(url, { headers: { ...HEADERS, 'Referer': referer + '/' } });
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
    if (count % 4) output += String.fromCharCode((buffer >> (-2 * count & 6)) & 0xff);
  }
  return output;
}

function rot13(input) {
  return String(input || '').replace(/[a-zA-Z]/g, c => {
    const code = c.charCodeAt(0) + 13;
    return String.fromCharCode(code <= (c <= 'Z' ? 90 : 122) ? code : code - 26);
  });
}

function decodeEntities(input) {
  if (!input) return '';
  return input.replace(/&(nbsp|amp|quot|lt|gt|#038);/g, (_, n) =>
    ({ nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', '#038': '&' })[n]
  ).replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c));
}

function normalizeTitle(input) {
  return String(input || '').toLowerCase().replace(/\[[^\]]*]/g, ' ')
    .replace(/\b(the|a|an|directors?|cut)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleScore(a, b) {
  const aW = normalizeTitle(a).split(' ').filter(Boolean);
  const bW = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (!aW.length) return 0;
  return aW.filter(w => bW.has(w)).length / aW.length;
}

function parseQuality(input) {
  const s = String(input || '').toLowerCase();
  if (s.includes('2160') || s.includes('4k')) return '2160p';
  if (s.includes('1080')) return '1080p';
  return '1080p';
}

function getQualityRank(input) {
  const s = String(input).toLowerCase();
  if (s.includes('2160') || s.includes('4k') || s.includes('uhd')) return 4;
  if (s.includes('1080') || s.includes('fhd')) return 3;
  return 0;
}

function parseSize(input) {
  const m = String(input || '').match(/([\d.]+)\s*(GB|MB|KB)/i);
  return m ? m[1] + ' ' + m[2].toUpperCase() : 'N/A';
}

// ====== FIX 1: search selectors match actual 4khdhub.one structure ======
async function getMetadata(tmdbId, type) {
  const kind = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
  const res = await fetch(TMDB_URL + '/' + kind + '/' + encodeURIComponent(tmdbId) +
    '?api_key=' + TMDB_KEY + '&language=en-US',
    { headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error('TMDB ' + res.status);
  const data = await res.json();
  const date = kind === 'tv' ? data.first_air_date : data.release_date;
  return { title: kind === 'tv' ? data.name : data.title, year: date ? Number(date.slice(0, 4)) : null };
}

async function findPage(meta, isSeries, season) {
  const query = isSeries && season
    ? meta.title + ' season ' + season
    : (meta.title + ' ' + (meta.year || '')).trim();
  const html = await fetchText(BASE_URL + '/?s=' + encodeURIComponent(query));
  const $ = cheerio.load(html);
  const targetType = isSeries ? 'Series' : 'Movies';
  let best = null;

  $('.movie-card').each((i, el) => {
    const $el = $(el);
    const format = $el.find('.movie-card-format').text().trim();
    if (!format.includes(targetType)) return;

    const metaText = $el.find('.movie-card-meta').text().trim();
    const yearMatch = metaText.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? Number(yearMatch[0]) : null;
    if (meta.year && year && Math.abs(year - meta.year) > 1) return;

    const cardTitle = $el.find('.movie-card-title').text().replace(/\[.*?]/g, '').trim();
    let score = titleScore(meta.title, cardTitle);
    if (meta.year && year === meta.year) score += 0.35;

    let href = $el.attr('href') || $el.find('a[href]').first().attr('href');
    if (!href) return;
    href = absoluteUrl(href);

    if (!best || score > best.score) best = { url: href, score };
  });

  return best && best.score >= 0.5 ? best.url : '';
}

// ====== FIX 2: redirect order is atob -> atob -> rot13 -> atob ======
async function decodeRedirect(url) {
  if (/hubcloud|hubdrive/i.test(url)) return url;
  try {
    const html = await fetchText(url);
    const encoded = html.match(/'o','(.*?)'/)?.[1];
    if (!encoded) return url;
    const step1 = decodeBase64(encoded);
    const step2 = decodeBase64(step1);
    const step3 = rot13(step2);
    const step4 = decodeBase64(step3);
    const parsed = JSON.parse(step4);
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

    if (text.includes('HubCloud') || /hubcloud/i.test(href))
      return decodeRedirect(absoluteUrl(href, baseUrl));

    if (text.includes('HubDrive') || /hubdrive/i.test(href)) {
      const hubUrl = await decodeRedirect(absoluteUrl(href, baseUrl));
      try {
        const html = await fetchText(hubUrl, baseUrl);
        const $hub = cheerio.load(html);
        const inner = $hub('a:contains("HubCloud")').attr('href');
        if (inner) return absoluteUrl(inner, hubUrl);
      } catch {}
    }
  }
  return '';
}

// ====== FIX 3: HubCloud page gives FSL / PixelServer, not .r2.dev ======
async function extractHubCloud(hubCloudUrl, baseMeta) {
  if (!hubCloudUrl) return [];
  try {
    const redirectHtml = await fetchText(hubCloudUrl, hubCloudUrl);
    const redirectMatch = redirectHtml.match(/var url\s*=\s*'(.*?)'/);
    if (!redirectMatch) return [];

    const finalLinksUrl = redirectMatch[1];
    const linksHtml = await fetchText(finalLinksUrl, hubCloudUrl);
    const $ = cheerio.load(linksHtml);

    const sizeText = $('#size').text();
    const titleText = $('title').text().trim();
    const currentMeta = {
      ...baseMeta,
      bytes: parseSize(sizeText) !== 'N/A' ? parseSize(sizeText) : baseMeta.size,
      title: titleText || baseMeta.title
    };

    const results = [];
    $('a').each((i, el) => {
      const text = $(el).text();
      const href = $(el).attr('href');
      if (!href) return;
      if (text.includes('FSL') || text.includes('Download File')) {
        results.push({ source: 'FSL', url: href, meta: currentMeta });
      } else if (text.includes('PixelServer')) {
        results.push({ source: 'PixelServer', url: href.replace('/u/', '/api/file/'), meta: currentMeta });
      }
    });
    return results;
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
      if (!$('.episode-title', el).text().includes(sTag)) return;
      $('.episode-download-item', el)
        .filter((j, item) => $(item).text().includes(eTag))
        .each((k, item) => items.push(item));
    });
  } else {
    $('.download-item').each((i, el) => items.push(el));
  }

  const results = await Promise.all(items.map(async (item) => {
    const $el = $(item);
    const text = $el.text().replace(/\s+/g, ' ').trim();
    const info = {
      title: $el.find('.file-title, .episode-file-title').text().trim() || text,
      quality: parseQuality(text),
      size: parseSize(text)
    };
    const hubUrl = await findHubCloud($el, pageUrl, $);
    return hubUrl ? extractHubCloud(hubUrl, info) : [];
  }));
  return results.flat();
}

// ====== FIX 4: build stream object — FSL/PixelServer links are the final URLs ======
function buildStreamObject(sourceResult, meta, episodeTag, sortBy) {
  const url = sourceResult.url;
  const baseMeta = sourceResult.meta || {};
  const quality = parseQuality(baseMeta.height ? baseMeta.height + 'p' : baseMeta.title || '');
  const rank = getQualityRank(quality);
  const sizeStr = baseMeta.bytes || 'N/A';

  let sizeMB = 0;
  const m = String(sizeStr).match(/([\d.]+)\s*(GB|MB)/i);
  if (m) {
    const num = parseFloat(m[1]);
    sizeMB = Math.round(m[2].toUpperCase().includes('GB') ? num * 1024 : num);
  }

  const sortTag = sortBy === 'largest'
    ? getInvertedSortTag(sizeMB, 999999)
    : getInvertedSortTag(rank * 100000 + sizeMB, 999999);

  const name = sortTag + PROVIDER_NAME + ' | ' + quality + ' | 📦 ' + sizeStr + ' | ' + sourceResult.source;
  const displayTitle = meta.title + (meta.year ? ' (' + meta.year + ')' : '');
  const episodeText = (episodeTag && episodeTag.startsWith('S'))
    ? '🎬 ' + displayTitle + ' - (' + episodeTag + ')'
    : '🎬 ' + displayTitle;
  const emoji = quality === '2160p' ? '⚡' : '🔥';
  const fullTitle = episodeText + '\n' + emoji + ' ' + quality + ' | 📦 ' + sizeStr + ' | 📼 MKV\n📀 ' + sourceResult.source;

  return {
    qualityRank: rank,
    sizeInMB: sizeMB,
    data: {
      name,
      title: fullTitle,
      size: fullTitle,
      description: fullTitle,
      url,
      behaviorHints: {
        notWebReady: true,
        proxyHeaders: { request: { 'Referer': BASE_URL + '/', 'User-Agent': USER_AGENT } }
      }
    }
  };
}

async function getStreams(tmdbId, type, season = null, episode = null, settings = {}) {
  const isSeries = type === 'tv' || type === 'series';
  if (!tmdbId || (!isSeries && type !== 'movie')) return [];
  try {
    const opts = resolveSettings(settings);
    const meta = await getMetadata(tmdbId, type);
    const pageUrl = await findPage(meta, isSeries, season);
    if (!pageUrl) { console.error('[' + PROVIDER_NAME + '] page not found for ' + tmdbId); return []; }

    const rawStreams = await extractStreams(pageUrl, isSeries, season, episode);
    if (!rawStreams.length) { console.error('[' + PROVIDER_NAME + '] 0 raw streams extracted'); return []; }

    let episodeTag = '';
    if (isSeries) {
      const s = parseInt(season, 10) || 1;
      const e = parseInt(episode, 10) || 1;
      episodeTag = 'S' + (s < 10 ? '0' : '') + s + 'E' + (e < 10 ? '0' : '') + e;
    }

    const seen = new Set();
    const out = [];
    for (const s of rawStreams) {
      if (!s.url || seen.has(s.url)) continue;
      seen.add(s.url);
      const obj = buildStreamObject(s, meta, episodeTag, opts.sortBy);
      if (obj.qualityRank !== 4 && obj.qualityRank !== 3) continue;
      out.push(obj);
    }

    const fourK = out.filter(o => o.qualityRank === 4);
    const hd1080 = out.filter(o => o.qualityRank === 3).sort((a, b) => b.sizeInMB - a.sizeInMB);
    const kept1080 = hd1080.slice(0, Math.max(1, hd1080.length - 1));
    const filtered = [...fourK, ...kept1080];

    filtered.sort((a, b) => {
      if (opts.sortBy === 'largest') return b.sizeInMB - a.sizeInMB;
      if (b.qualityRank !== a.qualityRank) return b.qualityRank - a.qualityRank;
      return b.sizeInMB - a.sizeInMB;
    });

    return filtered.map(o => o.data);
  } catch (e) {
    console.error('[' + PROVIDER_NAME + '] error: ' + e.message);
    return [];
  }
}

module.exports = { getStreams, onSettings };
