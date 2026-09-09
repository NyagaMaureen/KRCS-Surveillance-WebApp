import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './main.css'
import './charts/chartSetup'

createApp(App).use(router).mount('#app')
