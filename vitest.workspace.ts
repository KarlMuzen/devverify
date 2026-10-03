import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'core',
      root: './packages/core',
      include: ['src/**/*.test.ts'],
      coverage: { provider: 'v8' },
    },
  },
  {
    test: {
      name: 'cli',
      root: './packages/cli',
      include: ['src/**/*.test.ts'],
      coverage: { provider: 'v8' },
    },
  },
  {
    test: {
      name: 'crawler',
      root: './apps/crawler',
      include: ['src/**/*.test.ts'],
      coverage: { provider: 'v8' },
    },
  },
  {
    test: {
      name: 'action',
      root: './apps/action',
      include: ['src/**/*.test.ts'],
      coverage: { provider: 'v8' },
    },
  },
]);
