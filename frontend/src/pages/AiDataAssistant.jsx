import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Plus, Trash2, Sparkles, Mic, ArrowUp, Search, PanelLeft, PanelLeftClose, X } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import KbAnswer from '../components/assistant/KbAnswer'
import {
  askKnowledgeBase, currentUserId,
  listAssistantChats, getAssistantChat, saveAssistantChat, deleteAssistantChat,
} from '../api/frappe'

// English only for now; the backend still supports Kiswahili when it is switched back on.
const LANGUAGE = 'English'
const GENERIC_ERROR = 'Sorry, something went wrong while processing that request.'
const LEGACY_KEY = 'krcs_ai_assistant_chats'

const COLLAPSE_KEY = 'krcs_ai_chats_collapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

function kbHistory(messages) {
  return messages.slice(-6).map((m) => ({
    role: m.role,
    content: m.kind === 'kb' ? m.result?.answer || m.content || '' : m.content || '',
  }))
}

function getRealtime() {
  const rt = typeof window !== 'undefined' ? window.frappe?.realtime : null
  return rt && typeof rt.on === 'function' ? rt : null
}

function buildErrorReply(e, question) {
  if (e?.status === 503) {
    return { role: 'assistant', kind: 'error', content: 'The knowledge base is temporarily unavailable. Try again in a moment.', retryable: true, question }
  }
  if (e?.status === 403) {
    return { role: 'assistant', kind: 'error', content: 'You don’t have access to the knowledge base. Ask an administrator.' }
  }
  return { role: 'assistant', kind: 'error', content: GENERIC_ERROR, retryable: true, question }
}

// "2026-11-06 12:14:03.123" (server time) -> Date
function toDate(v) {
  if (typeof v === 'number') return new Date(v)
  return new Date(String(v || '').replace(' ', 'T'))
}

function groupChats(list) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const day = 86400000
  const groups = [['Today', []], ['Yesterday', []], ['Previous 7 days', []], ['Older', []]]
  list.forEach((c) => {
    const t = toDate(c.updatedAt).getTime()
    const i = t >= start.getTime() ? 0 : t >= start.getTime() - day ? 1 : t >= start.getTime() - 7 * day ? 2 : 3
    groups[i][1].push(c)
  })
  return groups.filter(([, items]) => items.length)
}

const voiceSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

function Composer({ value, onChange, onSend, disabled, isRecording, onVoice, textareaRef, autoFocus }) {
  return (
    <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm focus-within:border-gray-300">
      <textarea
        ref={textareaRef}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSend()
          }
        }}
        rows={1}
        aria-label="Your question"
        placeholder="Ask about protocols, case definitions or outbreak response…"
        className="flex-1 max-h-40 resize-none bg-transparent py-1.5 text-[15px] text-gray-800 placeholder:text-gray-400 focus:outline-none"
      />
      {voiceSupported && (
        <button
          type="button"
          onClick={onVoice}
          title="Voice input"
          aria-label="Voice input"
          className={['flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
            isRecording ? 'bg-red-100 text-red-700' : 'text-gray-500 hover:bg-gray-100'].join(' ')}
        >
          <Mic className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onSend}
        aria-label="Send"
        disabled={!value.trim() || disabled}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </div>
  )
}

function Avatar() {
  return (
    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-600">
      <Sparkles className="h-3.5 w-3.5 text-white" />
    </div>
  )
}

