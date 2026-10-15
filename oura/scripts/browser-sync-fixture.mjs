// Select a small subset of a real POST-created queue without inventing work or
// resetting task state, retry counts, or backoff.
export function shortAutomaticQueue(tasks, collections = ['sleep', 'heartrate']) {
  const scores = tasks.filter(task => task.collection === '__scores');
  if (scores.length !== 1) throw new Error('Expected one score task from a real automatic POST');
  const selected = collections.map(collection => {
    const task = tasks.find(task => task.collection === collection && task.state === 'pending');
    if (!task) throw new Error(`No pending automatic task for ${collection}`);
    return task;
  });
  if (new Set(collections).size !== collections.length || collections.includes('__scores')) {
    throw new Error('Short queue requires distinct detail collections');
  }
  return tasks.filter(task => scores.includes(task) || selected.includes(task));
}
