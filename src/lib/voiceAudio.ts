export function mergeTranscriptChunk(current: string, incoming: string): string {
  const next = incoming.trim();
  if (!next) return current.trim();
  const previous = current.trim();
  if (!previous) return next;
  if (next.startsWith(previous)) return next;
  if (previous.endsWith(next)) return previous;
  return `${previous} ${next}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  }
  return btoa(binary);
}

export function pcm16BufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

export function float32ToPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytesToBase64(bytes);
}

export function downsampleAudio(input: Float32Array, inputRate: number, outputRate = 16000): Float32Array {
  if (inputRate <= outputRate) return input.slice();
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let total = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) total += input[sourceIndex];
    output[index] = total / Math.max(1, end - start);
  }
  return output;
}

export function base64Pcm16ToFloat32(data: string): Float32Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const view = new DataView(bytes.buffer);
  const output = new Float32Array(Math.floor(bytes.length / 2));
  for (let index = 0; index < output.length; index += 1) {
    const value = view.getInt16(index * 2, true);
    output[index] = value / (value < 0 ? 0x8000 : 0x7fff);
  }
  return output;
}

export function audioSampleRate(mimeType: string | undefined, fallback = 24000): number {
  const match = mimeType?.match(/(?:rate|sample-rate)=(\d+)/i);
  const parsed = match ? Number(match[1]) : fallback;
  return Number.isFinite(parsed) && parsed >= 8000 && parsed <= 192000 ? parsed : fallback;
}

export function analyserLevel(analyser: AnalyserNode | null, buffer: Uint8Array<ArrayBuffer>): number {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(buffer);
  let squares = 0;
  for (const value of buffer) {
    const centered = (value - 128) / 128;
    squares += centered * centered;
  }
  return Math.min(1, Math.sqrt(squares / buffer.length) * 4);
}
