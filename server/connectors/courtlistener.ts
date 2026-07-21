import { Citation } from "../../src/types.js";

export interface LegalSourceAdapter {
  name: string;
  query(searchTerm: string): Promise<Citation[]>;
}

export const CourtListenerAdapter: LegalSourceAdapter = {
  name: "CourtListener",
  async query(searchTerm: string): Promise<Citation[]> {
    console.log(`[CourtListener] Querying for "${searchTerm}"...`);
    
    // Simulate query match on common terms
    const term = searchTerm.toLowerCase();
    const results: Citation[] = [];

    if (term.includes("compete") || term.includes("employment") || term.includes("restraint")) {
      results.push({
        id: `court_cl_1`,
        type: "connector",
        title: "Edwards v. Arthur Andersen LLP, 44 Cal. 4th 937 (2008)",
        url: "https://www.courtlistener.com/opinion/2635904/edwards-v-arthur-andersen-llp/",
        textSnippet: "In Edwards v. Arthur Andersen LLP, the California Supreme Court reaffirmed California's strict public policy against covenants not to compete, stating Section 16600 invalidates even reasonable non-compete agreements in employment contracts unless they fall into a statutory exception.",
        sourceName: "CourtListener"
      });
    }

    if (term.includes("privilege") || term.includes("nixon") || term.includes("executive")) {
      results.push({
        id: `court_cl_2`,
        type: "connector",
        title: "United States v. Nixon, 418 U.S. 683 (1974)",
        url: "https://www.courtlistener.com/opinion/109101/united-states-v-nixon/",
        textSnippet: "Neither the doctrine of separation of powers, nor the need for confidentiality of high-level communications, without more, can sustain an absolute, unqualified Presidential privilege of immunity from judicial process under all circumstances.",
        sourceName: "CourtListener"
      });
    }

    if (term.includes("copyright") || term.includes("fair use") || term.includes("transformative")) {
      results.push({
        id: `court_cl_3`,
        type: "connector",
        title: "Campbell v. Acuff-Rose Music, Inc., 510 U.S. 569 (1994)",
        url: "https://www.courtlistener.com/opinion/112903/campbell-v-acuff-rose-music-inc/",
        textSnippet: "The Supreme Court held that a commercial parody can qualify as fair use. The central inquiry in evaluating the character and purpose of the use is whether the new work is transformative, adding something new with a further purpose or different character.",
        sourceName: "CourtListener"
      });
    }

    // Default general result if nothing matches specifically
    if (results.length === 0) {
      results.push({
        id: `court_cl_gen`,
        type: "connector",
        title: "Federal Rules of Civil Procedure - Rule 26 (General Provisions)",
        url: "https://www.courtlistener.com/recap/",
        textSnippet: "Rule 26 of the Federal Rules of Civil Procedure governs the general provisions regarding discovery and duty of disclosure, outlining that parties may obtain discovery regarding any nonprivileged matter that is relevant to any party's claim or defense.",
        sourceName: "CourtListener"
      });
    }

    return results;
  }
};
