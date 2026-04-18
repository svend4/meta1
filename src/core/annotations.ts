import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBaseDir } from './paths.js';

/** A user annotation attached to a step */
export interface StepAnnotation {
  /** Annotation unique ID */
  id: string;
  /** Run ID this annotation belongs to */
  run_id: string;
  /** Step ID being annotated */
  step_id: string;
  /** The annotation text */
  text: string;
  /** Optional tags for categorization */
  tags?: string[];
  /** When the annotation was created */
  created_at: string;
  /** Who created the annotation */
  author?: string;
}

/** All annotations for a run */
export interface RunAnnotations {
  run_id: string;
  annotations: StepAnnotation[];
}

function getAnnotationsDir(): string {
  return join(getBaseDir(), 'annotations');
}

function getAnnotationsPath(runId: string): string {
  return join(getAnnotationsDir(), `${runId}.json`);
}

/**
 * Add an annotation to a step in a run.
 */
export function addAnnotation(
  runId: string,
  stepId: string,
  text: string,
  options?: { tags?: string[]; author?: string },
): StepAnnotation {
  const dir = getAnnotationsDir();
  mkdirSync(dir, { recursive: true });

  const existing = loadAnnotations(runId);

  const annotation: StepAnnotation = {
    id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    run_id: runId,
    step_id: stepId,
    text,
    tags: options?.tags,
    author: options?.author,
    created_at: new Date().toISOString(),
  };

  existing.annotations.push(annotation);
  saveAnnotations(existing);

  return annotation;
}

/**
 * Load all annotations for a run.
 */
export function loadAnnotations(runId: string): RunAnnotations {
  const path = getAnnotationsPath(runId);
  if (!existsSync(path)) {
    return { run_id: runId, annotations: [] };
  }
  return JSON.parse(readFileSync(path, 'utf8')) as RunAnnotations;
}

/**
 * Get annotations for a specific step.
 */
export function getStepAnnotations(runId: string, stepId: string): StepAnnotation[] {
  const all = loadAnnotations(runId);
  return all.annotations.filter((a) => a.step_id === stepId);
}

/**
 * Remove an annotation by ID.
 */
export function removeAnnotation(runId: string, annotationId: string): boolean {
  const data = loadAnnotations(runId);
  const idx = data.annotations.findIndex((a) => a.id === annotationId);
  if (idx === -1) return false;

  data.annotations.splice(idx, 1);
  saveAnnotations(data);
  return true;
}

/**
 * Search annotations by text or tag.
 */
export function searchAnnotations(
  runId: string,
  query: { text?: string; tag?: string },
): StepAnnotation[] {
  const all = loadAnnotations(runId);
  return all.annotations.filter((a) => {
    if (query.text && !a.text.toLowerCase().includes(query.text.toLowerCase())) return false;
    if (query.tag && !(a.tags ?? []).includes(query.tag)) return false;
    return true;
  });
}

function saveAnnotations(data: RunAnnotations): void {
  const path = getAnnotationsPath(data.run_id);
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}
