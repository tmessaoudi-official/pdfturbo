export interface ProgressHandle {
  update(labelKey: string, params?: Record<string, unknown>): void;
  /**
   * Set determinate progress as a fraction 0..1 (renders a progress bar and
   * hides the spinner). Pass `null` to return to the indeterminate spinner.
   * No-op after the handle has resolved, or when no bar element is wired.
   */
  setFraction(fraction: number | null): void;
  done(): void;
  failed(): void;
}

export interface IProgressManager {
  begin(labelKey: string, params?: Record<string, unknown>): ProgressHandle;
}
