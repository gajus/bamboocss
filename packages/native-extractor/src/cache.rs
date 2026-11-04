//! The maps every native call in the process shares: exported values, file hashes and recipes.

use std::{
    borrow::Borrow,
    collections::HashMap,
    hash::Hash,
    panic::{self, AssertUnwindSafe},
    sync::{
        Mutex, MutexGuard, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};

/// How many entries a cache holds before it empties and starts over.
const LIMIT: usize = 50_000;

/// A map every native call in the process shares, behind a lock.
///
/// Each export in `lib.rs` catches a panic, so the process outlives one, and a panic while a call
/// holds this lock poisons it. Answering a poisoned lock with nothing would switch the cache off for
/// the rest of the process without a word, so what the panic left in the map is dropped instead,
/// and the cache starts over.
pub(crate) struct SharedCache<K, V> {
    map: OnceLock<Mutex<HashMap<K, V>>>,
    hits: AtomicU64,
}

impl<K: Eq + Hash, V: Clone> SharedCache<K, V> {
    pub(crate) const fn new() -> Self {
        Self {
            map: OnceLock::new(),
            hits: AtomicU64::new(0),
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<K, V>> {
        let mutex = self.map.get_or_init(|| Mutex::new(HashMap::new()));
        mutex.lock().unwrap_or_else(|poisoned| {
            let mut map = poisoned.into_inner();
            map.clear();
            mutex.clear_poison();
            map
        })
    }

    pub(crate) fn get<Q>(&self, key: &Q) -> Option<V>
    where
        K: Borrow<Q>,
        Q: Eq + Hash + ?Sized,
    {
        let value = self.lock().get(key).cloned();
        if value.is_some() {
            self.hits.fetch_add(1, Ordering::Relaxed);
        }
        value
    }

    /// Store `value` at `key`, emptying the cache first once it holds `LIMIT` entries.
    pub(crate) fn insert(&self, key: K, value: V) {
        let mut map = self.lock();
        if map.len() >= LIMIT {
            map.clear();
        }
        map.insert(key, value);
    }

    /// How many lookups have found an entry, for `__cacheHits`.
    pub(crate) fn hits(&self) -> u64 {
        self.hits.load(Ordering::Relaxed)
    }

    /// Poison the lock, as a panic caught while a call held it would, for `__poisonCaches`.
    pub(crate) fn poison(&self) {
        let _ = panic::catch_unwind(AssertUnwindSafe(|| {
            let _map = self.lock();
            // Without the panic hook, which would print a panic nobody needs to read about.
            panic::resume_unwind(Box::new("poisoned for the tests"));
        }));
    }
}
