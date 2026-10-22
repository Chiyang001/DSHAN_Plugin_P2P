import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LinkedMessages, visibleEvent } from '../messages.js';
import { Peer } from '../peer.js';
import { createPair } from '../protocol.js';
import { createSignalServer } from '../signal-server.js';

async function until(check, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { if (Date.now() > deadline) throw new Error('Message synchronization timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
function controller() {
  const sessions = new Map(), calls = [];
  let messages;
  return {
    sessions, calls, bind(value) { messages = value; },
    async create() { const sessionId = randomUUID(); sessions.set(sessionId, []); return { sessionId }; },
    async inspect(id) { if (!sessions.has(id)) throw new Error('Session missing'); return { meta: { id }, events: sessions.get(id) }; },
    async list() { return { items: [...sessions.keys()].map(sessionId => ({ sessionId, blank: false })) }; },
    append(id, type, data, surfaceOp) {
      const events = sessions.get(id), event = { seq: events.length, type, data, time: Date.now(), ...(surfaceOp ? { surfaceOp } : {}) };
      events.push(event); messages?.observeEvent(id, event); return event;
    },
    async prompt(request) {
      calls.push(request);
      this.append(request.sessionId, 'user/message', { message: { id: randomUUID(), role: 'user', content: request.content, source: { kind: 'user', rpcId: request.requestId } } });
      return { accepted: true };
    },
    cancel(request) { return { accepted: true, ...request }; },
    async attachment(request) { return { attachment: { attachmentId: request.attachmentId, mediaType: 'image/png' }, data: 'aW1hZ2U=' }; },
  };
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-linked-messages-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  const server = createSignalServer({ port: 0 }); await once(server.http, 'listening');
  const pair = { ...createPair(`ws://127.0.0.1:${server.http.address().port}`), mode: 'relay' };
  const a = controller(), b = controller(); let host, guest;
  const left = new LinkedMessages({ file: join(directory, 'left.json'), controller: () => a, peer: () => host, interval: 20, label: '电脑' });
  const right = new LinkedMessages({ file: join(directory, 'right.json'), controller: () => b, peer: () => guest, interval: 20, label: 'Android 手机' });
  a.bind(left); b.bind(right);
  host = new Peer({ pair, role: 'host', dispatch: (...args) => left.dispatch(...args), reconnectDelay: 20 });
  guest = new Peer({ pair, role: 'guest', dispatch: (...args) => right.dispatch(...args), reconnectDelay: 20 });
  t.after(async () => { await Promise.all([left.dispose(), right.dispose()]); await Promise.all([host.close(), guest.close()]); await server.close(); await rm(directory, { recursive: true, force: true }); });
  await Promise.all([host.ready, guest.ready]); left.start(); right.start();
  await until(() => left.remoteId && right.remoteId);
  return { left, right, a, b, host, guest, directory };
}

test('only selected conversations synchronize, and both endpoints continue one owner session', async t => {
  const { left, right, a, b } = await fixture(t);
  const visible = await a.create(), privateSession = await a.create();
  a.append(visible.sessionId, 'user/message', { message: { content: [{ type: 'text', text: 'history' }] } });
  a.append(visible.sessionId, 'request/header', { secret: 'provider-secret' });
  a.append(visible.sessionId, 'user/message', { message: { content: [{ type: 'text', text: 'internal runtime prompt' }], source: { kind: 'runtime-context' } } });
  a.append(privateSession.sessionId, 'user/message', { message: { content: [{ type: 'text', text: 'private conversation' }] } });
  assert.equal((await right.overview()).chats.length, 0);
  const { id } = await left.action({ action: 'share', sessionId: visible.sessionId, title: '共同讨论' });
  await until(async () => (await right.overview()).chats.length === 1);
  const initial = await right.action({ action: 'view', id });
  assert.equal(initial.events.length, 1); assert.match(JSON.stringify(initial), /history/);
  assert.doesNotMatch(JSON.stringify(initial), /provider-secret|private conversation|internal runtime prompt/);
  const one = randomUUID(), two = randomUUID();
  await left.action({ action: 'send', id, requestId: one, text: 'from desktop' });
  await right.action({ action: 'send', id, requestId: two, text: 'from phone' });
  await until(() => a.calls.length === 2 && right.data.chats[id].events.length === 3);
  assert.equal(b.calls.length, 0);
  assert.equal(a.calls[1].sessionId, visible.sessionId);
  assert.equal(new Set(a.calls.map(call => call.requestId)).size, 2);
  a.append(visible.sessionId, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'one shared reply' }] } });
  await until(() => right.data.chats[id].events.some(event => event.type === 'assistant/message'));
  assert.equal((await right.action({ action: 'view', id })).outbox.length, 0);
});

