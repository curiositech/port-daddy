import { test, expect, jest } from '@jest/globals';
import Fastify from 'fastify';
import { orchestratorPlugin } from '../../routes/orchestrator.js';

test.each(['manual', 'edit-only', 'autonomous', 'invalid'])('rule route validates execution intent %s before persistence', async executionIntent => {
  const addRule = jest.fn(() => ({ success: true }));
  const app = Fastify();
  await app.register(orchestratorPlugin, { deps: { orchestrator: { addRule }, logger: { info() {}, error() {} }, metrics: { errors: 0 } } });
  try {
    const response = await app.inject({ method: 'POST', url: '/orchestrator/rules', payload: {
      name: 'governed rule', channelPattern: 'build', action: 'spawn', payload: { task: 'x', executionIntent }, enabled: true,
    } });
    expect(response.statusCode).toBe(executionIntent === 'invalid' ? 400 : 200);
    if (executionIntent === 'invalid') expect(addRule).not.toHaveBeenCalled();
    else expect(addRule).toHaveBeenCalledWith(expect.objectContaining({ payload: { task: 'x', executionIntent } }));
  } finally { await app.close(); }
});
