const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_HTML_BYTES = 768 * 1024;
const MAX_REDIRECTS = 6;
const FETCH_TIMEOUT_MS = 12000;

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PREVIEW_BOT_USER_AGENT =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

function isPrivateOrReservedIp(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return true;
  const ip = rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && parts[2] === 0) return true;
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(lower)) return true;
    if (lower.startsWith('ff')) return true;
    return false;
  }
  return true;
}

async function validateExternalUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch (e) {
    throw new Error('Please enter a valid http:// or https:// image URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported.');
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Local or internal URLs cannot be imported.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Private IP addresses cannot be imported.');
    }
    return parsed;
  }

  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch (e) {
    throw new Error('Could not reach that website address.');
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Could not resolve that website address.');
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error('Private network targets cannot be imported.');
    }
  }
  return parsed;
}

function unwrapSearchRedirectUrl(rawUrl) {
  let trimmed = String(rawUrl || '').trim();
  if (/^www\./i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host === 'google.com' || host.includes('.google.')) {
      if (parsed.pathname === '/imgres') {
        const imgUrl = parsed.searchParams.get('imgurl');
        if (imgUrl && (imgUrl.startsWith('http://') || imgUrl.startsWith('https://'))) {
          return imgUrl;
        }
      }
      if (parsed.pathname === '/url') {
        const target = parsed.searchParams.get('url') || parsed.searchParams.get('q');
        if (target && (target.startsWith('http://') || target.startsWith('https://'))) {
          return target;
        }
      }
    }
    if (host.includes('bing.com') && parsed.pathname.startsWith('/images/search')) {
      const mediaUrl = parsed.searchParams.get('mediaurl');
      if (mediaUrl && (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://'))) {
        return mediaUrl;
      }
    }
    if (host.includes('duckduckgo.com') && parsed.pathname === '/l/') {
      const target = parsed.searchParams.get('uddg');
      if (target && (target.startsWith('http://') || target.startsWith('https://'))) {
        return target;
      }
    }
    if (host.includes('facebook.com') && parsed.pathname === '/l.php') {
      const target = parsed.searchParams.get('u');
      if (target && (target.startsWith('http://') || target.startsWith('https://'))) {
        return target;
      }
    }
  } catch (e) {}
  return trimmed;
}

async function readLimitedBuffer(response, maxBytes, { truncate = false } = {}) {
  if (!truncate) {
    const lenHeader = Number(response.headers.get('content-length'));
    if (Number.isFinite(lenHeader) && lenHeader > maxBytes) {
      throw new Error(`Remote file exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB size limit.`);
    }
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const ab = await response.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      if (truncate) {
        return Buffer.from(ab.slice(0, maxBytes));
      }
      throw new Error(`Remote file exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB size limit.`);
    }
    return Buffer.from(ab);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        if (truncate) {
          const remaining = maxBytes - total;
          if (remaining > 0) {
            chunks.push(Buffer.from(value.subarray(0, remaining)));
            total += remaining;
          }
          await reader.cancel().catch(() => {});
          break;
        }
        await reader.cancel().catch(() => {});
        throw new Error(`Remote file exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB size limit.`);
      }
      total += value.byteLength;
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function safeFetch(rawUrl, maxBytes, options = {}) {
  const { userAgent = BROWSER_USER_AGENT, referer = null } = options;
  let currentUrl = String(rawUrl || '').trim();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const parsed = await validateExternalUrl(currentUrl);
    const headers = {
      'User-Agent': userAgent,
      Accept: 'image/webp,image/png,image/jpeg,image/*,text/html;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    };
    if (referer) headers.Referer = referer;

    const response = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel?.().catch(() => {});
      if (!location || hop === MAX_REDIRECTS) {
        throw new Error('Could not follow redirect for that image URL.');
      }
      currentUrl = new URL(location, parsed.toString()).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      const err = new Error(`Could not load image from that link (HTTP ${response.status}).`);
      err.httpStatus = response.status;
      throw err;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
    const limit = isHtml ? MAX_HTML_BYTES : maxBytes;
    const buffer = await readLimitedBuffer(response, limit, { truncate: isHtml });
    return { buffer, contentType, finalUrl: parsed.toString() };
  }

  throw new Error('Too many redirects while loading that link.');
}

function detectImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: '.jpg', mimeType: 'image/jpeg' };
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { ext: '.png', mimeType: 'image/png' };
  }
  const head6 = buf.subarray(0, 6).toString('ascii');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') {
    return { ext: '.gif', mimeType: 'image/gif' };
  }
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: '.webp', mimeType: 'image/webp' };
  }
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') {
      return { ext: '.avif', mimeType: 'image/avif' };
    }
  }
  return null;
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .trim();
}

function readTagAttr(tag, attrName) {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tag.match(re);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

function extractMetaImageUrl(html, pageUrl) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const preferredKeys = [
    'og:image:secure_url',
    'og:image:url',
    'og:image',
    'twitter:image:src',
    'twitter:image',
    'image'
  ];
  const candidates = [];

  for (const tag of metaTags) {
    const key = (
      readTagAttr(tag, 'property') ||
      readTagAttr(tag, 'name') ||
      readTagAttr(tag, 'itemprop')
    )
      .toLowerCase()
      .trim();
    if (!preferredKeys.includes(key)) continue;
    const content = decodeHtmlEntities(readTagAttr(tag, 'content'));
    if (content) {
      candidates.push({ rank: preferredKeys.indexOf(key), url: content });
    }
  }

  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const rel = readTagAttr(tag, 'rel').toLowerCase();
    if (rel.split(/\s+/).includes('image_src')) {
      const href = decodeHtmlEntities(readTagAttr(tag, 'href'));
      if (href) candidates.push({ rank: preferredKeys.length, url: href });
    }
  }

  candidates.sort((a, b) => a.rank - b.rank);
  for (const cand of candidates) {
    try {
      const resolved = new URL(cand.url, pageUrl).toString();
      if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
        return resolved;
      }
    } catch (e) {}
  }
  return null;
}

function extractMetaRefreshUrl(html, pageUrl) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const equiv = readTagAttr(tag, 'http-equiv').toLowerCase().trim();
    if (equiv !== 'refresh') continue;
    const content = decodeHtmlEntities(readTagAttr(tag, 'content'));
    const match = content.match(/\burl\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;]+))/i);
    const target = (match && (match[1] ?? match[2] ?? match[3])) || '';
    if (target) {
      try {
        const resolved = new URL(target, pageUrl).toString();
        if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
          return resolved;
        }
      } catch (e) {}
    }
  }
  return null;
}

async function fetchSocialFallbackImageUrl(pageUrl) {
  try {
    const parsed = new URL(pageUrl);
    const host = parsed.hostname.toLowerCase();
    if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) {
      const match = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      if (match) {
        const apiUrl = `https://api.fxtwitter.com/${match[1]}/status/${match[2]}`;
        const res = await safeFetch(apiUrl, MAX_HTML_BYTES, { userAgent: 'Finnival/1.0' });
        const json = JSON.parse(res.buffer.toString('utf8'));
        const photoUrl =
          json?.tweet?.media?.photos?.[0]?.url ||
          json?.tweet?.media?.videos?.[0]?.thumbnail_url ||
          json?.tweet?.author?.avatar_url;
        if (photoUrl && (photoUrl.startsWith('http://') || photoUrl.startsWith('https://'))) {
          return photoUrl;
        }
      }
    }
  } catch (e) {}
  return null;
}

function bufferLooksHtml(buf, contentType = '') {
  return (
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml+xml') ||
    buf.subarray(0, 128).toString('utf8').trimStart().startsWith('<')
  );
}

