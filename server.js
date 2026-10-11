"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_JSON_BYTES = Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 16 * 1024;
const MAX_TEXT_LENGTH = 3000;
const rateLimits = new Map();
const STATIC_FILES = new Map([
    ["/sw.js", { file: "sw.js", contentType: "text/javascript; charset=utf-8", cacheControl: "no-cache" }],
    ["/manifest.webmanifest", { file: "manifest.webmanifest", contentType: "application/manifest+json; charset=utf-8", cacheControl: "public, max-age=3600" }],
    ["/icon.svg", { file: "icon.svg", contentType: "image/svg+xml", cacheControl: "public, max-age=3600" }],
    ["/images/image_92e6fca0.jpeg", { file: path.join("images", "image_92e6fca0.jpeg"), contentType: "image/jpeg", cacheControl: "public, max-age=3600" }],
    ["/images/image_7c4f34c7.jpg", { file: path.join("images", "image_7c4f34c7.jpg"), contentType: "image/jpeg", cacheControl: "public, max-age=3600" }]
]);

function loadLocalApiKey() {
    if (process.env.ELEVENLABS_API_KEY) {
        return;
    }

    const envPath = path.join(ROOT, ".env");
    if (!fs.existsSync(envPath)) {
        return;
    }

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*?)\s*$/);
        if (!match) {
            continue;
        }

        let value = match[1];
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env.ELEVENLABS_API_KEY = value;
        return;
    }
}

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    });
    response.end(JSON.stringify(body));
}

function readJson(request, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;

        request.on("data", (chunk) => {
            size += chunk.length;
            if (size > limit) {
                const error = new Error("Request body is too large.");
                error.statusCode = 413;
                reject(error);
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on("end", () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
                const error = new Error("Request body must be valid JSON.");
                error.statusCode = 400;
                reject(error);
            }
        });
        request.on("error", reject);
    });
}

function takeRateLimit(request, key, maxRequests) {
    const now = Date.now();
    const address = request.socket.remoteAddress || "local";
    const mapKey = `${address}:${key}`;
    const active = (rateLimits.get(mapKey) || []).filter((timestamp) => now - timestamp < 60_000);
    if (active.length >= maxRequests) {
        return false;
    }
    active.push(now);
    rateLimits.set(mapKey, active);
    return true;
}

function getApiKey() {
    if (process.env.NODE_ENV === "test") {
        return undefined;
    }
    loadLocalApiKey();
    return process.env.ELEVENLABS_API_KEY;
}

function hasAllowedOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) {
        return true;
    }
    try {
        const originUrl = new URL(origin);
        return originUrl.origin === `http://127.0.0.1:${PORT}` ||
            originUrl.origin === `http://localhost:${PORT}`;
    } catch {
        return false;
    }
}

function hasJsonContentType(request) {
    return typeof request.headers["content-type"] === "string" &&
        request.headers["content-type"].split(";")[0].trim().toLowerCase() === "application/json";
}

function requireApiKey(response) {
    const apiKey = getApiKey();
    if (!apiKey) {
        sendJson(response, 503, {
            error: "Add ELEVENLABS_API_KEY to a .env file in the project folder, then restart the app."
        });
        return null;
    }
    return apiKey;
}

async function parseProviderError(response) {
    if (response.ok) {
        return null;
    }
    return `ElevenLabs returned HTTP ${response.status}. Check your API key, account access, and audio or text input.`;
}

async function handleClone(request, response) {
    if (!hasJsonContentType(request)) {
        sendJson(response, 415, { error: "Send the voice sample as a JSON request." });
        return;
    }
    if (!takeRateLimit(request, "clone", 8)) {
        sendJson(response, 429, { error: "Too many voice-cloning requests. Please wait a minute and try again." });
        return;
    }

    const apiKey = requireApiKey(response);
    if (!apiKey) {
        return;
    }

    const body = await readJson(request, MAX_JSON_BYTES);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 60) {
        sendJson(response, 400, { error: "Enter a voice name between 1 and 60 characters." });
        return;
    }

    const supportedTypes = new Map([
        ["audio/webm", "webm"],
        ["audio/ogg", "ogg"],
        ["audio/wav", "wav"],
        ["audio/x-wav", "wav"],
        ["audio/mpeg", "mp3"],
        ["audio/mp3", "mp3"],
        ["audio/mp4", "m4a"],
        ["audio/aac", "aac"]
    ]);
    const mimeType = typeof body.mimeType === "string" ? body.mimeType.split(";")[0].toLowerCase() : "";
    const extension = supportedTypes.get(mimeType);
    if (!extension) {
        sendJson(response, 415, { error: "Use an MP3, WAV, M4A, AAC, OGG, or WebM audio recording." });
        return;
    }

    const encodedAudio = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
    if (!encodedAudio || encodedAudio.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 4 ||
        encodedAudio.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encodedAudio)) {
        sendJson(response, 400, { error: "The audio recording is missing or invalid." });
        return;
    }

    const audio = Buffer.from(encodedAudio, "base64");
    if (audio.length < 1024 || audio.length > MAX_AUDIO_BYTES) {
        sendJson(response, 400, { error: "The audio recording must be between 1 KB and 10 MB." });
        return;
    }

    const form = new FormData();
    form.append("name", name);
    form.append("files", new Blob([audio], { type: mimeType }), `voice-sample.${extension}`);

    const upstream = await fetch("https://api.elevenlabs.io/v1/voices/add", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
        signal: AbortSignal.timeout(90_000)
    });
    const providerError = await parseProviderError(upstream);
    if (providerError) {
        sendJson(response, 502, { error: providerError });
        return;
    }

    const result = await upstream.json();
    if (typeof result.voice_id !== "string" || !result.voice_id) {
        sendJson(response, 502, { error: "ElevenLabs did not return a voice ID. Please try again." });
        return;
    }
    sendJson(response, 200, {
        voiceId: result.voice_id,
        requiresVerification: Boolean(result.requires_verification)
    });
}

