export const VOICE_CAPTURE_PROCESSOR_NAME = "exepts-voice-capture";
export const VOICE_CAPTURE_TARGET_RATE = 16000;

// 512 samples at 16 kHz is one 32 ms packet, which keeps end-of-speech detection
// responsive without posting to the main thread more often than necessary.
export const VOICE_CAPTURE_CHUNK_SAMPLES = 512;

/**
 * Runs on the audio rendering thread, so microphone frames keep being captured,
 * downsampled to 16 kHz and converted to PCM16 even while the main thread is busy
 * rendering. Only the finished packet crosses back to the main thread.
 */
export const VOICE_CAPTURE_WORKLET_SOURCE = `
class ExeptsVoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = (options && options.processorOptions) || {};
    this.chunkSamples = settings.chunkSamples || ${VOICE_CAPTURE_CHUNK_SAMPLES};
    this.step = (settings.targetRate || ${VOICE_CAPTURE_TARGET_RATE}) / sampleRate;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.chunk = new Int16Array(this.chunkSamples);
    this.filled = 0;
  }

  emit(value) {
    const clamped = value < -1 ? -1 : value > 1 ? 1 : value;
    this.chunk[this.filled] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    this.filled += 1;
    if (this.filled < this.chunkSamples) return;
    const packet = this.chunk.buffer;
    this.chunk = new Int16Array(this.chunkSamples);
    this.filled = 0;
    this.port.postMessage(packet, [packet]);
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let index = 0; index < channel.length; index += 1) {
      this.sum += channel[index];
      this.count += 1;
      this.phase += this.step;
      if (this.phase < 1) continue;
      this.phase -= 1;
      this.emit(this.sum / this.count);
      this.sum = 0;
      this.count = 0;
    }
    return true;
  }
}

registerProcessor(${JSON.stringify(VOICE_CAPTURE_PROCESSOR_NAME)}, ExeptsVoiceCaptureProcessor);
`;
