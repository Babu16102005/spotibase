/**
 * Manual Jest mock for react-native-mmkv.
 * Auto-applied for all tests (located adjacent to node_modules).
 * In-memory Map-based storage; mirrors the public API used by the app
 * (getString/set/clearAll plus the boolean/number helpers for completeness).
 */
class MMKV {
  constructor(options = {}) {
    this.id = options.id || 'mmkv';
    this._store = new Map();
  }

  getString(key) {
    const value = this._store.get(key);
    return typeof value === 'string' ? value : undefined;
  }

  set(key, value) {
    this._store.set(key, value);
  }

  delete(key) {
    this._store.delete(key);
  }

  clearAll() {
    this._store.clear();
  }

  getBoolean(key) {
    const value = this._store.get(key);
    return typeof value === 'boolean' ? value : undefined;
  }

  setBoolean(key, value) {
    this._store.set(key, Boolean(value));
  }

  getNumber(key) {
    const value = this._store.get(key);
    return typeof value === 'number' ? value : undefined;
  }

  setNumber(key, value) {
    this._store.set(key, Number(value));
  }

  contains(key) {
    return this._store.has(key);
  }

  getAllKeys() {
    return Array.from(this._store.keys());
  }

  toString() {
    return `[MMKV instance: ${this.id}]`;
  }
}

const createInstance = (options) => new MMKV(options);
const useMMKVStorage = () => {
  throw new Error('useMMKVStorage is not implemented in tests');
};

module.exports = { MMKV, createInstance, useMMKVStorage };
module.exports.default = MMKV;
