/**
 * Pure-TS WAV (RIFF/PCM) reading and writing for the endless player
 * (`awh endless`). `awh endless build` needs each pool file's exact duration
 * (bar-exact loops, checked to +-25ms against bars*4*60/bpm; see spec.ts),
 * and `awh endless demo` synthesizes tiny WAV files. Both are direct chunk
 * math, so no audio library is needed (docs/design/endless-player.md: "RIFF
 * fmt/data chunk math"). Zero dependencies is a hard constraint for the
 * player, and this keeps the whole `endless` feature dependency-free.
 */

export interface WavInfo {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  audioFormat: number;
  durationSeconds: number;
}

/**
 * Parse a WAV file's `fmt ` and `data` chunks (generic chunk walk, so extra
 * chunks like LIST/JUNK/fact don't confuse it) and compute its duration.
 * Throws a clear, non-WAV-specific message for anything that isn't a
 * RIFF/WAVE file (v1 doesn't support other formats; see design doc).
 */
export function parseWavHeader(buf: Buffer): WavInfo {
  if (
    buf.length < 12 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("not a WAV file (missing RIFF/WAVE header) — v1 only supports PCM WAV audio");
  }
  let offset = 12;
  let fmt:
    | { audioFormat: number; numChannels: number; sampleRate: number; bitsPerSample: number }
    | undefined;
  let dataLength: number | undefined;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= buf.length) {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        numChannels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      dataLength = Math.min(size, buf.length - body);
    }
    offset = body + size + (size % 2); // chunks are word-aligned; odd sizes get a pad byte
  }
  if (!fmt) throw new Error('WAV file has no "fmt " chunk — cannot determine sample rate/channels');
  if (dataLength === undefined)
    throw new Error('WAV file has no "data" chunk — cannot determine duration');
  if (fmt.sampleRate <= 0 || fmt.numChannels <= 0 || fmt.bitsPerSample <= 0) {
    throw new Error("WAV file's fmt chunk has an invalid sample rate/channels/bit depth");
  }
  const bytesPerSample = fmt.bitsPerSample / 8;
  const durationSeconds = dataLength / (fmt.sampleRate * fmt.numChannels * bytesPerSample);
  return {
    sampleRate: fmt.sampleRate,
    numChannels: fmt.numChannels,
    bitsPerSample: fmt.bitsPerSample,
    audioFormat: fmt.audioFormat,
    durationSeconds,
  };
}

/** Write a mono or interleaved-multichannel 16-bit PCM WAV file from a flat
 * Int16Array of samples (interleaved if numChannels > 1). */
export function writeWavPcm16(samples: Int16Array, sampleRate: number, numChannels = 1): Buffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size (PCM)
  buf.writeUInt16LE(1, 20); // audio format: PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // byte rate
  buf.writeUInt16LE(numChannels * bytesPerSample, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i] ?? 0, 44 + i * 2);
  }
  return buf;
}

/** Expected duration (seconds) of a bar-exact loop: v1 is 4/4 only. */
export function expectedLoopDurationSeconds(bars: number, bpm: number): number {
  return (bars * 4 * 60) / bpm;
}
