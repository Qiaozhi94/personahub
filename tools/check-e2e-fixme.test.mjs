import test from 'node:test';
import assert from 'node:assert/strict';
import { findParkedLines, extractUncheckedTasks, checkParkedSpecs } from './check-e2e-fixme.mjs';

test('findParkedLines', async (t) => {
  await t.test('flags test.fixme and describe.fixme', () => {
    const text = ['test("a", async () => {});', 'test.fixme("b", async () => {});', 'test.describe.fixme("c", () => {});'].join(
      '\n',
    );
    assert.deepEqual(findParkedLines(text), [2, 3]);
  });

  await t.test('flags a named test.skip / describe.skip', () => {
    const text = ['test.skip("parked", async () => {});', 'test.describe.skip("group", () => {});'].join('\n');
    assert.deepEqual(findParkedLines(text), [1, 2]);
  });

  await t.test('ignores the runtime skip form (condition, reason)', () => {
    // Playwright's in-test guard: an environment statement, not a parked spec.
    const text = 'test("a", async ({ browserName }) => { test.skip(browserName === "webkit", "no webkit"); });';
    assert.deepEqual(findParkedLines(text), []);
  });

  await t.test('ignores commented-out markers', () => {
    assert.deepEqual(findParkedLines('// test.fixme("later", async () => {});'), []);
  });

  await t.test('returns empty for a clean spec', () => {
    assert.deepEqual(findParkedLines('test("works", async () => {});'), []);
  });
});

test('extractUncheckedTasks', async (t) => {
  await t.test('keeps unchecked, drops checked', () => {
    const doc = ['- [ ] ST-T06: journey-1.spec.ts', '- [x] ST-T05: done', 'prose line'].join('\n');
    assert.deepEqual(extractUncheckedTasks(doc), ['- [ ] ST-T06: journey-1.spec.ts']);
  });
});

test('checkParkedSpecs', async (t) => {
  await t.test('parked spec with an owner task passes', () => {
    const specs = [{ file: 'e2e/tests/journey-1.spec.ts', parkedLines: [4] }];
    const errors = checkParkedSpecs(specs, ['- [ ] ST-T07: unpark journey-1.spec.ts after the fix']);
    assert.deepEqual(errors, []);
  });

  await t.test('parked spec without an owner task fails', () => {
    const specs = [{ file: 'e2e/tests/journey-2.spec.ts', parkedLines: [7, 9] }];
    const errors = checkParkedSpecs(specs, ['- [ ] ST-T07: unpark journey-1.spec.ts']);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /journey-2\.spec\.ts/);
    assert.match(errors[0], /7, 9/);
  });

  await t.test('a checked-off task does not count as an owner', () => {
    // The whole point: a completed task means nobody is still on the hook.
    const specs = [{ file: 'e2e/tests/journey-3.spec.ts', parkedLines: [2] }];
    const errors = checkParkedSpecs(specs, []); // extractUncheckedTasks already dropped it
    assert.equal(errors.length, 1);
  });

  await t.test('unparked specs need no task', () => {
    assert.deepEqual(checkParkedSpecs([{ file: 'e2e/tests/clean.spec.ts', parkedLines: [] }], []), []);
  });
});