export default function AiDataAssistant() {
  const [chats, setChats] = useState([])
  const [chatsLoaded, setChatsLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [current, setCurrent] = useState(null) // { id, title, messages }
  const [inputText, setInputText] = useState(() => new URLSearchParams(window.location.search).get('q') || '')
  const [isLoading, setIsLoading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [live, setLive] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const scrollAreaRef = useRef(null)
  const textareaRef = useRef(null)
  const recognitionRef = useRef(null)
  const currentRef = useRef(current)
  currentRef.current = current

  const messages = current?.messages || []
  const grouped = useMemo(() => groupChats(chats), [chats])

  function toggleCollapsed() {
    setCollapsed((v) => {
      try { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1') } catch { /* per-device preference only */ }
      return !v
    })
  }

  const refreshChats = useCallback(async (term = '') => {
    try {
      setChats(await listAssistantChats(term))
    } catch {
      // list stays as it was
    }
    setChatsLoaded(true)
  }, [])

  // chats saved on this device before they moved to the server are uploaded once, then removed from the device
  useEffect(() => {
    async function migrate() {
      const key = `${LEGACY_KEY}:${currentUserId() || 'Guest'}`
      try {
        const raw = localStorage.getItem(key)
        const old = raw ? JSON.parse(raw) : []
        for (const c of Array.isArray(old) ? old : []) {
          if (c?.id && c.messages?.length) await saveAssistantChat({ id: c.id, title: c.title, messages: c.messages })
        }
        localStorage.removeItem(key)
        localStorage.removeItem(LEGACY_KEY)
      } catch {
        // leave them on the device and try again next time
      }
      refreshChats()
    }
    migrate()
  }, [refreshChats])

  useEffect(() => {
    if (!chatsLoaded) return undefined
    const t = setTimeout(() => refreshChats(search.trim()), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  useEffect(() => () => recognitionRef.current?.stop(), [])

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (scrollAreaRef.current) scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    })
  }

  function autoGrow() {
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    })
  }

  async function persist(chat) {
    try {
      await saveAssistantChat(chat)
      setSaveError(false)
      refreshChats(search.trim())
    } catch {
      setSaveError(true)
    }
  }

  function newChat() {
    setCurrent(null)
    setInputText('')
    setPanelOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  async function openChat(id) {
    setPanelOpen(false)
    if (current?.id === id) return
    try {
      const chat = await getAssistantChat(id)
      setCurrent({ id: chat.id, title: chat.title, messages: chat.messages || [] })
      scrollToBottom()
    } catch {
      refreshChats(search.trim())
    }
  }

  async function removeChat(id) {
    try {
      await deleteAssistantChat(id)
    } catch {
      // already gone
    }
    if (current?.id === id) setCurrent(null)
    setChats((prev) => prev.filter((c) => c.id !== id))
  }

  async function runQuery(chat, question) {
    setIsLoading(true)
    scrollToBottom()
    let reply
    try {
      const history = kbHistory(chat.messages.slice(0, -1))
      const streamId = crypto.randomUUID()
      const rt = getRealtime()
      const handler = (data) => {
        if (!data || data.stream_id !== streamId || data.done) return
        if (data.status === 'checking') {
          setLive({ streamId, text: 'Writing a summary and checking it against the approved documents…' })
          return
        }
        if (data.delta) {
          setLive((prev) => ({ streamId, text: (prev?.streamId === streamId ? prev.text : '') + data.delta }))
          scrollToBottom()
        }
      }
      if (rt) rt.on('kb_answer', handler)
      let result
      try {
        result = await askKnowledgeBase({ query: question, language: LANGUAGE, history, streamId, conversationId: chat.id })
      } finally {
        rt?.off?.('kb_answer', handler)
        setLive(null)
      }
      reply = { role: 'assistant', kind: 'kb', result, content: result.answer }
    } catch (e) {
      reply = buildErrorReply(e, question)
    }
    const latest = currentRef.current?.id === chat.id ? currentRef.current : chat
    const next = { ...latest, messages: [...latest.messages, reply] }
    if (currentRef.current?.id === chat.id) setCurrent(next)
    setIsLoading(false)
    scrollToBottom()
    persist(next)
  }

  function send() {
    const question = inputText.trim()
    if (!question || isLoading) return
    const base = current || { id: crypto.randomUUID(), title: question.slice(0, 80), messages: [] }
    const chat = { ...base, messages: [...base.messages, { role: 'user', content: question }] }
    setCurrent(chat)
    setInputText('')
    autoGrow()
    if (!current) setChats((prev) => [{ id: chat.id, title: chat.title, updatedAt: Date.now(), count: 1 }, ...prev])
    runQuery(chat, question)
  }

  function retry(index) {
    if (isLoading || !current) return
    const msg = current.messages[index]
    if (!msg?.retryable) return
    const chat = { ...current, messages: current.messages.filter((_, i) => i !== index) }
    setCurrent(chat)
    runQuery(chat, msg.question)
  }

  function rememberFeedback(index, value) {
    if (!current) return
    const next = { ...current, messages: current.messages.map((m, i) => (i === index ? { ...m, result: { ...m.result, feedback: value } } : m)) }
    setCurrent(next)
    persist(next)
  }

  function toggleVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }
    if (!recognitionRef.current) {
      const rec = new SR()
      rec.continuous = false
      rec.interimResults = false
      rec.onresult = (event) => {
        const transcript = event.results[0][0].transcript
        setInputText((prev) => (prev ? prev + ' ' : '') + transcript)
        autoGrow()
      }
      rec.onend = () => setIsRecording(false)
      rec.onerror = () => setIsRecording(false)
      recognitionRef.current = rec
    }
    recognitionRef.current.lang = 'en-US'
    setIsRecording(true)
    recognitionRef.current.start()
  }

  const composer = (
    <Composer
      value={inputText}
      onChange={(v) => { setInputText(v); autoGrow() }}
      onSend={send}
      disabled={isLoading}
      isRecording={isRecording}
      onVoice={toggleVoice}
      textareaRef={textareaRef}
      autoFocus
    />
  )

  return (
    <AppShell>
      <div className="relative -m-4 flex h-[calc(100vh-80px)] overflow-hidden bg-white lg:-m-8">
        {/* chat list */}
        {panelOpen && <button type="button" aria-label="Close chats" onClick={() => setPanelOpen(false)} className="absolute inset-0 z-20 bg-black/20 md:hidden" />}
        <aside
          className={[
            'z-30 w-72 shrink-0 flex-col border-r border-gray-100 bg-gray-50',
            panelOpen ? 'absolute inset-y-0 left-0 flex shadow-xl' : 'hidden',
            'md:static md:flex md:shadow-none',
            collapsed ? 'md:hidden' : '',
          ].join(' ')}
        >
          <div className="space-y-3 p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={newChat}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-red-700"
              >
                <Plus className="h-4 w-4" /> New chat
              </button>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label="Close chats" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 md:hidden">
                <X className="h-4 w-4" />
              </button>
              <button type="button" onClick={toggleCollapsed} aria-label="Hide chats" title="Hide chats" className="hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100 md:block">
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats"
                aria-label="Search chats"
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-100"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            <div className="px-2 pb-1 pt-2 text-xs font-medium text-gray-400">Recent chats</div>
            {chatsLoaded && !chats.length && (
              <p className="px-2 py-4 text-sm text-gray-400">{search.trim() ? 'No chats match your search.' : 'Your chats will appear here.'}</p>
            )}
            {grouped.map(([label, items]) => (
              <div key={label} className="mb-2">
                <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</div>
                {items.map((c) => (
                  <div
                    key={c.id}
                    className={['group flex items-center rounded-lg', c.id === current?.id ? 'bg-white shadow-sm ring-1 ring-gray-100' : 'hover:bg-gray-100'].join(' ')}
                  >
                    <button type="button" onClick={() => openChat(c.id)} className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm text-gray-700" title={c.title}>
                      {c.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeChat(c.id)}
                      aria-label={`Delete chat: ${c.title}`}
                      className="mr-1 shrink-0 rounded p-1.5 text-gray-300 opacity-0 hover:text-red-700 focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {collapsed && (
          <div className="hidden w-14 shrink-0 flex-col items-center gap-2 border-r border-gray-100 bg-gray-50 py-3 md:flex">
            <button type="button" onClick={toggleCollapsed} aria-label="Show chats" title="Show chats" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
              <PanelLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={newChat} aria-label="New chat" title="New chat" className="rounded-lg bg-red-600 p-2 text-white hover:bg-red-700">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* conversation */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 md:hidden">
            <button type="button" onClick={() => setPanelOpen(true)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
              <PanelLeft className="h-4 w-4" /> Chats
            </button>
            <button type="button" onClick={newChat} className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
              <Plus className="h-4 w-4" /> New chat
            </button>
          </div>

          {!messages.length ? (
            <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
              <div className="w-full max-w-2xl">
                <h1 className="mb-6 text-center text-3xl font-medium text-gray-900">What can I help you with today?</h1>
                {composer}
                <p className="mt-3 text-center text-xs text-gray-400">Answers come from approved KRCS documents and trusted sources, with a link to each source.</p>
              </div>
            </div>
          ) : (
            <>
              <div ref={scrollAreaRef} className="flex-1 overflow-y-auto px-4 pt-8">
                <div className="mx-auto max-w-3xl space-y-8 pb-6">
                  {messages.map((m, i) => (
                    <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex gap-3'}>
                      {m.role === 'user' ? (
                        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-gray-100 px-4 py-2.5 text-[15px] leading-6 text-gray-900">
                          {m.content}
                        </div>
                      ) : (
                        <>
                          <Avatar />
                          <div className="min-w-0 flex-1">
                            {m.kind === 'kb' ? (
                              <KbAnswer result={m.result} onFeedback={(value) => rememberFeedback(i, value)} />
                            ) : (
                              <div className="text-[15px] leading-7 text-gray-800">
                                {m.content}
                                {m.retryable && i === messages.length - 1 && (
                                  <div className="mt-2">
                                    <button
                                      type="button"
                                      onClick={() => retry(i)}
                                      disabled={isLoading}
                                      className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                      Try again
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ))}

                  {isLoading && (
                    <div className="flex gap-3">
                      <Avatar />
                      {live?.text ? (
                        <div className="whitespace-pre-wrap text-[15px] leading-7 text-gray-800">{live.text}</div>
                      ) : (
                        <div className="flex items-center gap-1.5 py-3">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="px-4 pb-5 pt-2">
                <div className="mx-auto max-w-3xl">
                  {composer}
                  <p className="mt-2 text-center text-xs text-gray-400">
                    {saveError ? 'This chat could not be saved. It will be saved with your next message.' : 'Answers come from approved KRCS documents and trusted sources.'}
                  </p>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </AppShell>
  )
}
