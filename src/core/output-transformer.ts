/**
 * Step output transformers — pipe step output through chainable
 * transformers: JSON extraction, regex capture, template rendering,
 * line filtering, and custom functions.
 */

/** A single transformer in the pipeline */
export interface OutputTransformer {
  type: 'json_extract' | 'regex' | 'template' | 'lines' | 'trim' | 'custom';
  /** For json_extract: dot-notation path (e.g., "data.id") */
  path?: string;
  /** For regex: pattern with capture groups */
  pattern?: string;
  /** For regex: capture group index (default: 1) */
  group?: number;
  /** For template: template string with {{input}} placeholder */
  template?: string;
  /** For lines: 'first', 'last', or range like '1-5' */
  range?: string;
  /** For custom: transformer name registered in the registry */
  name?: string;
}

/** Result of applying transformers */
export interface TransformResult {
  /** Final output after all transformers */
  output: string;
  /** Whether transformation succeeded */
  success: boolean;
  /** Error message if any transformer failed */
  error?: string;
  /** Intermediate results from each transformer */
  stages: Array<{
    transformer: OutputTransformer;
    input: string;
    output: string;
    success: boolean;
    error?: string;
  }>;
}

/** Registry for custom transformer functions */
const customTransformers = new Map<string, (input: string) => string>();

/**
 * Register a custom transformer function.
 */
export function registerTransformer(name: string, fn: (input: string) => string): void {
  customTransformers.set(name, fn);
}

/**
 * Unregister a custom transformer.
 */
export function unregisterTransformer(name: string): boolean {
  return customTransformers.delete(name);
}

/**
 * Apply a chain of transformers to step output.
 */
export function applyTransformers(
  input: string,
  transformers: OutputTransformer[],
): TransformResult {
  const stages: TransformResult['stages'] = [];
  let current = input;
  let success = true;
  let error: string | undefined;

  for (const transformer of transformers) {
    const stageInput = current;
    try {
      current = applySingle(current, transformer);
      stages.push({ transformer, input: stageInput, output: current, success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stages.push({ transformer, input: stageInput, output: stageInput, success: false, error: msg });
      success = false;
      error = `Transformer "${transformer.type}" failed: ${msg}`;
      break;
    }
  }

  return { output: current, success, error, stages };
}

/**
 * Apply a single transformer.
 */
function applySingle(input: string, transformer: OutputTransformer): string {
  switch (transformer.type) {
    case 'json_extract':
      return applyJsonExtract(input, transformer.path ?? '');

    case 'regex':
      return applyRegex(input, transformer.pattern ?? '', transformer.group ?? 1);

    case 'template':
      return applyTemplate(input, transformer.template ?? '{{input}}');

    case 'lines':
      return applyLines(input, transformer.range ?? 'first');

    case 'trim':
      return input.trim();

    case 'custom': {
      const fn = customTransformers.get(transformer.name ?? '');
      if (!fn) throw new Error(`Custom transformer "${transformer.name}" not registered`);
      return fn(input);
    }

    default:
      throw new Error(`Unknown transformer type: ${transformer.type}`);
  }
}

/**
 * Extract a value from JSON using dot-notation path.
 */
function applyJsonExtract(input: string, path: string): string {
  const parsed = JSON.parse(input);
  const parts = path.split('.');
  let current: unknown = parsed;

  for (const part of parts) {
    if (current === null || current === undefined) {
      throw new Error(`Path "${path}" not found: null at "${part}"`);
    }

    // Handle array indexing: "items[0]"
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      current = (current as Record<string, unknown>)[arrayMatch[1]];
      if (Array.isArray(current)) {
        current = current[parseInt(arrayMatch[2], 10)];
      } else {
        throw new Error(`Path "${path}": "${arrayMatch[1]}" is not an array`);
      }
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  if (current === undefined) {
    throw new Error(`Path "${path}" not found in JSON`);
  }

  return typeof current === 'string' ? current : JSON.stringify(current);
}

/**
 * Apply regex extraction.
 */
function applyRegex(input: string, pattern: string, group: number): string {
  const match = input.match(new RegExp(pattern));
  if (!match) {
    throw new Error(`Pattern "${pattern}" did not match`);
  }

  if (group > 0 && group < match.length) {
    return match[group];
  }
  return match[0];
}

/**
 * Apply template rendering.
 */
function applyTemplate(input: string, template: string): string {
  return template.replace(/\{\{input\}\}/g, input);
}

/**
 * Extract lines from output.
 */
function applyLines(input: string, range: string): string {
  const lines = input.split('\n');

  if (range === 'first') return lines[0] ?? '';
  if (range === 'last') return lines[lines.length - 1] ?? '';

  const rangeMatch = range.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10) - 1;
    const end = parseInt(rangeMatch[2], 10);
    return lines.slice(start, end).join('\n');
  }

  const lineNum = parseInt(range, 10);
  if (!isNaN(lineNum)) return lines[lineNum - 1] ?? '';

  throw new Error(`Invalid line range: "${range}"`);
}

/**
 * Format a transform result for display.
 */
export function formatTransformResult(result: TransformResult): string {
  const lines: string[] = [];

  lines.push(`Transform: ${result.success ? 'OK' : 'FAILED'}`);
  if (result.error) lines.push(`  Error: ${result.error}`);

  for (let i = 0; i < result.stages.length; i++) {
    const s = result.stages[i];
    const status = s.success ? 'ok' : 'fail';
    lines.push(`  Stage ${i + 1} [${s.transformer.type}]: ${status}`);
    if (s.error) lines.push(`    Error: ${s.error}`);
  }

  const preview = result.output.length > 100
    ? result.output.slice(0, 100) + '...'
    : result.output;
  lines.push(`  Output: ${preview}`);

  return lines.join('\n');
}
