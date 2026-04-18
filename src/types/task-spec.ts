/** Specification for a task to be planned and executed */
export interface TaskSpec {
  task_id: string;
  prompt: string;
  context?: Record<string, unknown>;
  model: string;
}
