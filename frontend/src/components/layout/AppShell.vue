<template>
  <div class="flex">
    <Sidebar />
    <div class="flex-1 min-w-0">
      <Header />
      <main class="p-8">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup>
import Sidebar from './Sidebar.vue'
import Header from './Header.vue'
</script>