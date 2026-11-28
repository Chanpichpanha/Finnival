const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8000;

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
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    const host = parsed.hostname.toLowerCase();
    if ((host === 'google.com' || host.includes('.google.')) && parsed.pathname === '/imgres') {
      const imgUrl = parsed.searchParams.get('imgurl');
      if (imgUrl && (imgUrl.startsWith('http://') || imgUrl.startsWith('https://'))) {
        return imgUrl;
      }
    }
  } catch (e) {}
  return rawUrl;
}

async function readLimitedBuffer(response, maxBytes) {
  const lenHeader = Number(response.headers.get('content-length'));
  if (Number.isFinite(lenHeader) && lenHeader > maxBytes) {
    throw new Error(`Remote file exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB size limit.`);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const ab = await response.arrayBuffer();
    if (ab.byteLength > maxBytes) {
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
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Remote file exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB size limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function safeFetch(rawUrl, maxBytes) {
  let currentUrl = String(rawUrl || '').trim();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const parsed = await validateExternalUrl(currentUrl);
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,text/html;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
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
      throw new Error(`Could not load image from that link (HTTP ${response.status}).`);
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const limit = contentType.includes('text/html') ? MAX_HTML_BYTES : maxBytes;
    const buffer = await readLimitedBuffer(response, limit);
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
  return null;
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function readTagAttr(tag, attrName) {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tag.match(re);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

function extractMetaImageUrl(html, pageUrl) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const preferredKeys = ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'];
  const candidates = [];

  for (const tag of metaTags) {
    const key = (readTagAttr(tag, 'property') || readTagAttr(tag, 'name')).toLowerCase().trim();
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

async function importImageFromUrl(rawUrl) {
  const initialUrl = unwrapSearchRedirectUrl(rawUrl);
  const first = await safeFetch(initialUrl, MAX_IMAGE_BYTES);
  const directType = detectImageType(first.buffer);
  if (directType) {
    return {
      buffer: first.buffer,
      ext: directType.ext,
      mimeType: directType.mimeType,
      extractedFromPage: false
    };
  }

  const looksHtml =
    first.contentType.includes('text/html') ||
    first.buffer.subarray(0, 64).toString('utf8').trimStart().startsWith('<');

  if (looksHtml) {
    const html = first.buffer.toString('utf8');
    const metaImgUrl = extractMetaImageUrl(html, first.finalUrl);
    if (!metaImgUrl) {
      throw new Error('That link is a webpage with no preview image. Right-click the image → "Copy image address" or use Upload.');
    }
    const imgRes = await safeFetch(metaImgUrl, MAX_IMAGE_BYTES);
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

  throw new Error('That URL does not point to a supported image (JPG, PNG, WEBP, GIF).');
}

module.exports = {
  importImageFromUrl
};
