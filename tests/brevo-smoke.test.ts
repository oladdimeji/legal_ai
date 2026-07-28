import assert from "node:assert/strict";
import test from "node:test";
import {
  BrevoTransactionalEmail,
  type EmailDeliveryRecord,
} from "../server/transactionalEmail.js";

test("real Brevo staging smoke", {
  skip: process.env.BREVO_LIVE_SMOKE !== "true"
    ? "Set BREVO_LIVE_SMOKE=true with Brevo staging credentials."
    : false,
}, async () => {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const recipient = process.env.BREVO_SMOKE_RECIPIENT;
  assert.ok(apiKey && senderEmail && recipient, "Brevo staging variables are required");
  const records: EmailDeliveryRecord[] = [];
  const sender = new BrevoTransactionalEmail({
    apiKey,
    senderEmail,
    senderName: process.env.BREVO_SENDER_NAME || "Exepts Staging",
  }, {
    async recordEmailDelivery(record) { records.push(record); },
  });
  const result = await sender.send({
    toEmail: recipient,
    templateKey: "client_notification",
    values: {
      recipientName: "Staging reviewer",
      subject: "Exepts Brevo staging smoke",
      heading: "Staging email delivery check",
      message: "This environment-gated message verifies the Exepts transactional provider.",
      actionUrl: `${process.env.APP_BASE_URL || "https://staging.example.test"}/client/login`,
    },
  });
  assert.equal(result.status, "sent");
  assert.ok(result.providerMessageId);
  assert.equal(records[0]?.status, "sent");
});
