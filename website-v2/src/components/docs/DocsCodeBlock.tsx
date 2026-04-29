import { DocsCodeBlock as SiteDocsCodeBlock } from '@/components/site/primitives'

interface DocsCodeBlockProps {
  code: string
  output?: string
  language?: 'bash' | 'typescript'
  label?: string
}

export function DocsCodeBlock({ code, output, language = 'bash', label }: DocsCodeBlockProps) {
  return (
    <div className="space-y-[var(--space-3)]">
      <SiteDocsCodeBlock code={code} language={language === 'bash' ? 'cli' : 'typescript'} label={label} />
      {output && (
        <SiteDocsCodeBlock code={output} language="text" label="Output" />
      )}
    </div>
  )
}
