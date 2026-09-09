<template>
  <div class="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
    <div class="flex items-center justify-between mb-5">
      <h3 class="text-sm sm:text-base font-medium text-gray-900">{{ title }}</h3>
      <slot name="legend" />
    </div>
    <div :class="['relative w-full', height]">
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  height: { type: String, default: 'h-64 sm:h-80' },
})
</script>
