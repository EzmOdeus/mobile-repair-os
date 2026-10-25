declare module 'bidi-js' {
  export interface EmbeddingLevelsResult {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  }

  export interface Bidi {
    getEmbeddingLevels(text: string, explicitDirection?: 'ltr' | 'rtl'): EmbeddingLevelsResult;
    getReorderedString(text: string, levels: EmbeddingLevelsResult, start?: number, end?: number): string;
  }

  export default function bidiFactory(): Bidi;
}
