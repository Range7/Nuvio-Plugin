const cheerio = require('cheerio-without-node-native');

const PROVIDER_NAME = '4KHDHub';
const BASE_URL = 'https://4khdhub.one';
const TMDB_URL = 'https://api.themoviedb.org/3';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': USER_AGENT,
  'Referer': BASE_URL + '/'
};

function getInvertedSortTag(value, max = 999999) {
  const n = Math.max(0, parseInt(value, 10) || 0);
  const inverted = Math.max(0, max - n);
  const binary = inverted.toString(2).padStart(20, '0');

  return binary
    .split('')
    .map(c => c === '1' ? '\ufeff' : '​')
    .join('');
}

function resolveSettings(settings) {
  let result = { sortBy: 'quality' };

  try {
    let s = settings;

    if (!s && typeof globalThis !== 'undefined') {
      s = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    }

    if (!s && typeof global !== 'undefined') {
      s = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    }

    if (!s && typeof window !== 'undefined') {
      s = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    }

    if (s) {
      let sortBy = s.sortBy || s.sort_by || s.sortby || '';

      if (typeof sortBy === 'object' && sortBy !== null) {
        sortBy = sortBy.value || sortBy.name || '';
      }

      const lower = String(sortBy).toLowerCase();

      if (lower.includes('size') || lower.includes('largest')) {
        result.sortBy = 'size';
      } else {
        result.sortBy = 'quality';
      }
    }
  } catch (e) {
    console.error(`[${PROVIDER_NAME}] Settings error:`, e);
  }

  return result;
}

function onSettings() {
  return [
    {
      type: 'select',
      key: 'sortBy',
      name: 'sort_by',
      label: 'Sort By',
      options: [
        { label: 'Quality', value: 'quality' },
        { label: 'Size', value: 'size' }
      ],
      default: 'quality'
    }
  ];
}

