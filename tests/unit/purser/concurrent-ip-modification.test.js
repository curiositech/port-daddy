import Fastify from 'fastify';
import agentHarborRoutes from '../../../routes/agent-harbor.ts';

test('...', async () => {
   let laterHookRan = false;
   const app = Fastify();

   // register plugin first
   app.register(agentHarborRoutes);

   // later hook
   app.addHook('onRequest', (request, reply, done) => {
      laterHookRan = true;
      Object.defineProperty(request, 'ip', { configurable: true, value: '127.0.0.1' });
      done();
   });

   // initial hook to clear ip
   app.addHook('onRequest', (request, reply, done) => {
      Object.defineProperty(request, 'ip', { configurable: true, value: undefined });
      done();
   });

   await app.ready();
   const response = await app.inject({
      method: 'POST',
      url: '/agent-harbor/interactive-context-pressure',
      payload: {}
   });
   expect(response.statusCode).toBe(403);
   expect(laterHookRan).toBe(false);
   await app.close();
});