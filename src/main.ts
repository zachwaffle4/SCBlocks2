import './index.css';

// Blockly's standard blocks (math_number, logic_compare, …) are registered as a
// side effect. Importing them here instead of pulling the whole `blockly` entry
// point keeps the unused JavaScript/PHP/Lua/Dart generators out of the bundle.
import 'blockly/blocks';

import ui from '@nuxt/ui/vue-plugin';
import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [],
});

createApp(App).use(router).use(ui).mount('#app');
