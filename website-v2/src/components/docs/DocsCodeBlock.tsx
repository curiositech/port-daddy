import { DocsCodeBlock as SiteDocsCodeBlock } from '@/components/site/primitives'

interface DocsCodeBlockProps {
  code: string
  output?: string
  language?: 'bash' | 'typescript'
}

export function DocsCodeBlock({ code, output, language = 'bash' }: DocsCodeBlockProps) {
  return (
    <div className="space-y-[var(--space-3)]">
      <SiteDocsCodeBlock code={code} language={language === 'bash' ? 'cli' : 'typescript'} />
      {output && (
        <SiteDocsCodeBlock code={output} language="text" label="Output" />
      )}
    </div>
  )
}
