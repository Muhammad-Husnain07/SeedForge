CREATE TABLE organizations (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE
);

CREATE TABLE users (
    id    TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name  TEXT NOT NULL
);

CREATE TABLE memberships (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE activity_events (
    id            TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id   TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    metadata      TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
