import type { Citation } from "../../src/types.js";
import { GovInfoAdapter, type GovInfoQueryResult } from "./govinfo.js";

export async function queryLegalSources(
  searchTerm: string,
  configured: boolean,
  requested: boolean,
): Promise<{ govInfo: Citation[]; govInfoStatus: GovInfoQueryResult["status"] }> {
  if (!configured || !requested) {
    return { govInfo: [], govInfoStatus: "empty" };
  }
  const result = await GovInfoAdapter.search({ query: searchTerm });
  return { govInfo: result.citations, govInfoStatus: result.status };
}
