export const EXPORT_SAFE_DOCUMENT_MARKDOWN_RULES = `Export-safe document Markdown rules:
- Output clean GFM Markdown only and never wrap the whole document in a code fence.
- Use headings according to the document hierarchy and do not duplicate the document title repeatedly.
- Use tables only when they improve comprehension; use prose or lists when content is primarily long narrative text.
- Use a valid GFM table separator row, concise headers, and preferably two to four columns.
- Avoid more than six columns unless genuinely necessary. Do not use nested tables or blank columns for visual spacing.
- Keep table cells to concise inline content. Do not put bullet lists or multiple block paragraphs inside a table cell.
- Use <br> for a deliberate line break inside a table cell and escape a literal pipe as \\|.
- Never emit raw HTML except the supported <br> and <u> conventions.
- Never include a diagram, flow chart, process illustration, decision tree, organisation chart, timeline graphic, data chart, graph, figure, visual card, callout box, infographic, or any other drawn or rendered visual. This applies however it would be expressed, including Mermaid, PlantUML, Graphviz or DOT, other diagram markup, image or figure references, box-drawing or arrow art, and text or ASCII art.
- Express a sequence, process, structure, hierarchy, or decision path in words, as headings, as an ordered or nested list, or as a conventional table.
- Do not intentionally emit visible Markdown syntax.`;

