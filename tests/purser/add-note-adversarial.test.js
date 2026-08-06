const { test, expect } = require('@oclif/test');
const { app } = require('../../test-helper');

describe('Adversarial tests for add_note with agent_id', () => {
  test('agent_id not found returns SESSION_NOT_FOUND', async () => {
    const sessionRes = await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'Test Session' } });
    const sessionId = sessionRes.json().id;

    const res = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'test', agentId: 'non-existent' }
    });
    
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('SESSION_NOT_FOUND');
  });

  test('both session_id and agent_id provided uses session_id', async () => {
    const resA = await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'Session A', agentId: 'agent-a' } });
    const sessionIdA = resA.json().id;
    const resB = await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'Session B', agentId: 'agent-b' } });
    const sessionIdB = resB.json().id;

    const res = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'test', sessionId: sessionIdA, agentId: 'agent-b' }
    });
    
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBe(sessionIdA);
  });

  test('agent_id with invalid format', async () => {
    const sessionRes = await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'Test Session', agentId: 'valid-agent' } });
    const sessionId = sessionRes.json().id;

    const res = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'test', agentId: '' }
    });
    
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  test('multiple sessions active, agent_id resolves correctly', async () => {
    const resA = await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'Session A', agentId: 'agent-a' } });
    const sessionIdA = resA.json().id;
    const resB = await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'Session B', agentId: 'agent-b' } });
    const sessionIdB = resB.json().id;

    const res = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'test', agentId: 'agent-a' }
    });
    
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBe(sessionIdA);
  });

  test('agent_id with non-matching session', async () => {
    const resA = await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'Session A', agentId: 'agent-a' } });
    const sessionIdA = resA.json().id;
    const resB = await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'Session B' } });
    const sessionIdB = resB.json().id;

    const res = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'test', agentId: 'agent-a' }
    });
    
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBe(sessionIdA);
  });
});