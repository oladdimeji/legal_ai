import { useCallback, useMemo, useState } from "react";

export const MAX_SELECTED_FILES = 5;

export function browserFileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function appendUniqueFiles(
  current: File[],
  incoming: File[],
  maxFiles = MAX_SELECTED_FILES
): { files: File[]; error: string } {
  const seen = new Set(current.map(browserFileIdentity));
  const uniqueIncoming = incoming.filter((file) => {
    const key = browserFileIdentity(file);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (current.length + uniqueIncoming.length > maxFiles) {
    return {
      files: current,
      error: `Select at most ${maxFiles} files. ${current.length} already selected; ${uniqueIncoming.length} more would exceed the limit.`,
    };
  }
  return { files: [...current, ...uniqueIncoming], error: "" };
}

export function useCumulativeFileSelection(maxFiles = MAX_SELECTED_FILES) {
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");

  const addFiles = useCallback((list: FileList | File[] | null) => {
    const incoming = Array.from(list || []);
    if (incoming.length === 0) return;
    setFiles((current) => {
      const next = appendUniqueFiles(current, incoming, maxFiles);
      setFileError(next.error);
      return next.files;
    });
  }, [maxFiles]);

  const removeFile = useCallback((identity: string) => {
    setFiles((current) => current.filter((file) => browserFileIdentity(file) !== identity));
    setFileError("");
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    setFileError("");
  }, []);

  const selectedLabel = useMemo(() => {
    if (files.length === 0) return "No files selected";
    return files.length === 1 ? "1 file selected" : `${files.length} files selected`;
  }, [files.length]);

  return { files, fileError, selectedLabel, addFiles, removeFile, clearFiles, setFileError };
}
