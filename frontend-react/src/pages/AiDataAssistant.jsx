import { useState, useEffect, useRef, useMemo } from 'react'
import { Plus, History, Trash2, Sparkles, Paperclip, Mic, ArrowUp, X } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { queryAiAssistant } from '../api/frappe'

const STORAGE_KEY = 'krcs_ai_assistant_chats'

const SUGGESTED_PROMPTS = [
  'Show cholera cases by region',
  'What are the active alerts this week?',
  'Summarize recent case reports',
]

function loadChats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' \u2022 ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

const voiceSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

export default function AiDataAssistant() {
  const [chats, setChats] = useState(loadChats)
  const [currentChatId, setCurrentChatId] = useState(null)
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [attachedFile, setAttachedFile] = useState(null)
  const [isRecording, setIsRecording] = useState(false)

  const scrollAreaRef = useRef(null)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const historyRef = useRef(null)
  const recognitionRef = useRef(null)
  const chatsRef = useRef(chats)
  chatsRef.current = chats

  const currentChat = useMemo(() => chats.find((c) => c.id === currentChatId) || null, [chats, currentChatId])
  const messages = currentChat?.messages || []
  const sortedChats = useMemo(() => [...chats].sort((a, b) => b.updatedAt - a.updatedAt), [chats])

  function persistChats(next) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (scrollAreaRef.current) scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    })
  }

  function autoGrowTextarea() {
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    })
  }

  function startNewQuery() {
    setCurrentChatId(null)
    setInputText('')
    setAttachedFile(null)
    setShowHistory(false)
  }

  function selectChat(id) {
    setCurrentChatId(id)
    setShowHistory(false)
    scrollToBottom()
  }

  function deleteChat(id) {
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id)
      persistChats(next)
      return next
    })
    if (currentChatId === id) setCurrentChatId(null)
  }

  function onKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  async function send(preset) {
    const question = (preset ?? inputText).trim()
    if (!question || isLoading) return

    let chatId = currentChatId
    let chats0 = chatsRef.current
    if (!chatId) {
      chatId = crypto.randomUUID()
      const chat = { id: chatId, title: question.slice(0, 60), messages: [], updatedAt: Date.now() }
      chats0 = [...chats0, chat]
      setCurrentChatId(chatId)
    }

    chats0 = chats0.map((c) =>
      c.id === chatId ? { ...c, messages: [...c.messages, { role: 'user', content: question }], updatedAt: Date.now() } : c
    )
    setChats(chats0)
    setInputText('')
    setAttachedFile(null)
    autoGrowTextarea()
    persistChats(chats0)
    scrollToBottom()

    setIsLoading(true)
    scrollToBottom()

    try {
      const result = await queryAiAssistant(question)
      chats0 = chats0.map((c) =>
        c.id === chatId
          ? { ...c, messages: [...c.messages, { role: 'assistant', content: result.answer, table: result.table }], updatedAt: Date.now() }
          : c
      )
    } catch (e) {
      chats0 = chats0.map((c) =>
        c.id === chatId
          ? { ...c, messages: [...c.messages, { role: 'assistant', content: 'Sorry, something went wrong while processing that request.' }], updatedAt: Date.now() }
          : c
      )
    } finally {
      setChats(chats0)
      persistChats(chats0)
      setIsLoading(false)
      scrollToBottom()
    }
  }

  function triggerFilePicker() {
    fileInputRef.current?.click()
  }

  function onFileSelected(e) {
    const file = e.target.files?.[0]
    if (file) setAttachedFile(file)
    e.target.value = ''
  }

  function setupRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return null
    const rec = new SpeechRecognition()
    rec.continuous = false
    rec.interimResults = false
    rec.lang = 'en-US'
    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript
      setInputText((prev) => (prev ? prev + ' ' : '') + transcript)
      autoGrowTextarea()
    }
    rec.onend = () => setIsRecording(false)
    rec.onerror = () => setIsRecording(false)
    return rec
  }

  function toggleVoice() {
    if (!voiceSupported) return
    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }
    recognitionRef.current = recognitionRef.current || setupRecognition()
    if (!recognitionRef.current) return
    setIsRecording(true)
    recognitionRef.current.start()
  }

  useEffect(() => {
    function onClickOutside(e) {
      if (showHistory && historyRef.current && !historyRef.current.contains(e.target)) {
        setShowHistory(false)
      }
    }
    document.addEventListener('click', onClickOutside)
    return () => {
      document.removeEventListener('click', onClickOutside)
      recognitionRef.current?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory])

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
          <button
            onClick={startNewQuery}
            className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 sm:px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Query</span>
          </button>

          <div className="relative shrink-0" ref={historyRef}>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 sm:px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Your Chats</span>
            </button>

            {showHistory && (
              <div className="absolute right-0 mt-2 w-72 max-h-96 overflow-y-auto bg-white border border-gray-100 rounded-xl shadow-lg z-30 py-2">
                {!chats.length && <div className="px-4 py-6 text-sm text-gray-400 text-center">No chats yet</div>}
                {sortedChats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => selectChat(chat.id)}
                    className={['w-full text-left px-4 py-2.5 flex items-start justify-between gap-2 hover:bg-gray-50 group', chat.id === currentChatId ? 'bg-red-50' : ''].join(' ')}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{chat.title}</div>
                      <div className="text-xs text-gray-400">{formatTime(chat.updatedAt)}</div>
                    </div>
                    <span
                      onClick={(e) => { e.stopPropagation(); deleteChat(chat.id) }}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 shrink-0 mt-0.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div ref={scrollAreaRef} className="flex-1 overflow-y-auto px-4 sm:px-6">
          {!messages.length ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 py-10">
              <img src="/assets/surveillance/images/logo.png" alt="KRCS" className="w-20 h-18 object-contain mb-5" />
              <h2 className="text-2xl sm:text-3xl font-medium text-gray-900 mb-3">Welcome to KRCS AI DataAssistant</h2>
              <p className="text-gray-500 text-base sm:text-lg max-w-2xl mb-8">
                Ask me about community health data, disease trends, alerts, or reports.
                I'll query the database and show you results.
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => send(prompt)}
                    className="text-sm text-gray-600 border border-gray-200 rounded-full px-4 py-2 hover:bg-gray-50 hover:border-gray-300"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto py-6 space-y-6">
              {messages.map((m, i) => (
                <div key={i} className={['flex', m.role === 'user' ? 'justify-end' : 'justify-start'].join(' ')}>
                  {m.role === 'assistant' ? (
                    <div className="flex gap-3 max-w-[85%]">
                      <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center shrink-0">
                        <Sparkles className="w-4 h-4 text-white" />
                      </div>
                      <div className="space-y-3">
                        <div className="bg-gray-50 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 leading-relaxed">
                          {m.content}
                        </div>
                        {m.table && (
                          <div className="border border-gray-100 rounded-xl overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-gray-50 text-left text-gray-500 text-xs">
                                  {m.table.columns.map((col) => (
                                    <th key={col} className="px-4 py-2 font-medium">{col}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {m.table.rows.map((row, ri) => (
                                  <tr key={ri} className="border-t border-gray-50">
                                    {row.map((cell, ci) => (
                                      <td key={ci} className="px-4 py-2 text-gray-700">{cell}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-[85%] bg-red-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                      {m.content}
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-gray-50 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 sm:px-6 pb-5 pt-3">
          <div className="max-w-3xl mx-auto">
            {attachedFile && (
              <div className="flex items-center gap-2 mb-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-1.5 w-fit">
                <Paperclip className="w-3.5 h-3.5" />
                <span className="truncate max-w-xs">{attachedFile.name}</span>
                <button onClick={() => setAttachedFile(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="flex items-end gap-2 border border-gray-200 bg-gray-50 rounded-3xl px-4 sm:px-5 py-2.5">
              <button onClick={triggerFilePicker} className="text-gray-500 hover:text-gray-700 shrink-0 mb-1.5" title="Attach a file">
                <Paperclip className="w-5 h-5" />
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={onFileSelected} />

              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={onKeydown}
                rows={1}
                placeholder="Ask about health data... (e.g. 'Show cholera cases by region')"
                className="flex-1 bg-transparent resize-none focus:outline-none text-sm sm:text-base text-gray-800 placeholder:text-gray-400 py-1.5 max-h-40"
              ></textarea>

              <button
                onClick={toggleVoice}
                disabled={!voiceSupported}
                title={voiceSupported ? 'Voice input' : 'Voice input not supported in this browser'}
                className={['rounded-full w-10 h-10 flex items-center justify-center shrink-0 border transition-colors',
                  isRecording ? 'bg-red-100 border-red-200 text-red-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100',
                  !voiceSupported ? 'opacity-40 cursor-not-allowed' : ''].join(' ')}
              >
                <Mic className="w-4 h-4" />
              </button>

              <button
                onClick={() => send()}
                disabled={!inputText.trim() || isLoading}
                className="rounded-full w-10 h-10 flex items-center justify-center shrink-0 bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-700 transition-colors"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>

            <p className="text-center text-xs text-gray-400 mt-3">
              AI translates your questions into database queries. Results are based on current surveillance data.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
