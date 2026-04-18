import { compileFromFile } from 'json-schema-to-typescript';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, '..', 'schemas');
const outputDir = join(__dirname, '..', 'src', 'types', 'generated');

const schemas = [
  { file: 'execution-plan.json', output: 'execution-plan.d.ts' },
  { file: 'task-spec.json', output: 'task-spec.d.ts' },
  { file: 'event.json', output: 'event.d.ts' },
  { file: 'run-summary.json', output: 'run-summary.d.ts' },
];

async function main() {
  await mkdir(outputDir, { recursive: true });

  for (const schema of schemas) {
    const ts = await compileFromFile(join(schemasDir, schema.file), {
      bannerComment: '/* Auto-generated from ' + schema.file + '. Do not edit. */',
      style: { singleQuote: true },
    });
    await writeFile(join(outputDir, schema.output), ts);
    console.log(`Generated ${schema.output}`);
  }

  console.log('Type generation complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
