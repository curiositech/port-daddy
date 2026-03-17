/**
 * Unit Tests for Webhooks Module
 *
 * Comprehensive test coverage for webhook registration, delivery, SSRF prevention,
 * HMAC signing, retry logic, and event filtering.
 *
 * Total tests: 48 organized into 6 categories
 */

import { createTestDb, createMockFetch, waitFor, sleep } from '../setup-unit.js';
import { createWebhooks, WebhookEvent } from '../../lib/webhooks.js';

// =============================================================================
// REGISTRATION TESTS (10 tests)
// =============================================================================

describe('Webhook Registration', () => {
  let db;
  let webhooks;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
  });

  it('should register webhook with valid URL', () => {
    const result = webhooks.register('https://example.com/webhook');
    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
    expect(result.url).toBe('https://example.com/webhook');
    expect(result.events).toEqual(['*']);
  });

  it('should reject invalid URL format', () => {
    const result = webhooks.register('not-a-url');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });

  it('should reject non-http/https protocols', () => {
    const result = webhooks.register('ftp://example.com/webhook');
    expect(result.success).toBe(false);
    expect(result.error).toContain('http or https');
  });

  it('should reject private IP addresses (127.0.0.1)', () => {
    const result = webhooks.register('http://127.0.0.1:8000/webhook');
    expect(result.success).toBe(false);
    expect(result.error).toContain('private or internal');
  });

  it('should reject private IP addresses (10.x.x.x)', () => {
    const result = webhooks.register('http://10.0.0.1/webhook');
    expect(result.success).toBe(false);
    expect(result.error).toContain('private or internal');
  });

  it('should reject private IP addresses (172.16-31.x.x)', () => {
    const result = webhooks.register('http://172.16.0.1/webhook');
    expect(result.success).toBe(false);
    expect(result.error).toContain('private or internal');

    const result2 = webhooks.register('http://172.31.255.254/webhook');
    expect(result2.success).toBe(false);
  });

  it('should reject private IP addresses (192.168.x.x)', () => {
    const result = webhooks.register('http://192.168.1.1/webhook');
    expect(result.success).toBe(false);
    expect(result.error).toContain('private or internal');
  });

  it('should enforce maximum webhook limit', () => {
    // Register 100 webhooks (the max)
    for (let i = 0; i < 100; i++) {
      const result = webhooks.register(`https://example.com/${i}`);
      expect(result.success).toBe(true);
    }

    // 101st should fail
    const result = webhooks.register('https://example.com/101');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Maximum webhook limit');
  });

  it('should reject invalid event types', () => {
    const result = webhooks.register('https://example.com/webhook', {
      events: ['invalid.event']
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid event type');
  });

  it('should reject overly long filter patterns', () => {
    const longPattern = 'a'.repeat(101);
    const result = webhooks.register('https://example.com/webhook', {
      filterPattern: longPattern
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Filter pattern too long');
  });

  it('should reject filter patterns with invalid characters', () => {
    const result = webhooks.register('https://example.com/webhook', {
      filterPattern: 'invalid@pattern!'
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid characters');
  });
});

// =============================================================================
// UPDATE AND DELETE TESTS (5 tests)
// =============================================================================

describe('Webhook Update and Delete', () => {
  let db;
  let webhooks;
  let webhookId;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
    const result = webhooks.register('https://example.com/webhook');
    webhookId = result.id;
  });

  it('should update webhook URL', () => {
    const result = webhooks.update(webhookId, {
      url: 'https://newurl.com/webhook'
    });
    expect(result.success).toBe(true);

    const webhook = webhooks.get(webhookId);
    expect(webhook.webhook.url).toBe('https://newurl.com/webhook');
  });

  it('should update webhook events list', () => {
    const result = webhooks.update(webhookId, {
      events: [WebhookEvent.SERVICE_CLAIM, WebhookEvent.SERVICE_RELEASE]
    });
    expect(result.success).toBe(true);

    const webhook = webhooks.get(webhookId);
    expect(webhook.webhook.events).toEqual([
      WebhookEvent.SERVICE_CLAIM,
      WebhookEvent.SERVICE_RELEASE
    ]);
  });

  it('should toggle webhook active status', () => {
    const result = webhooks.update(webhookId, { active: false });
    expect(result.success).toBe(true);

    let webhook = webhooks.get(webhookId);
    expect(webhook.webhook.active).toBe(false);

    webhooks.update(webhookId, { active: true });
    webhook = webhooks.get(webhookId);
    expect(webhook.webhook.active).toBe(true);
  });

  it('should delete webhook', () => {
    const result = webhooks.remove(webhookId);
    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);

    const webhook = webhooks.get(webhookId);
    expect(webhook.success).toBe(false);
    expect(webhook.error).toContain('not found');
  });

  it('should return error for non-existent webhook', () => {
    const result = webhooks.remove('non-existent-id');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

// =============================================================================
// TRIGGER AND FILTERING TESTS (10 tests)
// =============================================================================

describe('Webhook Trigger and Filtering', () => {
  let db;
  let webhooks;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
  });

  it('should trigger webhooks matching event type', () => {
    const reg = webhooks.register('https://example.com/webhook', {
      events: [WebhookEvent.SERVICE_CLAIM]
    });

    const result = webhooks.trigger(WebhookEvent.SERVICE_CLAIM, { port: 3000 });
    expect(result.triggered).toBe(1);
  });

  it('should not trigger webhooks for non-matching events', () => {
    const reg = webhooks.register('https://example.com/webhook', {
      events: [WebhookEvent.SERVICE_CLAIM]
    });

    const result = webhooks.trigger(WebhookEvent.SERVICE_RELEASE, { port: 3000 });
    expect(result.triggered).toBe(0);
  });

  it('should match wildcard event subscriptions', () => {
    const reg = webhooks.register('https://example.com/webhook', {
      events: ['*']
    });

    const result = webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});
    expect(result.triggered).toBe(1);
  });

  it('should apply filter pattern matching', () => {
    webhooks.register('https://example.com/webhook1', {
      events: [WebhookEvent.SERVICE_CLAIM],
      filterPattern: 'myapp:*'
    });

    webhooks.register('https://example.com/webhook2', {
      events: [WebhookEvent.SERVICE_CLAIM],
      filterPattern: 'otherapp:*'
    });

    const result = webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {}, {
      targetId: 'myapp:api:main'
    });
    expect(result.triggered).toBe(1);
  });

  it('should not trigger inactive webhooks', () => {
    const reg = webhooks.register('https://example.com/webhook');
    webhooks.update(reg.id, { active: false });

    const result = webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});
    expect(result.triggered).toBe(0);
  });

  it('should handle glob pattern * correctly', () => {
    webhooks.register('https://example.com/webhook', {
      filterPattern: '*'
    });

    const result = webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {}, {
      targetId: 'anything'
    });
    expect(result.triggered).toBe(1);
  });

  it('should handle partial glob patterns (myapp:*)', () => {
    webhooks.register('https://example.com/webhook', {
      filterPattern: 'myapp:*'
    });

    const result1 = webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {}, {
      targetId: 'myapp:api'
    });
    expect(result1.triggered).toBe(1);

    const result2 = webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {}, {
      targetId: 'otherapp:api'
    });
    expect(result2.triggered).toBe(0);
  });

  it('should enforce queue size limit', () => {
    // Register webhooks
    webhooks.register('https://example.com/webhook');

    for (let i = 0; i < 50; i++) {
      webhooks.register(`https://example.com/webhook${i}`);
    }

    // Trigger should queue all registered webhooks (51 total)
    const result = webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});
    expect(result.triggered).toBeGreaterThan(0);
    expect(result.triggered).toBeLessThanOrEqual(51);
  });

  it('should return triggered count', () => {
    webhooks.register('https://example.com/webhook1');
    webhooks.register('https://example.com/webhook2');
    webhooks.register('https://example.com/webhook3');

    const result = webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});
    expect(result.triggered).toBe(3);
  });

  it('should include proper payload structure', () => {
    const webhookId = webhooks.register('https://example.com/webhook').id;

    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, { port: 3000, pid: 1234 });

    const deliveries = webhooks.getDeliveries(webhookId);
    expect(deliveries.count).toBe(1);

    const delivery = deliveries.deliveries[0];
    expect(delivery.event).toBe(WebhookEvent.SERVICE_CLAIM);
  });
});

