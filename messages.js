import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const ID = /^[a-zA-Z0-9_-]{1,120}$/;
const TYPES = new Set(['user/message', 'assistant/message', 'assistant/attempt', 'tool/call', 'tool/result', 'turn/start', 'turn/end', 'model/selection', 'inbox/queued', 'inbox/removed', 'inbox/claimed']);
const clone = value => JSON.parse(JSON.stringify(value));
export function visibleEvent(event) {
  if (!event || !Number.isSafeInteger(event.seq) || !TYPES.has(event.type)) return null;
  const source = event.data?.message?.source ?? event.data?.source;
  if (event.type === 'user/message' && source?.kind && source.kind !== 'user') return null;
  // Session headers, system prompts, credentials and request configuration are not a conversation transcript.
  const data = clone(event.data ?? {});
  delete data.meta;
  return { seq: event.seq, type: event.type, time: event.time, data,
    ...(event.surfaceOp === undefined ? {} : { surfaceOp: event.surfaceOp }) };
}
function promptId(event) { return event.data?.source?.rpcId ?? event.data?.message?.source?.rpcId; }
export class LinkedMessages {
  constructor({ file, controller, peer, label = '电脑', interval = 750, changed = () => {} }) {
    this.boot = randomUUID(); this.file = file; this.controller = controller; this.peer = peer; this.label = label;
    this.interval = interval; this.changed = changed; this.generation = 0; this.streams = new Map();
    this.writer = Promise.resolve(); this.receiptQueue = Promise.resolve(); this.clients = new Set();
  }
  async init() {
    if (!this.controller()) throw new Error('当前内核不支持联动消息，请更新 Harness 内核');
    if (!this.initializing) this.initializing = (async () => {
      let data;
      try { data = JSON.parse(await readFile(this.file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (data && (data.v !== 1 || !ID.test(data.deviceId) || !data.chats || !data.outbox || !data.receipts)) throw new Error('联动消息存储格式无效');
      this.data = data ?? { v: 1, deviceId: randomUUID(), chats: {}, outbox: {}, receipts: {} };
      // A process may have died after admission. Never silently replay that prompt.
      for (const item of Object.values(this.data.outbox)) if (item.status === 'sending') item.status = 'uncertain';
      for (const chat of Object.values(this.data.chats)) {
        chat.events = (chat.events ?? []).map(visibleEvent).filter(Boolean);
        chat.live = ''; chat.running = false;
        if (chat.owner === this.data.deviceId && !chat.removed) await this.refresh(chat);
      }
      await this.save();
    })();
    return this.initializing;
  }
  save() {
    const value = JSON.stringify(this.data);
    const write = async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = this.file + '.tmp';
      await writeFile(temp, value, { mode: 0o600 }); await rename(temp, this.file);
    };
    const task = this.writer.then(write); this.writer = task.catch(() => {}); return task;
  }
  touch(persist = true) {
    this.changed();
    for (const response of this.clients) {
      if (response.destroyed || response.writableEnded) { this.clients.delete(response); continue; }
      response.write('data: changed\n\n');
    }
    if (persist && !this.saveTimer) this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined; void this.save().catch(error => { this.error = error.message; });
    }, 200);
    this.saveTimer?.unref();
  }
  async refresh(chat) {
    try {
      const inspection = await this.controller().inspect(chat.sessionId, AbortSignal.timeout(15000));
      chat.events = inspection.events.map(visibleEvent).filter(Boolean);
      chat.version = (chat.version ?? 0) + 1;
    } catch (error) { chat.error = error.message; }
  }
  start() {
    if (this.disposed || !this.controller()) return;
    if (!this.timer) { this.timer = setInterval(() => void this.pump(), this.interval); this.timer.unref(); }
    void this.pump();
  }
  disconnected() { this.generation++; this.remoteId = undefined; this.remoteLabel = undefined; this.touch(false); }
  meta(chat) {
    const { id, owner, members, title, updatedAt, version, removed, sessionId } = chat;
    return { id, owner, members, title, updatedAt, version: owner === this.data.deviceId ? this.boot + ':' + version : version, removed: !!removed, sessionId };
  }
  sharedWith(chat, device) { return !chat.removed && chat.members.includes(device); }
  ownChat(id, remote = false) {
    if (!ID.test(id ?? '')) throw new Error('无效联动对话');
    const chat = this.data.chats[id];
    if (!chat || chat.removed || chat.owner !== this.data.deviceId || (remote && !this.sharedWith(chat, this.remoteId))) throw new Error('此对话未授权共享');
    return chat;
  }
  pending(chat) {
    const ids = new Set(chat.events.map(promptId).filter(Boolean));
    return Object.values(this.data.receipts).filter(item => item.chatId === chat.id && !ids.has(item.requestId))
      .map(({ requestId, text, status, error }) => ({ requestId, text, status, error }));
  }
  async nativeCall(chat, method, request, signal) {
    if (this.peer()?.state !== 'connected' || this.remoteId !== chat.owner) throw Error('执行设备离线，连接恢复后可继续此操作');
    return this.peer().request('messages.native', { deviceId: this.data.deviceId, id: chat.id, method, request }, signal);
  }
  async dispatch(method, args = {}, signal) {
    await this.init();
    if (method === 'messages.hello') {
      if (!ID.test(args.deviceId ?? '') || args.deviceId === this.data.deviceId) throw new Error('Invalid device identity');
      if (this.remoteId && this.remoteId !== args.deviceId) throw new Error('Peer identity changed');
      this.remoteId = args.deviceId; this.remoteLabel = String(args.label ?? '另一台设备').slice(0, 80);
      return { deviceId: this.data.deviceId, label: this.label, version: 1 };
    }
    if (!this.remoteId || args.deviceId !== this.remoteId) throw new Error('联动消息身份尚未确认');
    if (method === 'messages.index') return Object.values(this.data.chats).filter(chat => chat.owner === this.data.deviceId && chat.members.includes(this.remoteId)).map(chat => this.meta(chat));
    const chat = this.ownChat(args.id, true);
    if (method === 'messages.native') {
      if (!['selectModel', 'rename', 'updateQueue', 'cancel', 'attachment', 'upload', 'modelCatalog'].includes(args.method)) throw Error('未授权的联动会话操作');
      if (args.method === 'upload') {
        const request = args.request ?? {};
        if (typeof request.data !== 'string' || request.data.length > 12 * 1024 * 1024) throw Error('联动附件过大');
        const bytes = Buffer.from(request.data, 'base64');
        const uploads = this.uploads?.(); if (!uploads) throw Error('执行设备暂不支持附件上传');
        return uploads.uploadStream({ sessionId: chat.sessionId, data: (async function* () { yield bytes; })(), name: request.name, signal });
      }
      if (args.method === 'modelCatalog') return this.controller().modelCatalog();
      const result = await this.controller()[args.method]({ ...args.request, sessionId: chat.sessionId }, signal);
      if (args.method === 'selectModel' || args.method === 'rename') { await this.refreshNative(chat); chat.version++; this.touch(); }
      return result;
    }
    if (method === 'messages.read') {
      const after = Number.isSafeInteger(args.after) ? args.after : -1;
      const all = chat.events.filter(event => event.seq > after);
      const events = []; let bytes = 0;
      for (const event of all) {
        const size = Buffer.byteLength(JSON.stringify(event));
        if (events.length && (events.length >= 100 || bytes + size > 2 * 1024 * 1024)) break;
        if (size > 8 * 1024 * 1024) throw new Error('单条消息过大，暂时无法同步');
        events.push(event); bytes += size;
      }
      return { ...this.meta(chat), nativeProjections: chat.nativeProjections, nativeCatalog: chat.nativeCatalog, events, queued: this.pending(chat), live: chat.live ?? '', running: !!chat.running, error: chat.error ?? null,
        hasMore: events.length < all.length, through: events.at(-1)?.seq ?? after };
    }
    if (method === 'messages.send') return this.admit(chat, args.requestId, args.text, signal, args);
    if (method === 'messages.receipt') return this.data.receipts[args.requestId]?.chatId === chat.id ? this.data.receipts[args.requestId] : null;
    if (method === 'messages.cancel') return this.controller().cancel({ sessionId: chat.sessionId });
    if (method === 'messages.attachment') return this.controller().attachment({ sessionId: chat.sessionId, attachmentId: args.attachmentId });
    throw new Error('Unknown linked-message request');
  }
  async pump() {
    if (this.pumping || this.disposed || this.peer()?.state !== 'connected') return;
    this.pumping = true; const generation = this.generation; const peer = this.peer();
    const current = () => !this.disposed && generation === this.generation && peer === this.peer() && peer.state === 'connected';
    try {
      await this.init();
      if (!this.remoteId) {
        const hello = await peer.request('messages.hello', { deviceId: this.data.deviceId, label: this.label });
        if (!current()) return;
        if (!ID.test(hello.deviceId ?? '') || hello.version !== 1) throw new Error('对端需要更新联动消息插件');
        this.remoteId = hello.deviceId; this.remoteLabel = hello.label; this.touch(false);
      }
      for (const chat of Object.values(this.data.chats)) if (chat.owner === this.data.deviceId && !chat.removed && chat.members.includes(this.remoteId)) await this.refreshNative(chat);
      const rows = await peer.request('messages.index', { deviceId: this.data.deviceId });
      if (!current()) return;
      if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid linked-message index');
      for (const row of rows) {
        if (!ID.test(row.id ?? '') || row.owner !== this.remoteId || !Array.isArray(row.members) || !row.members.includes(this.data.deviceId)) throw new Error('Invalid shared conversation');
        let chat = this.data.chats[row.id];
        if (chat && chat.owner !== this.remoteId) throw new Error('Shared conversation identity collision');
        if (row.removed) { if (chat) { chat.removed = true; this.touch(); } continue; }
        if (chat?.syncedVersion === row.version && !chat.syncing) continue;
        const result = await peer.request('messages.read', { id: row.id, deviceId: this.data.deviceId, after: chat?.through ?? -1 });
        if (!current()) return;
        if (!Array.isArray(result.events) || result.owner !== this.remoteId || result.id !== row.id) throw new Error('Invalid conversation data');
        const durableChanged = !chat || chat.through !== result.through || chat.title !== result.title || JSON.stringify(chat.queued ?? []) !== JSON.stringify(result.queued ?? []);
        chat ??= { ...row, events: [], through: -1 };
        const events = new Map(chat.events.map(event => [event.seq, event]));
        for (const raw of result.events) { const event = visibleEvent(raw); if (event) events.set(event.seq, event); }
        Object.assign(chat, this.meta(result), { events: [...events.values()].sort((a,b) => a.seq-b.seq),
          nativeProjections: result.nativeProjections, nativeCatalog: result.nativeCatalog, queued: result.queued ?? [], live: String(result.live ?? ''), running: !!result.running, error: result.error,
          through: result.through, syncedVersion: result.version, syncing: !!result.hasMore });
        this.data.chats[chat.id] = chat; this.reconcile(chat); this.touch(durableChanged);
      }
      if (this.error) { this.error = undefined; this.touch(false); }
      for (const item of Object.values(this.data.outbox)) if (item.status === 'pending' && current()) await this.deliver(item);
    } catch (error) { if (current()) { const text = /Invalid remote tool call/.test(error.message) ? '对端插件暂不支持联动消息，请更新两端插件' : error.message; if (this.error !== text) { this.error = text; this.touch(false); } } }
    finally { this.pumping = false; }
  }
  async refreshNative(chat) {
    if (!this.controller().projections) return;
    try {
      const baseline = await this.controller().projections({ sessionId: chat.sessionId }, AbortSignal.timeout(10000));
      const allowed = ['modelSelection', 'title', 'sessionListMetadata', 'imageLimits', 'inbox', 'plan', 'permissions', 'agentPreset'];
      const values = Object.fromEntries(Object.entries(baseline?.values ?? {}).filter(([key]) => allowed.includes(key)));
      const next = { asOfSeq: baseline?.asOfSeq ?? -1, values };
      if (JSON.stringify(chat.nativeProjections) !== JSON.stringify(next)) { chat.nativeProjections = next; chat.version++; this.touch(); }
      if (!chat.nativeCatalog && this.controller().modelCatalog) { chat.nativeCatalog = await this.controller().modelCatalog(); chat.version++; this.touch(); }
    } catch (error) { chat.error = error.message; }
  }
  observeEvent(sessionId, raw) {
    if (!this.data) return;
    for (const chat of Object.values(this.data.chats)) {
      if (chat.owner !== this.data.deviceId || chat.sessionId !== sessionId || chat.removed) continue;
      const event = visibleEvent(raw); if (!event) continue;
      const found = chat.events.findIndex(item => item.seq === event.seq);
      if (found < 0) chat.events.push(event); else chat.events[found] = event;
      chat.events.sort((a,b) => a.seq-b.seq);
      if (event.type === 'user/message' && chat.title === '联动对话') {
        const text = (event.data.message?.content ?? event.data.content ?? []).find(block => block.type === 'text')?.text;
        if (text) chat.title = text.slice(0, 60);
      }
      if (event.type === 'assistant/message' || event.type === 'turn/end') chat.live = '';
      if (event.type === 'turn/start') chat.running = true;
      if (event.type === 'turn/end') chat.running = false;
      chat.updatedAt = Date.now(); chat.version++; this.reconcile(chat); this.touch();
    }
  }
  observeStream(sessionId, frame) {
    if (!this.data) return;
    for (const chat of Object.values(this.data.chats)) {
      if (chat.owner !== this.data.deviceId || chat.sessionId !== sessionId || chat.removed) continue;
      if (frame.type === 'start') { chat.live = ''; chat.running = true; chat.attempt = frame.attemptId; }
      if (frame.type === 'chunk' && frame.chunk?.type === 'text-delta') chat.live = (chat.live ?? '') + frame.chunk.text;
      if (frame.type === 'end') chat.live = '';
      chat.version++; this.touch(false);
    }
  }
  reconcile(chat) {
    const ids = new Set(chat.events.map(promptId).filter(Boolean));
    for (const item of Object.values(this.data.outbox)) if (item.chatId === chat.id && ids.has(item.requestId)) delete this.data.outbox[item.requestId];
  }
  async admit(chat, requestId, text, signal = AbortSignal.timeout(30000), prompt = {}) {
    if (!ID.test(requestId ?? '') || typeof text !== 'string' || (!text.trim() && !prompt.content?.length) || text.length > 64000) throw new Error('消息为空或过长');
    const task = async () => {
      const receipt = this.data.receipts[requestId];
      if (receipt) {
        if (receipt.chatId !== chat.id || receipt.text !== text || JSON.stringify(receipt.content) !== JSON.stringify(prompt.content)) throw new Error('消息标识已被其他内容使用');
        if (receipt.status === 'accepted') return { accepted: true, requestId };
        // An interrupted admission is never guessed safe to replay.
        throw new Error('该消息的执行结果尚未确认，请在执行设备检查后再发送新消息');
      }
      signal.throwIfAborted();
      this.data.receipts[requestId] = { chatId: chat.id, requestId, text, content: prompt.content, status: 'admitting' };
      chat.version++; this.touch(false);
      await this.save();
      try {
        await this.controller().prompt({ sessionId: chat.sessionId, requestId, mode: prompt.mode === 'steer' ? 'steer' : 'queue', content: prompt.content ?? [{ type: 'text', text }], ...(prompt.clientTimeZone ? { clientTimeZone: prompt.clientTimeZone } : {}) }, signal);
        this.data.receipts[requestId].status = 'accepted'; chat.version++; await this.save(); this.touch();
        return { accepted: true, requestId };
      } catch (error) { this.data.receipts[requestId].error = error.message; await this.save(); throw error; }
    };
    const result = this.receiptQueue.then(task); this.receiptQueue = result.catch(() => {}); return result;
  }
  async deliver(item) {
    const chat = this.data.chats[item.chatId]; if (!chat || chat.removed) return;
    if (chat.owner !== this.data.deviceId && (this.peer()?.state !== 'connected' || this.remoteId !== chat.owner)) return;
    item.status = 'sending'; await this.save(); this.touch(false);
    try {
      if (chat.owner === this.data.deviceId) await this.admit(chat, item.requestId, item.text, undefined, item);
      else await this.peer().request('messages.send', { deviceId: this.data.deviceId, id: chat.id, requestId: item.requestId, text: item.text, content: item.content, mode: item.mode, clientTimeZone: item.clientTimeZone });
      if (this.data.outbox[item.requestId]) item.status = 'accepted';
    } catch (error) { if (this.data.outbox[item.requestId]) { item.status = 'uncertain'; item.error = error.message; } }
    this.reconcile(chat); await this.save(); this.touch(false);
  }
  async overview() {
    if (!this.controller()) return { available: false, chats: [], connection: this.peer()?.state ?? 'disconnected' };
    await this.init(); this.start();
    return { available: true, deviceId: this.data.deviceId, label: this.label, remoteId: this.remoteId, remoteLabel: this.remoteLabel,
      connection: this.peer()?.state ?? 'disconnected', error: this.error ?? null,
      chats: Object.values(this.data.chats).filter(chat => !chat.removed).map(chat => ({ ...this.meta(chat),
        pendingCount: Object.values(this.data.outbox).filter(item => item.chatId === chat.id).length, uncertainIds: Object.values(this.data.outbox).filter(item => item.chatId === chat.id && item.status === 'uncertain').map(item => item.requestId), local: chat.owner === this.data.deviceId, running: !!chat.running, syncing: !!chat.syncing })).sort((a,b) => b.updatedAt-a.updatedAt) };
  }
  async action(input) {
    await this.init();
    if (input.action === 'sessions') {
      const result = await this.controller().list({}, AbortSignal.timeout(15000));
      return result.items.filter(item => !item.origin && !item.blank).map(item => ({ sessionId: item.sessionId,
        title: item.projections?.values?.sessionTitle?.title ?? ('本机对话 ' + item.sessionId.slice(0,8)) }));
    }
    if (input.action === 'create' || input.action === 'share') {
      if (this.peer()?.state !== 'connected' || !this.remoteId) throw new Error('请先连接另一台设备');
      let sessionId = input.sessionId;
      if (input.action === 'create') sessionId = (await this.controller().create({})).sessionId;
      if (!ID.test(sessionId ?? '')) throw new Error('请选择本机对话');
      const existing = Object.values(this.data.chats).find(chat => !chat.removed && chat.owner === this.data.deviceId && chat.sessionId === sessionId && chat.members.includes(this.remoteId));
      if (existing) return { id: existing.id };
      const chat = { id: randomUUID(), sessionId, owner: this.data.deviceId, members: [this.data.deviceId, this.remoteId],
        title: String(input.title || '联动对话').slice(0,100), version: 0, updatedAt: Date.now(), events: [] };
      await this.refresh(chat); if (chat.error) throw new Error(chat.error);
      this.data.chats[chat.id] = chat; await this.save(); this.touch(false); return { id: chat.id };
    }
    const chat = this.data.chats[input.id];
    if (!chat || chat.removed) throw new Error('找不到联动对话');
    if (input.action === 'view') {
      const records = chat.events.filter(event => !Number.isSafeInteger(input.before) || event.seq < input.before);
      const events = records.slice(-100);
      return { ...this.meta(chat), events, firstSeq: chat.events[0]?.seq ?? null, hasMore: records.length > events.length, queued: chat.owner === this.data.deviceId ? this.pending(chat) : (chat.queued ?? []), live: chat.live ?? '', running: !!chat.running,
        syncing: !!chat.syncing, error: chat.error ?? null,
        outbox: Object.values(this.data.outbox).filter(item => item.chatId === chat.id) };
    }
    if (input.action === 'remove') {
      if (chat.owner !== this.data.deviceId) throw new Error('请在执行设备停止共享这段对话');
      chat.removed = true; chat.events = []; chat.live = ''; chat.version++; await this.save(); this.touch(false); return { ok: true };
    }
    if (input.action === 'send') {
      if (!ID.test(input.requestId ?? '') || typeof input.text !== 'string' || (!input.text.trim() && !input.content?.length) || input.text.length > 64000 || JSON.stringify(input.content ?? []).length > 12 * 1024 * 1024) throw new Error('消息为空或过长');
      const existing = this.data.outbox[input.requestId];
      if (existing && (existing.chatId !== chat.id || existing.text !== input.text || JSON.stringify(existing.content) !== JSON.stringify(input.content))) throw new Error('重复消息标识');
      const item = existing ?? { chatId: chat.id, requestId: input.requestId, text: input.text, content: input.content, mode: input.mode, clientTimeZone: input.clientTimeZone, status: 'pending', createdAt: Date.now() };
      if (existing) return { requestId: item.requestId, status: item.status };
      this.data.outbox[item.requestId] = item; await this.save(); this.touch(false);
      void this.deliver(item).catch(error => { this.error = error.message; this.touch(false); });
      return { requestId: item.requestId, status: item.status };
    }
    if (input.action === 'check') {
      const item = this.data.outbox[input.requestId]; if (!item || item.chatId !== chat.id) throw new Error('找不到待确认消息');
      if (chat.owner !== this.data.deviceId && (this.peer()?.state !== 'connected' || this.remoteId !== chat.owner)) throw new Error('请先连接这段对话的执行设备');
      const receipt = chat.owner === this.data.deviceId ? this.data.receipts[item.requestId] : await this.peer().request('messages.receipt', { deviceId: this.data.deviceId, id: chat.id, requestId: item.requestId });
      if (receipt?.status === 'accepted') { item.status = 'accepted'; item.error = undefined; await this.save(); this.touch(false); }
      return { status: item.status, accepted: receipt?.status === 'accepted' };
    }
    if (input.action === 'cancel') {
      if (chat.owner === this.data.deviceId) return this.controller().cancel({ sessionId: chat.sessionId });
      if (this.remoteId !== chat.owner || this.peer()?.state !== 'connected') throw new Error('执行设备当前离线');
      return this.peer().request('messages.cancel', { deviceId: this.data.deviceId, id: chat.id });
    }
    if (input.action === 'attachment') {
      if (chat.owner === this.data.deviceId) return this.controller().attachment({ sessionId: chat.sessionId, attachmentId: input.attachmentId });
      if (this.remoteId !== chat.owner || this.peer()?.state !== 'connected') throw new Error('执行设备当前离线');
      return this.peer().request('messages.attachment', { deviceId: this.data.deviceId, id: chat.id, attachmentId: input.attachmentId });
    }
    throw new Error('未知联动消息操作');
  }
  async dispose() {
    this.disposed = true; clearInterval(this.timer); clearTimeout(this.saveTimer);
    for (const response of this.clients) response.end(); this.clients.clear();
    if (this.initializing) { await this.initializing.catch(() => {}); if (this.data) await this.save(); }
  }
}
