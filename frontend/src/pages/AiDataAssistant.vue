<template>
  <AppShell>
    <div class="flex flex-col h-[calc(100vh-140px)] bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <!-- Top bar -->
      <div class="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
        <button
          @click="startNewQuery"
          class="flex items-center gap-2 border border-gray-200 rounded-lg px-3 sm:px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 shrink-0"
        >
          <Plus class="w-4 h-4" />
          <span class="hidden sm:inline">New Query</span>
        </button>

        <div class="relative shrink-0" ref="historyRef">
          <button
            @click="showHistory = !showHistory"
            class="flex items-center gap-2 border border-gray-200 rounded-lg px-3 sm:px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <History class="w-4 h-4" />
            <span class="hidden sm:inline">Your Chats</span>
          </button>

          <div
            v-if="showHistory"
            class="absolute right-0 mt-2 w-72 max-h-96 overflow-y-auto bg-white border border-gray-100 rounded-xl shadow-lg z-30 py-2"
          >
            <div v-if="!chats.length" class="px-4 py-6 text-sm text-gray-400 text-center">No chats yet</div>
            <button
              v-for="chat in sortedChats"
              :key="chat.id"
              @click="selectChat(chat.id)"
              :class="['w-full text-left px-4 py-2.5 flex items-start justify-between gap-2 hover:bg-gray-50 group',
                        chat.id === currentChatId ? 'bg-red-50' : '']"
            >
              <div class="min-w-0">
                <div class="text-sm font-medium text-gray-900 truncate">{{ chat.title }}</div>
                <div class="text-xs text-gray-400">{{ formatTime(chat.updatedAt) }}</div>
              </div>
              <span
                @click.stop="deleteChat(chat.id)"
                class="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 shrink-0 mt-0.5"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- Messages / welcome -->
      <div ref="scrollAreaRef" class="flex-1 overflow-y-auto px-4 sm:px-6">
        <div v-if="!messages.length" class="h-full flex flex-col items-center justify-center text-center px-4 py-10">
          <img :src="'/assets/surveillance/images/logo.png'" alt="KRCS" class="w-14 h-14 object-contain mb-5" />
          <h2 class="text-2xl sm:text-3xl font-medium text-gray-900 mb-3">Welcome to KRCS AI DataAssistant</h2>
          <p class="text-gray-500 text-base sm:text-lg max-w-2xl mb-8">
            Ask me about community health data, disease trends, alerts, or reports.
            I'll query the database and show you results.
          </p>
          <div class="flex flex-wrap justify-center gap-2 max-w-2xl">
            <button
              v-for="prompt in suggestedPrompts"
              :key="prompt"
              @click="send(prompt)"
              class="text-sm text-gray-600 border border-gray-200 rounded-full px-4 py-2 hover:bg-gray-50 hover:border-gray-300"
            >
              {{ prompt }}
            </button>
          </div>
        </div>

        <div v-else class="max-w-3xl mx-auto py-6 space-y-6">
          <div v-for="(m, i) in messages" :key="i" class="flex" :class="m.role === 'user' ? 'justify-end' : 'justify-start'">
            <div v-if="m.role === 'assistant'" class="flex gap-3 max-w-[85%]">
              <div class="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center shrink-0">
                <Sparkles class="w-4 h-4 text-white" />
              </div>
              <div class="space-y-3">
                <div class="bg-gray-50 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 leading-relaxed">
                  {{ m.content }}
                </div>
                <div v-if="m.table" class="border border-gray-100 rounded-xl overflow-hidden">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="bg-gray-50 text-left text-gray-500 text-xs">
                        <th v-for="col in m.table.columns" :key="col" class="px-4 py-2 font-medium">{{ col }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, ri) in m.table.rows" :key="ri" class="border-t border-gray-50">
                        <td v-for="(cell, ci) in row" :key="ci" class="px-4 py-2 text-gray-700">{{ cell }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div v-else class="max-w-[85%] bg-red-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
              {{ m.content }}
            </div>
          </div>

          <div v-if="isLoading" class="flex gap-3">
            <div class="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center shrink-0">
              <Sparkles class="w-4 h-4 text-white" />
            </div>
            <div class="bg-gray-50 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 0ms"></span>
              <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 150ms"></span>
              <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 300ms"></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="px-4 sm:px-6 pb-5 pt-3">
        <div class="max-w-3xl mx-auto">
          <div v-if="attachedFile" class="flex items-center gap-2 mb-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-1.5 w-fit">
            <Paperclip class="w-3.5 h-3.5" />
            <span class="truncate max-w-xs">{{ attachedFile.name }}</span>
            <button @click="attachedFile = null" class="text-gray-400 hover:text-gray-600">
              <X class="w-3.5 h-3.5" />
            </button>
          </div>

          <div class="flex items-end gap-2 border border-gray-200 bg-gray-50 rounded-3xl px-4 sm:px-5 py-2.5">
            <button @click="triggerFilePicker" class="text-gray-500 hover:text-gray-700 shrink-0 mb-1.5" title="Attach a file">
              <Paperclip class="w-5 h-5" />
            </button>
            <input ref="fileInputRef" type="file" class="hidden" @change="onFileSelected" />

            <textarea
              ref="textareaRef"
              v-model="inputText"
              @keydown="onKeydown"
              rows="1"
              placeholder="Ask about health data... (e.g. 'Show cholera cases by region')"
              class="flex-1 bg-transparent resize-none focus:outline-none text-sm sm:text-base text-gray-800 placeholder:text-gray-400 py-1.5 max-h-40"
            ></textarea>

            <button
              @click="toggleVoice"
              :disabled="!voiceSupported"
              :title="voiceSupported ? 'Voice input' : 'Voice input not supported in this browser'"
              :class="['rounded-full w-10 h-10 flex items-center justify-center shrink-0 border transition-colors',
                        isRecording ? 'bg-red-100 border-red-200 text-red-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100',
                        !voiceSupported ? 'opacity-40 cursor-not-allowed' : '']"
            >
              <Mic class="w-4 h-4" />
            </button>

            <button
              @click="send()"
              :disabled="!inputText.trim() || isLoading"
              class="rounded-full w-10 h-10 flex items-center justify-center shrink-0 bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-700 transition-colors"
            >
              <ArrowUp class="w-4 h-4" />
            </button>
          </div>

          <p class="text-center text-xs text-gray-400 mt-3">
            AI translates your questions into database queries. Results are based on current surveillance data.
          </p>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { Plus, History, Trash2, Sparkles, Paperclip, Mic, ArrowUp, X } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import { queryAiAssistant } from '@/api/frappe'

