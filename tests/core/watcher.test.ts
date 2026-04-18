import { describe, it, expect } from 'vitest';
import { matchGlob } from '../../src/core/watcher.js';

describe('matchGlob', () => {
  it('matches exact filename', () => {
    expect(matchGlob('test.ts', 'test.ts')).toBe(true);
    expect(matchGlob('test.ts', 'other.ts')).toBe(false);
  });

  it('matches single star wildcard', () => {
    expect(matchGlob('*.ts', 'file.ts')).toBe(true);
    expect(matchGlob('*.ts', 'file.js')).toBe(false);
    expect(matchGlob('*.ts', 'dir/file.ts')).toBe(false); // * does not match /
  });

  it('matches double star (globstar)', () => {
    expect(matchGlob('**/*.ts', 'file.ts')).toBe(true);
    expect(matchGlob('**/*.ts', 'src/file.ts')).toBe(true);
    expect(matchGlob('**/*.ts', 'src/deep/file.ts')).toBe(true);
    expect(matchGlob('**/*.ts', 'src/file.js')).toBe(false);
  });

  it('matches directory prefix with globstar', () => {
    expect(matchGlob('src/**', 'src/file.ts')).toBe(true);
    expect(matchGlob('src/**', 'src/deep/file.ts')).toBe(true);
    expect(matchGlob('src/**', 'other/file.ts')).toBe(false);
  });

  it('matches question mark wildcard', () => {
    expect(matchGlob('?.txt', 'a.txt')).toBe(true);
    expect(matchGlob('?.txt', 'ab.txt')).toBe(false);
  });

  it('handles dots in extensions', () => {
    expect(matchGlob('*.test.ts', 'foo.test.ts')).toBe(true);
    expect(matchGlob('*.test.ts', 'foo.spec.ts')).toBe(false);
  });

  it('matches complex patterns', () => {
    expect(matchGlob('src/**/*.test.ts', 'src/core/foo.test.ts')).toBe(true);
    expect(matchGlob('src/**/*.test.ts', 'src/foo.test.ts')).toBe(true);
    expect(matchGlob('src/**/*.test.ts', 'tests/foo.test.ts')).toBe(false);
  });
});
