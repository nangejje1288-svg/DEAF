"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { after, before, test } = require("node:test");

const projectRoot = __dirname;
let serverProcess;
let baseUrl;

async function getOpenPort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            probe.close((error) => error ? reject(error) : resolve(address.port));
        });
    });
}

async function waitForServer(url) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return;
            }
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
    throw new Error("Local server did not start in time.");
}

before(async () => {
    const port = await getOpenPort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = spawn(process.execPath, [path.join(projectRoot, "server.js")], {
        cwd: projectRoot,
        env: { ...process.env, NODE_ENV: "test", PORT: String(port), ELEVENLABS_API_KEY: "" },
        stdio: "ignore"
    });
    await waitForServer(baseUrl);
});

after(() => {
    if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill();
    }
});

test("serves the communication app with the custom voice setup", async () => {
    const response = await fetch(baseUrl);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(html, /Set up my voice/);
    assert.match(html, /Create my voice/);
    assert.match(html, /Signboard/);
    assert.match(html, /Silent emergency message/);
    assert.match(html, /On-device only/);
    assert.match(html, /cannot identify or reliably detect/);
});

test("serves the background photo from the images folder", async () => {
    const response = await fetch(`${baseUrl}/images/image_92e6fca0.jpeg`);
    const image = await response.arrayBuffer();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /image\/jpeg/);
    assert.ok(image.byteLength > 0);
});

test("serves offline app assets", async () => {
    const [workerResponse, manifestResponse, iconResponse, secondImageResponse] = await Promise.all([
        fetch(`${baseUrl}/sw.js`),
        fetch(`${baseUrl}/manifest.webmanifest`),
        fetch(`${baseUrl}/icon.svg`),
        fetch(`${baseUrl}/images/image_7c4f34c7.jpg`)
    ]);
    assert.equal(workerResponse.status, 200);
    assert.match(workerResponse.headers.get("content-type"), /javascript/);
    assert.match(await workerResponse.text(), /sharine-static-v1/);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get("content-type"), /manifest\+json/);
    assert.equal(iconResponse.status, 200);
    assert.match(iconResponse.headers.get("content-type"), /image\/svg\+xml/);
    assert.equal(secondImageResponse.status, 200);
});

test("keeps the provider key server-side and reports missing configuration", async () => {
    const response = await fetch(`${baseUrl}/api/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: "exampleVoiceId", text: "Hello." })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.match(body.error, /ELEVENLABS_API_KEY/);
});

test("rejects cross-origin requests to local API endpoints", async () => {
    const response = await fetch(`${baseUrl}/api/speak`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Origin": "https://untrusted.example"
        },
        body: JSON.stringify({ voiceId: "exampleVoiceId", text: "Hello." })
    });
    assert.equal(response.status, 403);
});

test("does not serve unknown paths", async () => {
    const response = await fetch(`${baseUrl}/server.js`);
    assert.equal(response.status, 404);
});
