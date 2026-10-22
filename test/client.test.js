import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const react = {
  createElement: (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.length > 1 ? children : children[0],
  }),
  useState: (value) => [value, () => {}],
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useLayoutEffect: () => {},
  useMemo: (fn) => fn(),
  Fragment: 'Fragment',
}

const primitives = {
  Button: (props) => react.createElement('button', props, props.children),
}

const resolve = (specifier) => {
  if (specifier === 'react') return react
  if (specifier === 'react-dom') return { createPortal: (children, container) => ({ type: 'portal', props: { container }, children }) }
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require: ${specifier}`)
}

const factory = (() => {
  let captured
  globalThis.window = { __ModuleLoader__: { load: (entry) => { captured = entry } } }
  try {
    createRequire(import.meta.url)('../client.js')
  } finally {
    delete globalThis.window
  }
  assert.equal(captured.id, 'dsh-peer')
  return captured.factory
})()

test('registers the connection settings section', () => {
  const slots = []
  const plugin = factory(resolve)
  plugin.apply({
    get: () => undefined, emit() {},
    slots: {
      entriesOfSlot: () => [], subscribe: () => () => {},
      inject: (_ownerKey, contribute) => { contribute(); return () => {} },
      register: (options, component) => { slots.push({ options, component }); return () => {} },
    },
  })
  assert.deepEqual(
    slots.map(({ options }) => `${options.name}#${options.id}`),
    ['settings.section#connection', 'conversation.session.header.actions#peer-linked-status'],
  )
  assert.equal(slots[0].options.label(), '连接')
  assert.ok(!slots.some(({ options }) => options.name === 'sidebar.panellist' || options.name === 'main'))
})

function renderSettings(state, android = false) {
  let stateIndex = 0
  const testReact = { ...react, useState: value => [stateIndex++ === 0 ? state : value, () => {}] }
  const entries = []
  const plugin = factory(specifier => specifier === 'react' ? testReact : resolve(specifier))
  plugin.apply({ get: () => undefined, emit() {}, slots: { entriesOfSlot: () => [], subscribe: () => () => {}, inject: (_, contribute) => contribute(), register: (_, component) => entries.push(component) } })
  globalThis.window = android ? { DSHAndroid: { scanPeerQr() {} } } : {}
  try { return entries[0]() } finally { delete globalThis.window }
}

function flatten(tree) {
  if (Array.isArray(tree)) return tree.flatMap(flatten)
  if (!tree || typeof tree !== 'object') return [tree]
  return [tree, ...flatten(tree.children)]
}

test('desktop and Android pairing instructions match their device', () => {
  const state = { state: 'disconnected', sessions: [{ id: 'test', tools: [] }] }
  const desktop = flatten(renderSettings(state)).filter(item => typeof item === 'string').join(' ')
  const android = flatten(renderSettings(state, true)).filter(item => typeof item === 'string').join(' ')
  assert.match(desktop, /设备配对/)
  assert.match(desktop, /在手机的/)
  assert.doesNotMatch(desktop, /输入电脑生成的/)
  assert.match(android, /输入电脑生成的/)
})

test('hosting keeps the pairing code and QR visible while waiting for connection', () => {
  const nodes = flatten(renderSettings({ state: 'connecting', hosting: true, shortCode: 'ABCD2345', qrDataUrl: 'data:image/png;base64,test', sessions: [{ id: 'test', tools: [] }] }))
  assert.ok(nodes.some(item => item?.type === 'img' && item.props.src === 'data:image/png;base64,test'))
  const code = nodes.find(item => typeof item?.type === 'function' && item.props.value === 'ABCD2345')
  assert.ok(code)
  const group = code.type(code.props)
  assert.equal(group.props.style.gridTemplateColumns, 'repeat(8, minmax(0, 1fr))')
  assert.equal(group.children.length, 8)
  assert.ok(group.children.every(item => item.props.style.minWidth === 0))
})

test('linked conversations are a foldable history category and preserve the native browser entry', async () => {
  const nativeContainer = {}, opened = [], injected = [], disposers = [];
  const overview = { connection: 'connected', remoteId: 'other', chats: [{ id: 'remote-chat', title: '联动验收', local: false, sessionId: 'owner-id' }] };
  let mode = 'wrapper';
  const testReact = { ...react, useState: initial => [initial === null ? mode === 'wrapper' ? nativeContainer : overview : initial, () => {}] };
  const plugin = factory(specifier => specifier === 'react' ? testReact : resolve(specifier));
  const NativeBrowser = () => null, children = { 'native.menu': {} }, entry = { component: NativeBrowser, children, store: { native: true }, inject: () => ({native: true}) };
  let refreshes = 0, migrated = false;
  const ctx = { emit() {}, get: name => name === 'layout' ? { panelInfo: { getSnapshot: () => ({activePanelId:'peer-messages'}) }, selectPanel: value => { assert.equal(value,null); migrated=true; } } : name === 'sessions' ? {refresh: async()=>{refreshes++;}} : {openSession: id=>opened.push(id)}, slots: {
    entriesOfSlot: () => [entry], subscribe: () => () => {},
    inject: (name, callback) => { injected.push(name); const dispose=callback(); if(typeof dispose==='function')disposers.push(dispose); }, register: () => () => {},
  } };
  plugin.apply(ctx);
  assert.ok(migrated);assert.ok(injected.includes('sidebar.workspaces'));assert.ok(!injected.includes('sidebar.panellist'));assert.ok(!injected.includes('main'));
  assert.notEqual(entry.component,NativeBrowser);assert.equal(entry.children,children);
  const tree=entry.component({wide:true});assert.equal(tree.children[0].type,NativeBrowser);
  const portal=tree.children[1];assert.equal(portal.props.container,nativeContainer);
  mode='category';const group=portal.children.type(portal.children.props);assert.equal(group.props['aria-label'],'联动消息');
  const rows=flatten(group);assert.ok(rows.some(node=>node?.props?.['aria-expanded']===true));
  const chat=rows.find(node=>node?.props?.className?.includes('dsh-peer-linked-row'));assert.ok(chat);await chat.props.onClick();assert.equal(refreshes,1);assert.deepEqual(opened,['peer-linked-remote-chat']);
  assert.equal(portal.children.type({...portal.children.props,wide:false}),null);
  for(const dispose of disposers.reverse())dispose();assert.equal(entry.component,NativeBrowser);
});
