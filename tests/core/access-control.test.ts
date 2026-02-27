import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  registerPrincipal,
  getPrincipal,
  listPrincipals,
  removePrincipal,
  grant,
  revoke,
  checkAccess,
  getEffectivePermissions,
  getRolePermissions,
  formatAccessCheck,
  formatPrincipal,
} from '../../src/core/access-control.js';
import type { Principal } from '../../src/core/access-control.js';

let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

describe('access-control', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-acl-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('principals', () => {
    it('registers and retrieves a principal', () => {
      registerPrincipal({ id: 'u1', name: 'Alice', roles: ['admin'] });
      const p = getPrincipal('u1');
      expect(p).toBeDefined();
      expect(p!.name).toBe('Alice');
      expect(p!.roles).toEqual(['admin']);
    });

    it('updates existing principal', () => {
      registerPrincipal({ id: 'u1', name: 'Alice', roles: ['viewer'] });
      registerPrincipal({ id: 'u1', name: 'Alice (Admin)', roles: ['admin'] });

      const p = getPrincipal('u1');
      expect(p!.name).toBe('Alice (Admin)');
      expect(p!.roles).toEqual(['admin']);
    });

    it('lists all principals', () => {
      registerPrincipal({ id: 'u1', name: 'Alice', roles: ['admin'] });
      registerPrincipal({ id: 'u2', name: 'Bob', roles: ['viewer'] });

      expect(listPrincipals()).toHaveLength(2);
    });

    it('removes principal and their ACL entries', () => {
      registerPrincipal({ id: 'u1', name: 'Alice', roles: ['admin'] });
      grant('u1', 'run-1', ['execute'], 'system');

      expect(removePrincipal('u1')).toBe(true);
      expect(getPrincipal('u1')).toBeNull();
    });

    it('returns false removing unknown principal', () => {
      expect(removePrincipal('ghost')).toBe(false);
    });

    it('returns null for unknown principal', () => {
      expect(getPrincipal('ghost')).toBeNull();
    });
  });

  describe('role-based access', () => {
    it('admin has all permissions', () => {
      registerPrincipal({ id: 'admin', name: 'Admin', roles: ['admin'] });

      expect(checkAccess('admin', 'execute', 'run-1').allowed).toBe(true);
      expect(checkAccess('admin', 'view', 'run-1').allowed).toBe(true);
      expect(checkAccess('admin', 'cancel', 'run-1').allowed).toBe(true);
      expect(checkAccess('admin', 'modify', 'run-1').allowed).toBe(true);
      expect(checkAccess('admin', 'delete', 'run-1').allowed).toBe(true);
      expect(checkAccess('admin', 'export', 'run-1').allowed).toBe(true);
      expect(checkAccess('admin', 'snapshot', 'run-1').allowed).toBe(true);
    });

    it('viewer can only view and export', () => {
      registerPrincipal({ id: 'viewer', name: 'Viewer', roles: ['viewer'] });

      expect(checkAccess('viewer', 'view', 'run-1').allowed).toBe(true);
      expect(checkAccess('viewer', 'export', 'run-1').allowed).toBe(true);
      expect(checkAccess('viewer', 'execute', 'run-1').allowed).toBe(false);
      expect(checkAccess('viewer', 'cancel', 'run-1').allowed).toBe(false);
    });

    it('operator can execute, view, cancel, export, snapshot', () => {
      registerPrincipal({ id: 'op', name: 'Operator', roles: ['operator'] });

      expect(checkAccess('op', 'execute', 'run-1').allowed).toBe(true);
      expect(checkAccess('op', 'view', 'run-1').allowed).toBe(true);
      expect(checkAccess('op', 'cancel', 'run-1').allowed).toBe(true);
      expect(checkAccess('op', 'modify', 'run-1').allowed).toBe(false);
    });

    it('analyst can view, export, snapshot', () => {
      registerPrincipal({ id: 'analyst', name: 'Analyst', roles: ['analyst'] });

      expect(checkAccess('analyst', 'view', 'run-1').allowed).toBe(true);
      expect(checkAccess('analyst', 'export', 'run-1').allowed).toBe(true);
      expect(checkAccess('analyst', 'snapshot', 'run-1').allowed).toBe(true);
      expect(checkAccess('analyst', 'execute', 'run-1').allowed).toBe(false);
    });

    it('unknown principal is denied', () => {
      const result = checkAccess('ghost', 'view', 'run-1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  describe('ACL grants', () => {
    it('grants explicit permission', () => {
      registerPrincipal({ id: 'u1', name: 'User', roles: [] });
      grant('u1', 'run-1', ['execute'], 'admin');

      expect(checkAccess('u1', 'execute', 'run-1').allowed).toBe(true);
      expect(checkAccess('u1', 'view', 'run-1').allowed).toBe(false);
    });

    it('grants wildcard resource', () => {
      registerPrincipal({ id: 'u1', name: 'User', roles: [] });
      grant('u1', '*', ['view'], 'admin');

      expect(checkAccess('u1', 'view', 'any-run').allowed).toBe(true);
    });

    it('accumulates permissions', () => {
      registerPrincipal({ id: 'u1', name: 'User', roles: [] });
      grant('u1', 'run-1', ['view'], 'admin');
      grant('u1', 'run-1', ['execute'], 'admin');

      expect(checkAccess('u1', 'view', 'run-1').allowed).toBe(true);
      expect(checkAccess('u1', 'execute', 'run-1').allowed).toBe(true);
    });

    it('revokes permission', () => {
      registerPrincipal({ id: 'u1', name: 'User', roles: [] });
      grant('u1', 'run-1', ['view', 'execute'], 'admin');
      revoke('u1', 'run-1', ['execute']);

      expect(checkAccess('u1', 'view', 'run-1').allowed).toBe(true);
      expect(checkAccess('u1', 'execute', 'run-1').allowed).toBe(false);
    });

    it('revoke returns false for unknown entry', () => {
      expect(revoke('ghost', 'run-1', ['view'])).toBe(false);
    });
  });

  describe('effective permissions', () => {
    it('combines role and ACL permissions', () => {
      registerPrincipal({ id: 'u1', name: 'User', roles: ['viewer'] });
      grant('u1', 'run-1', ['execute'], 'admin');

      const perms = getEffectivePermissions('u1', 'run-1');
      expect(perms).toContain('view');    // from role
      expect(perms).toContain('export');  // from role
      expect(perms).toContain('execute'); // from ACL
    });

    it('returns empty for unknown principal', () => {
      expect(getEffectivePermissions('ghost')).toEqual([]);
    });
  });

  describe('getRolePermissions', () => {
    it('returns admin permissions', () => {
      const perms = getRolePermissions('admin');
      expect(perms).toContain('execute');
      expect(perms).toContain('delete');
    });

    it('returns viewer permissions', () => {
      const perms = getRolePermissions('viewer');
      expect(perms).toContain('view');
      expect(perms).not.toContain('execute');
    });
  });

  describe('formatters', () => {
    it('formats allowed check', () => {
      registerPrincipal({ id: 'u1', name: 'Admin', roles: ['admin'] });
      const result = checkAccess('u1', 'execute', 'run-1');
      expect(formatAccessCheck(result)).toContain('ALLOWED');
    });

    it('formats denied check', () => {
      registerPrincipal({ id: 'u1', name: 'Viewer', roles: ['viewer'] });
      const result = checkAccess('u1', 'execute', 'run-1');
      expect(formatAccessCheck(result)).toContain('DENIED');
    });

    it('formats principal', () => {
      const p: Principal = { id: 'u1', name: 'Alice', roles: ['admin', 'operator'] };
      expect(formatPrincipal(p)).toContain('Alice');
      expect(formatPrincipal(p)).toContain('admin');
    });
  });
});
