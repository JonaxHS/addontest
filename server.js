import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const AIO_BASE =
  process.env.AIO_BASE ||
  "https://aiostream.axonim.lat/stremio/35099f5e-fd8c-488f-a701-2bd66af59ead/eyJpIjoiT3ExWVFONXE1alQ3MVVvaEVKNU5CZz09IiwiZSI6IkpGYWxsWGtjZDVCUndTRDdNWlVlOUJpRnE0UzQwOEpvZEljaTFFUDQwOU09IiwidCI6ImEifQ/stream";
const PREFER_LATINO = process.env.PREFER_LATINO !== "false";
const LATINO_ONLY = process.env.LATINO_ONLY === "true";
const MAX_STREAMS = Number(process.env.MAX_STREAMS || 0);
const LATINO_MARKERS = (process.env.LATINO_MARKERS || "latino,lat,castellano,espanol,español")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

// Storage paths
const DATA_DIR = process.env.DATA_DIR || './data';
const ADDONS_DIR = join(DATA_DIR, 'addons');
const LEGACY_CONFIG_FILE = join(DATA_DIR, 'configs.json');

// In-memory store for generated configurations. Each entry: id -> { config, meta }
let configStore = new Map();

// Cache HTML in memory with timestamp
let cachedHtml = null;
let cachedHtmlTime = 0;
const HTML_CACHE_TTL = 60000; // 1 minute

// Cache stream results in memory with TTL
let streamCache = new Map(); // key: "${configId}:${searchPattern}" -> { streams, upstreamUrl, count, timestamp }
const STREAM_CACHE_TTL = 20 * 60 * 1000; // 20 minutes

function getStreamCacheKey(configId, searchPattern) {
  return `${configId}:${searchPattern}`;
}

function getCachedStreams(configId, searchPattern) {
  const key = getStreamCacheKey(configId, searchPattern);
  const cached = streamCache.get(key);
  if (!cached) return null;
  
  const now = Date.now();
  if (now - cached.timestamp > STREAM_CACHE_TTL) {
    streamCache.delete(key);
    return null;
  }
  
  return cached;
}

function setCachedStreams(configId, searchPattern, data) {
  const key = getStreamCacheKey(configId, searchPattern);
  streamCache.set(key, {
    ...data,
    timestamp: Date.now()
  });
}

function clearStreamCache() {
  streamCache.clear();
}

// Constants
const MAX_POST_SIZE = 10 * 1024 * 1024; // 10MB
const ID_COLLISION_CHECK_RETRIES = 3;

function ensureDataDir() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    if (!existsSync(ADDONS_DIR)) mkdirSync(ADDONS_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to create data dir', DATA_DIR, e);
  }
}

function getAddonFilePath(id) {
  return join(ADDONS_DIR, `${id}.json`);
}

