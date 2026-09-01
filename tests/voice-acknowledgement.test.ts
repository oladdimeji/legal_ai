import assert from "node:assert/strict";
import test from "node:test";
import {
  resetVoiceAcknowledgementVariantCounter,
  isVoiceDocumentAcknowledgementContent,
  isVoiceDocumentConfirmationSpeechContent,
  isVoiceDocumentSpokenContent,
  voiceAcknowledgementSpeech,
  voiceConfirmationSpeech,
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

test("Voice document spoken content is recognized for transcript suppression", () => {
  assert.equal(isVoiceDocumentAcknowledgementContent("Understood. I'll prepare the NDA now."), true);
  assert.equal(isVoiceDocumentAcknowledgementContent("Got it. I'll put together the Memo for you."), true);
  assert.equal(isVoiceDocumentAcknowledgementContent("Understood. I'll prepare the"), true);
  assert.equal(isVoiceDocumentConfirmationSpeechContent("I've finished preparing the NDA."), true);
  assert.equal(isVoiceDocumentConfirmationSpeechContent("I've finished revising the Agreement."), true);
  assert.equal(isVoiceDocumentConfirmationSpeechContent("I've finished preparing the"), true);
  assert.equal(isVoiceDocumentSpokenContent("Absolutely. I'll prepare the Contract based on your instructions."), true);
  assert.equal(isVoiceDocumentSpokenContent("I've finished revising the SOW.", voiceConfirmationSpeech("Revise the SOW.")), true);
  assert.equal(isVoiceDocumentSpokenContent("Here are the current matters."), false);
});