const STORAGE_KEY = 'krcs_ai_assistant_chats'

const suggestedPrompts = [
  'Show cholera cases by region',
  'What are the active alerts this week?',
  'Summarize recent case reports',
]

const chats = ref(loadChats())
const currentChatId = ref(null)
const inputText = ref('')
const isLoading = ref(false)
const showHistory = ref(false)
const attachedFile = ref(null)
const isRecording = ref(false)

const scrollAreaRef = ref(null)
const textareaRef = ref(null)
const fileInputRef = ref(null)
const historyRef = ref(null)

const currentChat = computed(() => chats.value.find((c) => c.id === currentChatId.value) || null)
const messages = computed(() => currentChat.value?.messages || [])
const sortedChats = computed(() => [...chats.value].sort((a, b) => b.updatedAt - a.updatedAt))

function loadChats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistChats() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats.value))
}

function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' \u2022 ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function startNewQuery() {
  currentChatId.value = null
  inputText.value = ''
  attachedFile.value = null
  showHistory.value = false
}

function selectChat(id) {
  currentChatId.value = id
  showHistory.value = false
  scrollToBottom()
}

function deleteChat(id) {
  chats.value = chats.value.filter((c) => c.id !== id)
  if (currentChatId.value === id) currentChatId.value = null
  persistChats()
}

function scrollToBottom() {
  nextTick(() => {
    if (scrollAreaRef.value) scrollAreaRef.value.scrollTop = scrollAreaRef.value.scrollHeight
  })
}

function autoGrowTextarea() {
  nextTick(() => {
    const el = textareaRef.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  })
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

async function send(preset) {
  const question = (preset ?? inputText.value).trim()
  if (!question || isLoading.value) return

  if (!currentChatId.value) {
    const chat = {
      id: crypto.randomUUID(),
      title: question.slice(0, 60),
      messages: [],
      updatedAt: Date.now(),
    }
    chats.value.push(chat)
    currentChatId.value = chat.id
  }

  const chat = currentChat.value
  chat.messages.push({ role: 'user', content: question })
  chat.updatedAt = Date.now()
  inputText.value = ''
  attachedFile.value = null
  autoGrowTextarea()
  persistChats()
  scrollToBottom()

  isLoading.value = true
  scrollToBottom()

  try {
    const result = await queryAiAssistant(question)
    chat.messages.push({ role: 'assistant', content: result.answer, table: result.table })
  } catch (e) {
    chat.messages.push({ role: 'assistant', content: 'Sorry, something went wrong while processing that request.' })
  } finally {
    isLoading.value = false
    chat.updatedAt = Date.now()
    persistChats()
    scrollToBottom()
  }
}

function triggerFilePicker() {
  fileInputRef.value?.click()
}

function onFileSelected(e) {
  const file = e.target.files?.[0]
  if (file) attachedFile.value = file
  e.target.value = ''
}

let recognition = null
const voiceSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SpeechRecognition) return null
  const rec = new SpeechRecognition()
  rec.continuous = false
  rec.interimResults = false
  rec.lang = 'en-US'
  rec.onresult = (event) => {
    const transcript = event.results[0][0].transcript
    inputText.value = (inputText.value ? inputText.value + ' ' : '') + transcript
    autoGrowTextarea()
  }
  rec.onend = () => { isRecording.value = false }
  rec.onerror = () => { isRecording.value = false }
  return rec
}

function toggleVoice() {
  if (!voiceSupported) return
  if (isRecording.value) {
    recognition?.stop()
    isRecording.value = false
    return
  }
  recognition = recognition || setupRecognition()
  if (!recognition) return
  isRecording.value = true
  recognition.start()
}

function onClickOutside(e) {
  if (showHistory.value && historyRef.value && !historyRef.value.contains(e.target)) {
    showHistory.value = false
  }
}

onMounted(() => document.addEventListener('click', onClickOutside))
onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  recognition?.stop()
})
</script>