async function fetchText(url, referer = BASE_URL) {
  const res = await fetch(url, {
    headers: {
      ...HEADERS,
      Referer: referer + '/'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`);
  }

  return res.text();
}

function absoluteUrl(url, base = BASE_URL) {
  if (!url) return '';

  if (/^https?:\/\//i.test(url)) return url;

  try {
    return new URL(url, base).toString();
  } catch {
    return '';
  }
}

function decodeBase64(input) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
  const str = String(input || '').replace(/=+$/, '');

  let output = '';
  let buffer = 0;
  let bits = 0;
  let i = 0;

  while (true) {
    const ch = str.charAt(i++);
    if (!ch) break;

    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;

    buffer = bits % 4 ? buffer * 64 + idx : idx;
    bits++;

    if (bits % 4) {
      output += String.fromCharCode((buffer >> (-2 * bits & 6)) & 0xff);
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

  const entities = {
    nbsp: ' ',
    amp: '&',
    quot: '"',
    lt: '<',
    gt: '>',
    '#038': '&'
  };

  return input
    .replace(/&(nbsp|amp|quot|lt|gt|#038);/g, (_, name) => entities[name])
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(num));
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\b(the|a|an|directors?|cut)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleScore(title, candidate) {
  const words = normalizeTitle(title).split(' ').filter(Boolean);
  const candidateWords = new Set(normalizeTitle(candidate).split(' ').filter(Boolean));

  if (!words.length) return 0;

  const matches = words.filter(word => candidateWords.has(word)).length;
  return matches / words.length;
}

function parseQuality(text) {
  const lower = String(text || '').toLowerCase();

  if (lower.indexOf('2160') >= 0 || lower.indexOf('4k') >= 0) return '2160p';
  if (lower.indexOf('1080') >= 0) return '1080p';
  if (lower.indexOf('720') >= 0) return '720p';
  if (lower.indexOf('480') >= 0) return '480p';

  return '1080p';
}

function getQualityRank(quality) {
  const q = String(quality).toLowerCase();

  if (q.includes('2160') || q.includes('4k') || q.includes('uhd')) return 4;
  if (q.includes('1080') || q.includes('fhd')) return 3;
  if (q.includes('720') || q.includes('hd')) return 2;
  if (q.includes('480') || q.includes('sd')) return 1;

  return 0;
}

function parseSize(text) {
  const match = String(text || '').match(/([\d.]+)\s*(GB|MB|KB)/i);
  return match ? `${match[1]} ${match[2].toUpperCase()}` : 'N/A';
}

function isDirectVideo(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    return (
      hostname.endsWith('.r2.dev') ||
      hostname.endsWith('.r2.cloudflarestorage.com')
    );
  } catch {
    return false;
  }
}

async function getMetadata(id, type) {
  const tmdbType = type === 'tv' || type === 'series' ? 'tv' : 'movie';

  const res = await fetch(
    `${TMDB_URL}/${tmdbType}/${encodeURIComponent(id)}?api_key=${TMDB_KEY}&language=en-US`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT
      }
    }
  );

  if (!res.ok) {
    throw new Error(`TMDB error ${res.status}`);
  }

  const data = await res.json();
  const date = tmdbType === 'tv' ? data.first_air_date : data.release_date;

  return {
    title: tmdbType === 'tv' ? data.name : data.title,
    year: date ? Number(date.slice(0, 4)) : null
  };
}

async function findPage(meta, isSeries, season) {
  const query = isSeries && season
    ? `${meta.title} season ${season}`
    : `${meta.title} ${meta.year || ''}`.trim();

  const html = await fetchText(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
  const $ = cheerio.load(html);

  let best = null;

  $('article').each((i, el) => {
    const $el = $(el);

    const title = $el.find('h2 a').text().trim();
    const type = $el.find('.category').text().trim();
    const metaText = $el.find('.year').text();
    const href = $el.attr('href') || $el.find('a[href]').first().attr('href');

    if (!title || !href) return;

    if (isSeries && !/series/i.test(type)) return;
    if (!isSeries && !/movies?/i.test(type)) return;

    const yearMatch = metaText.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? Number(yearMatch[0]) : null;

    let score = titleScore(meta.title, title);

    if (meta.year && year === meta.year) {
      score += 0.35;
    } else if (meta.year && year && Math.abs(year - meta.year) > 1) {
      score -= 0.5;
    }

    if (isSeries && season) {
      const seasonMatch = title.match(/(?:season\s*|s)(\d+)/i);

      if (seasonMatch && Number(seasonMatch[1]) === Number(season)) {
        score += 0.4;
      } else if (seasonMatch) {
        score -= 0.6;
      }
    }

    if (!best || score > best.score) {
      best = {
        url: absoluteUrl(href),
        score,
        title
      };
    }
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

    const decoded = JSON.parse(
      decodeBase64(rot13(decodeBase64(decodeBase64(encoded))))
    );

    return decoded.o ? decodeBase64(decoded.o).trim() : url;
  } catch {
    return url;
  }
}

async function findHubCloud($root, baseUrl, $) {
  const links = $root.find('a[href]').get();

  for (const el of links) {
    const $el = $(el);
    const href = $el.attr('href');
    const text = $el.text();

    if (!href) continue;

    if (/hubcloud/i.test(text) || /hubcloud/i.test(href)) {
      return decodeRedirect(absoluteUrl(href, baseUrl));
    }

    if (/hubdrive/i.test(text) || /hubdrive/i.test(href)) {
      const decoded = await decodeRedirect(absoluteUrl(href, baseUrl));

      try {
        const html = await fetchText(decoded, baseUrl);
        const $$ = cheerio.load(html);

        const hubLink = $$('a[href]')
          .filter((i, el2) => {
            const $a = $$(el2);
            return /hubcloud/i.test($a.text() + ' ' + ($a.attr('href') || ''));
          })
          .first()
          .attr('href');

        if (hubLink) {
          return absoluteUrl(hubLink, decoded);
        }
      } catch {}
    }
  }

  return '';
}

async function extractHubCloud(url, meta) {
  try {
    let html = await fetchText(url, url);
    let currentUrl = url;

    const link =
      html.match(/var url\s*=\s*['"]([^'"]+)['"]/)?.[1] ||
      cheerio.load(html)('a[href]').attr('href');

    if (link) {
      currentUrl = absoluteUrl(link, url);
      html = await fetchText(currentUrl, url);
    }

    const $ = cheerio.load(html);

    const title =
      $('div.card-header').text().replace(/\s+/g, ' ').trim() ||
      $('title').text().trim() ||
      meta.title;

    const sizeText = parseSize($('.card-body p').first().text());
    const size = sizeText !== 'N/A' ? sizeText : meta.size;
    const quality = parseQuality(title);

    const streams = [];

    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');

      if (!href || !isDirectVideo(href)) return;

      streams.push({
        url: href,
        title,
        quality,
        size
      });
    });

    return streams;
  } catch {
    return [];
  }
}

async function extractStreams(pageUrl, isSeries, season, episode) {
  const html = await fetchText(pageUrl);
  const $ = cheerio.load(html);

  const items = [];

  if (isSeries && season && episode) {
    const seasonTag = 'S' + String(season).padStart(2, '0');
    const episodeTag = 'Episode-' + String(episode).padStart(2, '0');

    $('.episode-item').each((i, el) => {
      const $el = $(el);

      if (!$el.find('.episode-title').text().includes(seasonTag)) return;

      $el.find('.episode-download-item').each((j, item) => {
        if ($(item).text().includes(episodeTag)) {
          items.push($(item));
        }
      });
    });
  } else {
    $('.download-item').each((i, el) => {
      items.push($(el));
    });
  }

  const results = await Promise.all(
    items.map(async $item => {
      const text = $item.text().replace(/\s+/g, ' ').trim();

      const meta = {
        title: $item.find('.quality').text().trim() || text,
        quality: parseQuality(text),
        size: parseSize(text)
      };

      const hubCloud = await findHubCloud($item, pageUrl, $);

      return hubCloud ? extractHubCloud(hubCloud, meta) : [];
    })
  );

  return results.flat();
}

function buildStreamObject(
  metaTitle,
  rawTitle,
  url,
  quality,
  size,
  proxyHeaders,
  episodeTag,
  meta,
  sortBy
) {
  let decodedUrl = '';

  try {
    decodedUrl = decodeURIComponent(url || '');
  } catch {
    decodedUrl = url || '';
  }

  const cleanTitle = decodeEntities(rawTitle || '')
    .replace(/[\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const combined = (cleanTitle + ' ' + decodedUrl).toLowerCase();

  let finalQuality = quality;

  const qualityMatch = combined.match(/\b(2160p|4k|1080p|720p|480p)\b/i);

  if (qualityMatch) {
    const q = qualityMatch[1].toLowerCase();

    if (q === '4k' || q === '2160p') finalQuality = '2160p';
    else if (q === '1080p') finalQuality = '1080p';
    else if (q === '720p') finalQuality = '720p';
    else if (q === '480p') finalQuality = '480p';
  }

  if (!finalQuality || finalQuality === 'N/A') {
    finalQuality = parseQuality(combined);
  }

  const qualityRank = getQualityRank(finalQuality);

  let audio = 'Single-Audio';

  if (/\b(multi|multi\-audio)\b/i.test(combined)) {
    audio = 'Multi-Audio';
  } else if (
    /\b(dual|dual\-audio|dubbed|hindi)\b/i.test(combined) ||
    decodeEntities(metaTitle || '').toLowerCase().includes('dual')
  ) {
    audio = 'Dual-Audio';
  }

  let finalSize = size && size !== 'N/A' ? size : 'N/A';

  const sizeMatch =
    cleanTitle.match(/\[\s*(\d+(?:\.\d+)?\s*[MG]B)\s*\]/i) ||
    cleanTitle.match(/(\d+(?:\.\d+)?\s*[MG]B)/i) ||
    decodedUrl.match(/(\d+(?:\.\d+)?\s*[MG]B)/i);

  if (sizeMatch) {
    finalSize = sizeMatch[1].toUpperCase().replace(/\s+/g, '');
  }

  let sizeInMB = 0;

  if (finalSize !== 'N/A') {
    const sizeParts = finalSize.match(/([\d.]+)\s*(GB|MB)/i);

    if (sizeParts) {
      const value = parseFloat(sizeParts[1]);
      const unit = sizeParts[2].toUpperCase();

      sizeInMB = Math.round(unit.includes('GB') ? value * 1024 : value);
    }
  }

  let sortTag = '';

  if (sortBy === 'size') {
    sortTag = getInvertedSortTag(sizeInMB, 999999);
  } else {
    sortTag = getInvertedSortTag(qualityRank * 100000 + sizeInMB, 999999);
  }

  const name = `${sortTag}${PROVIDER_NAME} | ${finalQuality} | ${audio}`;

  const titleName = meta && meta.title ? meta.title : metaTitle;
  const year = meta && meta.year ? meta.year : 'N/A';

  const episodeLine =
    episodeTag && (episodeTag.startsWith('S') || episodeTag.includes('E'))
      ? `🎬 ${titleName} - (${year}) ${episodeTag
          .replace(/E0*(\d+)/i, 'E$1')
          .replace(/S0*(\d+)/i, 'S$1')}`
      : `🎬 ${titleName} (${year})`;

  const qualityIcon =
    finalQuality === '2160p' ? '⚡' :
    finalQuality === '720p' ? '💎' :
    '🔥';

  const container =
    /\.mp4($|\?)/i.test(decodedUrl) || /\.mp4\b/i.test(cleanTitle)
      ? 'MP4'
      : 'MKV';

  const line2 = `${qualityIcon} ${finalQuality} | 💾 ${finalSize} | 📼 ${container}`;

  const hdr =
    /\bhdr10\+/i.test(combined) ? 'HDR10+' :
    /\bhdr10\b/i.test(combined) ? 'HDR10' :
    'HDR';

  const codec =
    /\b(h\.?265|x265|hevc)\b/i.test(combined)
      ? 'H.265'
      : 'H.264';

  const tags = [`🌈 ${hdr}`, `🎞️ ${codec}`];

  if (
    /\b(dolby\s*vision|dovi|\.dv\.)\b/i.test(combined) ||
    /[\.\-_]dv[\.\-_]/i.test(combined)
  ) {
    tags.push('👁️ DV');
  }

  const line3 = tags.join(' | ');

  const audioCodec =
    /\btruehd\s*7\.1\b/i.test(combined) ? 'TrueHD 7.1' :
    /\bddp5\.1\b/i.test(combined) || /\beac3\b/i.test(combined) ? 'DDP5.1' :
    'DD5.1';

  const atmos = /\batmos\b/i.test(combined) ? ' Atmos' : '';
  const line4 = `🔊 ${audio} | 🎧 ${audioCodec}${atmos}`;

  const source =
    /\b(bluray|blu\-ray)\b/i.test(combined)
      ? 'BluRay'
      : 'WEB-DL';

  const line5 = `📡 ${source}`;

  const description = `${episodeLine}\n${line2}\n${line3}\n${line4}\n${line5}`;

  return {
    qualityRank,
    sizeInMB,
    data: {
      name,
      title: description,
      size: description,
      description,
      url: url || '',
      behaviorHints: {
        notWebReady: true,
        proxyHeaders: {
          request: proxyHeaders || { Referer: BASE_URL + '/' }
        }
      }
    }
  };
}

async function getStreams(id, type, season = null, episode = null, settings = {}) {
  const isSeries = type === 'tv' || type === 'series';

  if (!id || (!isSeries && type !== 'movie')) return [];

  try {
    const { sortBy } = resolveSettings(settings);

    console.log(
      `[${PROVIDER_NAME}] id=${id} type=${type} S=${season} E=${episode} sortBy=${sortBy}`
    );

    const meta = await getMetadata(id, type);
    const pageUrl = await findPage(meta, isSeries, season);

    if (!pageUrl) return [];

    const streams = await extractStreams(pageUrl, isSeries, season, episode);

    let episodeTag = '';

    if (isSeries) {
      const s = parseInt(season, 10) || 1;
      const e = parseInt(episode, 10) || 1;

      episodeTag = `S${s < 10 ? '0' : ''}${s}E${e < 10 ? '0' : ''}${e}`;
    }

    const seen = {};
    const output = [];

    for (const stream of streams) {
      if (!isDirectVideo(stream.url) || seen[stream.url]) continue;

      seen[stream.url] = true;

      const rawTitle = `${stream.title} [${stream.quality}] ${stream.size}`;

      const built = buildStreamObject(
        meta.title,
        rawTitle,
        stream.url,
        stream.quality,
        stream.size,
        {
          Referer: BASE_URL + '/',
          'User-Agent': USER_AGENT
        },
        episodeTag.trim(),
        meta,
        sortBy
      );

      output.push(built);
    }

    output.sort((a, b) => {
      if (sortBy === 'size') {
        return b.sizeInMB - a.sizeInMB;
      }

      if (b.qualityRank !== a.qualityRank) {
        return b.qualityRank - a.qualityRank;
      }

      return b.sizeInMB - a.sizeInMB;
    });

    console.log(
      `[${PROVIDER_NAME}] Returning ${output.length} stream(s) sorted by ${sortBy}`
    );

    return output.map(item => item.data);
  } catch (e) {
    console.error(`[${PROVIDER_NAME}] error: ${e.message}`);
    return [];
  }
}

module.exports = {
  getStreams,
  onSettings
};