async function resolveImageUrlFromHtmlResult(fetchResult, initialUrl) {
  const html = fetchResult.buffer.toString('utf8');
  let metaImgUrl = extractMetaImageUrl(html, fetchResult.finalUrl);
  if (metaImgUrl) return { metaImgUrl, referer: fetchResult.finalUrl };

  const refreshUrl = extractMetaRefreshUrl(html, fetchResult.finalUrl);
  if (refreshUrl && refreshUrl !== fetchResult.finalUrl) {
    try {
      const refreshed = await safeFetch(refreshUrl, MAX_IMAGE_BYTES);
      if (detectImageType(refreshed.buffer)) {
        return { directResult: refreshed };
      }
      if (bufferLooksHtml(refreshed.buffer, refreshed.contentType)) {
        metaImgUrl = extractMetaImageUrl(refreshed.buffer.toString('utf8'), refreshed.finalUrl);
        if (metaImgUrl) return { metaImgUrl, referer: refreshed.finalUrl };
      }
    } catch (e) {}
  }

  try {
    const botRes = await safeFetch(initialUrl, MAX_HTML_BYTES, { userAgent: PREVIEW_BOT_USER_AGENT });
    if (detectImageType(botRes.buffer)) {
      return { directResult: botRes };
    }
    if (bufferLooksHtml(botRes.buffer, botRes.contentType)) {
      metaImgUrl = extractMetaImageUrl(botRes.buffer.toString('utf8'), botRes.finalUrl);
      if (metaImgUrl) return { metaImgUrl, referer: botRes.finalUrl };
    }
  } catch (e) {}

  const socialUrl = await fetchSocialFallbackImageUrl(fetchResult.finalUrl || initialUrl);
  if (socialUrl) return { metaImgUrl: socialUrl, referer: fetchResult.finalUrl };

  return null;
}

async function importImageFromUrl(rawUrl) {
  const initialUrl = unwrapSearchRedirectUrl(rawUrl);
  let first;
  try {
    first = await safeFetch(initialUrl, MAX_IMAGE_BYTES);
  } catch (err) {
    if (err.httpStatus === 401 || err.httpStatus === 403) {
      try {
        first = await safeFetch(initialUrl, MAX_IMAGE_BYTES, { userAgent: PREVIEW_BOT_USER_AGENT });
      } catch (botErr) {
        const socialUrl = await fetchSocialFallbackImageUrl(initialUrl);
        if (!socialUrl) throw err;
        const imgRes = await safeFetch(socialUrl, MAX_IMAGE_BYTES);
        const socialType = detectImageType(imgRes.buffer);
        if (!socialType) throw err;
        return {
          buffer: imgRes.buffer,
          ext: socialType.ext,
          mimeType: socialType.mimeType,
          extractedFromPage: true
        };
      }
    } else {
      throw err;
    }
  }

  const directType = detectImageType(first.buffer);
  if (directType) {
    return {
      buffer: first.buffer,
      ext: directType.ext,
      mimeType: directType.mimeType,
      extractedFromPage: false
    };
  }

  if (bufferLooksHtml(first.buffer, first.contentType)) {
    const resolved = await resolveImageUrlFromHtmlResult(first, initialUrl);
    if (!resolved) {
      throw new Error(
        'That link is a webpage with no preview image. Right-click the image → "Copy image address" or use Upload.'
      );
    }
    if (resolved.directResult) {
      const directMeta = detectImageType(resolved.directResult.buffer);
      if (directMeta) {
        return {
          buffer: resolved.directResult.buffer,
          ext: directMeta.ext,
          mimeType: directMeta.mimeType,
          extractedFromPage: true
        };
      }
    }
    if (resolved.metaImgUrl) {
      let imgRes;
      try {
        imgRes = await safeFetch(resolved.metaImgUrl, MAX_IMAGE_BYTES);
      } catch (imgErr) {
        if (imgErr.httpStatus === 401 || imgErr.httpStatus === 403) {
          imgRes = await safeFetch(resolved.metaImgUrl, MAX_IMAGE_BYTES, { referer: resolved.referer });
        } else {
          throw imgErr;
        }
      }
      const metaType = detectImageType(imgRes.buffer);
      if (!metaType) {
        throw new Error('Could not find a supported image (JPG, PNG, WEBP, GIF) at that link.');
      }
      return {
        buffer: imgRes.buffer,
        ext: metaType.ext,
        mimeType: metaType.mimeType,
        extractedFromPage: true
      };
    }
  }

  throw new Error('That URL does not point to a supported image (JPG, PNG, WEBP, GIF).');
}

module.exports = {
  importImageFromUrl
};
