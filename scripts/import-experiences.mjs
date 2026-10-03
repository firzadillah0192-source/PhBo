// Import data only from the original Python registry without executing Python.
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync(process.argv[2], 'utf8');
const block = source.split('_EXPERIENCE_ROWS = [')[1]?.split('\n]')[0];
if (!block) throw new Error('Original experience rows not found');
const presets = block.split('\n').filter(line => line.trim().startsWith('(')).map(line => {
  const values = [...line.matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/g)]
    .map(match => (match[1] ?? match[2]).replace(/\\(['"\\])/g, '$1'));
  if (values.length !== 4) throw new Error('Unexpected Python registry format');
  const [id, name, description, prompt] = values;
  return { id, name, description, model: 'cx/gpt-image-2.5', prompt: `${prompt} Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG.` };
});
if (!presets.length) throw new Error('No presets imported');
writeFileSync(new URL('../src/services/experience-presets.ts', import.meta.url),
  `// Imported from PhBo/backend/app/experiences.py. Server-only prompts.\nimport type { ExperiencePreset } from './ninerouter.service.js';\nexport const experiencePresets: readonly ExperiencePreset[] = ${JSON.stringify(presets, null, 2)};\n`);
console.log(`Imported ${presets.length} experiences`);
