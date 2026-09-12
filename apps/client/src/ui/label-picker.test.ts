import { describe, expect, it } from 'vitest';
import { filterLabelsByQuery, inlineCreateName } from './label-picker';

const labels = [
  { id: '1', name: 'Work', color: 'charcoal' as const },
  { id: '2', name: 'Home', color: 'blue' as const },
  { id: '3', name: 'workout', color: 'red' as const },
];

describe('label picker search', () => {
  it('filters case-insensitively and offers create when there is no exact match', () => {
    expect(filterLabelsByQuery(labels, 'wo').map((label) => label.name)).toEqual([
      'Work',
      'workout',
    ]);
    expect(inlineCreateName('wo', labels)).toBe('wo');
    expect(inlineCreateName('WORK', labels)).toBeNull();
    expect(inlineCreateName('  Work  ', labels)).toBeNull();
  });

  it('does not offer create for empty or overlong names', () => {
    expect(inlineCreateName('   ', labels)).toBeNull();
    expect(inlineCreateName('a'.repeat(61), labels)).toBeNull();
    expect(inlineCreateName('a'.repeat(60), labels)).toHaveLength(60);
  });

  it('returns all labels when the query is blank', () => {
    expect(filterLabelsByQuery(labels, '  ')).toEqual(labels);
  });
});
