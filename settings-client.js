window.__ModuleLoader__.load({
  id: 'dsh-peer',
  factory: (require) => {
    const React = require('react')
    const { Button } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const linkedRequest = async body => {
      const response = await fetch('/peer/messages', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '联动消息请求失败')
      return result
    }
    const linkedRequestId = () => {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
      return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
    }
    function linkedRows(events) {
      let rows = []
      for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
        const op = event.surfaceOp
        if (op && typeof op === 'object' && op.op === 'replace') rows = rows.filter(row => row.seq < op.startSeq || row.seq > op.endSeq)
        const data = event.data || {}
        const source = data.message?.source || data.source
        if (event.type === 'user/message' && source?.kind && source.kind !== 'user') continue
        if (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result') {
          rows.push({ seq: event.seq, role: event.type.split('/')[0], blocks: data.message?.content || data.content || [], error: data.message?.isError })
        } else if (event.type === 'tool/call') rows.push({ seq: event.seq, role: 'tool', name: data.name, blocks: [{ type: 'text', text: data.arguments || '' }] })
        else if (event.type === 'turn/end' && !['completed', 'success', 'done', 'stop'].includes(data.reason)) {
          if (typeof data.reason === 'string' && /error|fail|cancel|interrupt/.test(data.reason)) rows.push({ seq: event.seq, role: 'notice', blocks: [{ type: 'text', text: '本轮回复已停止：' + data.reason }] })
        }
      }
      return rows
    }
    function LinkedImage({ chatId, attachment }) {
      const [source, setSource] = React.useState('')
      const [failed, setFailed] = React.useState(false)
      const [attempt, setAttempt] = React.useState(0)
      React.useEffect(() => {
        let active = true
        setFailed(false)
        if (!attachment?.attachmentId) { setFailed(true); return }
        linkedRequest({ action: 'attachment', id: chatId, attachmentId: attachment.attachmentId }).then(value => {
          if (active && /^image\/(png|jpeg|webp|gif)$/.test(value.attachment?.mediaType)) setSource(`data:${value.attachment.mediaType};base64,${value.data}`)
        }).catch(() => { if (active) setFailed(true) })
        return () => { active = false }
      }, [chatId, attachment?.attachmentId, attempt])
      return source ? h('img', { src: source, alt: attachment?.name || '联动图片', style: { display: 'block', maxWidth: '100%', maxHeight: 480, borderRadius: 10 } }) : failed ? h('button', { type: 'button', onClick: () => setAttempt(value => value + 1) }, '图片暂不可用，点击重新加载') : h('span', null, '正在加载图片…')
    }
    function LinkedMessagesPanel({ openLocalSession } = {}) {
      const [overview, setOverview] = React.useState(null)
      const [selected, setSelected] = React.useState(null)
      const [view, setView] = React.useState(null)
      const [drafts, setDrafts] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [sessions, setSessions] = React.useState(null)
      const [shareId, setShareId] = React.useState('')
      const [shareTitle, setShareTitle] = React.useState('')
      const active = React.useRef(null)
      const selectedRef = React.useRef(null)
      const refreshRef = React.useRef(() => {})
      const historyRef = React.useRef(new Map())
      const scroller = React.useRef(null)
      const followBottom = React.useRef(true)
      selectedRef.current = selected
      React.useEffect(() => {
        let mounted = true, refreshing = false, again = false
        const refresh = async () => {
          if (refreshing) { again = true; return }
          refreshing = true
          try {
            const state = await linkedRequest()
            if (!mounted) return
            setOverview(state)
            const id = selectedRef.current
            if (id && state.chats.some(chat => chat.id === id)) {
              const detail = await linkedRequest({ action: 'view', id })
              if (!mounted || selectedRef.current !== id) return
              const cached = historyRef.current.get(id) || new Map()
              for (const event of detail.events) cached.set(event.seq, event)
              historyRef.current.set(id, cached)
              setView({ ...detail, hasMore: cached.size > 0 && Math.min(...cached.keys()) > detail.firstSeq, events: [...cached.values()].sort((a,b) => a.seq-b.seq) })
              if (followBottom.current) requestAnimationFrame(() => { const node = scroller.current; if (node) node.scrollTop = node.scrollHeight })
            } else if (id && mounted) { setSelected(null); setView(null) }
          } catch (failure) { if (mounted) setError(failure.message) }
          finally { refreshing = false; if (again && mounted) { again = false; void refresh() } }
        }
        refreshRef.current = refresh
        void refresh()
        const events = typeof EventSource === 'function' ? new EventSource('/peer/messages/events') : null
        if (events) events.onmessage = () => { void refresh() }
        const timer = setInterval(refresh, 2000)
        return () => { mounted = false; clearInterval(timer); events?.close() }
      }, [])
      React.useEffect(() => { setView(null); followBottom.current = true; void refreshRef.current() }, [selected])
      const run = async fn => {
        if (busy) return
        setBusy(true); setError(''); setNotice('')
        try { await fn(); await refreshRef.current() } catch (failure) { setError(failure.message) } finally { setBusy(false) }
      }
      const create = () => run(async () => { const value = await linkedRequest({ action: 'create' }); setSelected(value.id) })
      const share = () => run(async () => {
        if (!shareId) throw Error('请选择要放入联动消息的本机对话')
        const value = await linkedRequest({ action: 'share', sessionId: shareId, title: shareTitle || sessions.find(item => item.sessionId === shareId)?.title })
        setSelected(value.id); setSessions(null)
      })
      const submit = event => {
        event.preventDefault()
        const id = selected, text = drafts[id] || ''
        if (!text.trim()) return
        run(async () => {
          await linkedRequest({ action: 'send', id, text, requestId: linkedRequestId() })
          setDrafts(previous => ({ ...previous, [id]: '' }))
          followBottom.current = true
        })
      }
      const loadOlder = () => run(async () => {
        const older = await linkedRequest({ action: 'view', id: selected, before: view.events[0]?.seq })
        const cached = historyRef.current.get(selected) || new Map()
        for (const event of older.events) cached.set(event.seq, event)
        historyRef.current.set(selected, cached)
        setView(previous => ({ ...previous, hasMore: older.hasMore, events: [...cached.values()].sort((a,b) => a.seq-b.seq) }))
      })
      const item = overview?.chats.find(chat => chat.id === selected)
      const connected = overview?.connection === 'connected' && !!overview?.remoteId
      const ownerOnline = item?.local || connected && item?.owner === overview.remoteId
      const pending = new Map()
      for (const message of [...(view?.queued || []), ...(view?.outbox || [])]) pending.set(message.requestId, message)
      const button = (text, onClick, disabled = false) => h(Button, { type: 'button', size: 'sm', variant: 'outline', onClick, disabled: busy || disabled }, text)
      const secondary = { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #888)' }
      const border = '1px solid var(--dsw-alias-border-general, rgba(128,128,128,.2))'
      const card = { border, borderRadius: 12, padding: 14, background: 'var(--dsw-alias-bg-layer-1, transparent)' }
      const blocks = (entries, key) => entries.map((block, index) => {
        if (block.type === 'image') return h(LinkedImage, { key: key + ':' + index, chatId: selected, attachment: block.attachment || block })
        if (block.type === 'reasoning') return h('details', { key: key + ':' + index }, h('summary', { style: secondary }, '思考过程'), h('div', { style: { whiteSpace: 'pre-wrap' } }, block.text || ''))
        if (block.type === 'text') return h('div', { key: key + ':' + index, style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7 } }, block.text)
        return h('div', { key: key + ':' + index, style: secondary }, block.name || block.attachment?.name || (block.type === 'tool-call' ? '工具调用：' + block.name : '附件'))
      })
      return h('section', { className: 'dsh-peer-linked', style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0, color: 'var(--dsw-alias-label-primary, inherit)' } },
        h('style', null, '.dsh-peer-linked-body{display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}.dsh-peer-linked-list{flex:0 0 220px;width:220px;box-sizing:border-box}.dsh-peer-linked-chat{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0}@media(max-width:700px){.dsh-peer-linked-body{flex-direction:column}.dsh-peer-linked-list{flex:0 0 auto;width:100%;max-height:140px;border-bottom:1px solid rgba(128,128,128,.2)}}'),
        h('header', { style: { padding: '18px 20px', borderBottom: border, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
          h('div', null, h('strong', { style: { fontSize: 19 } }, '联动消息'), h('div', { style: { ...secondary, marginTop: 6 } }, connected ? `已连接${overview.remoteLabel || '另一台设备'} · 对话记录实时同步` : '离线时可查看已同步记录，重新连接后补齐消息')),
          h('div', { style: { display: 'flex', gap: 8 } }, button('新建联动对话', create, !connected), button('加入已有对话', () => run(async () => { setSessions(await linkedRequest({ action: 'sessions' })) }), !connected))),
        (error || notice || overview?.error) && h('div', { role: error ? 'alert' : 'status', style: { ...card, margin: '10px 20px', color: error ? '#c84646' : undefined } }, error || notice || overview.error),
        overview?.available === false && h('p', { style: { padding: 20 } }, '当前内核暂不支持联动消息，请更新 Harness 内核。'),
        sessions && h('section', { style: { ...card, margin: '10px 20px', display: 'flex', flexWrap: 'wrap', gap: 10 } },
          h('div', { style: { width: '100%', ...secondary } }, '只同步选中的这段对话；它原来的历史记录也会同步给当前连接的设备。'),
          h('select', { 'aria-label': '选择要联动的本机对话', value: shareId, onChange: e => setShareId(e.target.value), style: { maxWidth: '100%', minWidth: 120 } }, h('option', { value: '' }, '选择本机对话'), ...sessions.map(session => h('option', { key: session.sessionId, value: session.sessionId }, session.title))),
          h('input', { 'aria-label': '联动对话名称', placeholder: '对话名称（可选）', value: shareTitle, onChange: e => setShareTitle(e.target.value), style: { minWidth: 120, maxWidth: '100%' } }),
          button('放入联动消息', share, !shareId), button('取消', () => setSessions(null))),
        h('div', { className: 'dsh-peer-linked-body' },
          h('nav', { className: 'dsh-peer-linked-list', 'aria-label': '联动对话', style: { maxWidth: '100%', overflowY: 'auto', padding: 10, borderRight: border } },
            ...(overview?.chats || []).map(chat => h('button', { key: chat.id, type: 'button', onClick: () => { active.current = chat.id; setSelected(chat.id) }, style: { width: '100%', textAlign: 'left', padding: 12, marginBottom: 6, borderRadius: 10, border: chat.id === selected ? '1px solid var(--dsw-alias-state-business-primary, #6389df)' : '1px solid transparent', background: chat.id === selected ? 'var(--dsw-alias-bg-active, rgba(100,130,180,.12))' : 'transparent', color: 'inherit', cursor: 'pointer', overflowWrap: 'anywhere' } },
              h('div', null, chat.title), h('div', { style: { ...secondary, marginTop: 5 } }, chat.local ? '在本机执行' : '在另一台设备执行', chat.running ? ' · 回复中' : '', chat.syncing ? ' · 补齐记录中' : ''))),
            overview && !overview.chats.length && h('p', { style: { ...secondary, padding: 8 } }, '连接设备后新建一段联动对话，或加入已有对话。普通会话不会自动共享。')),
          h('div', { className: 'dsh-peer-linked-chat' },
            !selected ? h('div', { style: { margin: 'auto', padding: 24, textAlign: 'center' } }, h('h2', null, '两端接着聊'), h('p', { style: secondary }, '选择一段联动对话，在手机和电脑上查看同一份记录。')) :
              h(React.Fragment, null,
                h('div', { style: { padding: '12px 18px', borderBottom: border, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' } },
                  h('div', null, h('strong', null, item?.title), h('div', { style: secondary }, item?.local ? 'AI 在本机执行，工具授权仍由本机确认' : ownerOnline ? 'AI 在另一台设备执行，你可以在这里继续发送消息' : '执行设备离线，新的消息将等待连接后发送')),
                  h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, item?.local && openLocalSession && button('在本机完整对话中打开', () => openLocalSession(item.sessionId)),
                  item?.local && button('停止共享', () => run(async () => { await linkedRequest({ action: 'remove', id: selected }); setSelected(null) })))),
                h('div', { ref: scroller, onScroll: e => { const node = e.currentTarget; followBottom.current = node.scrollHeight-node.scrollTop-node.clientHeight < 80 }, style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px clamp(10px, 3vw, 30px)', display: 'flex', flexDirection: 'column', gap: 14 } },
                  view?.hasMore && button('加载更早记录', loadOlder),
                  !view && h('p', { role: 'status', style: secondary }, '正在读取记录…'),
                  ...linkedRows(view?.events || []).map(row => row.role === 'tool' ? h('details', { key: row.seq, style: card }, h('summary', { style: secondary }, row.name ? '工具：' + row.name : row.error ? '工具执行失败' : '工具结果'), ...blocks(row.blocks, row.seq)) :
                    h('article', { key: row.seq, style: { ...card, alignSelf: row.role === 'user' ? 'flex-end' : 'stretch', maxWidth: '100%', background: row.role === 'user' ? 'var(--dsw-alias-bg-active, rgba(100,130,180,.09))' : undefined } }, h('div', { style: { ...secondary, marginBottom: 7 } }, row.role === 'user' ? '用户' : row.role === 'assistant' ? 'AI' : '提示'), ...blocks(row.blocks, row.seq))),
                  ...[...pending.values()].map(message => h('article', { key: message.requestId, style: { ...card, alignSelf: 'flex-end', maxWidth: '100%' } }, h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, message.text),
                    h('div', { style: { ...secondary, marginTop: 8 } }, message.status === 'pending' ? '等待连接后发送' : message.status === 'uncertain' || message.status === 'admitting' ? '发送结果尚未确认，不会自动重发' : message.status === 'sending' ? '正在发送…' : '已发送，等待 AI 处理'),
                    message.status === 'uncertain' && button('核对发送结果', () => run(async () => { const result = await linkedRequest({ action: 'check', id: selected, requestId: message.requestId }); setNotice(result.accepted ? '执行设备已收到这条消息' : '暂未确认，请在执行设备检查；为避免重复执行，不会自动重发。') })))),
                  view?.live && h('article', { style: card, 'aria-label': 'AI 正在回复' }, h('div', { style: secondary }, 'AI · 正在回复'), h('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.7, overflowWrap: 'anywhere' } }, view.live)),
                  view?.syncing && h('p', { role: 'status', style: secondary }, '正在补齐历史记录…')),
                h('form', { onSubmit: submit, style: { padding: '12px 18px 18px', borderTop: border } },
                  h('textarea', { 'aria-label': '发送联动消息', placeholder: ownerOnline ? '在这段联动对话中继续聊…' : '离线消息会在连接恢复后发送…', value: drafts[selected] || '', maxLength: 64000, onChange: e => setDrafts(previous => ({ ...previous, [selected]: e.target.value })), rows: 3, style: { boxSizing: 'border-box', width: '100%', resize: 'vertical', minHeight: 65, maxHeight: 220, border, borderRadius: 10, background: 'transparent', color: 'inherit', padding: 12, font: 'inherit' } }),
                  h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 } },
                    view?.running && button('停止回复', () => run(() => linkedRequest({ action: 'cancel', id: selected })), !ownerOnline),
                    h(Button, { type: 'submit', size: 'sm', disabled: busy || !(drafts[selected] || '').trim() }, busy ? '处理中…' : ownerOnline ? '发送' : '等待连接后发送')))))))
    }
    function LinkedMessagesIcon({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M5 4h11a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H9l-5 4V7a3 3 0 0 1 1-3Z' }), h('path', { d: 'm9 8 2-2 2 2m-2-2v6m3-1 2 2 2-2' }))
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
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'peer-messages', order: 5, label: () => '联动消息',
        }, LinkedMessagesIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'peer-messages',
          inject: () => ({ openLocalSession: sessionId => ctx.get('uiWorkspace')?.openSession(sessionId) }),
        }, LinkedMessagesPanel))
      },
    }
  },
})
