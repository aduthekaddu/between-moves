import type { GameSeatColorChooser } from '@between-moves/domain';

/** [BM-022] Cryptographically unbiased color choice for an `any` Open-seat offer. */
export class CryptoGameSeatColorChooser implements GameSeatColorChooser {
  choose(): 'white' | 'black' {
    const value = crypto.getRandomValues(new Uint8Array(1))[0]!;
    return value < 128 ? 'white' : 'black';
  }
}
