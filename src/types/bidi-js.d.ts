/**
 * Ambient types for bidi-js@1.0.3 (UAX#9 Unicode Bidirectional Algorithm).
 * The package ships no TypeScript declarations; this models the subset we use.
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
