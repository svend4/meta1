/**
 * Run access control — role-based permissions for run operations.
 * Supports roles, permission checks, ACL storage, and audit integration.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBaseDir } from './paths.js';

/** Roles in the system */
export type Role = 'admin' | 'operator' | 'viewer' | 'analyst';

/** Operations that can be controlled */
export type RunPermission = 'execute' | 'view' | 'cancel' | 'modify' | 'delete' | 'export' | 'snapshot';

/** A principal (user or service) */
export interface Principal {
  id: string;
  name: string;
  roles: Role[];
}

/** An ACL entry mapping principal → permissions for a resource */
export interface AclEntry {
  principalId: string;
  resource: string;
  permissions: RunPermission[];
  grantedAt: string;
  grantedBy: string;
}

/** Result of an access check */
export interface AccessCheckResult {
  allowed: boolean;
  principal: string;
  permission: RunPermission;
  resource: string;
  reason: string;
  checkedAt: string;
}

/** The full ACL store */
interface AclStore {
  principals: Principal[];
  entries: AclEntry[];
}

/** Default permissions for each role */
const ROLE_PERMISSIONS: Record<Role, RunPermission[]> = {
  admin: ['execute', 'view', 'cancel', 'modify', 'delete', 'export', 'snapshot'],
  operator: ['execute', 'view', 'cancel', 'export', 'snapshot'],
  viewer: ['view', 'export'],
  analyst: ['view', 'export', 'snapshot'],
};

function getAclPath(): string {
  return join(getBaseDir(), 'acl.json');
}

function loadAcl(): AclStore {
  const path = getAclPath();
  if (!existsSync(path)) return { principals: [], entries: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

function saveAcl(store: AclStore): void {
  mkdirSync(getBaseDir(), { recursive: true });
  writeFileSync(getAclPath(), JSON.stringify(store, null, 2), 'utf8');
}

/**
 * Register a principal.
 */
export function registerPrincipal(principal: Principal): void {
  const store = loadAcl();
  const existing = store.principals.findIndex((p) => p.id === principal.id);
  if (existing >= 0) {
    store.principals[existing] = principal;
  } else {
    store.principals.push(principal);
  }
  saveAcl(store);
}

/**
 * Get a principal by ID.
 */
export function getPrincipal(id: string): Principal | null {
  const store = loadAcl();
  return store.principals.find((p) => p.id === id) ?? null;
}

/**
 * List all principals.
 */
export function listPrincipals(): Principal[] {
  return loadAcl().principals;
}

/**
 * Remove a principal and their ACL entries.
 */
export function removePrincipal(id: string): boolean {
  const store = loadAcl();
  const before = store.principals.length;
  store.principals = store.principals.filter((p) => p.id !== id);
  store.entries = store.entries.filter((e) => e.principalId !== id);
  saveAcl(store);
  return store.principals.length < before;
}

/**
 * Grant permissions to a principal for a resource.
 */
export function grant(
  principalId: string,
  resource: string,
  permissions: RunPermission[],
  grantedBy: string,
): AclEntry {
  const store = loadAcl();

  // Find or create entry
  let entry = store.entries.find(
    (e) => e.principalId === principalId && e.resource === resource,
  );

  if (entry) {
    const existing = new Set(entry.permissions);
    for (const p of permissions) existing.add(p);
    entry.permissions = [...existing];
  } else {
    entry = {
      principalId,
      resource,
      permissions,
      grantedAt: new Date().toISOString(),
      grantedBy,
    };
    store.entries.push(entry);
  }

  saveAcl(store);
  return entry;
}

/**
 * Revoke permissions from a principal for a resource.
 */
export function revoke(
  principalId: string,
  resource: string,
  permissions: RunPermission[],
): boolean {
  const store = loadAcl();
  const entry = store.entries.find(
    (e) => e.principalId === principalId && e.resource === resource,
  );

  if (!entry) return false;

  const toRevoke = new Set(permissions);
  entry.permissions = entry.permissions.filter((p) => !toRevoke.has(p));

  // Remove entry if no permissions left
  if (entry.permissions.length === 0) {
    store.entries = store.entries.filter(
      (e) => !(e.principalId === principalId && e.resource === resource),
    );
  }

  saveAcl(store);
  return true;
}

/**
 * Check if a principal has permission for a resource.
 */
export function checkAccess(
  principalId: string,
  permission: RunPermission,
  resource: string,
): AccessCheckResult {
  const store = loadAcl();
  const principal = store.principals.find((p) => p.id === principalId);

  const result: AccessCheckResult = {
    allowed: false,
    principal: principalId,
    permission,
    resource,
    reason: '',
    checkedAt: new Date().toISOString(),
  };

  if (!principal) {
    result.reason = 'Principal not found';
    return result;
  }

  // Check role-based permissions
  for (const role of principal.roles) {
    if (ROLE_PERMISSIONS[role]?.includes(permission)) {
      result.allowed = true;
      result.reason = `Allowed by role: ${role}`;
      return result;
    }
  }

  // Check explicit ACL entries
  const entry = store.entries.find(
    (e) => e.principalId === principalId && (e.resource === resource || e.resource === '*'),
  );

  if (entry?.permissions.includes(permission)) {
    result.allowed = true;
    result.reason = `Allowed by ACL entry for resource: ${entry.resource}`;
    return result;
  }

  result.reason = `No permission "${permission}" for principal "${principalId}" on resource "${resource}"`;
  return result;
}

/**
 * Get all permissions for a principal (combined role + ACL).
 */
export function getEffectivePermissions(principalId: string, resource?: string): RunPermission[] {
  const store = loadAcl();
  const principal = store.principals.find((p) => p.id === principalId);
  if (!principal) return [];

  const perms = new Set<RunPermission>();

  // Role-based
  for (const role of principal.roles) {
    for (const p of ROLE_PERMISSIONS[role] ?? []) {
      perms.add(p);
    }
  }

  // ACL-based
  for (const entry of store.entries) {
    if (entry.principalId === principalId && (!resource || entry.resource === resource || entry.resource === '*')) {
      for (const p of entry.permissions) perms.add(p);
    }
  }

  return [...perms];
}

/**
 * Get the default permissions for a role.
 */
export function getRolePermissions(role: Role): RunPermission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/**
 * Format access check result for display.
 */
export function formatAccessCheck(result: AccessCheckResult): string {
  const status = result.allowed ? 'ALLOWED' : 'DENIED';
  return `${status}: ${result.principal} → ${result.permission} on ${result.resource} (${result.reason})`;
}

/**
 * Format principal for display.
 */
export function formatPrincipal(principal: Principal): string {
  return `${principal.name} (${principal.id}) [${principal.roles.join(', ')}]`;
}
