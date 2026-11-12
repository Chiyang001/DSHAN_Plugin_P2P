import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peerToolSchemas, executePeerTool } from '../tools-compat.js';

const result = { isError: false, content: [{ type: 'text', text: 'done' }] };
const input = () => ({ callId: 'compat-test', name: 'screen', arguments: { text: '中文', enabled: false }, agent: { id: 'phone' }, signal: new AbortController().signal });

test('tool discovery uses only public scoped APIs, excluding peer, transport and conditional tools', () => {
  const agent = {};
  const tools = {
    schemas(scope) { assert.equal(scope, agent); return ['screen', 'conditional', 'peer_call', 'run_code'].map(name => ({ name })); },
    execute() {},
    executable(name, scope) { assert.equal(scope, agent); return name === 'conditional' ? undefined : {}; },
    get resolveExecution() { throw Error('private API must not be read'); },
  };
  assert.deepEqual(peerToolSchemas(tools, agent).map(tool => tool.name), ['screen']);
  delete tools.executable;
  assert.deepEqual(peerToolSchemas(tools, agent).map(tool => tool.name), ['screen', 'conditional']);
});

test('legacy single dispatch preserves arguments, scope, signal and permission denials', async () => {
  const call = input(), denied = { isError: true, content: [{ type: 'text', text: 'permission denied' }] };
  const tools = { schemas() {}, async execute(exec) { assert.equal(exec, call); return denied; } };
  assert.equal(await executePeerTool(tools, call), denied);
});

test('batch dispatch serializes arguments and correlates the one result without a model log or admission bypass', async () => {
  const call = input();
  const tools = { schemas() {}, setExecutor() {}, async execute(batch) {
    assert.deepEqual(batch, { calls: [{ type: 'tool-call', id: call.callId, name: call.name, arguments: JSON.stringify(call.arguments) }], agent: call.agent, signal: call.signal });
    return { results: [{ callId: call.callId, result }], additionalContexts: [], concluded: false };
  } };
  assert.equal(await executePeerTool(tools, call), result);
});

test('missing arguments become an empty JSON object for batch dispatch', async () => {
  const call = input(); delete call.arguments;
  const tools = { schemas() {}, setExecutor() {}, async execute(batch) {
    assert.equal(batch.calls[0].arguments, '{}');
    return { results: [{ callId: call.callId, result }] };
  } };
  assert.equal(await executePeerTool(tools, call), result);
});

test('explicit JSON null and primitive arguments are preserved for kernel validation', async () => {
  for (const value of [null, false, 0, '']) {
    const call = { ...input(), arguments: value };
    const tools = { schemas() {}, setExecutor() {}, async execute(batch) {
      assert.equal(JSON.parse(batch.calls[0].arguments), value);
      return { results: [{ callId: call.callId, result }] };
    } };
    assert.equal(await executePeerTool(tools, call), result);
  }
});

test('malformed results and thrown dispatch errors never cause a second execution', async () => {
  for (const batchApi of [false, true]) for (const outcome of [undefined, { content: [] }, { results: [] }, { results: [{ callId: 'other', result }] }, new Error('already started')]) {
    let calls = 0;
    const tools = { schemas() {}, ...(batchApi ? { setExecutor() {} } : {}), async execute() { calls++; if (outcome instanceof Error) throw outcome; return outcome; } };
    await assert.rejects(executePeerTool(tools, input()), /不兼容|already started/);
    assert.equal(calls, 1);
  }
});

test('cancellation and unsupported contracts fail before dispatch', async () => {
  const call = input(), controller = new AbortController(); controller.abort(); call.signal = controller.signal;
  let calls = 0;
  const tools = { schemas() {}, async execute() { calls++; return result; } };
  await assert.rejects(executePeerTool(tools, call), { name: 'AbortError' });
  assert.equal(calls, 0);
  assert.throws(() => peerToolSchemas({}, call.agent), /更新连接插件/);
  await assert.rejects(executePeerTool({}, input()), /更新连接插件/);
});
