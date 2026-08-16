import http from "node:http";
import { URL } from "node:url";
import { BridgeError, type LiveBridge } from "./types.js";

export const DEFAULT_GATEWAY_PORT = 8720;

export interface GatewayOptions {
  port?: number;
  /** Loopback only — never expose the gateway beyond the local machine. */
  host?: "127.0.0.1";
}

export interface OpContext {
  bridge: LiveBridge;
}

export type OpHandler = (args: unknown, ctx: OpContext) => Promise<unknown>;

export interface OpDefinition {
  name: string;
  description: string;
  handler: OpHandler;
}

/**
 * Deterministic operation registry. One op = one logical, undoable action
 * (M1 maps each mutating op to a single SDK transaction). Ops are the unit
 * both the CLI and any LLM invoke — same surface, no special AI path.
 */
export function buildOpRegistry(): Map<string, OpDefinition> {
  const ops = new Map<string, OpDefinition>();
  const add = (op: OpDefinition) => ops.set(op.name, op);

  add({
    name: "ping",
    description: "Gateway liveness + bridge identity",
    handler: async (_args, ctx) => ({
      service: "awh-gateway",
      bridge: await ctx.bridge.describe(),
    }),
  });

  add({
    name: "set.summary",
    description: "Compact summary of the open Live Set",
    handler: async (_args, ctx) => ctx.bridge.getSetSummary(),
  });

  return ops;
}

export interface GatewayServer {
  start(): Promise<number>;
  stop(): Promise<void>;
  readonly port: number | undefined;
}

/**
 * Plain node:http server (no framework — this must bundle cleanly into the
 * extension). Routes:
 *   GET  /ping               → ping op
 *   GET  /api/ops            → list registered ops
 *   POST /api/ops/{name}     → invoke op with JSON body as args
 *
 * Security posture (M0): bind loopback only and reject any request carrying a
 * non-localhost Origin header (blocks drive-by browser CSRF). M1 adds the
 * token handshake via the extension storage directory (loophole pattern).
 */
export function createGatewayServer(
  bridge: LiveBridge,
  options: GatewayOptions = {},
): GatewayServer {
  const port = options.port ?? DEFAULT_GATEWAY_PORT;
  const host = options.host ?? "127.0.0.1";
  const ops = buildOpRegistry();
  const startedAt = Date.now();

  let server: http.Server | undefined;
  let boundPort: number | undefined;

  const handler = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return sendJson(res, 403, { error: "forbidden_origin" });
    }

    const url = new URL(req.url ?? "/", `http://${host}`);

    try {
      if (req.method === "GET" && url.pathname === "/ping") {
        const result = await ops.get("ping")!.handler(undefined, { bridge });
        return sendJson(res, 200, {
          ...(result as object),
          uptimeMs: Date.now() - startedAt,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/ops") {
        return sendJson(res, 200, {
          ops: [...ops.values()].map(({ name, description }) => ({
            name,
            description,
          })),
        });
      }

      const opMatch = url.pathname.match(/^\/api\/ops\/([\w.-]+)$/);
      if (req.method === "POST" && opMatch) {
        const op = ops.get(opMatch[1]!);
        if (!op) {
          return sendJson(res, 404, { error: "unknown_op", op: opMatch[1] });
        }
        const args = await readJsonBody(req);
        const result = await op.handler(args, { bridge });
        return sendJson(res, 200, { result });
      }

      return sendJson(res, 404, { error: "not_found" });
    } catch (err) {
      if (err instanceof BridgeError) {
        const status =
          err.code === "not_found"
            ? 404
            : err.code === "bad_request"
              ? 400
              : err.code === "unavailable"
                ? 503
                : 500;
        return sendJson(res, status, { error: err.code, message: err.message });
      }
      return sendJson(res, 500, {
        error: "internal",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return {
    get port() {
      return boundPort;
    },
    start(): Promise<number> {
      return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          void handler(req, res);
        });
        server.once("error", reject);
        server.listen(port, host, () => {
          const address = server!.address();
          const actual =
            typeof address === "object" && address ? address.port : port;
          boundPort = actual;
          resolve(actual);
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!server) return resolve();
        server.close((err) => (err ? reject(err) : resolve()));
        server = undefined;
      });
    },
  };
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (Buffer.concat(chunks).length > 5_000_000) {
      throw new BridgeError("bad_request", "request body too large");
    }
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new BridgeError("bad_request", "request body is not valid JSON");
  }
}
