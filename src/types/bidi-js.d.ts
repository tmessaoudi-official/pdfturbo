/**
 * Ambient types for bidi-js (UAX#9 Unicode Bidirectional Algorithm), written against 1.0.3.
 * bidi-js 1.1.0 ships its own `src/bidi.d.ts`, but default-export-shaped: `src/utils/bidi.ts` imports
 * named types, and without this file tsc fails TS2614 on `BidiApi`. Models the subset we use.
 * See https://github.com/lojjic/bidi-js for the full API.
 */
declare module 'bidi-js' {
  export interface BidiParagraph {
    start: number;
    end: number;
    level: number;
  }
  export interface BidiEmbeddingLevels {
    levels: Uint8Array;
    paragraphs: BidiParagraph[];
  }
  export interface BidiApi {
    getEmbeddingLevels(text: string, explicitDirection?: 'ltr' | 'rtl' | null): BidiEmbeddingLevels;
    getReorderSegments(
      text: string,
      embeddingLevels: BidiEmbeddingLevels,
      start?: number,
      end?: number,
    ): [number, number][];
    getReorderedIndices(
      text: string,
      embeddingLevels: BidiEmbeddingLevels,
      start?: number,
      end?: number,
    ): number[];
    getReorderedString(
      text: string,
      embeddingLevels: BidiEmbeddingLevels,
      start?: number,
      end?: number,
    ): string;
    getBidiCharType(char: string): number;
    getBidiCharTypeName(char: string): string;
    getMirroredCharacter(char: string): string | null;
    getMirroredCharactersMap(
      text: string,
      embeddingLevels: BidiEmbeddingLevels,
      start?: number,
      end?: number,
    ): Map<number, string>;
  }
  export default function bidiFactory(): BidiApi;
}
