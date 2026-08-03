/// <reference types="vite/client" />

// `import ... from './x.json?url'` resolves to the emitted asset's URL. Declared
// here so tsc understands it outside of Vite (npm run smoke compiles this code
// with plain tsc).
declare module '*.json?url' {
  const url: string;
  export default url;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<
    Record<string, never>,
    Record<string, never>,
    unknown
  >;
  export default component;
}
