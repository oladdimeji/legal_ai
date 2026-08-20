export const VOICE_PLAYBACK_PROCESSOR_NAME = "exepts-voice-playback";

// Hold this much decoded audio before the first sample is heard, and keep
// outputting silence through short gaps so a late packet cannot punch a hole
// that the clock can never fill.
export const VOICE_PLAYBACK_PREBUFFER_SECONDS = 0.3;
export const VOICE_PLAYBACK_DRAIN_SECONDS = 0.2;

export const VOICE_PLAYBACK_WORKLET_SOURCE = `
class ExeptsVoicePlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = (options && options.processorOptions) || {};
    this.prebuffer = Math.round((settings.prebufferSeconds || ${VOICE_PLAYBACK_PREBUFFER_SECONDS}) * sampleRate);
    this.drainSilence = Math.round((settings.drainSeconds || ${VOICE_PLAYBACK_DRAIN_SECONDS}) * sampleRate);
    this.queue = [];
    this.offset = 0;
    this.queued = 0;
    this.playing = false;
    this.silent = 0;
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === "stop") {
        this.queue = [];
        this.offset = 0;
        this.queued = 0;
        this.playing = false;
        this.silent = 0;
        return;
      }
      if (data.type !== "push" || !data.samples) return;
      const samples = data.samples instanceof Int16Array ? data.samples : new Int16Array(data.samples);
      const resampled = this.resample(samples, data.sampleRate || 24000);
      if (!resampled.length) return;
      this.queue.push(resampled);
      this.queued += resampled.length;
      this.silent = 0;
    };
  }

  resample(int16, srcRate) {
    const floats = new Float32Array(int16.length);
    for (let index = 0; index < int16.length; index += 1) {
      const value = int16[index];
      floats[index] = value / (value < 0 ? 0x8000 : 0x7fff);
    }
    if (srcRate === sampleRate) return floats;
    const outLength = Math.max(1, Math.round(floats.length * sampleRate / srcRate));
    const output = new Float32Array(outLength);
    const step = srcRate / sampleRate;
    for (let index = 0; index < outLength; index += 1) {
      const position = index * step;
      const source = Math.min(Math.floor(position), floats.length - 1);
      const next = Math.min(source + 1, floats.length - 1);
      const fraction = position - Math.floor(position);
      output[index] = floats[source] + (floats[next] - floats[source]) * fraction;
    }
    return output;
  }

  process(_inputs, outputs) {
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    if (!this.playing) {
      if (this.queued < this.prebuffer) {
        output.fill(0);
        return true;
      }
      this.playing = true;
    }
    let filled = 0;
    while (filled < output.length && this.queue.length) {
      const current = this.queue[0];
      const available = current.length - this.offset;
      const take = Math.min(available, output.length - filled);
      output.set(current.subarray(this.offset, this.offset + take), filled);
      this.offset += take;
      filled += take;
      this.queued -= take;
      if (this.offset >= current.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    if (filled < output.length) {
      output.fill(0, filled);
      this.silent += output.length - filled;
      if (this.silent >= this.drainSilence && this.queued === 0) {
        this.playing = false;
        this.silent = 0;
        this.port.postMessage({ type: "drained" });
      }
    } else {
      this.silent = 0;
    }
    return true;
  }
}

registerProcessor(${JSON.stringify(VOICE_PLAYBACK_PROCESSOR_NAME)}, ExeptsVoicePlaybackProcessor);
`;
