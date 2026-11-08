import { createBusyLock } from './busyLock';

describe('createBusyLock (synchronous double-tap guard)', () => {
  it('runs the first call and ignores a second one fired in the same tick', async () => {
    const lock = createBusyLock();
    let calls = 0;
    const task = async () => {
      calls += 1;
      await Promise.resolve();
      return 'done';
    };
    const first = lock.run(task);
    const second = lock.run(task); // double-tap before any await resolved
    expect(await first).toBe('done');
    expect(await second).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('releases the lock when the task throws, so the user can retry', async () => {
    const lock = createBusyLock();
    await expect(lock.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(lock.isBusy()).toBe(false);
    await expect(lock.run(async () => 'ok')).resolves.toBe('ok');
  });
});
