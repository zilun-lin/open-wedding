CREATE TABLE guest_imports (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, checked INTEGER NOT NULL CHECK(checked=1), created_at INTEGER NOT NULL);
