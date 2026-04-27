import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

// In-memory store for generated configurations
const configStore = new Map();

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
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
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
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

async function handleStream(req, res, pathname, config) {
  const cfg = config || {
    aioBase: AIO_BASE,
    preferLatino: PREFER_LATINO,
    latinoOnly: LATINO_ONLY,
    maxStreams: MAX_STREAMS,
    latinoMarkers: LATINO_MARKERS
  };

  const searchPattern = pathname.slice("/stream/".length, -".json".length);
  if (!searchPattern) {
    sendJson(res, 400, { error: "Missing search pattern." });
    return;
  }

  const upstreamUrl = `${cfg.aioBase}/${searchPattern}.json`;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl, { headers: { accept: "application/json" } });
  } catch (error) {
    sendJson(res, 502, {
      error: "Failed to fetch upstream AIOStreams endpoint.",
      detail: String(error)
    });
    return;
  }

  if (!upstreamResponse.ok) {
    sendJson(res, 502, {
      error: "Upstream returned non-OK status.",
      status: upstreamResponse.status
    });
    return;
  }

  let payload;
  try {
    payload = await upstreamResponse.json();
  } catch {
    sendJson(res, 502, { error: "Upstream did not return valid JSON." });
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
    const filename = upstreamLabel;
    const bingeGroup = typeof stream?.behaviorHints?.bingeGroup === "string" ? stream.behaviorHints.bingeGroup : `${provider}|${qualityLine}`;
    const fileIdx = Number.isInteger(stream?.fileIdx) ? stream.fileIdx : 0;
    const videoSize = Number(stream?.behaviorHints?.videoSize || 0);

    converted.push({
      name: `${provider}\n${qualityLine}`,
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

  let output = converted;

  if (cfg.preferLatino && converted.length > 0) {
    const preferred = [];
    const others = [];

    for (const item of converted) {
      if (hasPreferredLatino(item, cfg.latinoMarkers)) preferred.push(item);
      else others.push(item);
    }

    if (preferred.length > 0) {
      output = cfg.latinoOnly ? preferred : [...preferred, ...others];
    }
  }

  if (cfg.maxStreams > 0) {
    output = output.slice(0, cfg.maxStreams);
  }

  sendJson(res, 200, { streams: output, count: output.length, upstreamUrl });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const method = req.method;

  // Serve HTML config generator at root
  if (pathname === "/" && method === "GET") {
    try {
      const html = readFileSync(join(__dirname, "config-generator.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    } catch (error) {
      sendJson(res, 500, { error: "Could not load config generator", detail: String(error) });
      return;
    }
  }

  // Health endpoint
  if (pathname === "/health" && method === "GET") {
    sendJson(res, 200, { ok: true, service: "aiostreams-debrid-bridge" });
    return;
  }

  // API: Generate custom configuration
  if (pathname === "/api/generate-config" && method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const { aioLink, preferLatino, latinoOnly, markers, maxStreams } = payload;

        if (!aioLink || !markers) {
          sendJson(res, 400, { error: "aioLink and markers are required" });
          return;
        }

        const configId = generateConfigId();
        const markerList = markers.split(",").map((m) => m.trim()).filter(Boolean);

        const config = {
          aioBase: aioLink,
          preferLatino: preferLatino !== false,
          latinoOnly: latinoOnly === true,
          maxStreams: parseInt(maxStreams) || 0,
          latinoMarkers: markerList
        };

        configStore.set(configId, config);

        const baseUrl = `http://${req.headers.host || "localhost"}`;
        const customUrl = `${baseUrl}/custom/${configId}/stream/%searchPattern.json`;

        sendJson(res, 200, {
          id: configId,
          url: customUrl,
          config
        });
      } catch (error) {
        sendJson(res, 400, { error: "Invalid JSON payload" });
      }
    });
    return;
  }

  // Custom stream endpoint: /custom/:configId/stream/*
  if (pathname.startsWith("/custom/") && pathname.includes("/stream/")) {
    const match = pathname.match(/^\/custom\/([^/]+)\/stream\/(.+)$/);
    if (match) {
      const [, configId, streamPath] = match;
      const config = configStore.get(configId);

      if (!config) {
        sendJson(res, 404, { error: "Configuration not found" });
        return;
      }

      await handleStream(req, res, `/stream/${streamPath}`, config);
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
