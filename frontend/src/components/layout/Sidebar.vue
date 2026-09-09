<template>
  <aside :class="['bg-white border-r border-gray-100 h-screen sticky top-0 flex flex-col transition-all duration-300 shrink-0', collapsed ? 'w-20' : 'w-64']">
    <div class="flex items-center justify-between px-5 py-6">
      <div class="flex items-center overflow-hidden flex-1">
  <img
  :src="'/assets/surveillance/images/logo.png'"
  alt="Kenya Red Cross"
  :class="[
    'object-contain object-left transition-all duration-300',
    collapsed ? 'h-8 w-8' : 'h-12 w-full'
  ]"
/>
</div>
      <button @click="toggle" class="border border-gray-200 rounded-full p-1 text-gray-400 hover:bg-gray-50 shrink-0">
        <ChevronLeft v-if="!collapsed" class="w-4 h-4" />
        <ChevronRight v-else class="w-4 h-4" />
      </button>
    </div>

    <nav class="flex-1 overflow-y-auto px-3 pb-6">
      <template v-for="group in SIDEBAR_MENU" :key="group.section">
        <div v-if="!collapsed" class="px-2 text-xs font-semibold text-gray-400 tracking-wide mb-2 mt-5">{{ group.section }}</div>
        <router-link
          v-for="item in group.items"
          :key="item.page"
          :to="`/${item.page}`"
          :class="['flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-1',
                    currentPage === item.page ? 'bg-red-600 text-white' : 'text-gray-600 hover:bg-gray-50']"
        >
          <component :is="iconFor(item.icon)" class="w-4 h-4 shrink-0" />
          <span v-if="!collapsed" class="whitespace-nowrap">{{ item.label }}</span>
        </router-link>
      </template>
    </nav>
  </aside>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import * as icons from 'lucide-vue-next'
import { SIDEBAR_MENU } from '@/data/sidebarMenu'

const route = useRoute()
const currentPage = computed(() => route.path.replace('/', ''))

const collapsed = ref(localStorage.getItem('sidebarCollapsed') === 'true')
function toggle() {
  collapsed.value = !collapsed.value
  localStorage.setItem('sidebarCollapsed', collapsed.value)
}

function iconFor(name) {
  return icons[name] || icons.Circle
}
</script>
