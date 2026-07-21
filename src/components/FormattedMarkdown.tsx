import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Citation } from "../types";

interface Props {
  content: string;
  citations?: Citation[];
  onCitationClick?: (citation: Citation, all: Citation[]) => void;
  onCitationHover?: (citation: Citation, rect: DOMRect) => void;
  onCitationLeave?: () => void;
  className?: string;
}

export function linkInlineCitations(content: string, citations: Citation[] = []) {
  if (!citations.length) return content;
  return content.replace(/\[([^\]]+)\]/g, (match, inner) => {
    const parts = inner.split(",").map((part) => part.trim());
    const linked = parts.map((part) => {
      const id = /^\d+$/.test(part) ? `cit_${part}` : part;
      return citations.some((citation) => citation.id === id) ? `[${id}](#${id})` : null;
    });
    return linked.every(Boolean) ? linked.join("") : match;
  });
}

export default function FormattedMarkdown({
  content,
  citations = [],
  onCitationClick,
  onCitationHover,
  onCitationLeave,
  className = "",
}: Props) {
  const linkedContent = linkInlineCitations(content || "", citations);

  return (
    <div className={`formatted-markdown text-sm leading-relaxed text-zinc-850 ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }: any) => {
            if (href?.startsWith("#cit_")) {
              const citation = citations.find((item) => item.id === href.slice(1));
              if (citation) {
                return (
                  <button
                    type="button"
                    onMouseEnter={(event) => onCitationHover?.(citation, event.currentTarget.getBoundingClientRect())}
                    onMouseLeave={onCitationLeave}
                    onClick={(event) => {
                      event.preventDefault();
                      onCitationClick?.(citation, citations);
                    }}
                    className="mx-0.5 align-super text-[10px] font-mono font-semibold text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline focus:outline-none focus:ring-1 focus:ring-zinc-400 rounded cursor-pointer"
                  >
                    [{citation.id.replace("cit_", "")}]
                  </button>
                );
              }
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-zinc-950 underline underline-offset-2 hover:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400 rounded"
                {...props}
              >
                {children}
              </a>
            );
          },
          h1: ({ children }: any) => <h1 className="mb-2 mt-5 text-lg font-bold text-zinc-950 first:mt-0">{children}</h1>,
          h2: ({ children }: any) => <h2 className="mb-2 mt-4 text-base font-bold text-zinc-950 first:mt-0">{children}</h2>,
          h3: ({ children }: any) => <h3 className="mb-1.5 mt-3 text-sm font-bold text-zinc-950 first:mt-0">{children}</h3>,
          p: ({ children }: any) => <p className="mb-2.5 last:mb-0">{children}</p>,
          ul: ({ children }: any) => <ul className="mb-2.5 ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }: any) => <ol className="mb-2.5 ml-5 list-decimal space-y-1">{children}</ol>,
          li: ({ children }: any) => <li className="pl-1">{children}</li>,
          blockquote: ({ children }: any) => (
            <blockquote className="my-3 border-l-2 border-zinc-300 pl-4 text-zinc-650">{children}</blockquote>
          ),
          table: ({ children }: any) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }: any) => <th className="border border-zinc-250 bg-zinc-50 px-2 py-1 font-semibold">{children}</th>,
          td: ({ children }: any) => <td className="border border-zinc-200 px-2 py-1 align-top">{children}</td>,
          strong: ({ children }: any) => <strong className="font-semibold text-zinc-950">{children}</strong>,
          em: ({ children }: any) => <em className="italic">{children}</em>,
        }}
      >
        {linkedContent}
      </Markdown>
    </div>
  );
}
