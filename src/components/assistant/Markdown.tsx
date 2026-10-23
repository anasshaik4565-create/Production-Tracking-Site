import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type P<T extends keyof React.JSX.IntrinsicElements> = ComponentProps<T> & { node?: unknown };

/**
 * Renders the assistant's Markdown (headings, lists, tables, code) as plain React elements.
 * Raw HTML in the text is never rendered, and links open safely in a new tab.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-sm leading-relaxed break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node: _n, ...p }: P<"h1">) => (
            <h3 className="mt-4 mb-2 text-base font-bold first:mt-0" {...p} />
          ),
          h2: ({ node: _n, ...p }: P<"h2">) => (
            <h3 className="mt-4 mb-2 text-base font-bold first:mt-0" {...p} />
          ),
          h3: ({ node: _n, ...p }: P<"h3">) => (
            <h4 className="mt-3 mb-1.5 text-sm font-bold first:mt-0" {...p} />
          ),
          h4: ({ node: _n, ...p }: P<"h4">) => (
            <h4 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0" {...p} />
          ),
          p: ({ node: _n, ...p }: P<"p">) => <p className="my-2 first:mt-0 last:mb-0" {...p} />,
          ul: ({ node: _n, ...p }: P<"ul">) => (
            <ul className="my-2 list-disc space-y-1 pl-5" {...p} />
          ),
          ol: ({ node: _n, ...p }: P<"ol">) => (
            <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />
          ),
          li: ({ node: _n, ...p }: P<"li">) => <li className="pl-0.5" {...p} />,
          strong: ({ node: _n, ...p }: P<"strong">) => <strong className="font-semibold" {...p} />,
          a: ({ node: _n, ...p }: P<"a">) => (
            <a
              className="font-medium text-primary underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
              {...p}
            />
          ),
          hr: () => <hr className="my-3 border-border" />,
          blockquote: ({ node: _n, ...p }: P<"blockquote">) => (
            <blockquote
              className="my-2 border-l-4 border-border pl-3 text-muted-foreground"
              {...p}
            />
          ),
          code: ({ node: _n, className: c, children: kids, ...p }: P<"code">) =>
            /language-/.test(c ?? "") ? (
              <code className={cn("font-mono text-xs", c)} {...p}>
                {kids}
              </code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...p}>
                {kids}
              </code>
            ),
          pre: ({ node: _n, ...p }: P<"pre">) => (
            <pre
              className="my-2 overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-xs"
              {...p}
            />
          ),
          table: ({ node: _n, ...p }: P<"table">) => (
            <div className="my-3 overflow-x-auto rounded-lg border">
              <table className="w-full border-collapse text-left text-xs sm:text-sm" {...p} />
            </div>
          ),
          thead: ({ node: _n, ...p }: P<"thead">) => <thead className="bg-muted" {...p} />,
          th: ({ node: _n, ...p }: P<"th">) => (
            <th className="border-b px-3 py-2 font-semibold whitespace-nowrap" {...p} />
          ),
          td: ({ node: _n, ...p }: P<"td">) => (
            <td className="border-b px-3 py-2 align-top last:border-b-0" {...p} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
