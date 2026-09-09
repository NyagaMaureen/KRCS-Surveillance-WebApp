<template>
  <AppShell>
    <div class="mb-6">
      <h2 class="text-xl font-bold text-gray-900">Help Center</h2>
      <p class="text-sm text-gray-400">Access activity, User Logs, Alert Created, Data Export and System Backup</p>
    </div>

    <div class="bg-white border border-gray-100 rounded-2xl p-6 mb-6">
      <div class="relative">
        <Search class="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          v-model="query"
          type="text"
          placeholder="Search help articles, FAQs, and documentation..."
          class="w-full bg-gray-50 border border-gray-200 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
        >
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6">
      <button
        v-for="card in QUICK_LINKS" :key="card.label"
        class="bg-white border border-gray-100 rounded-2xl p-8 flex flex-col items-center text-center gap-3 hover:border-red-200 hover:shadow-sm transition"
      >
        <component :is="card.icon" class="w-10 h-10 text-gray-900" />
        <div>
          <p class="font-medium text-gray-900">{{ card.label }}</p>
          <p class="text-xs text-gray-400 mt-1">{{ card.description }}</p>
        </div>
      </button>
    </div>

    <div class="bg-white border border-gray-100 rounded-2xl p-6 mb-6">
      <div class="mb-4">
        <h3 class="text-base text-gray-900">Frequently Asked Questions</h3>
        <p class="text-sm text-gray-500 mt-1">{{ filteredFaqs.length }} results</p>
      </div>

      <div class="divide-y divide-gray-100">
        <div v-for="faq in filteredFaqs" :key="faq.question">
          <button
            class="w-full flex items-center gap-2 py-4 text-left"
            @click="toggleFaq(faq.question)"
          >
            <Info class="w-4 h-4 text-gray-500 shrink-0" />
            <span class="flex-1 text-xs font-medium text-gray-900">{{ faq.question }}</span>
            <ChevronDown :class="['w-4 h-4 text-gray-900 shrink-0 transition-transform', openFaq === faq.question ? 'rotate-180' : '']" />
          </button>
          <p v-if="openFaq === faq.question" class="text-xs text-gray-500 pb-4 pl-6 pr-6">{{ faq.answer }}</p>
        </div>
        <p v-if="!filteredFaqs.length" class="text-sm text-gray-400 py-6 text-center">No matching articles found.</p>
      </div>
    </div>

    <div class="bg-white border border-gray-100 rounded-2xl p-6 mb-6">
      <div class="mb-4">
        <h3 class="text-base text-gray-900">Resources & Downloads</h3>
        <p class="text-sm text-gray-500 mt-1">Access guides, tutorials, and documentation</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <a v-for="resource in RESOURCES" :key="resource.label" href="#" class="flex items-center gap-4 border border-gray-100 rounded-xl px-5 py-5 hover:border-red-200 hover:shadow-sm transition">
          <component :is="resource.icon" class="w-6 h-6 text-gray-900 shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-gray-900">{{ resource.label }}</p>
              <span class="border border-gray-200 rounded text-[10px] font-medium text-gray-900 px-2 py-0.5">{{ resource.tag }}</span>
            </div>
            <p class="text-sm text-gray-500 mt-1">{{ resource.description }}</p>
          </div>
          <ExternalLink class="w-5 h-5 text-gray-900 shrink-0" />
        </a>
      </div>
    </div>

    <div class="bg-white border border-gray-100 rounded-2xl p-6">
      <h3 class="text-base text-gray-900 mb-5">Need More Help?</h3>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div>
          <p class="text-gray-900">Email Support</p>
          <p class="text-xs text-gray-500 mt-2">support@krcs.org</p>
          <p class="text-xs text-gray-500 mt-1">Or use the AI Assistant for instant answers.</p>
        </div>
        <div>
          <p class="text-gray-900">Phone Support</p>
          <p class="text-xs text-gray-500 mt-2">+254 700 000 000</p>
          <p class="text-xs text-gray-500 mt-1">Mon-Fri, 9:00 AM - 5:00 PM EAT</p>
        </div>
      </div>

      <button class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-medium w-full sm:w-auto">
        Submit Support Ticket
      </button>
    </div>
  </AppShell>
</template>

<script setup>
import { ref, computed } from 'vue'
import {
  Search, MessageSquare, PlaySquare, BookOpen, Info, ChevronDown,
  ExternalLink, FileText,
} from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'

const QUICK_LINKS = [
  { label: 'Contact Support', description: 'Get help from our support team', icon: MessageSquare },
  { label: 'Video Tutorials', description: 'Watch step-by-step guides', icon: PlaySquare },
  { label: 'Documentation', description: 'Browse complete user guides', icon: BookOpen },
]

const RESOURCES = [
  { label: 'User Guide', tag: 'Monthly', description: 'Complete guide for all system features', icon: BookOpen },
  { label: 'Video Tutorials', tag: 'Video', description: 'Step-by-step video walkthroughs', icon: PlaySquare },
  { label: 'API Documentation', tag: 'Web', description: 'Technical documentation for developers', icon: FileText },
  { label: 'Best Practices', tag: 'Monthly', description: 'Guidelines for effective program management', icon: BookOpen },
]

const FAQS = [
  { question: 'How do I export data?', answer: 'Go to Data Explorer, apply your search filters, then click the CSV or JSON export button. You can export alerts, reports, or cases with all applied filters.' },
  { question: 'How does the AI risk scoring work?', answer: 'The AI model scores incoming reports and signals using historical outbreak patterns, keyword severity, and source reliability to estimate risk level.' },
  { question: 'What happens when a keyword match is detected?', answer: 'A keyword match automatically raises an alert, notifies the relevant regional team, and logs the event to the Audit Log for review.' },
  { question: 'Can I use the system offline?', answer: 'Field data can be captured offline and will sync automatically once a network connection is restored.' },
  { question: 'How are disease outbreaks classified?', answer: 'Outbreaks are classified by case count, geographic spread, and severity thresholds defined in the Response Protocols.' },
  { question: 'What reporting channels are available?', answer: 'Reports can be submitted via SMS, USSD, the mobile app, WhatsApp, or directly through this dashboard.' },
]

const query = ref('')
const openFaq = ref(FAQS[0].question)

const filteredFaqs = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return FAQS
  return FAQS.filter((f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q))
})

function toggleFaq(question) {
  openFaq.value = openFaq.value === question ? null : question
}
</script>
