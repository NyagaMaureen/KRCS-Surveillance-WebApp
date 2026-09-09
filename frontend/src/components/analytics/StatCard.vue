<template>
  <div class="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4 min-w-0">
    <div class="bg-gray-100 rounded-full p-3.5 shrink-0">
      <component :is="icon" class="w-5 h-5 text-gray-500" />
    </div>
    <div class="min-w-0">
      <div class="text-xs font-medium text-gray-400 truncate">{{ label }}</div>
      <div class="flex items-baseline gap-2 flex-wrap">
        <span class="text-xl sm:text-2xl font-semibold text-gray-900">{{ value }}</span>
        <span v-if="changePct != null" :class="['inline-flex items-center gap-0.5 text-xs font-medium', sentiment === 'positive' ? 'text-emerald-400' : 'text-rose-400']">
          <component :is="trend === 'down' ? ArrowDownCircle : ArrowUpCircle" class="w-3 h-3" />
          {{ changePct }}%
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ArrowDownCircle, ArrowUpCircle } from 'lucide-vue-next'

defineProps({
  icon: { type: [Object, Function], required: true },
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  changePct: { type: Number, default: null },
  trend: { type: String, default: 'down' },
  sentiment: { type: String, default: 'positive' },
})
</script>
