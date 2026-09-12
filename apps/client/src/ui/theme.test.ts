import { describe, expect, it } from 'vitest';
import { LABEL_COLORS } from '../data/repositories';
import { hexForLabelColor, labelColorHex, labelColorList, nameForLabelColor } from './theme';

describe('label colors', () => {
  it('maps every palette name to a hex value and accessible label', () => {
    expect(labelColorList).toEqual(LABEL_COLORS);
    for (const color of LABEL_COLORS) {
      expect(hexForLabelColor(color)).toMatch(/^#[0-9A-F]{6}$/);
      expect(nameForLabelColor(color).length).toBeGreaterThan(2);
      expect(labelColorHex[color]).toBe(hexForLabelColor(color));
    }
  });

  it('defaults unknown display values to charcoal', () => {
    expect(hexForLabelColor('neon')).toBe(labelColorHex.charcoal);
    expect(nameForLabelColor('neon')).toBe('Charcoal');
  });
});
