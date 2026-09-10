<template>
  <header class="bg-white px-8 py-4 h-20 flex items-center justify-between border-b border-gray-100">
    <div>
      <h1 class="text-lg font-semibold text-gray-900 leading-tight">Good {{ timeOfDay }}, {{ firstName }}!</h1>
      <p class="text-xs text-gray-400 mt-0.5">{{ dateTimeLabel }}</p>
    </div>

    <div class="flex items-center gap-3">
      <div class="bg-gray-100 rounded-full h-11 flex items-center gap-2 pl-1 pr-4 w-64">
        <span class="w-9 h-9 rounded-full bg-white flex items-center justify-center shrink-0">
          <Search class="w-4 h-4 text-gray-600" />
        </span>
        <input
          type="text"
          placeholder="Search..."
          class="bg-transparent flex-1 text-sm text-gray-900 placeholder-gray-500 focus:outline-none"
        >
      </div>

      <div class="bg-gray-100 rounded-full h-11 flex items-center gap-1.5 px-1.5">
        <div ref="notifRef" class="relative">
          <button
            class="w-8 h-8 rounded-full bg-white flex items-center justify-center hover:bg-gray-50 transition-colors cursor-pointer"
            @click="notifOpen = !notifOpen"
          >
            <Bell class="w-4 h-4 text-gray-600" />
          </button>

          <div
            v-if="notifOpen"
            class="absolute right-0 top-[calc(100%+8px)] w-64 bg-white rounded-xl shadow-lg border border-gray-100 py-3 z-50"
          >
            <p class="px-4 pb-2 text-sm font-semibold text-gray-900">Notifications</p>
            <p class="px-4 py-3 text-sm text-gray-400">You're all caught up. No new notifications.</p>
          </div>
        </div>

        <button
          class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors cursor-pointer"
          @click="goToAiAssistant"
        >
          <Sparkles class="w-4 h-4 text-gray-900" />
        </button>
      </div>

      <div ref="menuRef" class="relative">
        <button
          class="bg-gray-100 rounded-full h-11 flex items-center gap-2 pl-1.5 pr-3 hover:bg-gray-200 transition-colors cursor-pointer"
          @click="menuOpen = !menuOpen"
        >
          <span class="w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center text-xs font-semibold shrink-0">
            {{ initials }}
          </span>
          <span class="text-left leading-tight">
            <span class="block text-sm font-semibold text-gray-900">{{ fullName }}</span>
            <span class="block text-xs text-gray-500">
  {{ userRole }}
</span>
          </span>
          <ChevronDown class="w-4 h-4 text-gray-500 transition-transform" :class="{ 'rotate-180': menuOpen }" />
        </button>

        <div
          v-if="menuOpen"
          class="absolute right-0 top-[calc(100%+8px)] w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50"
        >
          <button
            class="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
            @click="goToSettings"
          >
            <Settings class="w-4 h-4 text-gray-500" />
            Settings
          </button>
          <button
            class="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
            @click="handleLogout"
          >
            <LogOut class="w-4 h-4" />
            Log Out
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Search,
  Bell,
  Sparkles,
  ChevronDown,
  Settings,
  LogOut
} from 'lucide-vue-next'

import {
  currentUserFullName,
  getMyCapabilities,
  logout
} from '@/api/frappe'

const router = useRouter()

const fullName = ref(currentUserFullName())
const userRole = ref('')

const firstName = computed(() =>
  fullName.value.split(' ')[0]
)

const initials = computed(() =>
  fullName.value
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('')
)

const now = ref(new Date())
let timer

onMounted(async () => {
  try {
    const { primary_role } = await getMyCapabilities()
    userRole.value = primary_role
  } catch (error) {
    console.error('Failed to fetch user role:', error)
  }

  timer = setInterval(() => {
    now.value = new Date()
  }, 30000)

  document.addEventListener('click', onClickOutside)
})

onUnmounted(() => {
  clearInterval(timer)
  document.removeEventListener('click', onClickOutside)
})

const timeOfDay = computed(() => {
  const h = now.value.getHours()

  return h < 12
    ? 'Morning'
    : h < 17
      ? 'Afternoon'
      : 'Evening'
})

const dateTimeLabel = computed(() =>
  now.value.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) +
  ' • ' +
  now.value.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  })
)

const menuOpen = ref(false)
const menuRef = ref(null)

const notifOpen = ref(false)
const notifRef = ref(null)

function onClickOutside(e) {
  if (
    menuRef.value &&
    !menuRef.value.contains(e.target)
  ) {
    menuOpen.value = false
  }

  if (
    notifRef.value &&
    !notifRef.value.contains(e.target)
  ) {
    notifOpen.value = false
  }
}

function goToSettings() {
  menuOpen.value = false
  router.push('/settings')
}

function goToAiAssistant() {
  router.push('/ai-data-assistant')
}

async function handleLogout() {
  menuOpen.value = false
  await logout()
  router.push('/login')
}
</script>
