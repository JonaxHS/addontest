import { createServer } from "node:http";

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

// Embedded HTML for config generator
const CONFIG_GENERATOR_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generador de Addon AIOStreams → DebridStream</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      max-width: 700px;
      width: 100%;
      padding: 40px;
    }

    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 28px;
    }

    .subtitle {
      color: #999;
      margin-bottom: 30px;
      font-size: 14px;
    }

    .form-group {
      margin-bottom: 25px;
    }

    label {
      display: block;
      color: #333;
      font-weight: 600;
      margin-bottom: 8px;
      font-size: 14px;
    }

    input[type="text"],
    input[type="number"],
    textarea {
      width: 100%;
      padding: 12px;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 14px;
      font-family: 'Courier New', monospace;
      transition: border-color 0.3s;
    }

    input[type="text"]:focus,
    input[type="number"]:focus,
    textarea:focus {
      outline: none;
      border-color: #667eea;
    }

    textarea {
      resize: vertical;
      min-height: 80px;
    }

    .checkbox-group {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }

    .checkbox-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
      accent-color: #667eea;
    }

    .checkbox-item label {
      margin: 0;
      font-weight: 500;
      cursor: pointer;
    }

    .help-text {
      font-size: 12px;
      color: #999;
      margin-top: 6px;
    }

    .button-group {
      display: flex;
      gap: 12px;
      margin-top: 30px;
    }

    button {
      flex: 1;
      padding: 14px;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
    }

    .btn-generate {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    .btn-generate:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
    }

    .btn-generate:active {
      transform: translateY(0);
    }

    .btn-reset {
      background: #f0f0f0;
      color: #333;
    }

    .btn-reset:hover {
      background: #e0e0e0;
    }

    .result-section {
      margin-top: 30px;
      padding-top: 30px;
      border-top: 2px solid #f0f0f0;
      display: none;
    }

    .result-section.show {
      display: block;
    }

    .result-title {
      color: #333;
      font-weight: 600;
      margin-bottom: 15px;
      font-size: 16px;
    }

    .result-box {
      background: #f8f8f8;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 15px;
      margin-bottom: 12px;
      word-break: break-all;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      max-height: 150px;
      overflow-y: auto;
    }

    .copy-btn {
      padding: 8px 16px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.3s;
    }

    .copy-btn:hover {
      background: #764ba2;
    }

    .copy-btn.copied {
      background: #4caf50;
    }

    .result-item {
      margin-bottom: 15px;
    }

    .result-label {
      color: #667eea;
      font-weight: 600;
      margin-bottom: 6px;
      font-size: 13px;
    }

    .qr-code {
      text-align: center;
      margin-top: 20px;
    }

    .qr-code img {
      max-width: 200px;
    }

    .error {
      background: #fee;
      color: #c00;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 20px;
      display: none;
    }

    .error.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎬 Generador de Addon</h1>
    <p class="subtitle">AIOStreams → DebridStream Bridge Personalizado</p>

    <div class="error" id="error"></div>

    <form id="configForm">
      <div class="form-group">
        <label for="aioLink">Link de AIOStreams</label>
        <textarea id="aioLink" placeholder="https://aiostream.axonim.lat/stremio/..." required></textarea>
        <div class="help-text">Pega tu link completo de AIOStreams aquí</div>
      </div>

      <div class="form-group">
        <label>Preferencias de Idioma</label>
        <div class="checkbox-group">
          <div class="checkbox-item">
            <input type="checkbox" id="preferLatino" checked>
            <label for="preferLatino">Preferir Latino</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" id="latinoOnly">
            <label for="latinoOnly">Solo Latino</label>
          </div>
        </div>
        <div class="help-text">Marca "Solo Latino" si deseas excluir streams que no sean en español</div>
      </div>

      <div class="form-group">
        <label for="markers">Marcadores de Latino</label>
        <input type="text" id="markers" value="latino,lat,castellano,espanol,español" required>
        <div class="help-text">Palabras clave separadas por comas para detectar streams en español</div>
      </div>

      <div class="form-group">
        <label for="maxStreams">Máximo de Resultados</label>
        <input type="number" id="maxStreams" value="8" min="0">
        <div class="help-text">Limite de streams a mostrar (0 = sin límite)</div>
      </div>

      <div class="button-group">
        <button type="submit" class="btn-generate">Generar Addon</button>
        <button type="reset" class="btn-reset">Limpiar</button>
      </div>
    </form>

    <div class="result-section" id="resultSection">
      <div class="result-title">✅ Tu Addon Generado</div>

      <div class="result-item">
        <div class="result-label">ID del Addon:</div>
        <div class="result-box" id="addonId"></div>
        <button class="copy-btn" onclick="copyToClipboard('addonId')">Copiar ID</button>
      </div>

      <div class="result-item">
        <div class="result-label">URL para DebridStream (configUrl):</div>
        <div class="result-box" id="configUrl"></div>
        <button class="copy-btn" onclick="copyToClipboard('configUrl')">Copiar URL</button>
      </div>

      <div class="result-item">
        <div class="result-label">Configuración JSON para DebridStream:</div>
        <div class="result-box" id="configJson" style="max-height: 300px;"></div>
        <button class="copy-btn" onclick="copyToClipboard('configJson')">Copiar JSON</button>
        <button class="copy-btn" onclick="downloadConfig()" style="margin-left: 8px;">Descargar</button>
      </div>

      <div class="qr-code">
        <div class="result-label">Código QR de la URL:</div>
        <img id="qrCode" src="" alt="QR Code">
      </div>
    </div>
  </div>

  <script>
    const form = document.getElementById('configForm');
    const resultSection = document.getElementById('resultSection');
    const errorBox = document.getElementById('error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.classList.remove('show');

      const aioLink = document.getElementById('aioLink').value.trim();
      const preferLatino = document.getElementById('preferLatino').checked;
      const latinoOnly = document.getElementById('latinoOnly').checked;
      const markers = document.getElementById('markers').value.trim();
      const maxStreams = parseInt(document.getElementById('maxStreams').value) || 0;

      if (!aioLink) {
        showError('Por favor pega tu link de AIOStreams');
        return;
      }

      if (!markers) {
        showError('Debes especificar al menos un marcador de idioma');
        return;
      }

      try {
        const response = await fetch('/api/generate-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aioLink,
            preferLatino,
            latinoOnly,
            markers,
            maxStreams
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Error generando addon');
        }

        const data = await response.json();
        displayResults(data);
      } catch (error) {
        showError(error.message);
      }
    });

    function displayResults(data) {
      document.getElementById('addonId').innerText = data.id;
      document.getElementById('configUrl').innerText = data.configUrl;
      document.getElementById('configJson').innerText = JSON.stringify(data.debridConfig, null, 2);

      // Generate QR code
      const qrUrl = \`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=\${encodeURIComponent(data.configUrl)}\`;
      document.getElementById('qrCode').src = qrUrl;

      resultSection.classList.add('show');
      resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function copyToClipboard(elementId) {
      const element = document.getElementById(elementId);
      const text = element.innerText;
      navigator.clipboard.writeText(text).then(() => {
        const btn = event.target;
        const originalText = btn.innerText;
        btn.innerText = '✓ Copiado!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerText = originalText;
          btn.classList.remove('copied');
        }, 2000);
      });
    }

    function downloadConfig() {
      const element = document.getElementById('configJson');
      const text = element.innerText;
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'debrid-config.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function showError(message) {
      errorBox.innerText = message;
      errorBox.classList.add('show');
      errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  </script>
</body>
</html>`;

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
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(CONFIG_GENERATOR_HTML);
    return;
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
        sendJson(res, 400, { error: "Invalid JSON payload" });
      }
    });
    return;
  }

  // Get DebridStream config for a custom configuration
  if (pathname.startsWith("/config/") && pathname.endsWith(".json")) {
    const match = pathname.match(/^\/config\/([^/]+)\.json$/);
    if (match) {
      const [, configId] = match;
      const config = configStore.get(configId);

      if (!config) {
        sendJson(res, 404, { error: "Configuration not found" });
        return;
      }

      const baseUrl = `http://${req.headers.host || "localhost"}`;
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
