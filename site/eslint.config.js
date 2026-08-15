import js from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.recommended,
  reactHooks.configs.recommended,
  {
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'esnext',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        browser: true,
        es2024: true,
        node: true,
        Bun: true,
      },
    },
    settings: {
      react: { version: '19.2' },
      next: { rootDir: '.' },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
  {
    ignores: ['.next/', 'node_modules/', '*.config.*', 'out/'],
  }
)