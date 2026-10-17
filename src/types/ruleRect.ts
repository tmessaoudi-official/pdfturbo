/**
 * A thin graphic rule (filled/stroked path) in PDF user space (y-up), collected
 * from the export op-walk and matched against text runs to detect underlines and
 * strikethroughs. `y` is the bottom edge; height 0 is a pure horizontal stroke.
 */
export interface RuleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
