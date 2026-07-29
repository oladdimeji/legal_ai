import { createHash, randomUUID } from "node:crypto";

export type EmailTemplateKey =
  | "firm_invitation"
  | "client_invitation"
  | "email_verification"
  | "password_reset"
  | "account_security_notice"
  | "client_notification";

export interface EmailDeliveryRecord {
  id: string;
  firmId: string | null;
  clientUserId: string | null;
  templateKey: EmailTemplateKey;
  recipientEmailHash: string;
  provider: "brevo";
  providerMessageId: string | null;
  status: "sent" | "failed" | "skipped";
  attemptCount: number;
  failureCategory: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
}

export interface EmailDeliveryRecorder {
  recordEmailDelivery(record: EmailDeliveryRecord): Promise<void>;
}

export interface TransactionalEmailInput {
  firmId?: string | null;
  clientUserId?: string | null;
  toEmail: string;
  toName?: string | null;
  templateKey: EmailTemplateKey;
  values: Record<string, string>;
}

export interface TransactionalEmailResult {
  status: "sent" | "failed" | "skipped";
  providerMessageId: string | null;
  failureCategory: string | null;
}

export interface TransactionalEmailSender {
  send(input: TransactionalEmailInput): Promise<TransactionalEmailResult>;
}

type BrevoOptions = {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
};

function emailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function requiredValue(values: Record<string, string>, key: string): string {
  const value = values[key]?.trim();
  if (!value) throw new Error(`Email template substitution is missing: ${key}`);
  return value;
}

export function renderTransactionalTemplate(
  templateKey: EmailTemplateKey,
  values: Record<string, string>,
): { subject: string; htmlContent: string; textContent: string } {
  const recipientName = values.recipientName?.trim() || "there";
  const escapedName = escapeHtml(recipientName);
  const templates: Record<EmailTemplateKey, () => { subject: string; heading: string; body: string; action: string; actionLabel: string }> = {
    firm_invitation: () => ({
      subject: "You have been invited to join a firm in Exepts",
      heading: "Join your firm in Exepts",
      body: `You were invited to join Exepts with the ${escapeHtml(requiredValue(values, "role"))} role.`,
      action: requiredValue(values, "actionUrl"),
      actionLabel: "Accept invitation",
    }),
    client_invitation: () => ({
      subject: `You have been invited to ${requiredValue(values, "matterName")} in Exepts`,
      heading: "A lawyer has invited you to Exepts",
      body: `${escapeHtml(requiredValue(values, "lawyerName"))} shared the Matter “${escapeHtml(requiredValue(values, "matterName"))}” with you.`,
      action: requiredValue(values, "actionUrl"),
      actionLabel: "Activate account",
    }),
    email_verification: () => ({
      subject: "Verify your Exepts client account",
      heading: "Verify your email",
      body: "Verify this email address before signing in to your client dashboard.",
      action: requiredValue(values, "actionUrl"),
      actionLabel: "Verify email",
    }),
    password_reset: () => ({
      subject: "Reset your Exepts client password",
      heading: "Reset your password",
      body: "A password reset was requested for your Exepts client account. Ignore this email if you did not request it.",
      action: requiredValue(values, "actionUrl"),
      actionLabel: "Reset password",
    }),
    account_security_notice: () => ({
      subject: requiredValue(values, "subject"),
      heading: requiredValue(values, "heading"),
      body: requiredValue(values, "message"),
      action: requiredValue(values, "actionUrl"),
      actionLabel: "Review account",
    }),
    client_notification: () => ({
      subject: requiredValue(values, "subject"),
      heading: requiredValue(values, "heading"),
      body: requiredValue(values, "message"),
      action: requiredValue(values, "actionUrl"),
      actionLabel: "Open Exepts",
    }),
  };
  const rendered = templates[templateKey]();
  const actionUrl = escapeHtml(rendered.action);
  return {
    subject: rendered.subject.slice(0, 180),
    htmlContent: `<p>Hello ${escapedName},</p><h1>${escapeHtml(rendered.heading)}</h1><p>${rendered.body}</p><p><a href="${actionUrl}">${escapeHtml(rendered.actionLabel)}</a></p><p>This link expires and can be used only as described.</p>`,
    textContent: `Hello ${recipientName},\n\n${rendered.heading}\n\n${rendered.body.replace(/&quot;|&#39;|&amp;|&lt;|&gt;/g, "")}\n\n${rendered.actionLabel}: ${rendered.action}\n`,
  };
}

export class BrevoTransactionalEmail implements TransactionalEmailSender {
  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrl: string;

  constructor(
    private readonly options: BrevoOptions,
    private readonly recorder: EmailDeliveryRecorder,
  ) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.apiBaseUrl = (options.apiBaseUrl || "https://api.brevo.com/v3").replace(/\/+$/, "");
  }

  async send(input: TransactionalEmailInput): Promise<TransactionalEmailResult> {
    const id = `email_attempt_${randomUUID()}`;
    let result: TransactionalEmailResult;
    try {
      const template = renderTransactionalTemplate(input.templateKey, input.values);
      const response = await this.fetchImpl(`${this.apiBaseUrl}/smtp/email`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": this.options.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: { email: this.options.senderEmail, name: this.options.senderName },
          to: [{ email: input.toEmail, name: input.toName || undefined }],
          subject: template.subject,
          htmlContent: template.htmlContent,
          textContent: template.textContent,
        }),
      });
      const payload = response.ok ? await response.json() as { messageId?: unknown } : null;
      result = response.ok && typeof payload?.messageId === "string"
        ? { status: "sent", providerMessageId: payload.messageId, failureCategory: null }
        : {
            status: "failed",
            providerMessageId: null,
            failureCategory: response.status === 429 ? "rate_limited"
              : response.status >= 500 ? "provider_unavailable" : "provider_rejected",
          };
    } catch {
      result = { status: "failed", providerMessageId: null, failureCategory: "network_error" };
    }
    const now = new Date().toISOString();
    await this.recorder.recordEmailDelivery({
      id,
      firmId: input.firmId || null,
      clientUserId: input.clientUserId || null,
      templateKey: input.templateKey,
      recipientEmailHash: emailHash(input.toEmail),
      provider: "brevo",
      providerMessageId: result.providerMessageId,
      status: result.status,
      attemptCount: 1,
      failureCategory: result.failureCategory,
      deliveredAt: result.status === "sent" ? now : null,
      failedAt: result.status === "failed" ? now : null,
    });
    return result;
  }
}

export class DisabledTransactionalEmail implements TransactionalEmailSender {
  async send(): Promise<TransactionalEmailResult> {
    return { status: "skipped", providerMessageId: null, failureCategory: "feature_disabled" };
  }
}
