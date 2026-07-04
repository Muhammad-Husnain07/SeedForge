CREATE TABLE users (
    id         CHAR(36) PRIMARY KEY,
    email      VARCHAR(255) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name  VARCHAR(100) NOT NULL,
    role       ENUM('customer', 'admin') NOT NULL DEFAULT 'customer',
    referred_by CHAR(36) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active  TINYINT(1) NOT NULL DEFAULT 1,
    CONSTRAINT fk_users_referred FOREIGN KEY (referred_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE products (
    id          CHAR(36) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    price       DECIMAL(12,2) NOT NULL,
    sku         VARCHAR(50) NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE tags (
    id   CHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE product_tags (
    product_id CHAR(36) NOT NULL,
    tag_id     CHAR(36) NOT NULL,
    PRIMARY KEY (product_id, tag_id),
    CONSTRAINT fk_pt_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_pt_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE orders (
    id         CHAR(36) PRIMARY KEY,
    user_id    CHAR(36) NOT NULL,
    status     ENUM('pending', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
    total      DECIMAL(14,2) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE order_items (
    id         CHAR(36) PRIMARY KEY,
    order_id   CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    quantity   INT NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(12,2) NOT NULL,
    CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_oi_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE reviews (
    id         CHAR(36) PRIMARY KEY,
    product_id CHAR(36) NOT NULL,
    user_id    CHAR(36) NOT NULL,
    rating     INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    body       TEXT,
    CONSTRAINT fk_rev_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_rev_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
