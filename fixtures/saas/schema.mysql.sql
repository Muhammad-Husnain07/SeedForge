CREATE TABLE organizations (
    id   CHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE users (
    id    CHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name  VARCHAR(200) NOT NULL
);

CREATE TABLE memberships (
    organization_id CHAR(36) NOT NULL,
    user_id         CHAR(36) NOT NULL,
    role            VARCHAR(50) NOT NULL,
    joined_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, user_id),
    CONSTRAINT fk_membership_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_membership_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE activity_events (
    id            CHAR(36) PRIMARY KEY,
    resource_type VARCHAR(100) NOT NULL,
    resource_id   CHAR(36) NOT NULL,
    event_type    VARCHAR(100) NOT NULL,
    metadata      JSON NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
