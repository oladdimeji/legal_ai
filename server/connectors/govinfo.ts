import type { Citation } from "../../src/types.js";
import type { ProviderHealth } from "../providers/contracts.js";

export interface GovInfoQuery {
  query: string;
  dateFrom?: string;
  dateTo?: string;
  documentTypes?: string[];
  pageSize?: number;
  offsetMark?: string;
}

export interface GovInfoQueryResult {
  citations: Citation[];
  nextOffsetMark?: string;
  status: "ok" | "empty" | "unavailable";
}

export interface GovInfoAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  cacheTtlMs?: number;
}

type JsonRecord = Record<string, any>;
type CacheEntry = { expiresAt: number; value: GovInfoQueryResult };

const cache = new Map<string, CacheEntry>();
const MAX_PAGE_SIZE = 20;
const MAX_CONTENT_CHARS = 24_000;

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function safeDate(value?: string): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function safeDocumentTypes(values?: string[]): string[] {
  return [...new Set((values || []).map((value) => value.trim().toUpperCase()).filter((value) => /^[A-Z0-9_-]{1,30}$/.test(value)))].slice(0, 10);
}

function stripMarkup(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTENT_CHARS);
}

function offsetFromNextPage(nextPage: unknown): string | undefined {
  if (typeof nextPage !== "string") return undefined;
  try {
    return new URL(nextPage).searchParams.get("offsetMark") || undefined;
  } catch {
    return undefined;
  }
}

export class LiveGovInfoAdapter {
  readonly name = "GovInfo";
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly cacheTtlMs: number;

  constructor(options: GovInfoAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.GOVINFO_API_KEY;
    this.baseUrl = (options.baseUrl ?? process.env.GOVINFO_BASE_URL ?? "https://api.govinfo.gov").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.retries = options.retries ?? 2;
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60_000;
  }

  async health(): Promise<ProviderHealth> {
    return this.apiKey ? { status: "ready" } : { status: "disabled" };
  }

  private async request(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(pathOrUrl, `${this.baseUrl}/`);
    if (url.origin !== new URL(this.baseUrl).origin) {
      throw new Error("GovInfo returned an untrusted retrieval URL.");
    }
    url.searchParams.set("api_key", this.apiKey || "");

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
        if (response.ok) return response;
        if (![429, 502, 503, 504].includes(response.status) || attempt === this.retries) {
          throw new Error(`GovInfo request failed with status ${response.status}.`);
        }
        const retryAfter = Number(response.headers.get("retry-after") || "0");
        const delay = Math.min(1_500, retryAfter > 0 ? retryAfter * 1_000 : 150 * 2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        lastError = error;
        if (attempt === this.retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  private async json(path: string, init?: RequestInit): Promise<JsonRecord> {
    return (await (await this.request(path, init)).json()) as JsonRecord;
  }

  private async retrieve(result: JsonRecord): Promise<Citation | null> {
    const packageId = typeof result.packageId === "string" ? result.packageId : "";
    const granuleId = typeof result.granuleId === "string" ? result.granuleId : "";
    if (!packageId) return null;
    const summaryPath = granuleId
      ? `/packages/${encodeURIComponent(packageId)}/granules/${encodeURIComponent(granuleId)}/summary`
      : `/packages/${encodeURIComponent(packageId)}/summary`;
    const summary = await this.json(summaryPath);
    const download = summary.download || result.download || {};
    const contentUrl = download.txtLink || download.htmLink;
    if (typeof contentUrl !== "string") return null;
    const material = stripMarkup(await (await this.request(contentUrl)).text());
    if (!material) return null;
    const providerSourceId = granuleId ? `${packageId}:${granuleId}` : packageId;
    const canonicalLink =
      summary.detailsLink ||
      result.detailsLink ||
      `https://www.govinfo.gov/app/details/${encodeURIComponent(packageId)}${granuleId ? `/${encodeURIComponent(granuleId)}` : ""}`;
    const publicationDate = summary.dateIssued || result.dateIssued || result.publishDate;
    return {
      id: providerSourceId,
      type: "connector",
      title: summary.title || result.title || providerSourceId,
      url: canonicalLink,
      textSnippet: material,
      sourceName: "GovInfo",
      provider: "govinfo",
      providerSourceId,
      publicationDate: typeof publicationDate === "string" ? publicationDate : undefined,
      retrievalDate: new Date().toISOString(),
      sourceMetadata: {
        packageId,
        granuleId: granuleId || null,
        collectionCode: summary.collectionCode || result.collectionCode || null,
        documentClass: summary.docClass || result.docClass || null,
        lastModified: summary.lastModified || result.lastModified || null,
      },
    };
  }

  async search(input: GovInfoQuery): Promise<GovInfoQueryResult> {
    const query = normalizeQuery(input.query);
    if (!this.apiKey || !query) return { citations: [], status: "empty" };
    const documentTypes = safeDocumentTypes(input.documentTypes);
    const filters = [
      documentTypes.length ? `collection:(${documentTypes.join(" OR ")})` : "",
      safeDate(input.dateFrom) || safeDate(input.dateTo)
        ? `publishdate:range(${safeDate(input.dateFrom) || ""},${safeDate(input.dateTo) || ""})`
        : "",
    ].filter(Boolean);
    const body = {
      query: [query, ...filters].join(" AND "),
      pageSize: Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(input.pageSize || 5))),
      offsetMark: input.offsetMark || "*",
      resultLevel: "default",
      sorts: [{ field: "score", sortOrder: "DESC" }],
    };
    const cacheKey = JSON.stringify(body);
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    try {
      const response = await this.json("/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const candidates = Array.isArray(response.results) ? response.results.slice(0, body.pageSize) : [];
      const settled = await Promise.allSettled(candidates.map((item) => this.retrieve(item)));
      const citations = settled
        .filter((item): item is PromiseFulfilledResult<Citation | null> => item.status === "fulfilled")
        .map((item) => item.value)
        .filter((item): item is Citation => item !== null);
      const value: GovInfoQueryResult = {
        citations,
        nextOffsetMark: offsetFromNextPage(response.nextPage),
        status: citations.length ? "ok" : "empty",
      };
      for (const [key, entry] of cache) {
        if (entry.expiresAt <= Date.now()) cache.delete(key);
      }
      if (cache.size >= 100) cache.delete(cache.keys().next().value as string);
      cache.set(cacheKey, { expiresAt: Date.now() + this.cacheTtlMs, value });
      return value;
    } catch {
      return { citations: [], status: "unavailable" };
    }
  }

  async query(searchTerm: string): Promise<Citation[]> {
    return (await this.search({ query: searchTerm })).citations;
  }
}

export const GovInfoAdapter = new LiveGovInfoAdapter();
