/* Auto-generated from task-spec.json. Do not edit. */

/**
 * Specification for a task to be planned and executed by the runtime
 */
export interface TaskSpec {
  /**
   * Unique identifier for this task
   */
  task_id: string;
  /**
   * The task description in natural language
   */
  prompt: string;
  /**
   * Additional context for planning (e.g. existing files, dependencies)
   */
  context?: {
    [k: string]: unknown;
  };
  /**
   * LLM model identifier to use for planning
   */
  model: string;
  [k: string]: unknown;
}