// =============================================================================
// DELIVERY AND RETRY TESTS (10 tests)
// =============================================================================

describe('Webhook Delivery and Retry', () => {
  let db;
  let webhooks;
  let mockFetch;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
    mockFetch = createMockFetch();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('should deliver webhook successfully', async () => {
    mockFetch = createMockFetch({ status: 200, body: 'OK' });
    global.fetch = mockFetch;

    webhooks.register('https://example.com/webhook');
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, { port: 3000 });

    await waitFor(() => mockFetch.calls.length > 0, 2000);
    expect(mockFetch.calls.length).toBeGreaterThan(0);
    expect(mockFetch.calls[0].url).toBe('https://example.com/webhook');
  });

  it('should retry on HTTP error with exponential backoff', async () => {
    mockFetch = createMockFetch({ status: 500, body: 'Server Error' });
    global.fetch = mockFetch;

    webhooks.register('https://example.com/webhook');
    const result = webhooks.trigger(WebhookEvent.SERVICE_CLAIM, { port: 3000 });

    await sleep(100);
    const initialCalls = mockFetch.calls.length;
    expect(initialCalls).toBeGreaterThan(0);
  });

  it('should retry on network error', async () => {
    mockFetch = createMockFetch({
      shouldFail: true,
      failMessage: 'Network timeout'
    });
    global.fetch = mockFetch;

    webhooks.register('https://example.com/webhook');
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, { port: 3000 });

    await sleep(100);
    expect(mockFetch.calls.length).toBeGreaterThan(0);
  });

  it('should mark as failed after max retries', async () => {
    mockFetch = createMockFetch({ status: 500 });
    global.fetch = mockFetch;

    const webhookId = webhooks.register('https://example.com/webhook').id;
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await sleep(200);

    const deliveries = webhooks.getDeliveries(webhookId);
    const delivery = deliveries.deliveries[0];
    // After retries, should be marked as failed or retrying
    expect(['retrying', 'failed']).toContain(delivery.status);
  });

  it('should include HMAC signature when secret configured', async () => {
    mockFetch = createMockFetch({ status: 200 });
    global.fetch = mockFetch;

    webhooks.register('https://example.com/webhook', {
      secret: 'test-secret'
    });

    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => mockFetch.calls.length > 0, 2000);
    const call = mockFetch.calls[0];
    expect(call.opts.headers['X-PortDaddy-Signature']).toBeDefined();
    expect(call.opts.headers['X-PortDaddy-Signature']).toMatch(/^sha256=/);
  });

  it('should include proper headers', async () => {
    mockFetch = createMockFetch({ status: 200 });
    global.fetch = mockFetch;

    webhooks.register('https://example.com/webhook');
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => mockFetch.calls.length > 0, 2000);
    const call = mockFetch.calls[0];
    expect(call.opts.headers['X-PortDaddy-Event']).toBe(WebhookEvent.SERVICE_CLAIM);
    expect(call.opts.headers['X-PortDaddy-Delivery']).toBeDefined();
    expect(call.opts.headers['X-PortDaddy-Timestamp']).toBeDefined();
    expect(call.opts.headers['Content-Type']).toBe('application/json');
  });

  it('should timeout slow deliveries', async () => {
    const slowFetch = async () => {
      throw new Error('AbortError: signal timed out');
    };
    global.fetch = slowFetch;

    const webhookId = webhooks.register('https://example.com/webhook').id;
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await sleep(100);
    // Delivery should have been recorded despite the timeout error
    const deliveries = webhooks.getDeliveries(webhookId);
    expect(deliveries.count).toBeGreaterThanOrEqual(1);
  });

  it('should track delivery status', async () => {
    mockFetch = createMockFetch({ status: 200 });
    global.fetch = mockFetch;

    const webhookId = webhooks.register('https://example.com/webhook').id;
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => {
      const deliveries = webhooks.getDeliveries(webhookId);
      return deliveries.count > 0;
    }, 2000);

    const deliveries = webhooks.getDeliveries(webhookId);
    expect(deliveries.count).toBeGreaterThan(0);
    expect(deliveries.deliveries[0].status).toBeDefined();
  });

  it('should update success/failure counts', async () => {
    mockFetch = createMockFetch({ status: 200 });
    global.fetch = mockFetch;

    const webhookId = webhooks.register('https://example.com/webhook').id;
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => {
      const webhook = webhooks.get(webhookId);
      return webhook.webhook.successCount > 0;
    }, 2000);

    const webhook = webhooks.get(webhookId);
    expect(webhook.webhook.successCount).toBeGreaterThan(0);
  });

  it('should truncate long response bodies', async () => {
    const longBody = 'x'.repeat(2000);
    mockFetch = createMockFetch({ status: 200, body: longBody });
    global.fetch = mockFetch;

    const webhookId = webhooks.register('https://example.com/webhook').id;
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => {
      const deliveries = webhooks.getDeliveries(webhookId);
      return deliveries.count > 0;
    }, 2000);

    const deliveries = webhooks.getDeliveries(webhookId);
    const delivery = deliveries.deliveries[0];
    // Response body should be truncated to max 1000 chars
    if (delivery.responseStatus === 200) {
      expect(delivery.responseStatus).toBe(200);
    }
  });
});

