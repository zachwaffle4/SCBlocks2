import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import ui from '@nuxt/ui/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// Only the Python generator is ever used; see the stub for why the others are
// still pulled in.
const blocklyGeneratorStub = fileURLToPath(
  new URL('./src/shims/blocklyGeneratorStub.mjs', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      'blockly/javascript': blocklyGeneratorStub,
      'blockly/dart': blocklyGeneratorStub,
      'blockly/lua': blocklyGeneratorStub,
      'blockly/php': blocklyGeneratorStub,
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        // Keep the big, rarely-changing vendors in their own long-lived chunks
        // so an app edit does not invalidate all 2 MB.
        codeSplitting: {
          minSize: 20000,
          groups: [
            {
              name: 'iconify',
              test: /node_modules[\\/]@iconify[\\/]/,
              priority: 20,
            },
            {
              name: 'motion',
              test: /node_modules[\\/]motion-(dom|v)[\\/]/,
              priority: 18,
            },
            {
              name: 'ui',
              test: /node_modules[\\/](@nuxt[\\/]ui|reka-ui)[\\/]/,
              priority: 15,
            },
            {
              name: 'blockly',
              test: /node_modules[\\/](@blockly|blockly)[\\/]/,
              priority: 12,
            },
            {
              name: 'shiki',
              test: /node_modules[\\/]@?shikijs?[\\/]/,
              priority: 10,
            },
            {
              name: 'vue',
              test: /node_modules[\\/](@vue|vue|vue-router)[\\/]/,
              priority: 8,
            },
            {
              name: 'tailwind',
              test: /node_modules[\\/](?:tailwindcss|tailwind-merge|tailwind-variants|@tailwindcss)/,
              priority: 5,
            },
          ],
        },
      },
    },
  },
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