async function saveAddonFile(id, entry) {
  try {
    ensureDataDir();
    const payload = {
      id,
      config: entry.config,
      meta: entry.meta || { createdAt: Date.now(), lastAccess: null }
    };
    await writeFile(getAddonFilePath(id), JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving addon file:', err);
  }
}

function loadConfigs() {
  try {
    ensureDataDir();
    const files = readdirSync(ADDONS_DIR).filter((file) => file.endsWith('.json'));
    for (const file of files) {
      const raw = readFileSync(join(ADDONS_DIR, file), 'utf8');
      const parsed = JSON.parse(raw || '{}');
      const id = typeof parsed.id === 'string' && parsed.id ? parsed.id : file.replace(/\.json$/i, '');
      const config = parsed.config || null;
      if (!config) continue;

      const meta = parsed.meta || { createdAt: Date.now(), lastAccess: null };
      configStore.set(id, { config, meta });
    }

    if (existsSync(LEGACY_CONFIG_FILE)) {
      const raw = readFileSync(LEGACY_CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      const entries = Array.isArray(parsed.configs) ? parsed.configs : [];
      for (const item of entries) {
        const [id, config, meta] = item;
        if (!id || !config || configStore.has(id)) continue;
        const entry = { config, meta: meta || { createdAt: Date.now(), lastAccess: null } };
        configStore.set(id, entry);
        saveAddonFile(id, entry);
      }
    }
  } catch (err) {
    console.error('Failed to load configs:', err);
  }
}

async function markInstanceCreated(id) {
  const now = Date.now();
  // Ensure meta exists on stored config
  const entry = configStore.get(id);
  if (entry) {
    entry.meta = { createdAt: now, lastAccess: null };
    await saveAddonFile(id, entry);
  }
}

async function markInstanceAccessed(id) {
  const now = Date.now();
  const stored = configStore.get(id);
  if (stored) {
    stored.meta = stored.meta || { createdAt: now, lastAccess: now };
    stored.meta.lastAccess = now;
    await saveAddonFile(id, stored);
  }
}

function countAddonJsonFiles() {
  try {
    ensureDataDir();
    if (!existsSync(ADDONS_DIR)) return 0;
    return readdirSync(ADDONS_DIR).filter((file) => file.endsWith('.json')).length;
  } catch (err) {
    console.error('Failed to count addon json files:', err);
    return 0;
  }
}

// Load persisted configs at startup (if any)
loadConfigs();

// Load HTML from config-ui.html file with caching
async function getConfigHtml() {
  const now = Date.now();
  // Return cached version if still valid
  if (cachedHtml && (now - cachedHtmlTime) < HTML_CACHE_TTL) {
    return cachedHtml;
  }
  
  try {
    const html = await readFile(join(__dirname, 'config-ui.html'), 'utf8');
    cachedHtml = html;
    cachedHtmlTime = now;
    return html;
  } catch (error) {
    console.error("Error loading config-ui.html:", error);
    return "<h1>Error loading configuration UI</h1>";
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function getRequestBaseUrl(req) {
  const forwarded = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwarded || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}`;
}
function toHexInfoHash(candidate) {
  if (!candidate) return null;
  if (/^[A-Fa-f0-9]{40}$/.test(candidate)) {
    return candidate.toLowerCase();
  }

  if (!/^[A-Z2-7]{32}$/i.test(candidate)) {
    return null;
  }

  // Convert base32 BTIH into 20-byte hex hash.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const ch of candidate.toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) return null;

    value = (value << 5) | idx;
    bits += 5;

    while (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  if (bytes.length < 20) return null;
  return Buffer.from(bytes.slice(0, 20)).toString("hex");
}

function maybeDecodeURIComponent(input) {
  let out = input;
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(out);
      if (decoded === out) break;
      out = decoded;
    } catch {
      break;
    }
  }
  return out;
}

function extractInfoHashFromText(text) {
  const patterns = [
    /btih:([A-Fa-f0-9]{40}|[A-Z2-7]{32})/i,
    /\/resolve\/[^/]+\/[^/]+\/([A-Fa-f0-9]{40})(?:\/|$)/i,
    /\/_\/strem\/[^/]+\/[^/]+\/([A-Fa-f0-9]{40})(?:\/|$)/i,
    /(?:^|[^A-Fa-f0-9])([A-Fa-f0-9]{40})(?:$|[^A-Fa-f0-9])/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const infoHash = toHexInfoHash(match[1]);
    if (infoHash) return infoHash;
  }

  return null;
}

function extractInfoHash(stream) {
  const url = typeof stream?.url === "string" ? stream.url : "";
  const description = typeof stream?.description === "string" ? stream.description : "";
  const filename = typeof stream?.behaviorHints?.filename === "string" ? stream.behaviorHints.filename : "";

  const candidates = [url, maybeDecodeURIComponent(url), description, filename].filter(Boolean);

  for (const candidate of candidates) {
    const infoHash = extractInfoHashFromText(candidate);
    if (infoHash) return infoHash;
  }

  return null;
}

function normalizeName(stream, fallback) {
  const name = typeof stream?.name === "string" ? stream.name.trim() : "";
  if (name) return name;

  const filename = typeof stream?.behaviorHints?.filename === "string" ? stream.behaviorHints.filename.trim() : "";
  if (filename) return filename;

  return fallback;
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "Unknown";

  const gb = value / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;

  const mb = value / (1024 ** 2);
  return `${mb.toFixed(2)} MB`;
}

function parseProvider(stream) {
  const text = `${stream?.name || ""}\n${stream?.description || ""}`;
  const line = text
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.includes("🍿"));

  if (!line) return "AIOStreams";

  const provider = line.split("🍿").pop()?.trim();
  if (!provider) return "AIOStreams";

  return provider;
}

function parseQualityLine(stream) {
  const firstLine = (stream?.name || "").split("\n")[0]?.trim() || "";
  const normalized = firstLine.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
  return normalized || "Auto";
}

function buildTitle(stream, provider) {
  const filename = typeof stream?.behaviorHints?.filename === "string" ? stream.behaviorHints.filename.trim() : "";
  const descLine = (stream?.description || "")
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item && !item.toLowerCase().startsWith("infohash:"));

  const base = filename || descLine || normalizeName(stream, "AIOStreams Stream");
  const size = formatSize(stream?.behaviorHints?.videoSize);

  return `${base}\nSize ${size} Source ${provider}`;
}

function normalizeForMatch(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function generateConfigId() {
  // Include timestamp + random to minimize collision risk
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${random}`;
}

function ensureUniqueConfigId() {
  // Generate ID and verify it's not already in use
  for (let i = 0; i < ID_COLLISION_CHECK_RETRIES; i++) {
    const id = generateConfigId();
    if (!configStore.has(id)) {
      return id;
    }
  }
  // Fallback: use crypto-based ID if collision occurs
  // (extremely rare, but handle just in case)
  const crypto = require('crypto');
  return crypto.randomBytes(16).toString('hex');
}

function hasPreferredLatino(stream, markers = LATINO_MARKERS) {
  const haystack = normalizeForMatch(
    `${stream?.name || ""}\n${stream?.title || ""}\n${stream?.behaviorHints?.filename || ""}`
  );
  const tokens = new Set(haystack.split(/[^a-z0-9]+/).filter(Boolean));

  return markers.some((rawMarker) => {
    const marker = normalizeForMatch(rawMarker);
    if (marker.length <= 3) return tokens.has(marker);
    return haystack.includes(marker);
  });
}

async function handleStream(req, res, pathname, config, configId) {
  try {
    const cfg = config || {
      aioBase: AIO_BASE,
      useAioFiltering: false,
      selectedLanguages: LATINO_MARKERS.length > 0 ? ['español', 'latino'] : [],
      maxStreams: MAX_STREAMS,
      searchMarkers: LATINO_MARKERS,
      fallbackAllLanguages: false
    };

    const searchPattern = pathname.slice("/stream/".length, -".json".length);
    if (!searchPattern) {
      sendJson(res, 400, { error: "Missing search pattern." });
      return;
    }

    // Debug logging
    const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    console.log(`[${reqId}] Stream request: pattern=${searchPattern}, configId=${configId || 'NONE'}`);

    // Check cache first if configId provided
    if (configId) {
      const cached = getCachedStreams(configId, searchPattern);
      if (cached) {
        console.log(`[${reqId}] Cache HIT: ${cached.streams.length} streams`);
        sendJson(res, 200, { streams: cached.streams, count: cached.count, upstreamUrl: cached.upstreamUrl });
        return;
      }
      console.log(`[${reqId}] Cache MISS`);
    } else {
      console.log(`[${reqId}] No configId - cache disabled`);
    }

    const upstreamUrl = `${cfg.aioBase}/${searchPattern}.json`;

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstreamUrl, { headers: { accept: "application/json" } });
    } catch (error) {
      sendJson(res, 502, {
        error: "Failed to fetch upstream AIOStreams endpoint.",
        detail: String(error),
        upstreamUrl
      });
      return;
    }

    if (!upstreamResponse.ok) {
      sendJson(res, 502, {
        error: "Upstream returned non-OK status.",
        status: upstreamResponse.status,
        upstreamUrl
      });
      return;
    }

    let payload;
    try {
      payload = await upstreamResponse.json();
    } catch {
      sendJson(res, 502, { error: "Upstream did not return valid JSON.", upstreamUrl });
      return;
    }

    const streams = Array.isArray(payload?.streams) ? payload.streams : [];
    const dedupe = new Set();
    const converted = [];

    for (const stream of streams) {
      const infoHash = extractInfoHash(stream);
      if (!infoHash || dedupe.has(infoHash)) continue;

      dedupe.add(infoHash);
      const upstreamLabel = normalizeName(stream, `AIOStreams ${searchPattern}`);
      const provider = parseProvider(stream);
      const qualityLine = parseQualityLine(stream);
      const filename = typeof stream?.behaviorHints?.filename === "string" ? stream.behaviorHints.filename : upstreamLabel;
      const bingeGroup = typeof stream?.behaviorHints?.bingeGroup === "string" ? stream.behaviorHints.bingeGroup : `${provider}|${qualityLine}`;
      const fileIdx = Number.isInteger(stream?.fileIdx) ? stream.fileIdx : 0;
      const videoSize = Number(stream?.behaviorHints?.videoSize || 0);

        converted.push({
          name: `AIOStreams Bridge\n${qualityLine}`,
        title: upstreamLabel,
        infoHash,
        fileIdx,
        behaviorHints: {
          bingeGroup,
          filename,
          videoSize
        },
        size: videoSize,
        sourceUrl: typeof stream?.url === "string" ? stream.url : ""
      });
    }

    console.log(`[${reqId}] After upstream fetch: ${streams.length} upstream → ${converted.length} deduplicated`);

    let output = converted;

    if (cfg.useAioFiltering) {
      console.log(`[${reqId}] useAioFiltering=true, returning ${output.length} without further filtering`);
      sendJson(res, 200, { streams: output, count: output.length, upstreamUrl });
      return;
    }

    // Filter by selected languages/search markers
    if (cfg.selectedLanguages && cfg.selectedLanguages.length > 0 && cfg.searchMarkers) {
      const matchingStreams = converted.filter((item) => {
        return hasPreferredLatino(item, cfg.searchMarkers);
      });
      console.log(`[${reqId}] Language filter: ${converted.length} → ${matchingStreams.length} matching`);

      // Use matching streams if any found, otherwise apply fallback logic
      if (matchingStreams.length > 0) {
        output = matchingStreams;
      } else if (cfg.fallbackAllLanguages) {
        // No matching results - use fallback: return all available streams
        console.log(`[${reqId}] No matches, fallback=true, using all ${converted.length}`);
        output = converted;
      } else {
        // No matching results and no fallback - return empty
        console.log(`[${reqId}] No matches, fallback=false, returning empty`);
        output = [];
      }
    }

    if (cfg.maxStreams > 0) {
      output = output.slice(0, cfg.maxStreams);
      console.log(`[${reqId}] Max streams limit: ${output.length}`);
    }

    // Cache results before sending
    if (configId) {
      setCachedStreams(configId, searchPattern, { streams: output, count: output.length, upstreamUrl });
    }

    console.log(`[${reqId}] Final response: ${output.length} streams`);
    sendJson(res, 200, { streams: output, count: output.length, upstreamUrl });
  } catch (error) {
    sendJson(res, 500, { error: "Internal server error", detail: String(error) });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const method = req.method;

  // Serve HTML config generator at root
  if (pathname === "/" && method === "GET") {
    const html = await getConfigHtml();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // Serve static assets (images, css, js) from /assets
  if (pathname.startsWith('/assets/') && method === 'GET') {
    try {
      const assetPath = join(__dirname, pathname);
      if (!existsSync(assetPath)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const ext = assetPath.split('.').pop().toLowerCase();
      const mime = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        svg: 'image/svg+xml',
        css: 'text/css',
        js: 'application/javascript',
        ico: 'image/x-icon',
        json: 'application/json'
      }[ext] || 'application/octet-stream';

      const data = readFileSync(assetPath);
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=86400' });
      res.end(data);
      return;
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Error reading asset');
      return;
    }
  }

  // Health endpoint
  if (pathname === "/health" && method === "GET") {
    sendJson(res, 200, { ok: true, service: "aiostreams-debrid-bridge", addons: countAddonJsonFiles() });
    return;
  }

  // Account/config retrieval disabled: we do not create persistent accounts.
  if (pathname.startsWith("/api/config/") && method === "GET") {
    sendJson(res, 403, { error: "Account retrieval is disabled. This service does not create persistent accounts." });
    return;
  }

  // Metrics endpoint: count addon JSON files
  if (pathname === "/api/configs" && method === "GET") {
    sendJson(res, 200, {
      addonCount: countAddonJsonFiles()
    });
    return;
  }

  // Test AIOStreams link endpoint
  if (pathname.startsWith("/api/test-aio/") && method === "GET") {
    const aioLink = decodeURIComponent(pathname.slice("/api/test-aio/".length));
    try {
      const response = await fetch(aioLink, { headers: { accept: "application/json" } });
      if (!response.ok) {
        sendJson(res, 502, { error: "AIOStreams returned non-OK", status: response.status });
        return;
      }
      const data = await response.json();
      const streamCount = Array.isArray(data?.streams) ? data.streams.length : 0;
      sendJson(res, 200, { ok: true, streamCount, preview: data });
    } catch (error) {
      sendJson(res, 502, { error: "Failed to fetch AIOStreams", detail: String(error) });
    }
    return;
  }

  // API: Generate custom configuration
  if (pathname === "/api/generate-config" && method === "POST") {
    let body = "";
    let bodySize = 0;
    
    req.on("data", (chunk) => {
      bodySize += chunk.length;
      if (bodySize > MAX_POST_SIZE) {
        req.pause();
        sendJson(res, 413, { error: "Request too large", max: MAX_POST_SIZE });
        req.connection.destroy();
        return;
      }
      body += chunk;
    });
    
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        let { serverUrl, aioLink, languages, markers, maxStreams, fallbackAllLanguages, useAioFiltering } = payload;

        if (!serverUrl || !aioLink || !Array.isArray(languages)) {
          sendJson(res, 400, { error: "serverUrl, aioLink and languages array are required" });
          return;
        }

        // Normalize AIOStreams link
        aioLink = aioLink.trim();
        if (!aioLink.startsWith("http")) {
          sendJson(res, 400, { error: "AIOStreams link must start with http:// or https://" });
          return;
        }

        // Convert manifest.json to /stream endpoint
        if (aioLink.endsWith("/manifest.json")) {
          aioLink = aioLink.replace("/manifest.json", "/stream");
        }

        // Ensure it ends with /stream
        if (!aioLink.endsWith("/stream")) {
          aioLink = aioLink.replace(/\/$/, "") + "/stream";
        }

        const configId = ensureUniqueConfigId();
        const markerList = markers.split(",").map((m) => m.trim()).filter(Boolean);
        const languageList = languages.map((l) => typeof l === 'string' ? l.trim().toLowerCase() : '').filter(Boolean);

        const config = {
          aioBase: aioLink,
          selectedLanguages: languageList,
          maxStreams: parseInt(maxStreams) || 0,
          searchMarkers: markerList,
          fallbackAllLanguages: fallbackAllLanguages === true,
          useAioFiltering: useAioFiltering === true
        };

        // Store config in-memory with meta and persist to its own JSON file
        configStore.set(configId, { config, meta: { createdAt: Date.now(), lastAccess: null } });
        await markInstanceCreated(configId);

        let baseUrl;
        if (serverUrl && /^https?:\/\//i.test(serverUrl)) {
          baseUrl = serverUrl.replace(/\/$/, ""); // Remove trailing slash
          const reqProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket && req.socket.encrypted ? 'https' : 'http');
          if (reqProto === 'https' && baseUrl.startsWith('http://')) {
            baseUrl = baseUrl.replace(/^http:\/\//i, 'https://');
          }
        } else {
          baseUrl = getRequestBaseUrl(req);
        }

        const configUrl = `${baseUrl}/config/${configId}.json`;
        const customStreamBase = `${baseUrl}/custom/${configId}/stream`;

        // Generate DebridStream configuration
        const debridConfig = [
          {
            name: "AIOStreams Bridge",
            type: "json_imdb",
            imdbType: "tv",
            itemType: "info_hash",
            infoHashTargetKey: "infoHash",
            jsonResultsKey: "streams",
            torrentNameTargetKey: "title",
            sizeAttr: "behaviorHints.videoSize",
            searchPattern: {
              movie: "movie/%imdbId",
              tv: "series/%imdbId:%season:%episode"
            },
            url: `${customStreamBase}/%searchPattern.json`
          },
          {
            name: "AIOStreams Bridge",
            type: "json_imdb",
            imdbType: "movie",
            itemType: "info_hash",
            infoHashTargetKey: "infoHash",
            jsonResultsKey: "streams",
            torrentNameTargetKey: "title",
            sizeAttr: "behaviorHints.videoSize",
            searchPattern: {
              movie: "movie/%imdbId",
              tv: "series/%imdbId:%season:%episode"
            },
            url: `${customStreamBase}/%searchPattern.json`
          }
        ];

        sendJson(res, 200, {
          id: configId,
          configUrl,
          debridConfig,
          config
        });
      } catch (error) {
        sendJson(res, 400, { error: "Invalid JSON payload", detail: String(error) });
      }
    });
    return;
  }

  // Get DebridStream config for a custom configuration
  if (pathname.startsWith("/config/") && pathname.endsWith(".json")) {
    const match = pathname.match(/^\/config\/([^/]+)\.json$/);
    if (match) {
      const [, configId] = match;
      const entry = configStore.get(configId);

      if (!entry) {
        sendJson(res, 404, { error: "Configuration not found" });
        return;
      }

      const config = entry.config;
      const baseUrl = getRequestBaseUrl(req);
      const customUrl = `${baseUrl}/custom/${configId}/stream`;

      const debridConfig = [
        {
          name: "AIOStreams Bridge",
          type: "json_imdb",
          imdbType: "tv",
          itemType: "info_hash",
          infoHashTargetKey: "infoHash",
          jsonResultsKey: "streams",
          torrentNameTargetKey: "title",
          sizeAttr: "behaviorHints.videoSize",
          searchPattern: {
            movie: "movie/%imdbId",
            tv: "series/%imdbId:%season:%episode"
          },
          url: `${customUrl}/%searchPattern.json`
        },
        {
          name: "AIOStreams Bridge",
          type: "json_imdb",
          imdbType: "movie",
          itemType: "info_hash",
          infoHashTargetKey: "infoHash",
          jsonResultsKey: "streams",
          torrentNameTargetKey: "title",
          sizeAttr: "behaviorHints.videoSize",
          searchPattern: {
            movie: "movie/%imdbId",
            tv: "series/%imdbId:%season:%episode"
          },
          url: `${customUrl}/%searchPattern.json`
        }
      ];

      sendJson(res, 200, debridConfig);
      return;
    }
  }

  // Debug: Show what upstream URL will be called
  if (pathname.startsWith("/custom/") && pathname.includes("/stream/") && pathname.endsWith(".json?debug=1")) {
    const match = pathname.match(/^\/custom\/([^/]+)\/stream\/(.+)(\?debug=1)?$/);
    if (match) {
      const [, configId, streamPath] = match;
      const entry = configStore.get(configId);

      if (!entry) {
        sendJson(res, 404, { error: "Configuration not found" });
        return;
      }

      const config = entry.config;
      const upstreamUrl = `${config.aioBase}/${streamPath}.json`;
      sendJson(res, 200, {
        configId,
        streamPath,
        aioBase: config.aioBase,
        upstreamUrl,
        config
      });
      return;
    }
  }

  // Custom stream endpoint: /custom/:configId/stream/*
  if (pathname.startsWith("/custom/") && pathname.includes("/stream/")) {
      const match = pathname.match(/^\/custom\/([^/]+)\/stream\/(.+)$/);
      if (match) {
      const [, configId, streamPath] = match;
      const entry = configStore.get(configId);

      if (!entry) {
        sendJson(res, 404, { 
          error: "Configuration not found",
          configId,
          availableConfigs: Array.from(configStore.keys())
        });
        return;
      }

      try {
        // Mark instance as accessed for metrics
        await markInstanceAccessed(configId);
        await handleStream(req, res, `/stream/${streamPath}`, entry.config, configId);
      } catch (error) {
        sendJson(res, 500, { error: "Handler error", detail: String(error) });
      }
      return;
    }
  }

  // Default stream endpoint: /stream/*
  if (pathname.startsWith("/stream/") && pathname.endsWith(".json")) {
    await handleStream(req, res, pathname);
    return;
  }

  sendJson(res, 404, {
    error: "Not found.",
    hint: "Use /stream/movie/<imdbId>.json or /stream/series/<imdbId>:<season>:<episode>.json or visit / for the config generator"
  });
});

server.listen(PORT, () => {
  console.log(`Bridge listening on http://localhost:${PORT}`);
});
