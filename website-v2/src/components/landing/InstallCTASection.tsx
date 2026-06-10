import React, { useState, useEffect } from 'react';
import { Copy, Check, Terminal, Package, Zap, Code } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface Tab {
  id: string;
  label: string;
  command: string;
  description: string;
  icon: React.ReactNode;
}

const tabs: Tab[] = [
  {
    id: 'pd-init',
    label: 'pd init',
    command: 'pd init',
    description: 'Initialize a new project with our flagship CLI tool',
    icon: <Zap className="w-4 h-4" />,
  },
  {
    id: 'homebrew',
    label: 'Homebrew',
    command: 'brew install port-daddy',
    description: 'Install via Homebrew package manager for macOS',
    icon: <Package className="w-4 h-4" />,
  },
  {
    id: 'mcp',
    label: 'MCP',
    command: 'pd mcp install',
    description: 'Configure supported MCP clients from the installed Port Daddy CLI',
    icon: <Terminal className="w-4 h-4" />,
  },
  {
    id: 'npx',
    label: 'npx',
    command: 'npx port-daddy init',
    description: 'Run directly with npx without installation',
    icon: <Code className="w-4 h-4" />,
  },
];

const TypewriterText: React.FC<{ text: string; speed?: number }> = ({ text, speed = 50 }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setCurrentIndex((prev) => prev + 1);
      }, speed);
      return () => clearTimeout(timeout);
    }
  }, [currentIndex, text, speed]);

  return <span>{text.slice(0, currentIndex)}</span>;
};

const InstallCTASection: React.FC = () => {
  const [activeTab, setActiveTab] = useState('pd-init');
  const [copied, setCopied] = useState(false);

  const activeTabData = tabs.find((tab) => tab.id === activeTab) || tabs[0];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeTabData.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="w-full min-h-screen flex items-center justify-center p-6"
      style={{
        backgroundColor: 'var(--surface-elevated, #1E1B18)',
      }}
    >
      <style>{`
        :root {
          --brand-primary: #4A9D9E;
          --surface-elevated: #1E1B18;
          --text-primary: #D4C5A9;
          --text-secondary: #9A8F7A;
          --border-subtle: #3A3530;
          --accent-red: #BF2F2F;
        }
      `}</style>

      <div className="w-full max-w-4xl">
        <div className="text-center mb-12">
          <h2
            className="text-4xl md:text-5xl font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Get Started in Seconds
          </h2>
          <p
            className="text-lg md:text-xl"
            style={{ color: 'var(--text-secondary)' }}
          >
            Choose your preferred installation method
          </p>
        </div>

        <Card
          className="border-2 overflow-hidden"
          style={{
            backgroundColor: 'var(--surface-elevated)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          {/* Tabs */}
          <div
            className="flex flex-wrap border-b-2"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-2 px-6 py-4 font-semibold transition-all duration-200 relative"
                style={{
                  color:
                    activeTab === tab.id
                      ? tab.id === 'pd-init'
                        ? 'var(--accent-red)'
                        : 'var(--brand-primary)'
                      : 'var(--text-secondary)',
                  backgroundColor:
                    activeTab === tab.id
                      ? 'rgba(74, 157, 158, 0.1)'
                      : 'transparent',
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {activeTab === tab.id && (
                  <div
                    className="absolute bottom-0 left-0 right-0 h-0.5"
                    style={{
                      backgroundColor:
                        tab.id === 'pd-init'
                          ? 'var(--accent-red)'
                          : 'var(--brand-primary)',
                    }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="p-8">
            {/* Terminal Block */}
            <div
              className="rounded-lg border-2 mb-6 overflow-hidden"
              style={{
                backgroundColor: '#0D0C0B',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <div
                className="flex items-center justify-between px-4 py-3 border-b-2"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <div className="flex items-center gap-2">
                  <Terminal
                    className="w-4 h-4"
                    style={{ color: 'var(--brand-primary)' }}
                  />
                  <span
                    className="text-sm font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Terminal
                  </span>
                </div>
                <Button
                  onClick={handleCopy}
                  size="sm"
                  variant="ghost"
                  className="h-8 px-3"
                  style={{
                    color: copied ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  }}
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" /> Copy
                    </>
                  )}
                </Button>
              </div>
              <div className="px-6 py-6">
                <code
                  className="text-lg md:text-xl font-mono"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <span style={{ color: 'var(--brand-primary)' }}>$ </span>
                  <TypewriterText key={activeTabData.command} text={activeTabData.command} speed={50} />
                </code>
              </div>
            </div>

            {/* Description */}
            <div className="flex items-start gap-3">
              <div
                className="p-2 rounded-lg mt-1"
                style={{
                  backgroundColor: 'rgba(74, 157, 158, 0.1)',
                  color:
                    activeTab === 'pd-init'
                      ? 'var(--accent-red)'
                      : 'var(--brand-primary)',
                }}
              >
                {activeTabData.icon}
              </div>
              <div className="flex-1">
                <p
                  className="text-base md:text-lg leading-relaxed"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {activeTabData.description}
                </p>
                {activeTab === 'pd-init' && (
                  <div
                    className="inline-flex items-center gap-2 mt-3 px-3 py-1.5 rounded-full text-sm font-medium"
                    style={{
                      backgroundColor: 'rgba(191, 47, 47, 0.15)',
                      color: 'var(--accent-red)',
                    }}
                  >
                    <Zap className="w-3.5 h-3.5" /> Recommended
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Additional Info */}
        <div className="text-center mt-8">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Need help? Check out our{' '}
            <a
              href="#"
              className="font-semibold hover:underline"
              style={{ color: 'var(--brand-primary)' }}
            >
              documentation
            </a>{' '}
            or{' '}
            <a
              href="#"
              className="font-semibold hover:underline"
              style={{ color: 'var(--brand-primary)' }}
            >
              join our community
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default InstallCTASection;