async function handleSpeak(request, response) {
    if (!hasJsonContentType(request)) {
        sendJson(response, 415, { error: "Send the speech request as JSON." });
        return;
    }
    if (!takeRateLimit(request, "speak", 30)) {
        sendJson(response, 429, { error: "Too many speech requests. Please wait a minute and try again." });
        return;
    }

    const apiKey = requireApiKey(response);
    if (!apiKey) {
        return;
    }

    const body = await readJson(request, 16 * 1024);
    const voiceId = typeof body.voiceId === "string" ? body.voiceId : "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(voiceId)) {
        sendJson(response, 400, { error: "A valid custom voice is required." });
        return;
    }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > MAX_TEXT_LENGTH) {
        sendJson(response, 400, { error: `Enter a message between 1 and ${MAX_TEXT_LENGTH} characters.` });
        return;
    }

    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg"
        },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
        signal: AbortSignal.timeout(90_000)
    });
    const providerError = await parseProviderError(upstream);
    if (providerError) {
        sendJson(response, 502, { error: providerError });
        return;
    }

    response.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    });
    response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function handleDeleteVoice(request, response, voiceId) {
    if (!takeRateLimit(request, "delete", 8)) {
        sendJson(response, 429, { error: "Too many requests. Please wait a minute and try again." });
        return;
    }

    const apiKey = requireApiKey(response);
    if (!apiKey) {
        return;
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(voiceId)) {
        sendJson(response, 400, { error: "Invalid voice ID." });
        return;
    }

    const upstream = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, {
        method: "DELETE",
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(30_000)
    });
    const providerError = await parseProviderError(upstream);
    if (providerError) {
        sendJson(response, 502, { error: providerError });
        return;
    }
    sendJson(response, 200, { deleted: true });
}

function sendPage(response) {
    const page = fs.readFileSync(path.join(ROOT, "index.html"));
    response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    });
    response.end(page);
}

const server = http.createServer(async (request, response) => {
    try {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname.startsWith("/api/") &&
            (request.method === "POST" || request.method === "DELETE") &&
            !hasAllowedOrigin(request)) {
            sendJson(response, 403, { error: "Requests to this local app must come from its own page." });
            return;
        }
        if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
            sendPage(response);
            return;
        }
        if (request.method === "GET" && STATIC_FILES.has(url.pathname)) {
            const asset = STATIC_FILES.get(url.pathname);
            const contents = fs.readFileSync(path.join(ROOT, asset.file));
            response.writeHead(200, {
                "Content-Type": asset.contentType,
                "Cache-Control": asset.cacheControl,
                "X-Content-Type-Options": "nosniff"
            });
            response.end(contents);
            return;
        }
        if (request.method === "POST" && url.pathname === "/api/clone") {
            await handleClone(request, response);
            return;
        }
        if (request.method === "POST" && url.pathname === "/api/speak") {
            await handleSpeak(request, response);
            return;
        }
        const deleteMatch = url.pathname.match(/^\/api\/voices\/([^/]+)$/);
        if (request.method === "DELETE" && deleteMatch) {
            await handleDeleteVoice(request, response, decodeURIComponent(deleteMatch[1]));
            return;
        }
        sendJson(response, 404, { error: "Not found." });
    } catch (error) {
        if (response.headersSent || response.destroyed) {
            return;
        }
        if (error.name === "TimeoutError" || error.name === "AbortError") {
            sendJson(response, 504, { error: "The request to ElevenLabs timed out. Please try again." });
            return;
        }
        if (error.statusCode) {
            sendJson(response, error.statusCode, { error: error.message });
            return;
        }
        console.error("Request failed:", error.message);
        sendJson(response, 502, { error: "The request could not be completed. Check your connection and try again." });
    }
});

if (require.main === module) {
    server.listen(PORT, "127.0.0.1", () => {
        console.log(`Open Voice is running at http://127.0.0.1:${PORT}`);
        if (!getApiKey()) {
            console.log("Add ELEVENLABS_API_KEY to .env to enable custom voice cloning and speech.");
        }
    });
}

module.exports = { server };
