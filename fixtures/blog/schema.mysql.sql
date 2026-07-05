CREATE TABLE authors (
    id    CHAR(36) PRIMARY KEY,
    name  VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    bio   TEXT
);

CREATE TABLE tags (
    id   CHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE posts (
    id           CHAR(36) PRIMARY KEY,
    author_id    CHAR(36) NOT NULL,
    title        VARCHAR(300) NOT NULL,
    slug         VARCHAR(300) NOT NULL UNIQUE,
    body         TEXT NOT NULL,
    published_at DATETIME NULL,
    CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
);

CREATE TABLE post_tags (
    post_id CHAR(36) NOT NULL,
    tag_id  CHAR(36) NOT NULL,
    PRIMARY KEY (post_id, tag_id),
    CONSTRAINT fk_pt_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_pt_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE comments (
    id                CHAR(36) PRIMARY KEY,
    post_id           CHAR(36) NOT NULL,
    parent_comment_id CHAR(36) NULL,
    author_name       VARCHAR(100) NOT NULL,
    body              TEXT NOT NULL,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comments_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_parent FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE
);
