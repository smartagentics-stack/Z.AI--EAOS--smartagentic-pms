import smartagenticsPreset from '@smartagentics/dev-config/eslint';
export default [
  ...smartagenticsPreset,
  { ignores: ['**/dist/**','**/node_modules/**','**/.next/**','**/coverage/**','**/*.config.js','**/*.config.mjs','**/.turbo/**'] },
];
