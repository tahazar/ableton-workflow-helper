/**
 * Minimal OSC-over-UDP client for the M4L capture tap and Ducker
 * (m4l/README.md). Hand-rolled: we send/receive a handful of simple
 * messages on localhost — no dependency warranted. Plain JS numbers encode
 * as 'i' when they're whole numbers, 'f' otherwise; strings as 's'. Wrap a
 * whole-number arg in `oscFloat()` to force the 'f' tag (the Ducker
 * protocol calls for floats even at values like `0.0` or `4.0` — see
 * m4l/README.md's protocol table).
 */
import { createSocket } from "node:dgram";

export interface OscForcedFloat {
  readonly oscFloat: number;
}

/** Force a number to encode as OSC float ('f') even if it's a whole number. */
export function oscFloat(value: number): OscForcedFloat {
  return { oscFloat: value };
}

function isForcedFloat(a: unknown): a is OscForcedFloat {
  return typeof a === "object" && a !== null && "oscFloat" in a;
}

export type OscArg = string | number | OscForcedFloat;

function padTo4(buf: Buffer): Buffer {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}

function oscString(text: string): Buffer {
  // OSC strings are null-terminated, padded to a 4-byte boundary.
  return padTo4(Buffer.concat([Buffer.from(text, "ascii"), Buffer.alloc(1)]));
}

export function encodeOscMessage(address: string, args: OscArg[]): Buffer {
  const typeTags = args
    .map((a) =>
      typeof a === "string" ? "s" : isForcedFloat(a) ? "f" : Number.isInteger(a) ? "i" : "f",
    )
    .join("");
  const parts: Buffer[] = [oscString(address), oscString(`,${typeTags}`)];
  for (const arg of args) {
    if (typeof arg === "string") {
      parts.push(oscString(arg));
    } else if (isForcedFloat(arg)) {
      const b = Buffer.alloc(4);
      b.writeFloatBE(arg.oscFloat);
      parts.push(b);
    } else if (Number.isInteger(arg)) {
      const b = Buffer.alloc(4);
      b.writeInt32BE(arg);
      parts.push(b);
    } else {
      const b = Buffer.alloc(4);
      b.writeFloatBE(arg);
      parts.push(b);
    }
  }
  return Buffer.concat(parts);
}

/** Decode one OSC message (address + typed args) from a UDP datagram. */
export function decodeOscMessage(buf: Buffer): { address: string; args: (string | number)[] } {
  let offset = 0;
  function readString(): string {
    const end = buf.indexOf(0, offset);
    const str = buf.toString("ascii", offset, end === -1 ? buf.length : end);
    const len = (end === -1 ? buf.length : end) - offset;
    offset += Math.ceil((len + 1) / 4) * 4;
    return str;
  }
  const address = readString();
  const typeTags = readString();
  const args: (string | number)[] = [];
  for (const tag of typeTags.slice(1)) {
    if (tag === "i") {
      args.push(buf.readInt32BE(offset));
      offset += 4;
    } else if (tag === "f") {
      args.push(buf.readFloatBE(offset));
      offset += 4;
    } else if (tag === "s") {
      args.push(readString());
    }
  }
  return { address, args };
}

export const TAP_PORT = 9720;

export async function sendToTap(
  address: string,
  args: OscArg[] = [],
  port = TAP_PORT,
): Promise<void> {
  const socket = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.send(encodeOscMessage(address, args), port, "127.0.0.1", (err) =>
        err ? reject(err) : resolve(),
      );
    });
  } finally {
    socket.close();
  }
}

/**
 * Send one OSC message and wait for a specific reply address on a bound
 * UDP port (used by `mix duck push` to confirm the Ducker device is loaded
 * before pushing an envelope — see duck.ts). Binds `replyPort`, sends from
 * that same socket, and resolves with the reply's args, or rejects if
 * `timeoutMs` elapses first. The socket is always closed before returning
 * so the process can exit — mirrors sendToTap's close-in-finally discipline.
 */
export async function sendAndAwaitReply(params: {
  address: string;
  args?: OscArg[];
  sendPort: number;
  replyPort: number;
  matchAddress: string;
  timeoutMs?: number;
}): Promise<(string | number)[]> {
  const reply = await sendAndAwaitAnyReply({ ...params, matchAddresses: [params.matchAddress] });
  return reply.args;
}

/**
 * Like `sendAndAwaitReply`, but resolves on the FIRST reply whose address is
 * any of `matchAddresses` (also returning which one matched) — used by
 * remote.ts, where a single sent command (e.g. `/awh/fire`) can come back as
 * either `/awh/status` (success) or `/awh/error` (bad indices), and the
 * caller needs to tell those apart.
 */
export async function sendAndAwaitAnyReply(params: {
  address: string;
  args?: OscArg[];
  sendPort: number;
  replyPort: number;
  matchAddresses: string[];
  timeoutMs?: number;
}): Promise<{ address: string; args: (string | number)[] }> {
  const { address, args = [], sendPort, replyPort, matchAddresses, timeoutMs = 1000 } = params;
  const socket = createSocket("udp4");
  try {
    return await new Promise<{ address: string; args: (string | number)[] }>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `no reply to ${address} (expected ${matchAddresses.join(" or ")} on port ${replyPort}) ` +
              `within ${timeoutMs} ms`,
          ),
        );
      }, timeoutMs);
      socket.on("message", (msg) => {
        const decoded = decodeOscMessage(msg);
        if (matchAddresses.includes(decoded.address)) {
          clearTimeout(timer);
          resolve(decoded);
        }
      });
      socket.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.bind(replyPort, "127.0.0.1", () => {
        socket.send(encodeOscMessage(address, args), sendPort, "127.0.0.1", (err) => {
          if (err) {
            clearTimeout(timer);
            reject(err);
          }
        });
      });
    });
  } finally {
    socket.close();
  }
}
