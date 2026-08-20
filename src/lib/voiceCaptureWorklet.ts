export const VOICE_CAPTURE_PROCESSOR_NAME = "exepts-voice-capture";
export const VOICE_CAPTURE_TARGET_RATE = 16000;

// 512 samples at 16 kHz is one 32 ms packet, which keeps end-of-speech detection
// responsive without posting to the main thread more often than necessary.
export const VOICE_CAPTURE_CHUNK_SAMPLES = 512;

/**
 * Runs on the audio rendering thread, so microphone frames keep being captured,
 * downsampled to 16 kHz and converted to PCM16 even while the main thread is busy
 * rendering. Only the finished packet crosses back to the main thread.
 *
 * Downsampling uses the same floor-window averaging as createStreamingDownsampler,
 * carrying leftover input samples between callbacks so 48 kHz capture stays at a
 * true 16 kHz over time. The previous phase accumulator skipped samples because
 * (16000 / 48000) * 3 is just under 1 in floating point, which made speech reach
 * Gemini too fast and delayed end-of-speech detection.
 */
export const VOICE_CAPTURE_WORKLET_SOURCE = `
class ExeptsVoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = (options && options.processorOptions) || {};
    this.targetRate = settings.targetRate || ${VOICE_CAPTURE_TARGET_RATE};
    this.chunkSamples = settings.chunkSamples || ${VOICE_CAPTURE_CHUNK_SAMPLES};
    this.ratio = sampleRate / this.targetRate;
    this.leftover = new Float32Array(0);
    this.chunk = new Int16Array(this.chunkSamples);
    this.filled = 0;
  }

  writeSample(value) {
    const clamped = value < -1 ? -1 : value > 1 ? 1 : value;
    this.chunk[this.filled] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    this.filled += 1;
    if (this.filled < this.chunkSamples) return;
    const packet = this.chunk.buffer;
    this.chunk = new Int16Array(this.chunkSamples);
    this.filled = 0;
    this.port.postMessage(packet, [packet]);
  }

  process(inputs, outputs) {
    const output = outputs[0] && outputs[0][0];
    if (output) output.fill(0);
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    if (this.ratio <= 1) {
      for (let index = 0; index < channel.length; index += 1) this.writeSample(channel[index]);
      return true;
    }
    const combined = new Float32Array(this.leftover.length + channel.length);
    combined.set(this.leftover);
    combined.set(channel, this.leftover.length);
    const outputLength = Math.floor(combined.length / this.ratio);
    const consumed = Math.min(combined.length, Math.floor(outputLength * this.ratio));
    for (let index = 0; index < outputLength; index += 1) {
      const start = Math.floor(index * this.ratio);
      const end = Math.min(consumed, Math.floor((index + 1) * this.ratio));
      let total = 0;
      for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) total += combined[sourceIndex];
      this.writeSample(total / Math.max(1, end - start));
    }
    this.leftover = combined.slice(consumed);
    return true;
  }
}

registerProcessor(${JSON.stringify(VOICE_CAPTURE_PROCESSOR_NAME)}, ExeptsVoiceCaptureProcessor);
`;
