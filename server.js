import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8787);
const AIO_BASE =
  process.env.AIO_BASE ||
  "https://aiostream.axonim.lat/stremio/35099f5e-fd8c-488f-a701-2bd66af59ead/eyJpIjoiT3ExWVFONXE1alQ3MVVvaEVKNU5CZz09IiwiZSI6IkpGYWxsWGtjZDVCUndTRDdNWlVlOUJpRnE0UzQwOEpvZEljaTFFUDQwOU09IiwidCI6ImEifQ/stream";

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

async function handleStream(req, res, pathname) {
  const searchPattern = pathname.slice("/stream/".length, -".json".length);
  if (!searchPattern) {
    sendJson(res, 400, { error: "Missing search pattern." });
    return;
  }

  const upstreamUrl = `${AIO_BASE}/${searchPattern}.json`;

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
    const provider = parseProvider(stream);
    const qualityLine = parseQualityLine(stream);
    const filename = typeof stream?.behaviorHints?.filename === "string" ? stream.behaviorHints.filename : "";
    const bingeGroup = typeof stream?.behaviorHints?.bingeGroup === "string" ? stream.behaviorHints.bingeGroup : `${provider}|${qualityLine}`;
    const fileIdx = Number.isInteger(stream?.fileIdx) ? stream.fileIdx : 0;
    const videoSize = Number(stream?.behaviorHints?.videoSize || 0);

    converted.push({
      name: normalizeName(stream, `AIOStreams ${searchPattern}`),
      title: buildTitle(stream, provider),
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

  sendJson(res, 200, { streams: converted, count: converted.length, upstreamUrl });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "aiostreams-debrid-bridge" });
    return;
  }

  if (pathname.startsWith("/stream/") && pathname.endsWith(".json")) {
    await handleStream(req, res, pathname);
    return;
  }

  sendJson(res, 404, {
    error: "Not found.",
    hint: "Use /stream/movie/<imdbId>.json or /stream/series/<imdbId>:<season>:<episode>.json"
  });
});

server.listen(PORT, () => {
  console.log(`Bridge listening on http://localhost:${PORT}`);
});
