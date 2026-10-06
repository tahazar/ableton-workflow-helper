import { afterEach, describe, expect, it } from "vitest";
import { FakeLiveBridge } from "../src/fake/fakeLiveBridge.js";
import { createGatewayServer, type GatewayServer } from "../src/bridge/server.js";

let server: GatewayServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function startServer(): Promise<string> {
  server = createGatewayServer(new FakeLiveBridge(), { port: 0 });
  const port = await server.start();
  return `http://127.0.0.1:${port}`;
}

describe("gateway server", () => {
  it("answers /ping with bridge identity", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/ping`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe("awh-gateway");
    expect(body.bridge.kind).toBe("fake");
    expect(typeof body.uptimeMs).toBe("number");
  });

  it("lists registered ops", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/api/ops`);
    const body = await res.json();
    const names = body.ops.map((o: { name: string }) => o.name);
    expect(names).toContain("ping");
    expect(names).toContain("set.summary");
  });

  it("invokes set.summary and returns fake set state", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/api/ops/set.summary`, { method: "POST" });
    const body = await res.json();
    expect(body.result.tempo).toBe(128);
    expect(body.result.trackCount).toBe(4);
    expect(body.result.tracks).toHaveLength(4);
  });

  it("runs a full write-then-read cycle over HTTP (M1 exit criterion)", async () => {
    const base = await startServer();
    const create = await fetch(`${base}/api/ops/clip.create-midi`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: { type: "arrangement", trackPath: "track:0", startBeat: 128 },
        lengthBeats: 4,
        notes: [{ pitch: 60, start: 0, duration: 1 }],
      }),
    });
    expect(create.status).toBe(200);
    const { result } = await create.json();

    const read = await fetch(`${base}/api/ops/clip.get`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: result.path }),
    });
    const clip = (await read.json()).result;
    expect(clip.startTime).toBe(128);
    expect(clip.notes).toHaveLength(1);
  });

  it("maps bridge errors to HTTP statuses", async () => {
    const base = await startServer();
    const notFound = await fetch(`${base}/api/ops/clip.get`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "track:99/slot:0" }),
    });
    expect(notFound.status).toBe(404);
    const badRequest = await fetch(`${base}/api/ops/clip.get`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "garbage" }),
    });
    expect(badRequest.status).toBe(400);
  });

  it("404s unknown ops", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/api/ops/nope`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("rejects non-localhost origins (CSRF guard)", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/ping`, {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("400s invalid JSON bodies", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/api/ops/set.summary`, {
      method: "POST",
      body: "{not json",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});