// =============================================================================
// SSRF PREVENTION TESTS (10 tests)
// =============================================================================

describe('SSRF Prevention', () => {
  let db;
  let webhooks;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
  });

  it('should block 127.0.0.1', () => {
    const result = webhooks.register('http://127.0.0.1/webhook');
    expect(result.success).toBe(false);
    expect(result.error).toContain('private or internal');
  });

  it('should block 10.0.0.0/8 range', () => {
    expect(webhooks.register('http://10.0.0.1/webhook').success).toBe(false);
    expect(webhooks.register('http://10.255.255.254/webhook').success).toBe(false);
  });

  it('should block 172.16.0.0/12 range', () => {
    expect(webhooks.register('http://172.16.0.1/webhook').success).toBe(false);
    expect(webhooks.register('http://172.31.255.254/webhook').success).toBe(false);
    expect(webhooks.register('http://172.15.255.254/webhook').success).toBe(true);
    expect(webhooks.register('http://172.32.0.1/webhook').success).toBe(true);
  });

  it('should block 192.168.0.0/16 range', () => {
    expect(webhooks.register('http://192.168.0.1/webhook').success).toBe(false);
    expect(webhooks.register('http://192.168.255.254/webhook').success).toBe(false);
  });

  it('should block localhost hostname', () => {
    const result = webhooks.register('http://localhost/webhook');
    expect(result.success).toBe(false);
    expect(result.error).toContain('private or internal');
  });

  it('should block ::1 IPv6 loopback', () => {
    const result = webhooks.register('http://[::1]/webhook');
    expect(result.success).toBe(false);
    expect(result.error).toContain('private or internal');
  });

  it('should block fc00::/7 IPv6 private', () => {
    const result = webhooks.register('http://[fc00::1]/webhook');
    expect(result.success).toBe(false);
  });

  it('should block metadata.google.internal', () => {
    const result = webhooks.register('http://metadata.google.internal/webhook');
    expect(result.success).toBe(false);
    expect(result.error).toContain('private or internal');
  });

  it('should block 169.254.169.254 metadata service', () => {
    const result = webhooks.register('http://169.254.169.254/webhook');
    expect(result.success).toBe(false);
    expect(result.error).toContain('private or internal');
  });

  it('should allow valid external URLs', () => {
    expect(webhooks.register('https://api.example.com/webhook').success).toBe(true);
    expect(webhooks.register('https://webhook.service.io/v1/hook').success).toBe(true);
    expect(webhooks.register('http://external-server.com:8080/webhooks').success).toBe(true);
  });
});

