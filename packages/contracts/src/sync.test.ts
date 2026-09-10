import { describe, expect, it } from 'vitest';
import {
  crudEntrySchema,
  taskColumnsSchema,
  taskPatchColumnsSchema,
  uploadErrorSchema,
  uploadRequestSchema,
  uploadResponseSchema,
} from './sync.js';

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = '2026-09-11T12:00:00.000Z';

const validPutData = {
  title: 'Buy milk',
  description: '',
  priority: 4,
  scheduled_date: null,
  scheduled_time: null,
  created_at: CREATED_AT,
};

describe('taskColumnsSchema', () => {
  it('trims the title and defaults description', () => {
    expect(
      taskColumnsSchema.parse({
        title: '  Buy milk  ',
        priority: 1,
        created_at: CREATED_AT,
      }),
    ).toEqual({
      title: 'Buy milk',
      description: '',
      priority: 1,
      created_at: CREATED_AT,
    });
  });

  it('strips id, user_id, updated_at and other extras', () => {
    expect(
      taskColumnsSchema.parse({
        ...validPutData,
        id: TASK_ID,
        user_id: USER_ID,
        updated_at: '2026-09-11T12:00:01.000Z',
        extra: 'ignored',
      }),
    ).toEqual(validPutData);
  });

  it.each(['14:30', '14:30:00'])('accepts scheduled_time %s with a date', (scheduled_time) => {
    expect(
      taskColumnsSchema.parse({
        ...validPutData,
        scheduled_date: '2026-09-11',
        scheduled_time,
      }).scheduled_time,
    ).toBe(scheduled_time);
  });

  it('rejects a time without a date', () => {
    expect(
      taskColumnsSchema.safeParse({
        ...validPutData,
        scheduled_time: '14:30',
      }).success,
    ).toBe(false);
  });

  it('rejects an empty title', () => {
    expect(taskColumnsSchema.safeParse({ ...validPutData, title: '  ' }).success).toBe(false);
  });

  it('rejects priority 5', () => {
    expect(taskColumnsSchema.safeParse({ ...validPutData, priority: 5 }).success).toBe(false);
  });

  it('rejects a non-iso created_at', () => {
    expect(taskColumnsSchema.safeParse({ ...validPutData, created_at: 'not-a-date' }).success).toBe(
      false,
    );
  });
});

describe('taskPatchColumnsSchema', () => {
  it('accepts a single column', () => {
    expect(taskPatchColumnsSchema.parse({ title: ' Renamed ' })).toEqual({ title: 'Renamed' });
  });

  it('treats a payload of only server-owned keys as empty after strip', () => {
    expect(
      taskPatchColumnsSchema.parse({ id: TASK_ID, user_id: USER_ID, updated_at: CREATED_AT }),
    ).toEqual({});
  });

  it('rejects time with an explicit null date', () => {
    expect(
      taskPatchColumnsSchema.safeParse({ scheduled_date: null, scheduled_time: '09:00' }).success,
    ).toBe(false);
  });
});

describe('crudEntrySchema', () => {
  it('accepts a PUT', () => {
    expect(
      crudEntrySchema.parse({
        clientId: 1,
        op: 'PUT',
        table: 'tasks',
        id: TASK_ID,
        opData: validPutData,
      }),
    ).toMatchObject({ op: 'PUT', id: TASK_ID });
  });

  it('accepts DELETE with null opData', () => {
    expect(
      crudEntrySchema.parse({
        clientId: 2,
        op: 'DELETE',
        table: 'tasks',
        id: TASK_ID,
        opData: null,
      }),
    ).toMatchObject({ op: 'DELETE', opData: null });
  });

  it('accepts DELETE with omitted opData', () => {
    expect(
      crudEntrySchema.parse({
        clientId: 2,
        op: 'DELETE',
        table: 'tasks',
        id: TASK_ID,
      }),
    ).toMatchObject({ op: 'DELETE' });
  });

  it('rejects an unknown table', () => {
    expect(
      crudEntrySchema.safeParse({
        clientId: 1,
        op: 'PUT',
        table: 'projects',
        id: TASK_ID,
        opData: validPutData,
      }).success,
    ).toBe(false);
  });
});

describe('uploadRequestSchema', () => {
  it('requires at least one operation', () => {
    expect(uploadRequestSchema.safeParse({ operations: [] }).success).toBe(false);
  });

  it('accepts an optional transactionId', () => {
    expect(
      uploadRequestSchema.parse({
        transactionId: 7,
        operations: [{ clientId: 1, op: 'DELETE', table: 'tasks', id: TASK_ID, opData: null }],
      }).transactionId,
    ).toBe(7);
  });
});

describe('uploadResponseSchema / uploadErrorSchema', () => {
  it('accepts applied count', () => {
    expect(uploadResponseSchema.parse({ applied: 3 })).toEqual({ applied: 3 });
  });

  it.each(['invalid-request', 'forbidden', 'unauthorized'] as const)(
    'accepts error %s',
    (error) => {
      expect(uploadErrorSchema.parse({ error })).toEqual({ error });
    },
  );
});
