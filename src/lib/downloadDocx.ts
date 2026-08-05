function contentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim().replace(/^"|"$/g, ""));
    } catch {
      // Fall through to the ordinary filename parameter.
    }
  }
  return header.match(/filename="([^"]+)"/i)?.[1]
    ?? header.match(/filename=([^;]+)/i)?.[1]?.trim()
    ?? null;
}

function safeDocxFilename(header: string | null): string {
  const candidate = contentDispositionFilename(header)
    ?.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!candidate) return "document.docx";
  return candidate.toLowerCase().endsWith(".docx") ? candidate : `${candidate}.docx`;
}

export async function downloadDocx(exportUrl: string): Promise<void> {
  const response = await fetch(exportUrl, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`DOCX export failed with status ${response.status}.`);

  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = safeDocxFilename(response.headers.get("Content-Disposition"));
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
