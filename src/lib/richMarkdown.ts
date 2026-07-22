export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdownToHtml(value: string): string {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>")
    .replace(/<u>(.*?)<\/u>/g, "<u>$1</u>");
}

export function markdownToEditorHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inlineMarkdownToHtml(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      html.push(`<${list.type}>${list.items.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join("")}</${list.type}>`);
      list = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    const quote = /^>\s?(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(3, heading[1].length);
      html.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
    } else if (unordered || ordered) {
      flushParagraph();
      const type = unordered ? "ul" : "ol";
      if (!list || list.type !== type) flushList();
      list = list || { type, items: [] };
      list.items.push((unordered || ordered)![1]);
    } else if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${inlineMarkdownToHtml(quote[1])}</blockquote>`);
    } else {
      flushList();
      paragraph.push(trimmed);
    }
  }
  flushParagraph();
  flushList();
  return html.join("") || "<p><br></p>";
}

function inlineHtmlToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (!(node instanceof HTMLElement)) return "";
  const children = Array.from(node.childNodes).map(inlineHtmlToMarkdown).join("");
  if (node.tagName === "STRONG" || node.tagName === "B") return `**${children}**`;
  if (node.tagName === "EM" || node.tagName === "I") return `*${children}*`;
  if (node.tagName === "U") return `<u>${children}</u>`;
  if (node.tagName === "A") {
    const href = node.getAttribute("href") || "";
    return href && /^(https?:\/\/|mailto:)/i.test(href) ? `[${children}](${href})` : children;
  }
  if (node.tagName === "BR") return "\n";
  return children;
}

export function editorHtmlToMarkdown(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  root.querySelectorAll("script,style,iframe,object,embed").forEach((node) => node.remove());
  const blocks: string[] = [];

  Array.from(root.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || "").trim();
      if (text) blocks.push(text);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const text = inlineHtmlToMarkdown(node).trim();
    if (!text && node.tagName !== "BR") return;
    if (/^H[1-6]$/.test(node.tagName)) {
      const level = Math.min(3, Number(node.tagName.slice(1)));
      blocks.push(`${"#".repeat(level)} ${text}`);
    } else if (node.tagName === "UL" || node.tagName === "OL") {
      const items = Array.from(node.querySelectorAll(":scope > li")).map((li, index) => {
        const marker = node.tagName === "OL" ? `${index + 1}.` : "-";
        return `${marker} ${inlineHtmlToMarkdown(li).trim()}`;
      });
      blocks.push(items.join("\n"));
    } else if (node.tagName === "BLOCKQUOTE") {
      blocks.push(text.split("\n").map((line) => `> ${line}`).join("\n"));
    } else {
      blocks.push(text);
    }
  });

  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
