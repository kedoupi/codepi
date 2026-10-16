const message = "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. [code: 7500]";

// Reject mutations at the database boundary while keeping actual D1 reads.
export function failingDb(db, reject = sql => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
  return {
    prepare(sql) {
      const statement = db?.prepare(sql);
      const wrap = item => ({
        bind(...args) { return wrap(item?.bind(...args)); },
        async run(...args) { if (reject(sql)) throw new Error(message); return item.run(...args); },
        async first(...args) { if (reject(sql)) throw new Error(message); return item.first(...args); },
        async all(...args) { if (reject(sql)) throw new Error(message); return item.all(...args); },
      });
      return wrap(statement);
    },
    async batch() { throw new Error(message); },
  };
}
