import vue from 'eslint-plugin-vue';
import vueTypeScript from '@vue/eslint-config-typescript';
import prettierSkipFormatting from '@vue/eslint-config-prettier/skip-formatting';

export default [
  {
    ignores: [
      // Auto-generated — regenerate with npm run generate:api / generate:a301.
      'src/generated/**',
      'python_tools/**',
      'runtime_python/**',
      'dist/**',
      '.wrangler/**',
      'auto-imports.d.ts',
      'components.d.ts',
      'test_proc.js',
    ],
  },
  ...vue.configs['flat/essential'],
  ...vueTypeScript(),
  {
    rules: {
      // Blockly block definitions and generators build strings by hand, so
      // unused-but-documented generator parameters are common; flag them only
      // when they are not deliberately underscore-prefixed.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
      ],
      // Blockly's runtime types are loose in places (mutators, fields), so an
      // explicit `any` is sometimes the honest annotation.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Formatting is Prettier's job; keep ESLint out of it.
  prettierSkipFormatting,
];
