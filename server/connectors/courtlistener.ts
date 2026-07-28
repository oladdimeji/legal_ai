import { Citation } from "../../src/types.js";

export interface LegalSourceAdapter {
  name: string;
  query(searchTerm: string): Promise<Citation[]>;
}

export const CourtListenerAdapter: LegalSourceAdapter = {
  name: "CourtListener",
  async query(_searchTerm: string): Promise<Citation[]> {
    return [];
  }
};
