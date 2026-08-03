import './index.css';

// Importing `blockly/core` rather than the whole `blockly` entry point keeps the
// unused JavaScript/PHP/Lua/Dart generators out of the bundle, but it also means
// the locale and the standard blocks are no longer set up for us. Order matters:
// the messages have to be installed before the blocks that reference them.
import './blocklyLocale';
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
