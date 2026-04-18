/** I/O contract for a plan — informational in v3.0 MVP */
export interface PlanIOSignature {
  inputs?: {
    files?: string[];
    env_vars?: string[];
  };
  exports?: {
    artifacts: string[];
    env_vars?: string[];
  };
}
