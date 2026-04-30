import { DocsCodeBlock as SiteDocsCodeBlock } from '@/components/site/primitives'

type DocsCodeLanguage = 'bash' | 'cli' | 'shell' | 'typescript' | 'ts' | 'javascript' | 'js' | 'json' | 'yaml' | 'yml' | 'text'

interface DocsCodeBlockProps {
  code: string
  output?: string
  language?: DocsCodeLanguage
  label?: string
}

export function DocsCodeBlock({ code, output, language = 'bash', label }: DocsCodeBlockProps) {
  const siteLanguage = language === 'bash' ? 'cli' : language

  return (
    <div className="space-y-[var(--space-3)]">
      <SiteDocsCodeBlock code={code} language={siteLanguage} label={label} />
      {output && (
        <SiteDocsCodeBlock code={output} language="text" label="Output" />
      )}
    </div>
  )
}
