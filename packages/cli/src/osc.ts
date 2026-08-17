/**
 * Minimal OSC-over-UDP client for the M4L capture tap (m4l/README.md).
 * Hand-rolled: we send a handful of simple messages on localhost — no
 * dependency warranted. Integers encode as 'i', other numbers as 'f',
 * strings as 's'.
 */
import { createSocket } from "node:dgram";

function padTo4(buf: Buffer): Buffer {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}

function oscString(text: string): Buffer {
  // OSC strings are null-terminated, padded to a 4-byte boundary.
  return padTo4(Buffer.concat([Buffer.from(text, "ascii"), Buffer.alloc(1)]));
}

export function encodeOscMessage(address: string, args: (string | number)[]): Buffer {
  const typeTags = args
    .map((a) => (typeof a === "string" ? "s" : Number.isInteger(a) ? "i" : "f"))
    .join("");
  const parts: Buffer[] = [oscString(address), oscString(`,${typeTags}`)];
  for (const arg of args) {
    if (typeof arg === "string") {
      parts.push(oscString(arg));
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

export const TAP_PORT = 9720;

export async function sendToTap(
  address: string,
  args: (string | number)[] = [],
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
