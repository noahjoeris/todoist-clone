import { describe, expect, it } from 'vitest';
import {
  crudEntrySchema,
  LABEL_COLORS,
  labelColumnsSchema,
  labelPatchColumnsSchema,
  mergeScheduledColumns,
  projectColumnsSchema,
  projectPatchColumnsSchema,
  taskColumnsSchema,
  taskLabelColumnsSchema,
  taskPatchColumnsSchema,
  uploadErrorSchema,
  uploadRequestSchema,
  uploadResponseSchema,
} from './sync.js';

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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

  it('treats omitted project_id as Inbox (PowerSync omits nulls)', () => {
    expect(taskColumnsSchema.parse(validPutData).project_id).toBeUndefined();
  });

  it('accepts explicit null project_id (Inbox)', () => {
    expect(taskColumnsSchema.parse({ ...validPutData, project_id: null }).project_id).toBeNull();
  });

  it('accepts a UUID project_id', () => {
    expect(taskColumnsSchema.parse({ ...validPutData, project_id: PROJECT_ID }).project_id).toBe(
      PROJECT_ID,
    );
  });

  it('rejects a non-uuid project_id', () => {
    expect(taskColumnsSchema.safeParse({ ...validPutData, project_id: 'inbox' }).success).toBe(
      false,
    );
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

  it('omits project_id when it is not in the patch', () => {
    expect(taskPatchColumnsSchema.parse({ title: 'Renamed' })).toEqual({ title: 'Renamed' });
  });

  it('accepts explicit null project_id (move to Inbox)', () => {
    expect(taskPatchColumnsSchema.parse({ project_id: null })).toEqual({ project_id: null });
  });

  it('accepts a UUID project_id', () => {
    expect(taskPatchColumnsSchema.parse({ project_id: PROJECT_ID })).toEqual({
      project_id: PROJECT_ID,
    });
  });

  it('rejects a non-uuid project_id', () => {
    expect(taskPatchColumnsSchema.safeParse({ project_id: 'not-a-uuid' }).success).toBe(false);
  });
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

const LABEL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TASK_LABEL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const validLabelPutData = {
  name: 'Work',
  color: 'charcoal' as const,
  is_favorite: false,
  created_at: CREATED_AT,
};

describe('LABEL_COLORS', () => {
  it("is Todoist's 20-color palette in documented order", () => {
    expect(LABEL_COLORS).toEqual([
      'berry_red',
      'red',
      'orange',
      'yellow',
      'olive_green',
      'lime_green',
      'green',
      'mint_green',
      'teal',
      'sky_blue',
      'light_blue',
      'blue',
      'grape',
      'violet',
      'lavender',
      'magenta',
      'salmon',
      'charcoal',
      'grey',
      'taupe',
    ]);
  });
});

describe('labelColumnsSchema', () => {
  it('trims the name and defaults color and favorite', () => {
    expect(
      labelColumnsSchema.parse({
        name: '  Work  ',
        created_at: CREATED_AT,
      }),
    ).toEqual({
      name: 'Work',
      color: 'charcoal',
      is_favorite: false,
      created_at: CREATED_AT,
    });
  });

  it('strips id, user_id, updated_at and other extras', () => {
    expect(
      labelColumnsSchema.parse({
        ...validLabelPutData,
        id: LABEL_ID,
        user_id: USER_ID,
        updated_at: '2026-09-11T12:00:01.000Z',
        extra: 'ignored',
      }),
    ).toEqual(validLabelPutData);
  });

  it('rejects an empty name', () => {
    expect(labelColumnsSchema.safeParse({ ...validLabelPutData, name: '  ' }).success).toBe(false);
  });

  it('rejects a name longer than 60 characters', () => {
    expect(
      labelColumnsSchema.safeParse({ ...validLabelPutData, name: 'a'.repeat(61) }).success,
    ).toBe(false);
  });

  it('accepts a 60-character name', () => {
    expect(labelColumnsSchema.parse({ ...validLabelPutData, name: 'a'.repeat(60) }).name).toBe(
      'a'.repeat(60),
    );
  });

  it('rejects an unknown color', () => {
    expect(labelColumnsSchema.safeParse({ ...validLabelPutData, color: 'pink' }).success).toBe(
      false,
    );
  });

  it.each(LABEL_COLORS)('accepts color %s', (color) => {
    expect(labelColumnsSchema.parse({ ...validLabelPutData, color }).color).toBe(color);
  });

  it.each([
    [0, false],
    [1, true],
    [false, false],
    [true, true],
  ] as const)('normalizes favorite wire value %s to %s', (input, expected) => {
    expect(labelColumnsSchema.parse({ ...validLabelPutData, is_favorite: input }).is_favorite).toBe(
      expected,
    );
  });

  it.each([2, '1', 'true', null])('rejects non-boolean favorite wire value %s', (is_favorite) => {
    expect(labelColumnsSchema.safeParse({ ...validLabelPutData, is_favorite }).success).toBe(false);
  });

  it.each(['2026-09-11 15:00:00.000Z', '2026-09-11 15:00:00.000000Z'] as const)(
    'accepts PowerSync space-separated created_at %s',
    (created_at) => {
      expect(labelColumnsSchema.parse({ ...validLabelPutData, created_at }).created_at).toBe(
        created_at.replace(' ', 'T'),
      );
    },
  );
});

describe('labelPatchColumnsSchema', () => {
  it('accepts a single column', () => {
    expect(labelPatchColumnsSchema.parse({ name: ' Renamed ' })).toEqual({ name: 'Renamed' });
  });

  it('treats a payload of only server-owned keys as empty after strip', () => {
    expect(
      labelPatchColumnsSchema.parse({ id: LABEL_ID, user_id: USER_ID, updated_at: CREATED_AT }),
    ).toEqual({});
  });

  it('omits color and favorite when they are not in the patch', () => {
    expect(labelPatchColumnsSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('accepts explicit false favorite without coercing from other values', () => {
    expect(labelPatchColumnsSchema.parse({ is_favorite: 0 })).toEqual({ is_favorite: false });
  });

  it('rejects an unknown color', () => {
    expect(labelPatchColumnsSchema.safeParse({ color: 'hot_pink' }).success).toBe(false);
  });

  it('rejects a blank name', () => {
    expect(labelPatchColumnsSchema.safeParse({ name: '  ' }).success).toBe(false);
  });
});

const validProjectPutData = {
  name: 'Work',
  color: 'charcoal' as const,
  is_favorite: false,
  is_archived: false,
  sort_order: 0,
  created_at: CREATED_AT,
};

describe('projectColumnsSchema', () => {
  it('trims the name and defaults color, flags, and order', () => {
    expect(
      projectColumnsSchema.parse({
        name: '  Work  ',
        created_at: CREATED_AT,
      }),
    ).toEqual({
      name: 'Work',
      color: 'charcoal',
      is_favorite: false,
      is_archived: false,
      sort_order: 0,
      created_at: CREATED_AT,
    });
  });

  it('strips id, user_id, updated_at and other extras', () => {
    expect(
      projectColumnsSchema.parse({
        ...validProjectPutData,
        id: PROJECT_ID,
        user_id: USER_ID,
        updated_at: '2026-09-11T12:00:01.000Z',
        extra: 'ignored',
      }),
    ).toEqual(validProjectPutData);
  });

  it('rejects an empty name', () => {
    expect(projectColumnsSchema.safeParse({ ...validProjectPutData, name: '  ' }).success).toBe(
      false,
    );
  });

  it('rejects a name longer than 60 characters', () => {
    expect(
      projectColumnsSchema.safeParse({ ...validProjectPutData, name: 'a'.repeat(61) }).success,
    ).toBe(false);
  });

  it('accepts a 60-character name', () => {
    expect(projectColumnsSchema.parse({ ...validProjectPutData, name: 'a'.repeat(60) }).name).toBe(
      'a'.repeat(60),
    );
  });

  it('rejects an unknown color', () => {
    expect(projectColumnsSchema.safeParse({ ...validProjectPutData, color: 'pink' }).success).toBe(
      false,
    );
  });

  it.each(LABEL_COLORS)('accepts color %s', (color) => {
    expect(projectColumnsSchema.parse({ ...validProjectPutData, color }).color).toBe(color);
  });

  it.each([
    [0, false],
    [1, true],
    [false, false],
    [true, true],
  ] as const)('normalizes favorite wire value %s to %s', (input, expected) => {
    expect(
      projectColumnsSchema.parse({ ...validProjectPutData, is_favorite: input }).is_favorite,
    ).toBe(expected);
  });

  it.each([
    [0, false],
    [1, true],
    [false, false],
    [true, true],
  ] as const)('normalizes archived wire value %s to %s', (input, expected) => {
    expect(
      projectColumnsSchema.parse({ ...validProjectPutData, is_archived: input }).is_archived,
    ).toBe(expected);
  });

  it.each([2, '1', 'true', null])('rejects non-boolean favorite wire value %s', (is_favorite) => {
    expect(projectColumnsSchema.safeParse({ ...validProjectPutData, is_favorite }).success).toBe(
      false,
    );
  });

  it.each([2, '1', 'true', null])('rejects non-boolean archived wire value %s', (is_archived) => {
    expect(projectColumnsSchema.safeParse({ ...validProjectPutData, is_archived }).success).toBe(
      false,
    );
  });

  it.each([0, 1, 2147483647])('accepts sort_order %s', (sort_order) => {
    expect(projectColumnsSchema.parse({ ...validProjectPutData, sort_order }).sort_order).toBe(
      sort_order,
    );
  });

  it.each([-1, 0.5, 2147483648, '1', null])('rejects sort_order %s', (sort_order) => {
    expect(projectColumnsSchema.safeParse({ ...validProjectPutData, sort_order }).success).toBe(
      false,
    );
  });

  it.each(['2026-09-11 15:00:00.000Z', '2026-09-11 15:00:00.000000Z'] as const)(
    'accepts PowerSync space-separated created_at %s',
    (created_at) => {
      expect(projectColumnsSchema.parse({ ...validProjectPutData, created_at }).created_at).toBe(
        created_at.replace(' ', 'T'),
      );
    },
  );
});

describe('projectPatchColumnsSchema', () => {
  it('accepts a single column', () => {
    expect(projectPatchColumnsSchema.parse({ name: ' Renamed ' })).toEqual({ name: 'Renamed' });
  });

  it('treats a payload of only server-owned keys as empty after strip', () => {
    expect(
      projectPatchColumnsSchema.parse({ id: PROJECT_ID, user_id: USER_ID, updated_at: CREATED_AT }),
    ).toEqual({});
  });

  it('omits color, flags, and order when they are not in the patch', () => {
    expect(projectPatchColumnsSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('accepts explicit false flags without coercing from other values', () => {
    expect(projectPatchColumnsSchema.parse({ is_favorite: 0, is_archived: 0 })).toEqual({
      is_favorite: false,
      is_archived: false,
    });
  });

  it('rejects an unknown color', () => {
    expect(projectPatchColumnsSchema.safeParse({ color: 'hot_pink' }).success).toBe(false);
  });

  it('rejects a blank name', () => {
    expect(projectPatchColumnsSchema.safeParse({ name: '  ' }).success).toBe(false);
  });

  it('rejects a fractional sort_order', () => {
    expect(projectPatchColumnsSchema.safeParse({ sort_order: 1.5 }).success).toBe(false);
  });
});

describe('taskLabelColumnsSchema', () => {
  it('accepts task_id, label_id and created_at', () => {
    expect(
      taskLabelColumnsSchema.parse({
        task_id: TASK_ID,
        label_id: LABEL_ID,
        created_at: CREATED_AT,
      }),
    ).toEqual({
      task_id: TASK_ID,
      label_id: LABEL_ID,
      created_at: CREATED_AT,
    });
  });

  it('strips id, user_id and extras', () => {
    expect(
      taskLabelColumnsSchema.parse({
        task_id: TASK_ID,
        label_id: LABEL_ID,
        created_at: CREATED_AT,
        id: TASK_LABEL_ID,
        user_id: USER_ID,
        extra: 'ignored',
      }),
    ).toEqual({
      task_id: TASK_ID,
      label_id: LABEL_ID,
      created_at: CREATED_AT,
    });
  });

  it('rejects a missing task_id', () => {
    expect(
      taskLabelColumnsSchema.safeParse({ label_id: LABEL_ID, created_at: CREATED_AT }).success,
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
        table: 'sections',
        id: TASK_ID,
        opData: validPutData,
      }).success,
    ).toBe(false);
  });

  it('accepts a labels PUT', () => {
    expect(
      crudEntrySchema.parse({
        clientId: 1,
        op: 'PUT',
        table: 'labels',
        id: LABEL_ID,
        opData: validLabelPutData,
      }),
    ).toMatchObject({ op: 'PUT', table: 'labels', id: LABEL_ID });
  });

  it('accepts a labels PATCH that omits color and favorite', () => {
    expect(
      crudEntrySchema.parse({
        clientId: 2,
        op: 'PATCH',
        table: 'labels',
        id: LABEL_ID,
        opData: { name: 'Renamed' },
      }),
    ).toMatchObject({ op: 'PATCH', table: 'labels', opData: { name: 'Renamed' } });
  });

  it('accepts a labels DELETE', () => {
    expect(
      crudEntrySchema.parse({
        clientId: 3,
        op: 'DELETE',
        table: 'labels',
        id: LABEL_ID,
        opData: null,
      }),
    ).toMatchObject({ op: 'DELETE', table: 'labels' });
  });

  it('accepts a task_labels PUT', () => {
    expect(
      crudEntrySchema.parse({
        clientId: 1,
        op: 'PUT',
        table: 'task_labels',
        id: TASK_LABEL_ID,
        opData: { task_id: TASK_ID, label_id: LABEL_ID, created_at: CREATED_AT },
      }),
    ).toMatchObject({ op: 'PUT', table: 'task_labels', id: TASK_LABEL_ID });
  });

  it('accepts a task_labels DELETE', () => {
    expect(
      crudEntrySchema.parse({
        clientId: 2,
        op: 'DELETE',
        table: 'task_labels',
        id: TASK_LABEL_ID,
      }),
    ).toMatchObject({ op: 'DELETE', table: 'task_labels' });
  });

  it('rejects a task_labels PATCH', () => {
    expect(
      crudEntrySchema.safeParse({
        clientId: 2,
        op: 'PATCH',
        table: 'task_labels',
        id: TASK_LABEL_ID,
        opData: { task_id: TASK_ID },
      }).success,
    ).toBe(false);
  });

  it('rejects a labels PUT with task columns', () => {
    expect(
      crudEntrySchema.safeParse({
        clientId: 1,
        op: 'PUT',
        table: 'labels',
        id: LABEL_ID,
        opData: validPutData,
      }).success,
    ).toBe(false);
  });

  it('accepts a projects PUT', () => {
    expect(
      crudEntrySchema.parse({
        clientId: 1,
        op: 'PUT',
        table: 'projects',
        id: PROJECT_ID,
        opData: validProjectPutData,
      }),
    ).toMatchObject({ op: 'PUT', table: 'projects', id: PROJECT_ID });
  });

  it('accepts a projects PATCH that omits defaults', () => {
    expect(
      crudEntrySchema.parse({
        clientId: 2,
        op: 'PATCH',
        table: 'projects',
        id: PROJECT_ID,
        opData: { name: 'Renamed' },
      }),
    ).toMatchObject({ op: 'PATCH', table: 'projects', opData: { name: 'Renamed' } });
  });

  it('accepts a projects DELETE', () => {
    expect(
      crudEntrySchema.parse({
        clientId: 3,
        op: 'DELETE',
        table: 'projects',
        id: PROJECT_ID,
        opData: null,
      }),
    ).toMatchObject({ op: 'DELETE', table: 'projects' });
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
