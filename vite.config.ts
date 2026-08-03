import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import ui from '@nuxt/ui/vite';
import {cloudflare} from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    ui({
      prose: true,
      colorMode: false,
      ui: {
        colors: {
          primary: 'teal',
          neutral: 'slate',
        },
      },
    }),
    cloudflare(),
  ],
});
