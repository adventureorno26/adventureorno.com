module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'vite.config.ts', 'src/lib/database.types.ts'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // COMPLETION-PLAN Phase 2: creation must go through the one transactional,
    // idempotent path. `createPlace` is a bare INSERT — not atomic with the
    // visit/rating/review that accompany it, and a retry duplicates the place.
    // Importing it again would silently reintroduce that class of bug.
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '../lib/data',
            importNames: ['createPlace', 'addVisit'],
            message:
              'Use createPlaceAtomic/addExperience — createPlace and addVisit are non-atomic, non-idempotent inserts.',
          },
          {
            name: './data',
            importNames: ['createPlace', 'addVisit'],
            message:
              'Use createPlaceAtomic/addExperience — createPlace and addVisit are non-atomic, non-idempotent inserts.',
          },
          {
            name: '../../lib/data',
            importNames: ['createPlace', 'addVisit'],
            message:
              'Use createPlaceAtomic/addExperience — createPlace and addVisit are non-atomic, non-idempotent inserts.',
          },
        ],
      },
    ],
  },
};
