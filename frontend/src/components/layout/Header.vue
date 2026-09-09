<template>
  <header class="bg-white border-b border-gray-100 px-8 py-4 flex items-center justify-between">
    <div>
      <h1 class="text-lg font-bold text-gray-900">Good {{ timeOfDay }}, {{ firstName }}!</h1>
      <p class="text-xs text-gray-400">{{ dateTimeLabel }}</p>
    </div>
    <div class="flex items-center gap-3">
      <div class="relative">
        <Search class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input type="text" placeholder="Search..." class="bg-gray-100 rounded-full pl-9 pr-4 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-red-300">
      </div>
      <button class="border border-gray-200 rounded-full p-2.5 text-gray-500 hover:bg-gray-50"><Bell class="w-4 h-4" /></button>
      <button class="border border-gray-200 rounded-full p-2.5 text-gray-500 hover:bg-gray-50"><Sparkles class="w-4 h-4" /></button>
      <div class="flex items-center gap-2 pl-2">
        <div class="leading-tight">
          <div class="text-sm font-semibold text-gray-900">{{ fullName }}</div>
          <div class="text-xs text-gray-400">Admin</div>
        </div>
        <ChevronDown class="w-4 h-4 text-gray-400 ml-1" />
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Search, Bell, Sparkles, ChevronDown } from 'lucide-vue-next'
import { currentUserFullName } from '@/api/frappe'

const fullName = ref(currentUserFullName())
const firstName = computed(() => fullName.value.split(' ')[0])
const now = ref(new Date())
let timer

onMounted(() => { timer = setInterval(() => (now.value = new Date()), 30000) })
onUnmounted(() => clearInterval(timer))

const timeOfDay = computed(() => {
  const h = now.value.getHours()
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'
})
const dateTimeLabel = computed(() =>
  now.value.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) +
  ' \u2022 ' + now.value.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
)
</script>