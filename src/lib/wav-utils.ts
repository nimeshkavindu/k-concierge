const PCM16_BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;

export function pcm16Base64ChunksToWavBase64(
  chunks: string[],
  sampleRate = 16_000,
): string {
  const pcmBytes = chunks.map(base64ToBytes);
  const dataLength = pcmBytes.reduce((total, bytes) => total + bytes.byteLength, 0);
  const wavBytes = new Uint8Array(WAV_HEADER_BYTES + dataLength);
  const view = new DataView(wavBytes.buffer);

  writeAscii(wavBytes, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(wavBytes, 8, "WAVE");
  writeAscii(wavBytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * PCM16_BYTES_PER_SAMPLE, true);
  view.setUint16(32, PCM16_BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  writeAscii(wavBytes, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = WAV_HEADER_BYTES;
  for (const bytes of pcmBytes) {
    wavBytes.set(bytes, offset);
    offset += bytes.byteLength;
  }

  return bytesToBase64(wavBytes);
}

export function getPcm16Base64DurationMs(
  chunks: string[],
  sampleRate = 16_000,
): number {
  const byteLength = chunks.reduce(
    (total, chunk) => total + base64ToBytes(chunk).byteLength,
    0,
  );
  const samples = byteLength / PCM16_BYTES_PER_SAMPLE;
  return Math.round((samples / sampleRate) * 1000);
}

export function isSilentPcm16Base64(
  chunks: string[],
  amplitudeThreshold = 96,
): boolean {
  if (chunks.length === 0) return true;

  let totalSamples = 0;
  let loudSamples = 0;

  for (const chunk of chunks) {
    const bytes = base64ToBytes(chunk);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset + 1 < bytes.byteLength; offset += 2) {
      totalSamples += 1;
      if (Math.abs(view.getInt16(offset, true)) > amplitudeThreshold) {
        loudSamples += 1;
      }
    }
  }

  return totalSamples === 0 || loudSamples / totalSamples < 0.01;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  const buffer = getBuffer().from(base64, "base64");
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === "function") {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return globalThis.btoa(binary);
  }

  return getBuffer().from(bytes).toString("base64");
}

function getBuffer(): typeof Buffer {
  const candidate = (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer;
  if (!candidate) {
    throw new Error("Base64 conversion is unavailable in this runtime.");
  }
  return candidate;
}
