const chunkIndexToCitId: Record<number, string> = {
  0: "cit_5",
  1: "cit_6",
  2: "cit_7",
  3: "cit_8",
  4: "cit_9",
  5: "cit_10",
  6: "cit_11"
};

const rewriteCitations = (text: string) => {
  // Find anything inside brackets [...]
  return text.replace(/\[([^\]]+)\]/g, (match, inner) => {
    // Split by comma
    const items = inner.split(",");
    const rewrittenItems: string[] = [];
    let hasChanges = false;

    for (const item of items) {
      const trimmed = item.trim();
      // If it is a digit, try to map it from search grounding chunks
      if (/^\d+$/.test(trimmed)) {
        const num = parseInt(trimmed, 10);
        const index = num - 1;
        if (chunkIndexToCitId[index]) {
          rewrittenItems.push(chunkIndexToCitId[index]);
          hasChanges = true;
        } else {
          // If no mapping, keep as plain number or convert to a generic fallback cit
          rewrittenItems.push(`cit_${trimmed}`);
          hasChanges = true;
        }
      } else {
        rewrittenItems.push(trimmed);
      }
    }

    if (hasChanges || items.length > 1) {
      // Return them as separate bracketed tags, e.g. [cit_1][cit_2]
      return rewrittenItems.map(x => `[${x}]`).join("");
    }

    return match;
  });
};

const text1 = "Unfair prejudice [cit_1, cit_2, 1, 2, 3, 4, 5, 6, 7].";
const text2 = "Single citation [1] and [cit_3].";
const text3 = "Multi [1, 2].";

console.log("text1 after:", rewriteCitations(text1));
console.log("text2 after:", rewriteCitations(text2));
console.log("text3 after:", rewriteCitations(text3));
