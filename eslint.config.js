import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

// Temporary relaxed rules while we tighten up our TypeScript code
// TODO: Remove these rules once we eliminate all of the unnecessary `any` types in the code
const relaxedTypedRules = {
  // Allow us to write async functions that don't use await
  // Intresting commentary on this: https://github.com/standard/eslint-config-standard-with-typescript/issues/217
  '@typescript-eslint/require-await': 'off',
  '@typescript-eslint/no-unsafe-argument': 'warn',
  '@typescript-eslint/no-unsafe-assignment': 'warn',
  '@typescript-eslint/no-unsafe-return': 'warn',
  '@typescript-eslint/no-unsafe-call': 'warn',
  '@typescript-eslint/no-unsafe-member-access': 'warn',
  '@typescript-eslint/no-unsafe-enum-comparison': 'warn',
  '@typescript-eslint/no-unsafe-declaration-merging': 'warn',
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-floating-promises': 'warn',
  '@typescript-eslint/no-misused-promises': 'warn',
  '@typescript-eslint/no-unused-expressions': 'warn',
  '@typescript-eslint/unbound-method': 'warn',
  '@typescript-eslint/no-this-alias': 'warn',
  '@typescript-eslint/no-empty-object-type': 'off',
  '@typescript-eslint/ban-ts-comment': 'warn',
  '@typescript-eslint/restrict-template-expressions': 'warn',
  '@typescript-eslint/prefer-promise-reject-errors': 'warn',
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended], // recommendedTypeChecked
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
        warnOnUnsupportedTypeScriptVersion: false,
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      ...relaxedTypedRules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          caughtErrorsIgnorePattern: '^(e|er|err|error)$',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  prettierConfig,
);
