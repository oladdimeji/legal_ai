import { Citation } from "../../src/types.js";
import { LegalSourceAdapter } from "./courtlistener.js";

export const GovInfoAdapter: LegalSourceAdapter = {
  name: "GovInfo",
  async query(_searchTerm: string): Promise<Citation[]> {
    return [];
  }
};
