CREATE TABLE authors (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    bio   TEXT
);

CREATE TABLE tags (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE posts (
    id           TEXT PRIMARY KEY,
    author_id    TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    slug         TEXT NOT NULL UNIQUE,
    body         TEXT NOT NULL,
    published_at TEXT
);

CREATE TABLE post_tags (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE comments (
    id                TEXT PRIMARY KEY,
    post_id           TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    parent_comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
    author_name       TEXT NOT NULL,
    body              TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
