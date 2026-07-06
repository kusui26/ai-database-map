import js from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * ESLint flat config。
 * CLAUDE.md の規約を「落ちるゲート」として機械化する：
 *  - `any` 禁止（@typescript-eslint/no-explicit-any）
 *  - `as` キャスト禁止（consistent-type-assertions: never → 型ガードへ誘導）
 *  - 依存方向の強制（domain 層は UI/app/ai へ import できない・architecture.md §3.3）
 */
export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'next-env.d.ts',
      'data/**',
      'slide/**',
      'script/**',
      'condminium/**',
      'pipeline/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Next.js 推奨ルール（Core Web Vitals 含む）
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },

  // グローバル（Node + ブラウザ）＋ CLAUDE.md §3 の不変/関数型の下支え
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // TypeScript 固有の厳格ルール
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-undef': 'off', // 型は TS が担保する（typescript-eslint 推奨）
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },

  // アーキテクチャ境界：domain → UI/app/ai の依存を禁止（architecture.md §3.3）
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/components',
                '@/components/**',
                '@/app',
                '@/app/**',
                '@/ai',
                '@/ai/**',
                '**/components/**',
                '**/app/**',
                '**/ai/**',
              ],
              message:
                'domain 層は UI/app/ai へ依存できません（architecture.md §3.3 の依存方向）。共通の型・定数は @/shared、データ取得は @/db を経由してください。',
            },
          ],
        },
      ],
    },
  },

  // Prettier と競合する整形系ルールを無効化（必ず最後）
  eslintConfigPrettier,
)
