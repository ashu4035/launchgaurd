import js from '@eslint/js';
import ts from 'typescript-eslint';
export default [
  {ignores:['**/node_modules/**','**/dist/**','**/public/**','test-results/**']},
  {files:['apps/api/src/**/*.js'],...js.configs.recommended,languageOptions:{globals:{process:'readonly',Buffer:'readonly',URL:'readonly',URLSearchParams:'readonly',AbortSignal:'readonly',fetch:'readonly',setTimeout:'readonly',clearTimeout:'readonly',console:'readonly',document:'readonly',window:'readonly'}}},
  ...ts.configs.recommended.map(config=>({...config,files:['packages/ui/**/*.tsx','apps/webflow-extension/src/**/*.tsx']})),
  {files:['apps/api/src/**/*.js'],rules:{'no-unused-vars':['error',{argsIgnorePattern:'^_|^observed$|^expected$',varsIgnorePattern:'^private|^observed$|^expected$'}]}},
];
