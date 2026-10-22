window.__ModuleLoader__.load({
  id: 'dsh-peer',
  factory: (require) => {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const { Button } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const linkedRequest = async body => {
      const response = await fetch('/peer/messages', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '联动消息请求失败')
      return result
    }
    function useLinkedOverview() {
      const [value, setValue] = React.useState(null)
      const [error, setError] = React.useState('')
      React.useEffect(() => {
        let active = true, pending = false
        const refresh = async () => { if (pending) return; pending = true; try { const next = await linkedRequest(); if (active) { setValue(next); setError('') } } catch (failure) { if (active) setError(failure.message) } finally { pending = false } }
        void refresh()
        const events = new EventSource('/peer/messages/events'); events.onmessage = refresh
        const timer = setInterval(refresh, 2000)
        return () => { active = false; clearInterval(timer); events.close() }
      }, [])
      return [value, error]
    }
    function LinkedHistoryCategory({ wide, openConversation }) {
      const [overview, failure] = useLinkedOverview()
      const [expanded, setExpanded] = React.useState(true)
      const [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false)
      const region = React.useRef(null)
      React.useLayoutEffect(() => {
        const node = region.current, root = node?.parentElement
        if (!root || document.documentElement.hasAttribute('data-codsh-theme')) return
        let frame
        const sync = () => {
          frame = undefined
          const copy = (source, targets, properties) => { if (!source) return; const computed = getComputedStyle(source); for (const target of targets) for (const property of properties) if (target.style[property] !== computed[property]) target.style[property] = computed[property] }
          const fonts = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color']
          copy(root.querySelector('[class*="_sectionLabel"]'), node.querySelectorAll('.codsh-section-toggle'), fonts)
          const row = root.querySelector('[class*="_sessionRow"]')
          copy(row, node.querySelectorAll('.codsh-session'), [...fonts, 'height', 'minHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'borderRadius'])
          copy(row?.querySelector('[class*="_title"]'), node.querySelectorAll('.codsh-session > span:first-child'), fonts)
        }
        const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(sync) })
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] }); sync()
        return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame) }
      }, [wide, overview?.chats.length])
      if (wide === false) return null
      const run = async fn => { if (busy) return; setBusy(true); setError(''); try { await fn() } catch (failure) { setError(failure.message) } finally { setBusy(false) } }
      const create = () => run(async () => { const result = await linkedRequest({ action: 'create' }); const next = await linkedRequest(); await openConversation(next.chats.find(chat => chat.id === result.id).sessionId) })
      const connected = overview?.connection === 'connected' && !!overview.remoteId
      return h('section', { ref: region, className: 'dsh-peer-linked-history', 'aria-label': '联动消息', style: { flex: 'none', marginTop: 6 } },
        h('style', null, ':where(.dsh-peer-linked-history .codsh-section-toggle){display:flex;align-items:center;gap:5px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,#888);font:600 12px/18px var(--dsw-font-family,system-ui);text-align:left;cursor:pointer}:where(.dsh-peer-linked-history .codsh-section-toggle svg){width:14px;height:14px;transition:transform 180ms ease}:where(.dsh-peer-linked-history .codsh-section-toggle[aria-expanded=true] svg){transform:rotate(90deg)}:where(.dsh-peer-linked-history .codsh-session){box-sizing:border-box;display:flex;align-items:center;width:100%;height:26px;min-height:26px;margin:1px 0;padding:0 8px;border:0;border-radius:7px;background:transparent;color:inherit;font:12px/18px var(--dsw-font-family,system-ui);text-align:left;cursor:pointer}:where(.dsh-peer-linked-history .codsh-session span){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}:where(.dsh-peer-linked-history .codsh-session:hover){background:var(--dsw-alias-bg-active,#8881)}.dsh-peer-linked-history button:disabled{opacity:.4;cursor:default}'),
        h('h2', { style: { display: 'flex', alignItems: 'center', margin: 0, padding: '2px 4px 3px', fontSize: 12 } },
          h('button', { type: 'button', className: 'codsh-section-toggle', 'aria-expanded': expanded, 'aria-controls': 'dsh-peer-linked-history-list', onClick: () => setExpanded(value => !value), style: { flex: 1 } },
            h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true }, h('path', { d: 'm6 4 4 4-4 4' })), '联动消息'),
          h('button', { type: 'button', 'aria-label': '新建联动对话', title: connected ? '新建联动对话' : '连接另一台设备后可新建联动对话', disabled: busy || !connected, onClick: create, style: { width: 20, height: 18, display: 'grid', placeItems: 'center', border: 0, borderRadius: 5, background: 'none', color: 'var(--codsh-muted,var(--dsw-alias-label-secondary,#888))', padding: 0 } }, h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true }, h('path', { d: 'M8 3v10M3 8h10' })))),
        expanded && h('div', { id: 'dsh-peer-linked-history-list', style: { overflowY: 'auto', minHeight: 0 } },
          ...(overview?.chats || []).map(chat => h('div', { className: 'codsh-session-container', key: chat.id }, h('button', { type: 'button', className: 'codsh-session dsh-peer-linked-row', title: chat.title, onClick: () => run(() => openConversation(chat.local ? chat.sessionId : 'peer-linked-' + chat.id)), style: { gap: 8 } }, h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, chat.title), chat.running && h('span', { title: '正在回复', 'aria-label': '正在回复', style: { width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 } })))),
          overview?.chats.length === 0 && h('p', { style: { margin: '4px 8px 6px', fontSize: 12, opacity: .6 } }, '暂无联动消息')),
        (error || failure) && h('p', { role: 'alert', style: { margin: '4px 8px', fontSize: 12, overflowWrap: 'anywhere' } }, error || failure))
    }
    // Keep the upstream browser's entry, stores, menus and slot declarations.
    // The portal adds one history group inside its existing browsing region.
    function installLinkedHistory(ctx) {
      const decorated = new Map()
      const layout = ctx.get('layout')
      if (layout?.panelInfo.getSnapshot().activePanelId === 'peer-messages') layout.selectPanel(null)
      const openConversation = async sessionId => { await ctx.get('sessions')?.refresh(); ctx.get('uiWorkspace')?.openSession(sessionId) }
      const refreshBrowser = () => {
        // Pulse the public registration ledger so an already-mounted renderer
        // observes the changed component; the native entry always stays elected.
        const remove = ctx.slots.register({ name: 'sidebar.workspaces', priority: Number.MAX_SAFE_INTEGER }, () => null)
        remove()
      }
      const decorate = () => {
        let changed = false
        for (const entry of ctx.slots.entriesOfSlot('sidebar.workspaces')) {
          if (decorated.has(entry)) continue
          const Original = entry.component
          function HistoryWithLinkedCategory(props) {
            const boundary = React.useRef(null)
            const [target, setTarget] = React.useState(null)
            React.useLayoutEffect(() => { const next = boundary.current?.firstElementChild; if (next !== target) setTarget(next || null) }, [props.wide, target])
            return h('div', { ref: boundary, style: { display: 'contents' } }, h(Original, props), target && createPortal(h(LinkedHistoryCategory, { wide: props.wide, openConversation }), target))
          }
          decorated.set(entry, { Original, wrapper: HistoryWithLinkedCategory })
          entry.component = HistoryWithLinkedCategory
          changed = true
        }
        if (changed) refreshBrowser()
      }
      const unsubscribe = ctx.slots.subscribe('sidebar.workspaces', decorate)
      decorate()
      return () => { unsubscribe(); for (const [entry, { Original, wrapper }] of decorated) if (entry.component === wrapper) entry.component = Original; decorated.clear(); refreshBrowser() }
    }
    function LinkedConversationStatus({ sessionId } = {}) {
      const [overview] = useLinkedOverview()
      const [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false)
      const chat = overview?.chats.find(item => (item.local ? item.sessionId : 'peer-linked-' + item.id) === sessionId)
      React.useEffect(() => {
        if (!chat) return
        document.body.classList.add('dsh-peer-native-conversation')
        return () => document.body.classList.remove('dsh-peer-native-conversation')
      }, [chat?.id])
      const action = async () => { setBusy(true); setError(''); try { await linkedRequest(chat ? { action: 'remove', id: chat.id } : { action: 'share', sessionId }) } catch (failure) { setError(failure.message) } finally { setBusy(false) } }
      return h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 } },
        chat && h('style', null, 'body.dsh-peer-native-conversation button[class*="_primary"]{border-radius:999px!important;min-width:36px;min-height:36px;transition:background .16s,box-shadow .16s,transform .16s}body.dsh-peer-native-conversation button[class*="_primary"]:hover:not(:disabled){box-shadow:0 3px 10px #0002}body.dsh-peer-native-conversation button[class*="_primary"]:active:not(:disabled){transform:scale(.95)}@media(prefers-reduced-motion:reduce){body.dsh-peer-native-conversation button[class*="_primary"]{transition:none}}'),
        chat && h('span', { role: 'status' }, overview?.connection === 'connected' ? '联动消息 · 同步中' : '联动消息 · 离线，恢复后补齐'),
        chat?.pendingCount > 0 && h('span', { role: 'status' }, '待同步消息 ' + chat.pendingCount + ' 条'),
        chat?.uncertainIds?.length > 0 && h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: async () => { for (const requestId of chat.uncertainIds) { try { await linkedRequest({ action: 'check', id: chat.id, requestId }) } catch (failure) { setError(failure.message) } } } }, '核对发送结果'),
        (!chat || chat.local) && h(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: busy || !chat && overview?.connection !== 'connected', onClick: action, style: { borderRadius: 999 } }, chat ? '停止共享' : '加入联动消息'),
        error && h('span', { role: 'alert' }, error))
    }
    const CODE_LENGTH = 8
    const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/

    function parseCode(value) {
      const raw = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      return CODE_RE.test(raw) ? raw : ''
    }

    function CodeBoxes({ value, onChange, disabled, readOnly = false, autoFocus = false }) {
      const refs = React.useRef([])
      const digits = React.useMemo(() => {
        const chars = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)
        return Array.from({ length: CODE_LENGTH }, (_, index) => chars[index] || '')
      }, [value])
      const boxStyle = {
        boxSizing: 'border-box',
        width: '100%',
        minWidth: 0,
        height: 48,
        textAlign: 'center',
        fontSize: 20,
        fontWeight: 600,
        letterSpacing: '0.04em',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-general, #ddd)',
        background: readOnly ? 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,.08))' : 'var(--dsw-alias-bg-layer-2, #fff)',
        color: 'var(--dsw-alias-label-primary, #222)',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        padding: 0,
      }
      function commit(nextDigits) {
        onChange(nextDigits.join('').slice(0, CODE_LENGTH))
      }
      function handleInput(index, event) {
        const char = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1)
        const next = [...digits]
        next[index] = char
        commit(next)
        if (char && index < CODE_LENGTH - 1) refs.current[index + 1]?.focus()
      }
      function handleKeyDown(index, event) {
        if (event.key === 'Backspace' && !digits[index] && index > 0) {
          refs.current[index - 1]?.focus()
          return
        }
        if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus()
        if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) refs.current[index + 1]?.focus()
      }
      function handlePaste(event) {
        event.preventDefault()
        const pasted = parseCode(event.clipboardData.getData('text'))
        if (!pasted) return
        onChange(pasted)
        refs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus()
      }
      return h('div', {
        role: 'group',
        'aria-label': readOnly ? '配对码' : '输入配对码',
        onPaste: readOnly ? undefined : handlePaste,
        style: { display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 'clamp(3px, 1vw, 8px)', width: '100%', maxWidth: 376, marginTop: 16 },
      }, digits.map((digit, index) => h('input', {
        key: index,
        ref: node => { refs.current[index] = node },
        type: 'text',
        inputMode: 'text',
        autoCapitalize: 'characters',
        autoCorrect: 'off',
        spellCheck: false,
        maxLength: 1,
        value: digit,
        readOnly,
        disabled,
        autoFocus: autoFocus && index === 0,
        'aria-label': `配对码第 ${index + 1} 位`,
        onChange: event => handleInput(index, event),
        onKeyDown: event => handleKeyDown(index, event),
        style: boxStyle,
      })))
    }

    function ConnectionSettings() {
      const [state, setState] = React.useState(null)
      const [code, setCode] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const mounted = React.useRef(false)
      const inFlight = React.useRef(false)
      const joinAttempted = React.useRef('')
      const read = React.useCallback(async () => {
        if (inFlight.current) return
        inFlight.current = true
        try {
          const response = await fetch('/peer/settings')
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || '无法读取连接状态')
          if (mounted.current) setState(previous => ({ ...data, qrDataUrl: data.hosting && data.shortCode === previous?.shortCode ? data.qrDataUrl || previous?.qrDataUrl : data.qrDataUrl }))
        } catch (readError) { if (mounted.current) setError(readError.message) }
        finally { inFlight.current = false }
      }, [])
      React.useEffect(() => {
        mounted.current = true
        read()
        const timer = setInterval(read, 3000)
        const scan = event => {
          if (event.detail?.error) setError(event.detail.error)
          else if (event.detail?.code) {
            const parsed = parseCode(event.detail.code)
            if (parsed) { setCode(parsed); setError('') }
            else setError('无效配对码')
          }
        }
        window.addEventListener('dsh-peer-scan', scan)
        return () => { mounted.current = false; clearInterval(timer); window.removeEventListener('dsh-peer-scan', scan) }
      }, [read])
      const active = state && !['disconnected', 'closed', 'error', 'failed'].includes(state.state)
      const connected = state?.state === 'connected'
      async function post(action, fields = {}) {
        if (busy) return
        setBusy(true); setError('')
        try {
          const response = await fetch('/peer/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, ...fields }),
          })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || '连接操作失败')
          if (mounted.current) {
            setState(data)
            if (action === 'join') { setCode(''); joinAttempted.current = '' }
          }
        } catch (postError) { if (mounted.current) setError(postError.message) }
        finally { if (mounted.current) setBusy(false) }
      }
      React.useEffect(() => {
        if (!CODE_RE.test(code) || active || connected || busy) return
        if (joinAttempted.current === code) return
        joinAttempted.current = code
        post('join', { code, allowHttp: true })
      }, [code, active, connected, busy])
      const text = (title, description) => h('div', { style: { minWidth: 0, flex: 1 } }, h('div', { className: 'Pt1bsG_title' }, title), h('div', { className: 'Pt1bsG_description' }, description))
      const row = (title, description, control) => h('div', { className: 'Pt1bsG_row', style: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '16px 0' } }, text(title, description), control)
      const names = { android_status: '设备状态', android_screenshot: '截图', android_screen: '读取屏幕内容', android_tap: '点击屏幕', android_swipe: '滑动屏幕', android_text: '输入文字', android_key: '按键', android_launch_app: '打开应用', android_shell: '执行 shell 命令（高级）', android_displays: '查看显示屏', android_virtual_display: '管理虚拟副屏', android_select_display: '选择显示屏', android_ui: '读取界面结构', android_tap_element: '点击界面元素', android_tap_cell: '按网格点击', android_scroll: '滚动页面', android_find_files: '查找手机文件', android_search_text: '搜索手机文件内容', read: '读取文件', write: '写入文件', edit: '编辑文件', glob: '查找文件', grep: '搜索文件内容', read_image: '查看图片' }
      const hosting = Boolean(state?.hosting && state?.shortCode)
      const isAndroid = Boolean(window.DSHAndroid?.scanPeerQr)
      const canPair = !active && !connected
      const remote = isAndroid ? '电脑' : '另一台设备'
      const cardStyle = {
        padding: '20px clamp(12px, 3vw, 24px)', borderRadius: 16,
        border: '1px solid var(--dsw-alias-border-general, rgba(128,128,128,.2))',
        background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,.04))',
        minWidth: 0,
      }
      const pairingCard = (title, description, ...children) => h('section', { style: cardStyle }, text(title, description), ...children)
      const reconnecting = state?.state === 'reconnecting'
      const statusLabel = reconnecting ? '正在重连' : connected ? '已连接' : hosting ? '等待配对' : active ? '连接中' : '未连接'
      return h('div', { style: { maxWidth: 880, width: '100%', minWidth: 0, display: 'grid', gap: 16 } },
        h('section', { style: cardStyle },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
            h('div', { className: 'Pt1bsG_title', style: { fontSize: 18, fontWeight: 600 } }, isAndroid ? '连接电脑' : '设备配对'),
            h('span', { role: 'status', style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 } },
              h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: connected ? '#22a06b' : active || hosting ? '#d59b32' : '#888' } }), statusLabel)),
          row(isAndroid ? '手机与电脑互联' : '连接手机或其他电脑',
            reconnecting ? '网络已中断，正在自动重连；恢复网络后无需重新配对。' : connected ? `已连接${remote}，可在会话中调用对方共享的工具。` : hosting ? '配对码已生成，等待另一台设备扫码或输入。' : active ? `正在连接${remote}，请保持两端在线…` : isAndroid ? '扫描电脑上的二维码，或输入电脑生成的 8 位配对码。' : '在此生成配对码，让手机扫码连接；也可以输入另一台设备的配对码。',
            (active || hosting) && h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => post('disconnect') }, connected || reconnecting ? '断开连接' : '取消配对')),
          connected && row('连接方式', state.transport?.includes('relay') ? '加密中继连接' : 'P2P 直接连接', h('span', { className: 'Pt1bsG_description' }, '已加密'))),
        (error || state?.error) && h('div', { role: 'alert', style: { ...cardStyle, color: 'var(--dsw-alias-state-error-primary, #d43b3b)', overflowWrap: 'anywhere' } }, error || state.error),
        (canPair || hosting && !connected && !reconnecting) && h('div', { style: { display: 'grid', gap: 16 } },
          pairingCard('创建配对', isAndroid ? '生成本机配对码，供电脑或其他设备输入。' : '生成配对码后，在手机的「设置 → 连接」中扫码或输入。',
            h('div', { style: { marginTop: 16 } }, h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => post('host', { allowHttp: true }) }, hosting ? '重新生成配对码' : '创建配对码')),
            hosting && h(React.Fragment, null,
              h(CodeBoxes, { value: state.shortCode, readOnly: true }),
              state.qrDataUrl && h('img', { src: state.qrDataUrl, alt: '配对二维码', style: { display: 'block', width: 200, maxWidth: '100%', height: 'auto', marginTop: 20, borderRadius: 12, border: '1px solid var(--dsw-alias-border-general, #ddd)' } }),
              h('div', { className: 'Pt1bsG_description', style: { marginTop: 12 } }, '将配对码或二维码展示给另一台设备。'))),
          canPair && pairingCard('输入配对码', `输入${remote}显示的 8 位配对码，输满后自动连接，也支持粘贴完整配对码。`,
            h(CodeBoxes, { value: code, disabled: busy, autoFocus: !isAndroid, onChange: setCode }),
            isAndroid && h('div', { style: { marginTop: 16 } }, h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => window.DSHAndroid.scanPeerQr() }, '扫描电脑二维码')),
            busy && h('div', { className: 'Pt1bsG_description', role: 'status', style: { marginTop: 12 } }, '正在连接…')),
          h('div', { className: 'Pt1bsG_description', style: { padding: '0 4px' } }, '设备连接独立于会话，删除会话不会断开。可用工具默认共享，调用仍需通过本机权限检查。')),
        connected && pairingCard('已共享的工具', state.sharedTools?.map(name => names[name] || name).join('、') || '当前暂无可用工具；打开启用了工具的会话后自动恢复。'))
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'connection', order: 35, label: () => '连接',
        }, ConnectionSettings))
        ctx.slots.inject('sidebar.workspaces', () => installLinkedHistory(ctx))
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: 'peer-linked-status', order: 50 }, LinkedConversationStatus))
      },
    }
  },
})
