import { describe, expect, it } from 'vitest';
import {
  crudEntrySchema,
  mergeScheduledColumns,
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

  it.each(['2026-09-11 15:00:00.000Z', '2026-09-11 15:00:00.000000Z'] as const)(
    'accepts PowerSync space-separated created_at %s',
    (created_at) => {
      expect(taskColumnsSchema.parse({ ...validPutData, created_at }).created_at).toBe(
        created_at.replace(' ', 'T'),
      );
    },
  );

  it('accepts a completed_at timestamp', () => {
    expect(
      taskColumnsSchema.parse({
        ...validPutData,
        completed_at: '2026-09-11T15:00:00.000Z',
      }).completed_at,
    ).toBe('2026-09-11T15:00:00.000Z');
  });

  it.each(['2026-09-11 15:00:00.000Z', '2026-09-11 15:00:00.000000Z'] as const)(
    'accepts PowerSync space-separated completed_at %s',
    (completed_at) => {
      expect(taskColumnsSchema.parse({ ...validPutData, completed_at }).completed_at).toBe(
        completed_at.replace(' ', 'T'),
      );
    },
  );

  it('accepts explicit null completed_at (active)', () => {
    expect(
      taskColumnsSchema.parse({ ...validPutData, completed_at: null }).completed_at,
    ).toBeNull();
  });

  it('treats omitted completed_at as active (PowerSync omits nulls)', () => {
    expect(taskColumnsSchema.parse(validPutData).completed_at).toBeUndefined();
  });

  it.each(['not-a-date', '2026-09-11', '2026-09-11T15:00:00'])(
    'rejects invalid completed_at %s',
    (completed_at) => {
      expect(taskColumnsSchema.safeParse({ ...validPutData, completed_at }).success).toBe(false);
    },
  );
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

  it('accepts a time-only patch; the stored date is merged later', () => {
    expect(taskPatchColumnsSchema.parse({ scheduled_time: '09:00' })).toEqual({
      scheduled_time: '09:00',
    });
  });

  it('accepts clearing the date without sending time', () => {
    expect(taskPatchColumnsSchema.parse({ scheduled_date: null })).toEqual({
      scheduled_date: null,
    });
  });

  it('accepts a completed_at timestamp', () => {
    expect(taskPatchColumnsSchema.parse({ completed_at: '2026-09-11T15:00:00.000Z' })).toEqual({
      completed_at: '2026-09-11T15:00:00.000Z',
    });
  });

  it.each(['2026-09-11 15:00:00.000Z', '2026-09-11 15:00:00.000000Z'] as const)(
    'accepts PowerSync space-separated created_at %s',
    (created_at) => {
      expect(taskPatchColumnsSchema.parse({ created_at }).created_at).toBe(
        created_at.replace(' ', 'T'),
      );
    },
  );

  it.each(['2026-09-11 15:00:00.000Z', '2026-09-11 15:00:00.000000Z'] as const)(
    'accepts PowerSync space-separated completed_at %s',
    (completed_at) => {
      expect(taskPatchColumnsSchema.parse({ completed_at }).completed_at).toBe(
        completed_at.replace(' ', 'T'),
      );
    },
  );

  it('accepts explicit null completed_at (reopen)', () => {
    expect(taskPatchColumnsSchema.parse({ completed_at: null })).toEqual({ completed_at: null });
  });

  it('omits completed_at when it is not in the patch', () => {
    expect(taskPatchColumnsSchema.parse({ title: 'Renamed' })).toEqual({ title: 'Renamed' });
  });

  it.each(['yesterday', '2026-09-11T15:00:00'])(
    'rejects invalid completed_at %s',
    (completed_at) => {
      expect(taskPatchColumnsSchema.safeParse({ completed_at }).success).toBe(false);
    },
  );
});

describe('mergeScheduledColumns', () => {
  const dated = { scheduled_date: '2026-09-11', scheduled_time: '09:00' };
  const dateless = { scheduled_date: null, scheduled_time: null };

  it('keeps the stored date when only time changes', () => {
    expect(mergeScheduledColumns(dated, { scheduled_time: '10:30' })).toEqual({
      ok: true,
      scheduled_date: '2026-09-11',
      scheduled_time: '10:30',
    });
  });

  it('drops a leftover time when the date is cleared', () => {
    expect(mergeScheduledColumns(dated, { scheduled_date: null })).toEqual({
      ok: true,
      scheduled_date: null,
      scheduled_time: null,
    });
  });

  it('rejects setting a time on a dateless row', () => {
    expect(mergeScheduledColumns(dateless, { scheduled_time: '09:00' })).toEqual({ ok: false });
  });

  it('rejects an explicit time together with a null date', () => {
    expect(mergeScheduledColumns(dated, { scheduled_date: null, scheduled_time: '10:30' })).toEqual(
      { ok: false },
    );
  });

  it('clears both when the patch sends nulls', () => {
    expect(mergeScheduledColumns(dated, { scheduled_date: null, scheduled_time: null })).toEqual({
      ok: true,
      scheduled_date: null,
      scheduled_time: null,
    });
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
