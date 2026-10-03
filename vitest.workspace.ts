import { resolve } from 'node:path';
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
    resolve: {
      alias: [
        {
          find: '@devverify/core/node',
          replacement: resolve(process.cwd(), 'packages/core/src/node.ts'),
        },
        {
          find: '@devverify/core',
          replacement: resolve(process.cwd(), 'packages/core/src/index.ts'),
        },
      ],
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
