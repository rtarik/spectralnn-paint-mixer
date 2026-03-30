function requireUnitChannel(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be in 0..1, got ${value}`);
  }
}

function requireByteChannel(name, value) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${name} must be in 0..255, got ${value}`);
  }
}

function channelToHexPair(value) {
  const channel = Math.max(0, Math.min(255, Math.trunc(value * 255)));
  return channel.toString(16).toUpperCase().padStart(2, '0');
}

export class SrgbColor {
  constructor(red, green, blue) {
    requireUnitChannel('red', red);
    requireUnitChannel('green', green);
    requireUnitChannel('blue', blue);
    this.red = red;
    this.green = green;
    this.blue = blue;
  }

  static fromUnitRgb(red, green, blue) {
    return new SrgbColor(red, green, blue);
  }

  static fromRgb8(red, green, blue) {
    requireByteChannel('red', red);
    requireByteChannel('green', green);
    requireByteChannel('blue', blue);
    return new SrgbColor(red / 255, green / 255, blue / 255);
  }

  static fromHex(hex) {
    const raw = hex.startsWith('#') ? hex.slice(1) : hex;
    let rgb = raw;
    if (raw.length === 8) {
      if (!raw.toUpperCase().startsWith('FF')) {
        throw new Error(`Opaque-only colors require alpha FF in 8-digit hex, got ${hex}`);
      }
      rgb = raw.slice(2);
    } else if (raw.length !== 6) {
      throw new Error(`Expected #RRGGBB or #FFRRGGBB, got ${hex}`);
    }
    return SrgbColor.fromRgb8(
      Number.parseInt(rgb.slice(0, 2), 16),
      Number.parseInt(rgb.slice(2, 4), 16),
      Number.parseInt(rgb.slice(4, 6), 16),
    );
  }

  toHexString() {
    return `#${channelToHexPair(this.red)}${channelToHexPair(this.green)}${channelToHexPair(this.blue)}`;
  }
}
