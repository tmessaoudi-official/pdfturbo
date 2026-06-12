export interface ProgressHandle {
  update(labelKey: string, params?: Record<string, unknown>): void;
  done(): void;
  failed(): void;
}

export interface IProgressManager {
  begin(labelKey: string, params?: Record<string, unknown>): ProgressHandle;
}
