/** Defines which artifacts require strict integrity vs allow benign drift */
export interface ProtectedSurface {
  protected_paths: string[];
  driftable_paths: string[];
}

/** Default protected surface when not specified in plan */
export const DEFAULT_PROTECTED_SURFACE: ProtectedSurface = {
  protected_paths: [],
  driftable_paths: [
    'node_modules/**',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    '.npm/**',
    'build/**',
    'dist/**',
  ],
};
