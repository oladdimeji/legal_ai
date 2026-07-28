import type { Citation } from "../../src/types.js";
import type { FeatureFlags } from "../config.js";
import type { LegalSourceAdapter } from "./courtlistener.js";
import { CourtListenerAdapter } from "./courtlistener.js";
import { GovInfoAdapter } from "./govinfo.js";
import type { GovInfoQueryResult } from "./govinfo.js";

export interface LegalSourceRequest {
  courtListener: boolean;
  govInfo: boolean;
}

export async function queryLegalSources(
  searchTerm: string,
  features: Pick<FeatureFlags, "courtListener" | "govInfo">,
  requested: LegalSourceRequest,
  adapters: { courtListener: LegalSourceAdapter; govInfo: LegalSourceAdapter } = {
    courtListener: CourtListenerAdapter,
    govInfo: GovInfoAdapter,
  }
): Promise<{ courtListener: Citation[]; govInfo: Citation[]; govInfoStatus: GovInfoQueryResult["status"] }> {
  const [courtListener, govInfoResult] = await Promise.all([
    features.courtListener && requested.courtListener
      ? adapters.courtListener.query(searchTerm)
      : Promise.resolve([]),
    features.govInfo && requested.govInfo
      ? adapters.govInfo === GovInfoAdapter
        ? GovInfoAdapter.search({ query: searchTerm })
        : adapters.govInfo.query(searchTerm).then((citations) => ({
            citations,
            status: citations.length ? "ok" as const : "empty" as const,
          }))
      : Promise.resolve({ citations: [], status: "empty" as const }),
  ]);
  return { courtListener, govInfo: govInfoResult.citations, govInfoStatus: govInfoResult.status };
}
