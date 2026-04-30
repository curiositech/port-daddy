import { jest } from '@jest/globals';
import Fastify from 'fastify';

const mockAssessBackendReadiness = jest.fn(async (backend) => ({
  backend,
  status: backend === 'claude-cli' ? 'manual_check' : 'ready',
  summary: `${backend} summary`,
  nextStep: backend === 'claude-cli' ? 'Run claude once interactively.' : undefined,
  credentialKeys: backend === 'claude' ? ['ANTHROPIC_API_KEY'] : [],
  credentialAlternates: backend === 'gemini' ? ['GOOGLE_API_KEY'] : [],
  setupCommand: backend === 'claude' ? "printf '\\nANTHROPIC_API_KEY=<paste-value>\\n' >> ~/.port-daddy-env\npd restart" : `setup ${backend}`,
  setupFiles: backend === 'claude' ? ['~/.port-daddy-env', '.env.local', '.env'] : [],
  restartRequired: backend === 'claude',
}));

jest.unstable_mockModule('../../lib/backend-readiness.js', () => ({
  assessBackendReadiness: mockAssessBackendReadiness,
}));

const { fleetPlugin } = await import('../../routes/fleet.js');

describe('fleet routes /fleet/models', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async () => ({
      async json() {
        return {
          models: [{ name: 'llama3.1:8b' }, { name: 'qwen2.5-coder:7b' }],
        };
      },
    }));
  });

  test('returns supported backends with readiness metadata', async () => {
    const app = Fastify();
    await app.register(fleetPlugin, {
      deps: {
        fleetDaemon: {
          getStatus() {
            return { fleets: [] };
          },
        },
        messaging: {
          subscribe() {
            return null;
          },
        },
      },
    });

    const res = await app.inject({ method: 'GET', url: '/fleet/models' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.backends).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'claude-cli',
        supported: true,
        readinessStatus: 'manual_check',
        readinessSummary: 'claude-cli summary',
        readinessNextStep: 'Run claude once interactively.',
      }),
      expect.objectContaining({
        id: 'codex',
        supported: true,
        models: ['gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.4'],
        modelTiers: { low: 'gpt-5.4-mini', mid: 'gpt-5.3-codex', high: 'gpt-5.4' },
        readinessStatus: 'ready',
        readinessSummary: 'codex summary',
        setupCommand: 'setup codex',
      }),
      expect.objectContaining({
        id: 'claude',
        credentialKeys: ['ANTHROPIC_API_KEY'],
        setupFiles: ['~/.port-daddy-env', '.env.local', '.env'],
        restartRequired: true,
      }),
      expect.objectContaining({
        id: 'gemini',
        credentialAlternates: ['GOOGLE_API_KEY'],
      }),
      expect.objectContaining({
        id: 'cloudflare',
        models: [
          '@cf/zai-org/glm-4.7-flash',
          '@cf/openai/gpt-oss-120b',
          '@cf/moonshotai/kimi-k2.6',
          '@cf/qwen/qwen3-30b-a3b-fp8',
          '@cf/nvidia/nemotron-3-120b-a12b',
          '@cf/meta/llama-4-scout-17b-16e-instruct',
        ],
        modelTiers: {
          low: '@cf/zai-org/glm-4.7-flash',
          mid: '@cf/openai/gpt-oss-120b',
          high: '@cf/moonshotai/kimi-k2.6',
        },
      }),
      expect.objectContaining({
        id: 'ollama',
        supported: true,
        models: ['llama3.1:8b', 'qwen2.5-coder:7b', 'qwen2.5-coder:14b'],
        modelTiers: { low: 'qwen2.5-coder:7b', mid: 'llama3.1:8b', high: 'qwen2.5-coder:14b' },
        readinessStatus: 'ready',
        readinessSummary: 'ollama summary',
      }),
      expect.objectContaining({
        id: 'aider',
        models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5'],
        modelTiers: { low: 'gpt-4.1-mini', mid: 'gpt-4.1', high: 'gpt-5' },
      }),
      expect.objectContaining({
        id: 'custom',
        models: ['custom-low', 'custom-mid', 'custom-high'],
        modelTiers: { low: 'custom-low', mid: 'custom-mid', high: 'custom-high' },
      }),
    ]));

    expect(mockAssessBackendReadiness).toHaveBeenCalledWith('claude-cli');
    expect(mockAssessBackendReadiness).toHaveBeenCalledWith('codex');
    expect(mockAssessBackendReadiness).toHaveBeenCalledWith('ollama');

    await app.close();
  });
});
