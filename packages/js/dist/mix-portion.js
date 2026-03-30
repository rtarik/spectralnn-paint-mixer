import { SrgbColor } from './srgb-color.js';

export class MixPortion {
  constructor({ color, parts }) {
    if (!(color instanceof SrgbColor)) {
      throw new TypeError('color must be an SrgbColor');
    }
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new RangeError(`parts must be greater than zero, got ${parts}`);
    }
    this.color = color;
    this.parts = parts;
  }
}
