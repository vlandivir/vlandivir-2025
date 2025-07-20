// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Files and directories to ignore during linting
    ignores: [
      'eslint.config.mjs', // This config file itself
      'src/generated/**/*', // Auto-generated Prisma client files
      'node_modules/**/*', // Dependencies
      'dist/**/*', // Build output
    ],
  },
  // Base configurations
  eslint.configs.recommended, // ESLint recommended rules
  ...tseslint.configs.recommendedTypeChecked, // TypeScript ESLint recommended rules with type checking
  eslintPluginPrettierRecommended, // Prettier integration
  
  {
    // Language options and parser configuration
    languageOptions: {
      globals: {
        ...globals.node, // Node.js globals
        ...globals.jest, // Jest testing globals
      },
      ecmaVersion: 5, // ECMAScript version
      sourceType: 'module', // Use ES modules
      parserOptions: {
        projectService: true, // Enable project service for better type checking
        tsconfigRootDir: import.meta.dirname, // Root directory for tsconfig
      },
    },
  },
  
  {
    // Custom rule overrides and configurations
    rules: {
      // TypeScript-specific rules
      
      // Disable explicit any rule - consider enabling this for better type safety
      // Recommendation: Gradually replace 'any' types with proper TypeScript types
      '@typescript-eslint/no-explicit-any': 'off',
      
      // Floating promises - warn about unhandled promises
      // Recommendation: Always await promises or handle them with .catch()
      '@typescript-eslint/no-floating-promises': 'warn',
      
      // Unsafe operations - warn about potential type safety issues
      // Recommendation: Add proper type annotations to eliminate these warnings
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      
      // Unused variables - warn about unused imports and variables
      // Recommendation: Remove unused imports and variables to keep code clean
      '@typescript-eslint/no-unused-vars': 'warn',
      
      // Async/await rules
      // Recommendation: Only use async when you actually await something
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/await-thenable': 'warn',
      
      // Method binding - warn about potential 'this' context issues
      // Recommendation: Use arrow functions or bind methods properly
      '@typescript-eslint/unbound-method': 'warn',
      
      // Object type rules
      // Recommendation: Use more specific types instead of empty object types
      '@typescript-eslint/no-empty-object-type': 'warn',
      
      // Future improvements to consider:
      // - Enable '@typescript-eslint/no-explicit-any': 'error' gradually
      // - Add '@typescript-eslint/prefer-nullish-coalescing': 'error'
      // - Add '@typescript-eslint/prefer-optional-chain': 'error'
      // - Add '@typescript-eslint/no-unnecessary-type-assertion': 'error'
      // - Add '@typescript-eslint/prefer-string-starts-ends-with': 'error'
      // - Add '@typescript-eslint/prefer-includes': 'error'
      // - Add '@typescript-eslint/no-array-constructor': 'error'
      // - Add '@typescript-eslint/no-unused-expressions': 'error'
      // - Add '@typescript-eslint/no-duplicate-imports': 'error'
      // - Add '@typescript-eslint/no-var-requires': 'error'
      // - Add '@typescript-eslint/prefer-const': 'error'
      // - Add '@typescript-eslint/no-this-alias': 'error'
      // - Add '@typescript-eslint/no-non-null-assertion': 'warn'
      // - Add '@typescript-eslint/consistent-type-imports': 'error'
      // - Add '@typescript-eslint/consistent-type-exports': 'error'
      // - Add '@typescript-eslint/consistent-type-definitions': 'error'
      // - Add '@typescript-eslint/consistent-indexed-object-style': 'error'
      // - Add '@typescript-eslint/consistent-function-return-type': 'warn'
      // - Add '@typescript-eslint/consistent-generic-constructors': 'error'
      // - Add '@typescript-eslint/consistent-return': 'error'
      // - Add '@typescript-eslint/class-literal-property-style': 'error'
      // - Add '@typescript-eslint/adjacent-overload-signatures': 'error'
      // - Add '@typescript-eslint/array-type': 'error'
      // - Add '@typescript-eslint/ban-ts-comment': 'warn'
      // - Add '@typescript-eslint/ban-types': 'error'
      // - Add '@typescript-eslint/explicit-function-return-type': 'warn'
      // - Add '@typescript-eslint/explicit-member-accessibility': 'warn'
      // - Add '@typescript-eslint/explicit-module-boundary-types': 'warn'
      // - Add '@typescript-eslint/member-delimiter-style': 'error'
      // - Add '@typescript-eslint/member-ordering': 'warn'
      // - Add '@typescript-eslint/method-signature-style': 'error'
      // - Add '@typescript-eslint/naming-convention': 'warn'
      // - Add '@typescript-eslint/no-base-to-string': 'error'
      // - Add '@typescript-eslint/no-confusing-non-null-assertion': 'error'
      // - Add '@typescript-eslint/no-confusing-void-expression': 'error'
      // - Add '@typescript-eslint/no-dynamic-delete': 'error'
      // - Add '@typescript-eslint/no-extraneous-class': 'error'
      // - Add '@typescript-eslint/no-extra-non-null-assertion': 'error'
      // - Add '@typescript-eslint/no-floating-promises': 'error'
      // - Add '@typescript-eslint/no-for-in-array': 'error'
      // - Add '@typescript-eslint/no-implied-eval': 'error'
      // - Add '@typescript-eslint/no-inferrable-types': 'error'
      // - Add '@typescript-eslint/no-misused-new': 'error'
      // - Add '@typescript-eslint/no-misused-promises': 'error'
      // - Add '@typescript-eslint/no-namespace': 'error'
      // - Add '@typescript-eslint/no-non-null-asserted-nullish-coalescing': 'error'
      // - Add '@typescript-eslint/no-non-null-asserted-optional-chain': 'error'
      // - Add '@typescript-eslint/no-parameter-properties': 'error'
      // - Add '@typescript-eslint/no-require-imports': 'error'
      // - Add '@typescript-eslint/no-this-alias': 'error'
      // - Add '@typescript-eslint/no-throw-literal': 'error'
      // - Add '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error'
      // - Add '@typescript-eslint/no-unnecessary-condition': 'error'
      // - Add '@typescript-eslint/no-unnecessary-qualifier': 'error'
      // - Add '@typescript-eslint/no-unnecessary-type-arguments': 'error'
      // - Add '@typescript-eslint/no-unnecessary-type-constraint': 'error'
      // - Add '@typescript-eslint/no-unsafe-argument': 'error'
      // - Add '@typescript-eslint/no-unsafe-assignment': 'error'
      // - Add '@typescript-eslint/no-unsafe-call': 'error'
      // - Add '@typescript-eslint/no-unsafe-member-access': 'error'
      // - Add '@typescript-eslint/no-unsafe-return': 'error'
      // - Add '@typescript-eslint/no-unsafe-unary-negation': 'error'
      // - Add '@typescript-eslint/no-var-requires': 'error'
      // - Add '@typescript-eslint/prefer-as-const': 'error'
      // - Add '@typescript-eslint/prefer-enum-initializers': 'error'
      // - Add '@typescript-eslint/prefer-for-of': 'error'
      // - Add '@typescript-eslint/prefer-function-type': 'error'
      // - Add '@typescript-eslint/prefer-includes': 'error'
      // - Add '@typescript-eslint/prefer-literal-enum-member': 'error'
      // - Add '@typescript-eslint/prefer-namespace-keyword': 'error'
      // - Add '@typescript-eslint/prefer-nullish-coalescing': 'error'
      // - Add '@typescript-eslint/prefer-optional-chain': 'error'
      // - Add '@typescript-eslint/prefer-readonly': 'error'
      // - Add '@typescript-eslint/prefer-readonly-parameter-types': 'warn'
      // - Add '@typescript-eslint/prefer-reduce-type-parameter': 'error'
      // - Add '@typescript-eslint/prefer-regexp-exec': 'error'
      // - Add '@typescript-eslint/prefer-return-this-type': 'error'
      // - Add '@typescript-eslint/prefer-string-starts-ends-with': 'error'
      // - Add '@typescript-eslint/prefer-ts-expect-error': 'error'
      // - Add '@typescript-eslint/promise-function-async': 'error'
      // - Add '@typescript-eslint/require-array-sort-compare': 'error'
      // - Add '@typescript-eslint/require-await': 'error'
      // - Add '@typescript-eslint/require-unawaited': 'error'
      // - Add '@typescript-eslint/restrict-plus-operands': 'error'
      // - Add '@typescript-eslint/restrict-template-expressions': 'error'
      // - Add '@typescript-eslint/return-await': 'error'
      // - Add '@typescript-eslint/strict-boolean-expressions': 'warn'
      // - Add '@typescript-eslint/switch-exhaustiveness-check': 'error'
      // - Add '@typescript-eslint/triple-slash-reference': 'error'
      // - Add '@typescript-eslint/type-annotation-spacing': 'error'
      // - Add '@typescript-eslint/unbound-method': 'error'
      // - Add '@typescript-eslint/unified-signatures': 'error'
    },
  },
);