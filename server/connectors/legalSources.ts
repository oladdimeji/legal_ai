import type { Citation } from "../../src/types.js";
import type { FeatureFlags } from "../config.js";
import type { LegalSourceAdapter } from "./courtlistener.js";
import { CourtListenerAdapter } from "./courtlistener.js";
import { GovInfoAdapter } from "./govinfo.js";

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
): Promise<{ courtListener: Citation[]; govInfo: Citation[] }> {
  const [courtListener, govInfo] = await Promise.all([
    features.courtListener && requested.courtListener
      ? adapters.courtListener.query(searchTerm)
      : Promise.resolve([]),
    features.govInfo && requested.govInfo
      ? adapters.govInfo.query(searchTerm)
      : Promise.resolve([]),
  ]);
  return { courtListener, govInfo };
}

