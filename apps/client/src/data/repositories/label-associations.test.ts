import { describe, expect, it } from 'vitest';
import {
  diffLabelAssociations,
  labelIdsForSubmit,
  sameIdSet,
  uniqueIds,
} from './label-associations';

describe('label association merge', () => {
  it('deduplicates ids without reordering first occurrences', () => {
    expect(uniqueIds(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('compares id sets regardless of order', () => {
    expect(sameIdSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameIdSet(['a'], ['a', 'b'])).toBe(false);
  });

  it('attaches newly selected labels and detaches user removals still on the task', () => {
    expect(diffLabelAssociations(['a', 'b'], ['a', 'b'], ['a', 'c'])).toEqual({
      attach: ['c'],
      detach: ['b'],
    });
  });

  it('does not detach a label another device added after the editor opened', () => {
    expect(diffLabelAssociations(['a'], ['a', 'remote'], ['a'])).toEqual({
      attach: [],
      detach: [],
    });
  });

  it('re-attaches a label the user still wants after another device removed it', () => {
    expect(diffLabelAssociations(['a', 'b'], ['b'], ['a', 'b'])).toEqual({
      attach: ['a'],
      detach: [],
    });
  });

  it('is a no-op when the selection matches the live links', () => {
    expect(diffLabelAssociations(['a'], ['a', 'b'], ['a', 'b'])).toEqual({
      attach: [],
      detach: [],
    });
  });
});

describe('editor submit label payload', () => {
  it('omits labels when the selection still matches the frozen baseline', () => {
    expect(labelIdsForSubmit(['a'], ['a'], 'when-changed')).toBeUndefined();
  });

  it('sends the selection when the user changed labels or the composer always submits', () => {
    expect(labelIdsForSubmit(['a', 'b'], ['a'], 'when-changed')).toEqual(['a', 'b']);
    expect(labelIdsForSubmit(['a'], ['a'], 'always')).toEqual(['a']);
  });
});
