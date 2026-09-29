// In-memory stand-in for the Firestore Admin API surface the licensing code
// uses: doc get/create/set/update, equality where().limit().get(), and
// runTransaction with tx.get/update/set.

class FakeDocRef {
  constructor(store, collection, id) {
    this.store = store;
    this.collection = collection;
    this.id = id;
  }
  get _key() { return `${this.collection}/${this.id}`; }
  async get() { return this.store._snapshot(this); }
  async create(data) {
    if (this.store.docs.has(this._key)) {
      const error = new Error('ALREADY_EXISTS');
      error.code = 6;
      throw error;
    }
    this.store.docs.set(this._key, { ...data });
  }
  async set(data, { merge = false } = {}) {
    const current = merge ? this.store.docs.get(this._key) || {} : {};
    this.store.docs.set(this._key, { ...current, ...data });
  }
  async update(data) {
    if (!this.store.docs.has(this._key)) throw new Error('NOT_FOUND');
    this.store.docs.set(this._key, { ...this.store.docs.get(this._key), ...data });
  }
}

class FakeQuery {
  constructor(store, collection, filters = [], max = Infinity) {
    Object.assign(this, { store, collection, filters, max });
  }
  where(field, op, value) {
    if (op !== '==') throw new Error(`Unsupported op ${op}`);
    return new FakeQuery(this.store, this.collection, [...this.filters, [field, value]], this.max);
  }
  limit(n) { return new FakeQuery(this.store, this.collection, this.filters, n); }
  async get() {
    const docs = [...this.store.docs.entries()]
      .filter(([key]) => key.startsWith(`${this.collection}/`))
      .filter(([, data]) => this.filters.every(([field, value]) => data[field] === value))
      .slice(0, this.max)
      .map(([key]) => this.store._snapshot(new FakeDocRef(this.store, this.collection, key.slice(this.collection.length + 1))));
    const resolved = await Promise.all(docs);
    return { empty: resolved.length === 0, docs: resolved };
  }
}

export function fakeFirestore(initial = {}) {
  const store = {
    docs: new Map(Object.entries(initial).map(([key, data]) => [key, { ...data }])),
    _snapshot(ref) {
      const data = store.docs.get(ref._key);
      return { id: ref.id, ref, exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
    },
    collection(name) {
      const query = new FakeQuery(store, name);
      query.doc = (id) => new FakeDocRef(store, name, id);
      return query;
    },
    async runTransaction(fn) {
      const tx = {
        get: (ref) => ref.get(),
        update: (ref, data) => { store.docs.set(ref._key, { ...store.docs.get(ref._key), ...data }); },
        set: (ref, data, { merge = false } = {}) => {
          store.docs.set(ref._key, { ...(merge ? store.docs.get(ref._key) || {} : {}), ...data });
        }
      };
      return fn(tx);
    },
    // Test helper: read a document's data directly
    read: (key) => store.docs.get(key)
  };
  return store;
}

export const FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' };

// Razorpay client stand-in: payments keyed by id
export function fakeRazorpay(payments = {}) {
  return {
    payments: {
      async fetch(id) {
        if (!payments[id]) throw new Error('The id provided does not exist');
        return { ...payments[id], id };
      },
      async capture(id, amount, currency) {
        payments[id] = { ...payments[id], status: 'captured', amount, currency };
        return { ...payments[id], id };
      }
    }
  };
}

// Mailer stand-in: records messages; set failWith to make send() reject
export function fakeMailer() {
  const mailer = {
    sent: [],
    failWith: null,
    async send(message) {
      if (mailer.failWith) throw new Error(mailer.failWith);
      mailer.sent.push(message);
    }
  };
  return mailer;
}

export const fixedClock = (iso) => () => new Date(iso);
