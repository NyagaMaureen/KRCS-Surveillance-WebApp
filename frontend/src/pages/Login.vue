<template>
  <div class="bg-white min-h-screen w-full flex items-center justify-center">
  <div class="w-full max-w-5xl grid grid-cols-1 md:grid-cols-[1fr_1.5px_1fr] overflow-hidden">
      <div class="p-10 md:p-14 flex flex-col justify-center">
        <div class="mb-10">
          <img :src="'/assets/surveillance/images/logo.png'" alt="Kenya Red Cross" class="h-10 w-auto object-contain">
        </div>
        <h1 class="text-3xl font-extrabold text-gray-900 mb-1">Welcome Back!</h1>
        <p class="text-gray-400 mb-8">Login to your account</p>


        <form @submit.prevent="handleLogin">
          <label class="block text-sm font-semibold text-gray-800 mb-1">Username or Email</label>
          <input
  v-model="usr"
  type="text"
  required
  class="w-full bg-gray-100 rounded-lg px-4 py-3 mb-5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
  placeholder="Enter your username or email"
>


          <label class="block text-sm font-semibold text-gray-800 mb-1">Password</label>
          <div class="relative mb-6">
            <input v-model="pwd" :type="showPwd ? 'text' : 'password'" required
              class="w-full bg-gray-100 rounded-lg px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="Enter your password">
            <button
  type="button"
  @click="showPwd = !showPwd"
  class="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
  :aria-label="showPwd ? 'Hide password' : 'Show password'"
>
  <!-- Eye open -->
  <svg
    v-if="!showPwd"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    class="w-5 h-5"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
    />
    <circle cx="12" cy="12" r="2.5" />
  </svg>


  <!-- Eye closed / hidden -->
  <svg
    v-else
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    class="w-5 h-5"
  >
    <!-- Closed eye -->
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M3 12c2.2 2.7 5.2 4 9 4s6.8-1.3 9-4"
    />


    <!-- Eyelashes / closed-eye detail -->
    <path
      stroke-linecap="round"
      d="M7 10.5 5.5 9"
    />
    <path
      stroke-linecap="round"
      d="M12 9.5V8"
    />
    <path
      stroke-linecap="round"
      d="M17 10.5 18.5 9"
    />


    <!-- Slash -->
    <path
      stroke-linecap="round"
      stroke-width="2"
      d="M4 4l16 16"
    />
  </svg>
</button>
          </div>


          <p v-if="error" class="text-red-600 text-sm mb-4">{{ error }}</p>


          <button type="submit" class="w-full bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg py-3 mb-4">Login</button>
          <p class="text-center text-sm text-gray-600">Forgot Password? <a href="#" class="text-red-600 font-medium">Reset</a></p>
        </form>
      </div>


      <div class="hidden md:block bg-gray-300"></div>


      <div class="hidden md:flex items-center justify-center bg-white p-10">
        <img :src="'/assets/surveillance/images/crest.svg'" alt="" class="w-80 h-80 object-contain">
      </div>
    </div>
  </div>
</template>


<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login } from '@/api/frappe'


const usr = ref('')
const pwd = ref('')
const error = ref('')
const showPwd = ref(false)
const router = useRouter()


async function handleLogin() {
  error.value = ''
  const ok = await login(usr.value, pwd.value)
 if (ok) {
    router.push('/reports')
} else {
    error.value = 'Invalid email or password. Please try again.'
  }
}
</script>