test('streaming text, tool output and durable settlement appear on the other device', async t => {
  const { left, right, a } = await fixture(t);
  const { id } = await left.action({ action: 'create' });
  await until(() => right.data.chats[id]);
  const sessionId = left.data.chats[id].sessionId;
  left.observeStream(sessionId, { type: 'start', attemptId: 'attempt' });
  left.observeStream(sessionId, { type: 'chunk', attemptId: 'attempt', chunk: { type: 'text-delta', text: 'hello ' } });
  left.observeStream(sessionId, { type: 'chunk', attemptId: 'attempt', chunk: { type: 'text-delta', text: 'phone' } });
  await until(() => right.data.chats[id].live === 'hello phone');
  a.append(sessionId, 'tool/call', { name: 'read', arguments: '{"file_path":"test.txt"}' });
  a.append(sessionId, 'tool/result', { message: { isError: false, content: [{ type: 'text', text: 'tool output' }] }, meta: { localOnly: true } });
  a.append(sessionId, 'assistant/message', { message: { content: [{ type: 'text', text: 'hello phone' }] } });
  await until(() => right.data.chats[id].events.length === 3 && right.data.chats[id].live === '');
  assert.doesNotMatch(JSON.stringify(right.data.chats[id]), /localOnly/);
});

test('network interruption backfills history, sends an offline draft once, and preserves cached records after restart', async t => {
  const { left, right, a, b, host, guest, directory } = await fixture(t);
  const { id } = await left.action({ action: 'create' });
  await until(() => right.data.chats[id]);
  const paused = right.pump.bind(right); right.pump = async () => {};
  guest.ws.terminate();
  await until(() => guest.state === 'reconnecting');
  const requestId = randomUUID();
  await right.action({ action: 'send', id, requestId, text: 'offline draft' });
  a.append(left.data.chats[id].sessionId, 'assistant/message', { message: { content: [{ type: 'text', text: 'reply while disconnected' }] } });
  await until(() => host.state === 'connected' && guest.state === 'connected');
  right.pump = paused;
  await until(() => a.calls.length === 1 && right.data.chats[id].events.length === 2);
  assert.equal(a.calls[0].requestId, requestId); assert.equal(b.calls.length, 0);
  await right.dispose();
  const reopened = new LinkedMessages({ file: join(directory, 'right.json'), controller: () => b, peer: () => undefined });
  t.after(() => reopened.dispose());
  const overview = await reopened.overview();
  assert.equal(overview.chats.length, 1); assert.equal(overview.connection, 'disconnected');
  assert.equal((await reopened.action({ action: 'view', id })).events.length, 2);
});

test('lost send acknowledgement is checked without replay; changed request content is rejected', async t => {
  const { left, right, a, guest } = await fixture(t);
  const { id } = await left.action({ action: 'create' }); await until(() => right.data.chats[id]);
  const request = guest.request.bind(guest);
  guest.request = async (method, args, signal) => {
    const result = await request(method, args, signal);
    if (method === 'messages.send') throw new Error('Acknowledgement lost');
    return result;
  };
  const requestId = randomUUID();
  await right.action({ action: 'send', id, requestId, text: 'execute only once' });
  await until(() => a.calls.length === 1);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(a.calls.length, 1);
  await assert.rejects(left.admit(left.data.chats[id], requestId, 'different text'), /其他内容/);
  assert.equal((await left.admit(left.data.chats[id], requestId, 'execute only once')).accepted, true);
  assert.equal(a.calls.length, 1);
});

test('other paired devices cannot read old linked chats or command private session IDs; stopping sharing removes the mirror', async t => {
  const { left, right, a } = await fixture(t);
  const { id } = await left.action({ action: 'create' }); await until(() => right.data.chats[id]);
  const privateSession = await a.create();
  await assert.rejects(left.dispatch('messages.read', { deviceId: right.data.deviceId, id: privateSession.sessionId }), /未授权/);
  const original = left.remoteId; left.remoteId = randomUUID();
  assert.deepEqual(await left.dispatch('messages.index', { deviceId: left.remoteId }), []);
  await assert.rejects(left.dispatch('messages.read', { deviceId: left.remoteId, id }), /未授权/);
  left.remoteId = original;
  await left.action({ action: 'remove', id });
  await until(async () => (await right.overview()).chats.length === 0);
  assert.ok(a.sessions.has(left.data.chats[id].sessionId));
});

test('history is paginated and credentials/system headers are excluded from synchronized events', async t => {
  const { left, right, a } = await fixture(t);
  const { sessionId } = await a.create();
  for (let index = 0; index < 220; index++) a.append(sessionId, 'user/message', { message: { content: [{ type: 'text', text: 'message ' + index }] } });
  a.append(sessionId, 'system/message', { message: { content: [{ type: 'text', text: 'private system prompt' }] } });
  const { id } = await left.action({ action: 'share', sessionId });
  await until(() => right.data.chats[id]?.events.length === 220);
  const recent = await right.action({ action: 'view', id });
  assert.equal(recent.events.length, 100); assert.equal(recent.hasMore, true);
  const earlier = await right.action({ action: 'view', id, before: recent.events[0].seq });
  assert.equal(earlier.events.length, 100); assert.ok(earlier.events.at(-1).seq < recent.events[0].seq);
  assert.equal(visibleEvent({ seq: 1, type: 'request/header', data: { apiKey: 'secret' } }), null);
  assert.doesNotMatch(await readFile(left.file, 'utf8'), /private system prompt/);
});
