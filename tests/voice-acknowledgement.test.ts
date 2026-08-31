import assert from "node:assert/strict";
import test from "node:test";
import {
  resetVoiceAcknowledgementVariantCounter,
  voiceAcknowledgementSpeech,
} from "../src/lib/voiceAcknowledgement.js";

test("Voice acknowledgement variants rotate through create templates", () => {
  resetVoiceAcknowledgementVariantCounter();
  assert.equal(voiceAcknowledgementSpeech("Draft an NDA."), "Understood. I'll prepare the NDA now.");
  assert.equal(voiceAcknowledgementSpeech("Draft an NDA."), "Got it. I'll put together the NDA for you.");
  assert.equal(voiceAcknowledgementSpeech("Draft an NDA."), "Absolutely. I'll prepare the NDA based on your instructions.");
  assert.equal(voiceAcknowledgementSpeech("Draft an NDA."), "Understood. I'll prepare the NDA now.");
});

test("Voice acknowledgement variants use revision templates when requested", () => {
  assert.equal(voiceAcknowledgementSpeech("Revise the agreement.", 0), "Understood. I'll revise the Agreement now.");
  assert.equal(voiceAcknowledgementSpeech("Revise the agreement.", 2), "Absolutely. I'll revise the Agreement based on your instructions.");
});