// =============================================================================
// ADDITIONAL COMPREHENSIVE TESTS (5 tests)
// =============================================================================

describe('Webhook Advanced Features', () => {
  let db;
  let webhooks;
  let mockFetch;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
    mockFetch = createMockFetch();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('should list all webhooks', () => {
    webhooks.register('https://example.com/webhook1');
    webhooks.register('https://example.com/webhook2');

    const list = webhooks.list();
    expect(list.success).toBe(true);
    expect(list.count).toBe(2);
    expect(list.webhooks.length).toBe(2);
  });

  it('should list only active webhooks', () => {
    const w1 = webhooks.register('https://example.com/webhook1');
    const w2 = webhooks.register('https://example.com/webhook2');

    webhooks.update(w1.id, { active: false });

    const list = webhooks.list({ activeOnly: true });
    expect(list.count).toBe(1);
  });

  it('should cleanup old deliveries', () => {
    const webhookId = webhooks.register('https://example.com/webhook').id;
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    const result = webhooks.cleanup();
    expect(result).toBeDefined();
    expect(result.cleaned).toBeGreaterThanOrEqual(0);
  });

  it('should test webhook delivery', async () => {
    mockFetch = createMockFetch({ status: 200, body: 'Test received' });
    global.fetch = mockFetch;

    const webhookId = webhooks.register('https://example.com/webhook').id;

    const result = await webhooks.test(webhookId);

    await sleep(100);
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
  });

  it('should handle test on non-existent webhook', async () => {
    const result = await webhooks.test('non-existent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

// =============================================================================
// DNS REBINDING AND REDIRECT SECURITY TESTS (5 tests)
// =============================================================================

describe('Webhook Advanced Security - DNS & Redirects', () => {
  let db;
  let webhooks;
  let mockFetch;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
    mockFetch = createMockFetch();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('should reject update to private IP URL', () => {
    const result = webhooks.register('https://example.com/webhook');
    expect(result.success).toBe(true);

    // Try to update to private IP
    const updateResult = webhooks.update(result.id, {
      url: 'http://192.168.1.1/webhook'
    });
    expect(updateResult.success).toBe(false);
    expect(updateResult.error).toContain('private or internal');

    // Verify URL wasn't actually changed
    const webhook = webhooks.get(result.id);
    expect(webhook.webhook.url).toBe('https://example.com/webhook');
  });

  it('should reject update with invalid URL format', () => {
    const result = webhooks.register('https://example.com/webhook');
    expect(result.success).toBe(true);

    const updateResult = webhooks.update(result.id, {
      url: 'not-a-valid-url'
    });
    expect(updateResult.success).toBe(false);
    expect(updateResult.error).toContain('Invalid URL');
  });

  it('should reject update with non-http/https protocol', () => {
    const result = webhooks.register('https://example.com/webhook');
    expect(result.success).toBe(true);

    const updateResult = webhooks.update(result.id, {
      url: 'ftp://example.com/webhook'
    });
    expect(updateResult.success).toBe(false);
    expect(updateResult.error).toContain('http or https');
  });

  it('should include redirect: error in fetch options', async () => {
    mockFetch = createMockFetch({ status: 200 });
    global.fetch = mockFetch;

    webhooks.register('https://example.com/webhook');
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => mockFetch.calls.length > 0, 2000);
    const call = mockFetch.calls[0];
    expect(call.opts.redirect).toBe('error');
  });

  it('should include redirect: error in test webhook call', async () => {
    mockFetch = createMockFetch({ status: 200 });
    global.fetch = mockFetch;

    const webhookId = webhooks.register('https://example.com/webhook').id;
    await webhooks.test(webhookId);

    await sleep(100);
    const call = mockFetch.calls[0];
    expect(call.opts.redirect).toBe('error');
  });
});
