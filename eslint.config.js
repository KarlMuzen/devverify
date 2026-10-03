import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/.astro/**'],
  },
  {
    files: ['**/*.ts'],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.workspace.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
