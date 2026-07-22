import React from "react";
import FormattedMarkdown from "./FormattedMarkdown";

export default function WorkProductDocument({ content }: { content: string }) {
  return (
    <article className="min-h-full bg-white text-sm leading-relaxed text-zinc-900">
      <FormattedMarkdown content={content} />
    </article>
  );
}
