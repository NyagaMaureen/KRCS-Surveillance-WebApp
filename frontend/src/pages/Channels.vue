<template>
  <AppShell>
    <!-- Header -->
    <div class="flex items-start justify-between gap-4 mb-6 flex-wrap">
      <div>
        <h2 class="text-xl font-bold text-gray-900">
          Reporting Channels
        </h2>
        <p class="text-sm text-gray-400">
          Standard Operating Procedures for disease outbreak response
        </p>
      </div>

      <button
        class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-2"
      >
        <Plus class="w-4 h-4" />
        Add Channel
      </button>
    </div>

    <!-- Error -->
    <p
      v-if="error"
      class="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mb-6"
    >
      {{ error }}
    </p>

    <!-- Loading -->
    <div
      v-else-if="loading"
      class="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-400"
    >
      Loading reporting channels...
    </div>

    <!-- Empty -->
    <div
      v-else-if="channels.length === 0"
      class="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-400"
    >
      No reporting channels found.
    </div>

    <!-- Content -->
    <template v-else>

      <!-- Distribution -->
      <div class="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <h3 class="text-base font-semibold text-gray-900 mb-6">
          Reporting Channels Distribution
        </h3>

        <div class="flex flex-col md:flex-row items-center justify-center gap-10">

          <!-- Pie Chart -->
          <div
            class="w-48 h-48 rounded-full shrink-0"
            :style="{ background: pieGradient }"
          ></div>

          <!-- Legend -->
          <div class="flex flex-wrap md:flex-col gap-3">
            <div
              v-for="c in channels"
              :key="c.name"
              class="flex items-center gap-2 text-xs font-medium text-gray-700"
            >
              <span
                class="w-2.5 h-2.5 rounded-full shrink-0"
                :style="{ background: c.color }"
              ></span>

              {{ c.label }}

              <span class="font-semibold">
                {{ c.share }}%
              </span>
            </div>
          </div>

        </div>
      </div>


      <!-- Channel Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">

        <div
          v-for="c in channels"
          :key="c.name"
          class="bg-white rounded-2xl border border-gray-200 p-6"
        >

          <!-- Icon + Status -->
          <div class="flex items-start justify-between mb-6">

            <div
              class="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center"
            >
              <component
                :is="iconFor(c.icon)"
                class="w-6 h-6 text-gray-400"
              />
            </div>

            <span
              :class="[
                'text-[10px] font-medium px-3 py-1 rounded-full text-white capitalize',
                statusColor(c.status)
              ]"
            >
              {{ c.status }}
            </span>

          </div>


          <!-- Channel name -->
          <h4 class="text-lg font-medium text-gray-900 mb-1">
            {{ c.label }}
          </h4>

          <!-- Description -->
          <p class="text-xs text-gray-400 mb-6 leading-relaxed">
            {{ c.description }}
          </p>


          <!-- Stats -->
          <div
            class="flex items-center justify-between text-xs border-t border-gray-100 pt-4 mb-4"
          >
            <span class="text-gray-900 font-medium">
              Uptime:
              <span class="font-semibold">
                {{ c.uptime }}%
              </span>
            </span>

            <span class="text-gray-900 font-medium">
              Today:
              <span class="font-semibold">
                {{ c.today }}
              </span>
            </span>
          </div>


          <!-- Configure -->
          <button
            class="w-full border border-gray-200 rounded-lg py-2.5 text-sm font-medium text-gray-900 flex items-center justify-center gap-2 hover:bg-gray-50"
          >
            <Settings class="w-4 h-4" />
            Configure
          </button>

        </div>

      </div>

    </template>
  </AppShell>
</template>


<script setup>
import { ref, computed } from 'vue'

import {
  Plus,
  Settings,
  Smartphone,
  MessageSquare,
  Grid3x3,
  MessageCircle,
  Radio
} from 'lucide-vue-next'

import AppShell from '@/components/layout/AppShell.vue'


/*
|--------------------------------------------------------------------------
| Mock data
|--------------------------------------------------------------------------
|
| This is temporary data so we can build and verify the UI
| before connecting it to the Frappe Reporting Channel DocType.
|
*/

const channels = ref([
  {
    name: 'whatsapp',
    label: 'WhatsApp',
    description: 'Receive health reports and outbreak alerts through WhatsApp.',
    icon: 'MessageCircle',
    status: 'operational',
    uptime: 99.8,
    today: 126,
    share: 35,
    color: '#D62728'
  },

  {
    name: 'sms',
    label: 'SMS',
    description: 'SMS reporting channel for areas with limited internet connectivity.',
    icon: 'MessageSquare',
    status: 'operational',
    uptime: 98.7,
    today: 92,
    share: 26,
    color: '#2F80ED'
  },

  {
    name: 'ussd',
    label: 'USSD',
    description: 'USSD-based reporting for community health workers and facilities.',
    icon: 'Grid3x3',
    status: 'operational',
    uptime: 97.9,
    today: 74,
    share: 21,
    color: '#F2C94C'
  },

  {
    name: 'mobile-app',
    label: 'Mobile App',
    description: 'Mobile application for structured health signal reporting.',
    icon: 'Smartphone',
    status: 'degraded',
    uptime: 94.6,
    today: 63,
    share: 18,
    color: '#27AE60'
  }
])


/*
|--------------------------------------------------------------------------
| UI state
|--------------------------------------------------------------------------
*/

const error = ref('')
const loading = ref(false)


/*
|--------------------------------------------------------------------------
| Icons
|--------------------------------------------------------------------------
*/

const ICONS = {
  Smartphone,
  MessageSquare,
  Grid3x3,
  MessageCircle
}

const iconFor = (name) => {
  return ICONS[name] || Radio
}


/*
|--------------------------------------------------------------------------
| Status colours
|--------------------------------------------------------------------------
*/

const STATUS_COLORS = {
  operational: 'bg-green-500',
  degraded: 'bg-amber-500',
  down: 'bg-red-500'
}

const statusColor = (status) => {
  return STATUS_COLORS[status] || 'bg-gray-400'
}


/*
|--------------------------------------------------------------------------
| Pie chart
|--------------------------------------------------------------------------
*/

const pieGradient = computed(() => {
  let start = 0

  const stops = channels.value.map((channel) => {
    const end = start + channel.share

    const stop =
      `${channel.color} ${start}% ${end}%`

    start = end

    return stop
  })

  return `conic-gradient(${stops.join(', ')})`
})
</script>