import { defineConfig } from 'vite-plus';

export default defineConfig({
  base: './',
  server: { host: '0.0.0.0' },
  build: { target: 'es2022' },
  lint: {
    plugins: ['typescript', 'import', 'unicorn', 'oxc'],
    categories: { correctness: 'error', suspicious: 'error' },
    ignorePatterns: ['dist/**', '.blabla/**'],
    options: { typeAware: true, typeCheck: true, denyWarnings: true, reportUnusedDisableDirectives: 'error' },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'import/no-cycle': 'error',
      'typescript/no-explicit-any': 'error',
      'typescript/no-non-null-assertion': 'error',
      'typescript/no-floating-promises': 'error',
      'typescript/no-misused-promises': 'error',
      'typescript/no-unsafe-assignment': 'error',
      'typescript/no-unsafe-call': 'error',
      'typescript/no-unsafe-member-access': 'error',
      'typescript/no-unsafe-return': 'error',
      'typescript/switch-exhaustiveness-check': 'error',
    },
  },
  fmt: { singleQuote: true, semi: true },
});
