<template>
  <div class="bg-gray-100 min-h-screen flex items-center justify-center p-6">
    <div class="bg-white rounded-2xl shadow-sm w-full max-w-4xl grid grid-cols-1 md:grid-cols-[1fr_1.5px_1fr] overflow-hidden">
      <div class="p-10 md:p-14 flex flex-col justify-center">
        <div class="mb-10">
          <img :src="'/assets/surveillance/images/logo.png'" alt="Kenya Red Cross" class="h-10 w-auto object-contain">
        </div>
        <h1 class="text-3xl font-extrabold text-gray-900 mb-1">Welcome Back!</h1>
        <p class="text-gray-400 mb-8">Login to your account</p>


        <form @submit.prevent="handleLogin">
          <label class="block text-sm font-semibold text-gray-800 mb-1">Email</label>
          <input v-model="usr" type="email" required
            class="w-full bg-gray-100 rounded-lg px-4 py-3 mb-5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="Enter your email">


          <label class="block text-sm font-semibold text-gray-800 mb-1">Password</label>
          <div class="relative mb-6">
            <input v-model="pwd" :type="showPwd ? 'text' : 'password'" required
              class="w-full bg-gray-100 rounded-lg px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="Enter your password">
            <button type="button" @click="showPwd = !showPwd" class="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">👁</button>
          </div>


          <p v-if="error" class="text-red-600 text-sm mb-4">{{ error }}</p>


          <button type="submit" class="w-full bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg py-3 mb-4">Login</button>
          <p class="text-center text-sm text-gray-600">Forgot Password? <a href="#" class="text-red-600 font-medium">Reset</a></p>
        </form>
      </div>


      <div class="hidden md:block bg-gray-300"></div>


      <div class="hidden md:flex items-center justify-center bg-white p-10">
        <img :src="'/assets/surveillance/images/crest.png'" alt="" class="w-56 h-56 object-contain">
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
    router.push('/dashboard')
  } else {
    error.value = 'Invalid email or password. Please try again.'
  }
}
</script>
