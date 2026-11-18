INSERT INTO products (sku, name, category, price_cents, stock, reorder_level) VALUES
('ST-001','Studio Desk Lamp','Lighting',5900,24,5),
('ST-002','Oak Monitor Stand','Workspace',4900,4,5),
('ST-003','Everyday Carry Tote','Accessories',2800,38,8),
('ST-004','Ceramic Pour-Over Set','Kitchen',4200,0,4),
('ST-005','Soft Grid Notebook','Stationery',1400,62,10),
('ST-006','Wool Felt Desk Mat','Workspace',3400,7,8),
('ST-007','Insulated Travel Mug','Kitchen',2600,18,5),
('ST-008','Modular Cable Kit','Accessories',1900,31,6);

INSERT INTO orders (customer) VALUES ('Avery Morgan'), ('Jordan Lee');
INSERT INTO order_items VALUES
(1, 1, 'Studio Desk Lamp', 1, 5900),
(1, 5, 'Soft Grid Notebook', 2, 1400),
(2, 7, 'Insulated Travel Mug', 3, 2600);
