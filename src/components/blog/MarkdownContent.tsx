import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function headingId(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

function headingText(children: ReactNode) {
  return Array.isArray(children) ? children.join('') : String(children ?? '')
}

export function MarkdownContent({ content, hideTitle = false }: { content: string; hideTitle?: boolean }) {
  return (
    <div className="prose-blog">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => hideTitle ? null : <h1 id={headingId(headingText(children))}>{children}</h1>,
          h2: ({ children }) => <h2 id={headingId(headingText(children))}>{children}</h2>,
          h3: ({ children }) => <h3 id={headingId(headingText(children))}>{children}</h3>,
          a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
          img: ({ alt, ...props }) => <img {...props} alt={alt || '文章图片'} loading="lazy" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
