import { CodeBlock } from '@/components/ui/CodeBlock'

interface DocsCodeBlockProps {
  code: string
  output?: string
  language?: 'bash' | 'typescript'
}

export function DocsCodeBlock({ code, output, language = 'bash' }: DocsCodeBlockProps) {
  return (
    <div className="space-y-3">
      <CodeBlock language={language}>
        {code}
      </CodeBlock>
      {output && (
        <CodeBlock language="output" copyable={false}>
          {output}
        </CodeBlock>
      )}
    </div>
  )
}
