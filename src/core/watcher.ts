import { watch, type FSWatcher } from 'node:fs';

export interface WatchOptions {
  glob: string;
  debounceMs?: number;
  onTrigger: () => Promise<void>;
  signal?: AbortSignal;
}

/**
 * Match a file path against a simple glob pattern.
 * Supports: ** (any path), * (any chars in segment), ? (single char).
 */
export function matchGlob(pattern: string, filePath: string): boolean {
  // Use \x00 for ** and \x01 for the optional ? marker so they survive other replacements
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(\x00/)\x01')
    .replace(/\*\*/g, '\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\x00/g, '.*')
    .replace(/\x01/g, '?');
  return new RegExp(`^${regexStr}$`).test(filePath);
}

/**
 * Watch a directory for file changes matching a glob pattern.
 * Returns a stop function to terminate watching.
 */
export function watchDirectory(
  dir: string,
  options: WatchOptions,
): { stop: () => void } {
  const debounceMs = options.debounceMs ?? 500;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isRunning = false;
  let pendingRun = false;
  let watcher: FSWatcher | null = null;

  async function triggerRun(): Promise<void> {
    if (isRunning) {
      pendingRun = true;
      return;
    }

    isRunning = true;
    try {
      await options.onTrigger();
    } catch {
      // Errors handled by the caller's onTrigger
    } finally {
      isRunning = false;
      if (pendingRun) {
        pendingRun = false;
        triggerRun();
      }
    }
  }

  function stop(): void {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  try {
    watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.replace(/\\/g, '/');
      if (!matchGlob(options.glob, rel)) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => triggerRun(), debounceMs);
    });
  } catch {
    // fs.watch may not support recursive on all platforms
    // Fallback: just run once
    triggerRun();
  }

  if (options.signal) {
    options.signal.addEventListener('abort', stop, { once: true });
  }

  return { stop };
}
