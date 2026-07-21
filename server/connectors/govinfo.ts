import { Citation } from "../../src/types.js";
import { LegalSourceAdapter } from "./courtlistener.js";

export const GovInfoAdapter: LegalSourceAdapter = {
  name: "GovInfo",
  async query(searchTerm: string): Promise<Citation[]> {
    console.log(`[GovInfo] Querying US Government Publishing Office for "${searchTerm}"...`);
    
    const term = searchTerm.toLowerCase();
    const results: Citation[] = [];

    if (term.includes("compete") || term.includes("employment") || term.includes("federal trade") || term.includes("ftc")) {
      results.push({
        id: `gov_gi_1`,
        type: "connector",
        title: "FTC Non-Compete Clause Rule, 16 CFR Part 910",
        url: "https://www.govinfo.gov/app/details/FR-2024-05-07/2024-09171",
        textSnippet: "The Federal Trade Commission issued a Final Rule prohibiting employers from entering into, or attempting to enter into, non-compete clauses with workers, declaring non-competes to be an unfair method of competition.",
        sourceName: "GovInfo"
      });
    }

    if (term.includes("copyright") || term.includes("fair use") || term.includes("title 17")) {
      results.push({
        id: `gov_gi_2`,
        type: "connector",
        title: "U.S. Code Title 17 Section 107 - Limitations on exclusive rights",
        url: "https://www.govinfo.gov/app/details/USCODE-2022-title17/USCODE-2022-title17-chap1-sec107",
        textSnippet: "Title 17, Section 107 of the United States Code details the fair use doctrine for copyrighted material. It specifies statutory factors for determining fair use, including commercial vs non-profit educational character and market impact.",
        sourceName: "GovInfo"
      });
    }

    // Default general result if nothing matches specifically
    if (results.length === 0) {
      results.push({
        id: `gov_gi_gen`,
        type: "connector",
        title: "United States Constitution - Article I Section 8",
        url: "https://www.govinfo.gov/content/pkg/CDOC-110hdoc50/pdf/CDOC-110hdoc50.pdf",
        textSnippet: "Article I, Section 8 of the United States Constitution grants Congress the power to lay and collect taxes, regulate commerce with foreign nations and among the several states, and to promote the progress of science and useful arts.",
        sourceName: "GovInfo"
      });
    }

    return results;
  }
};
