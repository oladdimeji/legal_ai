import * as tus from "tus-js-client";

export const PRIVATE_UPLOAD_MAX_FILES = 25;

type AuthorizedUpload = {
  versionId: string;
  endpoint: string;
  token: string;
  metadata: Record<string, string>;
};

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadOne(file: File, authorization: AuthorizedUpload): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: authorization.endpoint,
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        "x-signature": authorization.token,
        "x-upsert": "false",
      },
      metadata: authorization.metadata,
      onError: reject,
      onSuccess: () => resolve(),
    });
    void upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }, reject);
  });
}

export async function privateUploadsEnabled(): Promise<boolean> {
  try {
    const response = await fetch("/api/uploads/capabilities", { cache: "no-store" });
    return response.ok && Boolean((await response.json()).enabled);
  } catch {
    return false;
  }
}

export async function uploadPrivateFiles(files: File[], caseId: string | null): Promise<boolean> {
  if (!(await privateUploadsEnabled())) return false;
  const checksums = [];
  for (const file of files) checksums.push(await sha256(file));
  const response = await fetch("/api/uploads/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      caseId,
      files: files.map((file, index) => ({
        filename: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
        checksumSha256: checksums[index],
      })),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload authorization failed");
  if (!Array.isArray(data.files) || data.files.length !== files.length) {
    throw new Error("Upload authorization response was incomplete");
  }
  for (let index = 0; index < files.length; index += 1) {
    await uploadOne(files[index], data.files[index]);
    const confirmation = await fetch(`/api/uploads/${data.files[index].versionId}/confirm`, {
      method: "POST",
    });
    if (!confirmation.ok) {
      const error = await confirmation.json();
      throw new Error(error.error || "Upload confirmation failed");
    }
  }
  return true;
}
