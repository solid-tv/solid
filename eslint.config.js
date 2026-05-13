import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

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
  '@typescript-eslint/no-empty-object-type': 'warn',
  '@typescript-eslint/ban-ts-comment': 'warn',
  '@typescript-eslint/restrict-template-expressions': 'warn',
  '@typescript-eslint/prefer-promise-reject-errors': 'warn',
  '@typescript-eslint/no-unused-vars': [
    'warn',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    },
  ],
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.{ts,tsx,js}'],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: relaxedTypedRules,
  },
  {
    files: ['**/*.{ts,tsx,js}'],
    ignores: ['src/**/*.{ts,tsx,js}'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
);
