import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const TOKEN_VERSION = "v1";

function encryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32 || key.toString("base64") !== base64) {
    throw new Error("Provider token encryption is not configured correctly.");
  }
  return key;
}

export function encryptProviderSecret(value: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyBase64), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    TOKEN_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptProviderSecret(encrypted: string, keyBase64: string): string {
  const [version, ivText, tagText, ciphertextText] = encrypted.split(".");
  if (version !== TOKEN_VERSION || !ivText || !tagText || !ciphertextText) {
    throw new Error("Stored provider credentials are unavailable.");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(keyBase64),
      Buffer.from(ivText, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Stored provider credentials are unavailable.");
  }
}
