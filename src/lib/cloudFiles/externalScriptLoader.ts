type ExternalScriptOptions = {
  id: string;
  src: string;
  attributes?: Record<string, string>;
  isReady: () => boolean;
  failureMessage: string;
  documentRef?: Document;
};

const loadingScripts = new Map<string, Promise<void>>();

export function loadExternalScript(options: ExternalScriptOptions): Promise<void> {
  if (options.isReady()) return Promise.resolve();
  const existingPromise = loadingScripts.get(options.id);
  if (existingPromise) return existingPromise;

  const documentRef = options.documentRef || (typeof document === "undefined" ? undefined : document);
  if (!documentRef) return Promise.reject(new Error(options.failureMessage));

  const promise = new Promise<void>((resolve, reject) => {
    let script = documentRef.getElementById(options.id) as HTMLScriptElement | null;
    let created = false;
    if (!script) {
      script = documentRef.createElement("script");
      script.id = options.id;
      script.src = options.src;
      script.async = true;
      Object.entries(options.attributes || {}).forEach(([name, value]) => script?.setAttribute(name, value));
      created = true;
    }

    const cleanup = () => {
      script?.removeEventListener("load", handleLoad);
      script?.removeEventListener("error", handleError);
    };
    const fail = () => {
      cleanup();
      loadingScripts.delete(options.id);
      if (created) script?.remove();
      reject(new Error(options.failureMessage));
    };
    const handleLoad = () => {
      if (!options.isReady()) {
        fail();
        return;
      }
      cleanup();
      script?.setAttribute("data-exepts-loaded", "true");
      resolve();
    };
    const handleError = () => fail();

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });

    if (created) {
      documentRef.head.appendChild(script);
    } else if (options.isReady()) {
      handleLoad();
    } else if (script.getAttribute("data-exepts-loaded") === "true") {
      fail();
    }
  });

  loadingScripts.set(options.id, promise);
  return promise;
}

export function resetExternalScriptLoaderForTests(): void {
  loadingScripts.clear();
}
