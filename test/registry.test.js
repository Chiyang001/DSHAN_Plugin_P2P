import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { peerToolSchemas, executePeerTool } from '../tools-compat.js';

// Point at an isolated installed kernel to exercise its real public contract.
const requireKernel = createRequire(process.env.DSH_PEER_TEST_KERNEL ? resolve(process.env.DSH_PEER_TEST_KERNEL, 'package.json') : import.meta.url);
const load = name => import(pathToFileURL(requireKernel.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt');
const { default: ToolRuntime, defineTool } = await load('@deepseek-ai/dsh-tools');
const { createScope } = await load('@deepseek-ai/dsh-scope');
import { apply } from '../index.js';

test('real Harness registry accepts plugin schemas, scoped tools, result rendering and permission guards', async () => {
  const ctx = new Context();
  new SystemPrompt(ctx, {}); new ToolRuntime(ctx);
  if (typeof ctx.tools.setExecutor === 'function') {
    const { NativeToolExecutor } = await load('@deepseek-ai/dsh-tool-executor-native');
    ctx.tools.setExecutor(new NativeToolExecutor(ctx));
  }
  const agent = { id: 'registry-test' };
  const scope = createScope(ctx, agent);
  ctx.agents = { get: id => id === agent.id ? agent : undefined };
  apply(ctx);
  let invoked = false;
  scope.ctx.tools.register(defineTool({ name: 'local_test', description: 'test scoped native tool', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { invoked = true; return 'done'; },
  }));
  assert.equal(ctx.tools.schemas().some(item => item.name === 'local_test'), false);
  assert.equal(ctx.tools.schemas(agent).some(item => item.name === 'local_test'), true);
  assert.equal(ctx.tools.schemas(agent).filter(item => item.name.startsWith('peer_')).length, 6);
  assert.deepEqual(peerToolSchemas(ctx.tools, agent).map(tool => tool.name), ['local_test']);
  // Global masks must still hide inherited tools in the agent's view.
  const unregister = ctx.tools.register(defineTool({ name: 'hidden_global', description: 'restricted tool', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { throw Error('must not execute'); } }));
  const unrestrict = scope.ctx.tools.restrict({ deny: ['hidden_global'] });
  assert.equal(peerToolSchemas(ctx.tools, agent).some(tool => tool.name === 'hidden_global'), false);
  unrestrict(); unregister();
  if (typeof ctx.tools.executable === 'function') {
    const removeConditional = scope.ctx.tools.register(defineTool({ name: 'conditional', description: 'step-only tool', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { throw Error('must not execute'); } }), { when: () => true });
    assert.equal(peerToolSchemas(ctx.tools, agent).some(tool => tool.name === 'conditional'), false);
    removeConditional();
  }
  const signal = new AbortController().signal;
  const status = await executePeerTool(ctx.tools, { callId: 'status', name: 'peer_status', arguments: {}, agent, signal });
  assert.equal(status.isError, false); assert.match(status.content[0].text, /disconnected/);
  const removeGuard = ctx.tools.guard(exec => exec.name === 'local_test' ? 'permission denied' : undefined);
  const denied = await executePeerTool(ctx.tools, { callId: 'denied', name: 'local_test', arguments: {}, agent, signal });
  assert.equal(denied.isError, true); assert.equal(invoked, false);
  removeGuard();
  const result = await executePeerTool(ctx.tools, { callId: 'allowed', name: 'local_test', arguments: {}, agent, signal });
  assert.equal(result.isError, false); assert.equal(result.content[0].text, 'done');
  const stop = await executePeerTool(ctx.tools, { callId: 'stop', name: 'peer_disconnect', arguments: {}, agent, signal });
  assert.equal(stop.isError, false);
  await scope.dispose();
});
