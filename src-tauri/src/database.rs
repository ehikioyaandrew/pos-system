use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Deserialize)]
pub enum UserRole {
    SuperAdmin,
    Manager,
    Secretary,
    Staff,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub password_hash: String,
    pub role: UserRole,
    pub name: String,
    pub email: Option<String>,
    pub created_at: DateTime<Utc>,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Product {
    pub id: i64,
    pub business_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub category: String, // BAR, KITCHEN, ROOM
    pub price: f64,
    pub cost_price: f64,
    pub stock_quantity: i32, // Keep for backward compatibility
    pub min_stock_level: i32,
    pub fridge_stock: i32, // Stock in fridge (for POS)
    pub show_stock: i32, // Display/show stock
    pub store_stock: i32, // Warehouse/store stock (only Admin/Secretary can edit)
    pub barcode: Option<String>,
    pub serial_number: Option<String>,
    pub image_path: Option<String>,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Sale {
    pub id: i64,
    pub user_id: i64,
    pub total_amount: f64,
    pub payment_method: String, // CASH, CARD, EXTERNAL_POS
    pub payment_status: String, // PENDING, COMPLETED, CANCELLED
    pub created_at: DateTime<Utc>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaleItem {
    pub id: i64,
    pub sale_id: i64,
    pub product_id: i64,
    pub quantity: i32,
    pub unit_price: f64,
    pub total_price: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InventoryTransaction {
    pub id: i64,
    pub product_id: i64,
    pub transaction_type: String, // STOCK_IN, STOCK_OUT, SALE, ADJUSTMENT
    pub quantity: i32,
    pub reason: Option<String>,
    pub user_id: i64,
    pub created_at: DateTime<Utc>,
}

pub struct Database {
    pub conn: Connection,
}

impl Database {
    pub fn new(db_path: &Path) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        let db = Database { conn };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        // Disable foreign key checks during initialization
        self.conn.execute("PRAGMA foreign_keys = OFF", [])?;

        // Create users table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                name TEXT,
                email TEXT,
                business_id INTEGER,
                temporary_password TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1
            )",
            [],
        )?;

        // Create businesses table (with migration support)
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS businesses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                client_id TEXT UNIQUE NOT NULL,
                logo_path TEXT,
                address TEXT,
                phone TEXT,
                email TEXT,
                primary_color TEXT NOT NULL DEFAULT '#3B82F6',
                secondary_color TEXT NOT NULL DEFAULT '#1E40AF',
                modules_enabled TEXT NOT NULL,
                subscription_status TEXT NOT NULL DEFAULT 'TRIAL',
                created_by INTEGER NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users (id)
            )",
            [],
        )?;

        // Create products table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                business_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                category TEXT NOT NULL,
                price REAL NOT NULL,
                cost_price REAL NOT NULL,
                stock_quantity INTEGER DEFAULT 0,
                min_stock_level INTEGER DEFAULT 0,
                fridge_stock INTEGER DEFAULT 0,
                show_stock INTEGER DEFAULT 0,
                store_stock INTEGER DEFAULT 0,
                barcode TEXT,
                serial_number TEXT,
                image_path TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (business_id) REFERENCES businesses (id)
            )",
            [],
        )?;

        // Migration: Add new stock columns if they don't exist
        let _ = self.conn.execute(
            "ALTER TABLE products ADD COLUMN fridge_stock INTEGER DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE products ADD COLUMN show_stock INTEGER DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE products ADD COLUMN store_stock INTEGER DEFAULT 0",
            [],
        );
        
        // Migration: Add serial_number column if it doesn't exist
        let _ = self.conn.execute(
            "ALTER TABLE products ADD COLUMN serial_number TEXT",
            [],
        );

        // Create sales table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                total_amount REAL NOT NULL,
                payment_method TEXT NOT NULL,
                payment_status TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                notes TEXT,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )",
            [],
        )?;

        // Create sale_items table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS sale_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sale_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                unit_price REAL NOT NULL,
                total_price REAL NOT NULL,
                FOREIGN KEY (sale_id) REFERENCES sales (id),
                FOREIGN KEY (product_id) REFERENCES products (id)
            )",
            [],
        )?;

        // Create report_permissions table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS report_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                business_id INTEGER UNIQUE NOT NULL,
                manager_can_view BOOLEAN DEFAULT 0,
                secretary_can_view BOOLEAN DEFAULT 0,
                staff_can_view BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (business_id) REFERENCES businesses (id)
            )",
            [],
        )?;
        
        // Create inventory_transactions table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS inventory_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                transaction_type TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                reason TEXT,
                user_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (product_id) REFERENCES products (id),
                FOREIGN KEY (user_id) REFERENCES users (id)
            )",
            [],
        )?;

        // Create pending_notifications table for tracking email notifications
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS pending_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                notification_type TEXT NOT NULL,
                item_id INTEGER,
                item_type TEXT NOT NULL,
                business_id INTEGER,
                message TEXT,
                email_sent BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                sent_at DATETIME,
                FOREIGN KEY (business_id) REFERENCES businesses (id)
            )",
            [],
        )?;

        // Create email_config table for storing email settings per business
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS email_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                business_id INTEGER UNIQUE NOT NULL,
                smtp_server TEXT NOT NULL DEFAULT 'smtp.gmail.com',
                smtp_port INTEGER NOT NULL DEFAULT 587,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                from_email TEXT NOT NULL,
                from_name TEXT NOT NULL DEFAULT 'POS System',
                use_tls BOOLEAN DEFAULT 1,
                enabled BOOLEAN DEFAULT 1,
                notification_roles TEXT DEFAULT 'SuperAdmin,Manager',
                low_stock_enabled BOOLEAN DEFAULT 1,
                pending_sales_enabled BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (business_id) REFERENCES businesses (id)
            )",
            [],
        )?;
        
        // Migration: Add notification_roles column if it doesn't exist
        let _ = self.conn.execute(
            "ALTER TABLE email_config ADD COLUMN notification_roles TEXT DEFAULT 'SuperAdmin,Manager'",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE email_config ADD COLUMN low_stock_enabled BOOLEAN DEFAULT 1",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE email_config ADD COLUMN pending_sales_enabled BOOLEAN DEFAULT 1",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE email_config ADD COLUMN daily_reports_enabled BOOLEAN DEFAULT 0",
            [],
        );

        // Create password_reset_tokens table
        let _ = self.conn.execute(
            "CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT NOT NULL UNIQUE,
                expires_at DATETIME NOT NULL,
                used BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )",
            [],
        );

        // Create kitchen_orders table for kitchen order queue
        let _ = self.conn.execute(
            "CREATE TABLE IF NOT EXISTS kitchen_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sale_id INTEGER NOT NULL,
                sale_item_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                product_name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                started_at DATETIME,
                ready_at DATETIME,
                completed_at DATETIME,
                prepared_by INTEGER,
                FOREIGN KEY (sale_id) REFERENCES sales (id),
                FOREIGN KEY (sale_item_id) REFERENCES sale_items (id),
                FOREIGN KEY (product_id) REFERENCES products (id),
                FOREIGN KEY (prepared_by) REFERENCES users (id)
            )",
            [],
        );

        // Migration: Recreate products table with business_id if needed
        // Check if business_id column exists in products table
        let products_column_exists = self.conn
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='products'")?
            .query_row([], |row: &rusqlite::Row| {
                let sql: String = row.get(0)?;
                Ok(sql.contains("business_id"))
            })
            .unwrap_or(false);

        if !products_column_exists {
            println!("Products table missing business_id column, adding column safely...");

            // Try to add column using ALTER TABLE (non-destructive)
            match self.conn.execute(
                "ALTER TABLE products ADD COLUMN business_id INTEGER DEFAULT 1",
                [],
            ) {
                Ok(_) => {
                    println!("Successfully added business_id column to products table");
                    // Update existing products to have business_id = 1 (for orphaned products)
                    let _ = self.conn.execute(
                        "UPDATE products SET business_id = 1 WHERE business_id IS NULL",
                        [],
                    ); // Ignore errors if no products exist
                }
                Err(e) => {
                    // If ALTER fails, log but don't crash
                    println!("Column addition skipped: {}", e);
                }
            }
        }

        // Migration: Add temporary_password column to users table if needed
        let users_password_column_exists = self.conn
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")?
            .query_row([], |row: &rusqlite::Row| {
                let sql: String = row.get(0)?;
                Ok(sql.contains("temporary_password"))
            })
            .unwrap_or(false);

        if !users_password_column_exists {
            println!("Users table missing temporary_password column, adding column...");
            match self.conn.execute(
                "ALTER TABLE users ADD COLUMN temporary_password TEXT",
                [],
            ) {
                Ok(_) => {
                    println!("Successfully added temporary_password column to users table");
                }
                Err(e) => {
                    println!("Column addition skipped: {}", e);
                }
            }
        }

        // Add image_path column to products table if it doesn't exist
        match self.conn.execute(
            "ALTER TABLE products ADD COLUMN image_path TEXT",
            [],
        ) {
            Ok(_) => {
                println!("Successfully added image_path column to products table");
            }
            Err(e) => {
                println!("Column addition skipped (may already exist): {}", e);
            }
        }

        // Reset business_id for all users since businesses table was recreated
        self.conn.execute("UPDATE users SET business_id = NULL", [])?;

        // Re-enable foreign key checks
        self.conn.execute("PRAGMA foreign_keys = ON", [])?;

        // Create indexes for better performance
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)", [])?;
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at)", [])?;
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id)", [])?;
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_inventory_product_id ON inventory_transactions(product_id)", [])?;

        Ok(())
    }

    // User methods

    // Product methods
    pub fn create_product(&self, product: &Product) -> Result<i64> {
        println!("Creating product: name='{}', business_id={}, is_active={}", product.name, product.business_id, product.is_active);
        // SQLite stores booleans as integers: 1 for true, 0 for false
        let is_active_int = if product.is_active { 1 } else { 0 };
        self.conn.execute(
            "INSERT INTO products (business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, fridge_stock, show_stock, store_stock, barcode, serial_number, image_path, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            [
                &product.business_id.to_string(),
                &product.name,
                product.description.as_deref().unwrap_or(""),
                &product.category,
                &product.price.to_string(),
                &product.cost_price.to_string(),
                &product.stock_quantity.to_string(),
                &product.min_stock_level.to_string(),
                &product.fridge_stock.to_string(),
                &product.show_stock.to_string(),
                &product.store_stock.to_string(),
                &product.barcode.as_deref().unwrap_or(""),
                &product.serial_number.as_deref().unwrap_or(""),
                &product.image_path.as_deref().unwrap_or(""),
                &is_active_int.to_string(),
            ],
        )?;
        let product_id = self.conn.last_insert_rowid();
        println!("Product created successfully with ID: {} for business_id: {} with is_active={}", product_id, product.business_id, is_active_int);
        Ok(product_id)
    }

    pub fn get_all_users(&self) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare("SELECT id, username, password_hash, name, email, role, business_id, temporary_password, created_at, is_active FROM users ORDER BY id")?;
        let user_iter = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "username": row.get::<_, String>(1)?,
                "password_hash": row.get::<_, String>(2)?,
                "name": row.get::<_, Option<String>>(3)?,
                "email": row.get::<_, Option<String>>(4)?,
                "role": row.get::<_, String>(5)?,
                "business_id": row.get::<_, Option<i64>>(6)?,
                "temporary_password": row.get::<_, Option<String>>(7)?,
                "created_at": row.get::<_, String>(8)?,
                "is_active": row.get::<_, i64>(9)? != 0
            }))
        })?;
        user_iter.collect()
    }

    pub fn get_all_sales(&self) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.user_id, s.total_amount, s.payment_method, s.payment_status, s.created_at, s.notes
             FROM sales s
             ORDER BY s.created_at DESC"
        )?;
        let sale_iter = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "user_id": row.get::<_, i64>(1)?,
                "total_amount": row.get::<_, f64>(2)?,
                "payment_method": row.get::<_, String>(3)?,
                "payment_status": row.get::<_, String>(4)?,
                "created_at": row.get::<_, String>(5)?,
                "notes": row.get::<_, Option<String>>(6)?
            }))
        })?;
        sale_iter.collect()
    }

    pub fn get_all_sale_items(&self) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, sale_id, product_id, quantity, unit_price, total_price
             FROM sale_items
             ORDER BY id"
        )?;
        let item_iter = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "sale_id": row.get::<_, i64>(1)?,
                "product_id": row.get::<_, i64>(2)?,
                "quantity": row.get::<_, i32>(3)?,
                "unit_price": row.get::<_, f64>(4)?,
                "total_price": row.get::<_, f64>(5)?
            }))
        })?;
        item_iter.collect()
    }

    pub fn get_all_products(&self) -> Result<Vec<Product>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, fridge_stock, show_stock, store_stock, barcode, serial_number, image_path, is_active, created_at 
             FROM products WHERE is_active = 1 ORDER BY name"
        )?;
        let product_iter = stmt.query_map([], |row| {
            // Map is_active from integer (1/0) to boolean
            let is_active_int: i64 = row.get(15)?;
            let is_active = is_active_int != 0;
            
            Ok(Product {
                id: row.get(0)?,
                business_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                category: row.get(4)?,
                price: row.get(5)?,
                cost_price: row.get(6)?,
                stock_quantity: row.get(7)?,
                min_stock_level: row.get(8)?,
                fridge_stock: row.get(9)?,
                show_stock: row.get(10)?,
                store_stock: row.get(11)?,
                barcode: row.get(12)?,
                serial_number: row.get(13)?,
                image_path: row.get::<_, Option<String>>(14)?,
                is_active,
                created_at: row.get(16)?,
            })
        })?;
        product_iter.collect()
    }

    pub fn get_products_for_business(&self, business_id: i64) -> Result<Vec<Product>> {
        println!("get_products_for_business: Querying for business_id: {}", business_id);
        // First, let's check how many products exist for this business (including inactive)
        let total_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM products WHERE business_id = ?1",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);
        println!("Total products for business_id {}: {}", business_id, total_count);
        
        let active_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM products WHERE business_id = ?1 AND is_active = 1",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);
        println!("Active products for business_id {}: {}", business_id, active_count);
        
        // Try querying without is_active filter first to see all products
        let all_products_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM products WHERE business_id = ?1",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);
        println!("Products (all statuses) for business_id {}: {}", business_id, all_products_count);
        
        // Query with is_active filter - use explicit column names to ensure correct order
        let mut stmt = self.conn.prepare(
            "SELECT id, business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, fridge_stock, show_stock, store_stock, barcode, serial_number, image_path, is_active, created_at 
             FROM products WHERE business_id = ?1 AND is_active = 1 ORDER BY name"
        )?;
        let product_iter = stmt.query_map([business_id], |row| {
            // Map is_active from integer (1/0) to boolean
            let is_active_int: i64 = row.get(15)?;
            let is_active = is_active_int != 0;
            
            Ok(Product {
                id: row.get(0)?,
                business_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                category: row.get(4)?,
                price: row.get(5)?,
                cost_price: row.get(6)?,
                stock_quantity: row.get(7)?,
                min_stock_level: row.get(8)?,
                fridge_stock: row.get(9)?,
                show_stock: row.get(10)?,
                store_stock: row.get(11)?,
                barcode: row.get(12)?,
                serial_number: row.get(13)?,
                image_path: row.get::<_, Option<String>>(14)?,
                is_active,
                created_at: row.get(16)?,
            })
        })?;
        let products: Vec<Product> = product_iter.collect::<Result<Vec<_>>>()?;
        println!("Returning {} active products for business_id {}", products.len(), business_id);
        Ok(products)
    }

    // Sale methods
    pub fn create_sale(&self, user_id: i64, total_amount: f64, payment_method: &str) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO sales (user_id, total_amount, payment_method, payment_status) VALUES (?1, ?2, ?3, 'PENDING')",
            [&user_id.to_string(), &total_amount.to_string(), payment_method],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    // Inventory methods
    pub fn update_stock(&self, product_id: i64, quantity_change: i32, transaction_type: &str, user_id: i64, reason: Option<&str>) -> Result<()> {
        // Update product stock (backward compatibility - updates stock_quantity)
        self.conn.execute(
            "UPDATE products SET stock_quantity = stock_quantity + ?1 WHERE id = ?2",
            [&quantity_change.to_string(), &product_id.to_string()],
        )?;

        // Record transaction
        self.conn.execute(
            "INSERT INTO inventory_transactions (product_id, transaction_type, quantity, reason, user_id)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            [
                &product_id.to_string(),
                transaction_type,
                &quantity_change.to_string(),
                &reason.unwrap_or(""),
                &user_id.to_string(),
            ],
        )?;
        Ok(())
    }

    // Update specific stock type (fridge_stock, show_stock, or store_stock)
    pub fn update_stock_type(&self, product_id: i64, stock_type: &str, quantity_change: i32, user_id: i64, reason: Option<&str>) -> Result<()> {
        let column = match stock_type {
            "fridge" => "fridge_stock",
            "show" => "show_stock",
            "store" => "store_stock",
            _ => return Err(rusqlite::Error::InvalidColumnName(stock_type.to_string())),
        };

        // Update the specific stock type
        self.conn.execute(
            &format!("UPDATE products SET {} = {} + ?1 WHERE id = ?2", column, column),
            [&quantity_change.to_string(), &product_id.to_string()],
        )?;

        // Also update stock_quantity for backward compatibility
        self.conn.execute(
            "UPDATE products SET stock_quantity = stock_quantity + ?1 WHERE id = ?2",
            [&quantity_change.to_string(), &product_id.to_string()],
        )?;

        // Record transaction
        self.conn.execute(
            "INSERT INTO inventory_transactions (product_id, transaction_type, quantity, reason, user_id)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            [
                &product_id.to_string(),
                &format!("STOCK_{}", stock_type.to_uppercase()),
                &quantity_change.to_string(),
                reason.unwrap_or(""),
                &user_id.to_string(),
            ],
        )?;
        Ok(())
    }

    // Transfer stock from store to fridge or show
    pub fn transfer_stock(&self, product_id: i64, from: &str, to: &str, quantity: i32, user_id: i64) -> Result<()> {
        // Validate stock types
        let from_col = match from {
            "store" => "store_stock",
            _ => return Err(rusqlite::Error::InvalidColumnName(format!("Invalid source: {}", from))),
        };
        let to_col = match to {
            "fridge" => "fridge_stock",
            "show" => "show_stock",
            _ => return Err(rusqlite::Error::InvalidColumnName(format!("Invalid destination: {}", to))),
        };

        // Check if store has enough stock
        let current_store_stock: i64 = self.conn.query_row(
            "SELECT store_stock FROM products WHERE id = ?1",
            [product_id],
            |row| row.get(0),
        )?;

        if current_store_stock < quantity as i64 {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                Some(format!("Insufficient store stock. Available: {}, Requested: {}", current_store_stock, quantity))
            ));
        }

        // Transfer stock
        self.conn.execute(
            &format!("UPDATE products SET {} = {} - ?1, {} = {} + ?1 WHERE id = ?2", from_col, from_col, to_col, to_col),
            [&quantity.to_string(), &product_id.to_string()],
        )?;

        // Record transaction
        self.conn.execute(
            "INSERT INTO inventory_transactions (product_id, transaction_type, quantity, reason, user_id)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            [
                &product_id.to_string(),
                &format!("TRANSFER_{}_TO_{}", from.to_uppercase(), to.to_uppercase()),
                &quantity.to_string(),
                &format!("Transferred from {} to {}", from, to),
                &user_id.to_string(),
            ],
        )?;
        Ok(())
    }

    pub fn get_low_stock_products(&self) -> Result<Vec<Product>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, fridge_stock, show_stock, store_stock, barcode, serial_number, image_path, is_active, created_at 
             FROM products WHERE fridge_stock <= 5 AND is_active = 1"
        )?;
        let product_iter = stmt.query_map([], |row| {
            // Map is_active from integer (1/0) to boolean
            let is_active_int: i64 = row.get(15)?;
            let is_active = is_active_int != 0;
            
            Ok(Product {
                id: row.get(0)?,
                business_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                category: row.get(4)?,
                price: row.get(5)?,
                cost_price: row.get(6)?,
                stock_quantity: row.get(7)?,
                min_stock_level: row.get(8)?,
                fridge_stock: row.get(9)?,
                show_stock: row.get(10)?,
                store_stock: row.get(11)?,
                barcode: row.get(12)?,
                serial_number: row.get(13)?,
                image_path: row.get::<_, Option<String>>(14)?,
                is_active,
                created_at: row.get(16)?,
            })
        })?;
        product_iter.collect()
    }
    
    // Find product by barcode or serial_number
    pub fn find_product_by_code(&self, code: &str, business_id: i64) -> Result<Option<Product>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, fridge_stock, show_stock, store_stock, barcode, serial_number, image_path, is_active, created_at 
             FROM products WHERE (barcode = ?1 OR serial_number = ?1) AND business_id = ?2 AND is_active = 1 LIMIT 1"
        )?;
        
        let result = stmt.query_row([code, &business_id.to_string()], |row| {
            let is_active_int: i64 = row.get(15)?;
            let is_active = is_active_int != 0;
            
            Ok(Product {
                id: row.get(0)?,
                business_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                category: row.get(4)?,
                price: row.get(5)?,
                cost_price: row.get(6)?,
                stock_quantity: row.get(7)?,
                min_stock_level: row.get(8)?,
                fridge_stock: row.get(9)?,
                show_stock: row.get(10)?,
                store_stock: row.get(11)?,
                barcode: row.get(12)?,
                serial_number: row.get(13)?,
                image_path: row.get::<_, Option<String>>(14)?,
                is_active,
                created_at: row.get(16)?,
            })
        });
        
        match result {
            Ok(product) => Ok(Some(product)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    // User methods
    pub fn has_super_super_admin(&self) -> Result<bool> {
        let mut stmt = self.conn.prepare("SELECT COUNT(*) FROM users WHERE role LIKE '%SuperSuperAdmin%'")?;
        let count: i64 = stmt.query_row([], |row| row.get(0))?;
        Ok(count > 0)
    }

    pub fn authenticate_user(&self, username: &str, password_hash: &str) -> Result<serde_json::Value> {
        // Trim username to handle whitespace issues
        let username_trimmed = username.trim();
        
        // First check if user exists
        let user_exists: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM users WHERE TRIM(username) = ?1",
            [username_trimmed],
            |row| row.get(0),
        ).unwrap_or(0);

        if user_exists == 0 {
            println!("Authentication failed: User '{}' not found", username_trimmed);
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        // Now check password (use TRIM to handle whitespace)
        let mut stmt = self.conn.prepare(
            "SELECT id, username, role, name, email, business_id, password_hash FROM users WHERE TRIM(username) = ?1"
        )?;
        let (id, db_username, role, name, email, business_id, stored_hash) = stmt.query_row([username_trimmed], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<i64>>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;

        // Compare password hashes
        if stored_hash != password_hash {
            println!("Authentication failed: Password mismatch for user '{}'", username_trimmed);
            println!("Stored hash: {}, Provided hash: {}", stored_hash, password_hash);
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        
        println!("Authentication successful for user '{}'", username_trimmed);

        // Check if user has a temporary password (needs to change password)
        let has_temporary_password = self.conn.query_row(
            "SELECT temporary_password FROM users WHERE id = ?1",
            [id],
            |row| {
                let temp_pass: Option<String> = row.get(0)?;
                Ok(temp_pass.is_some() && !temp_pass.as_ref().unwrap().is_empty())
            },
        ).unwrap_or(false);

        // Return user data including temporary_password flag
        Ok(serde_json::json!({
            "id": id,
            "username": db_username,
            "role": serde_json::from_str::<serde_json::Value>(&role).unwrap_or(serde_json::Value::Null),
            "name": name,
            "email": email,
            "business_id": business_id,
            "has_temporary_password": has_temporary_password
        }))
    }

    pub fn create_user(&self, username: &str, password_hash: &str, role: &serde_json::Value, name: Option<&str>, email: Option<&str>, business_id: Option<i64>, temporary_password: Option<&str>) -> Result<i64> {
        let role_json = serde_json::to_string(role).unwrap();
        let name_str = name.unwrap_or("");
        let email_str = email.unwrap_or("");
        let temp_pass_str = temporary_password.unwrap_or("");

        // Check if role is SuperAdmin and business_id is required
        let role_str = role_json.trim_matches('"');
        if role_str == "SuperAdmin" && business_id.is_none() {
            println!("WARNING: Creating SuperAdmin user without business_id!");
        }

        if let Some(business_id_val) = business_id {
            println!("Creating user '{}' with business_id: {}", username, business_id_val);
            // Verify business exists
            let business_exists: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM businesses WHERE id = ?1",
                [business_id_val],
                |row| row.get(0),
            ).unwrap_or(0);
            
            if business_exists == 0 {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(1),
                    Some(format!("Business with id {} does not exist", business_id_val))
                ));
            }

            self.conn.execute(
                "INSERT INTO users (username, password_hash, role, name, email, business_id, temporary_password) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                [
                    &username,
                    &password_hash,
                    role_json.as_str(),
                    &name_str,
                    &email_str,
                    &business_id_val.to_string(),
                    &temp_pass_str,
                ],
            )?;
            
            let user_id = self.conn.last_insert_rowid();
            println!("User '{}' created successfully with ID: {} and business_id: {}", username, user_id, business_id_val);
            return Ok(user_id);
        }
        
        // No business_id provided
        println!("Creating user '{}' without business_id", username);
        self.conn.execute(
            "INSERT INTO users (username, password_hash, role, name, email, temporary_password) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            [
                &username,
                &password_hash,
                role_json.as_str(),
                &name_str,
                &email_str,
                &temp_pass_str,
            ],
        )?;
        let user_id = self.conn.last_insert_rowid();
        println!("User '{}' created successfully with ID: {} (no business_id)", username, user_id);
        Ok(user_id)
    }

    pub fn change_password(&self, user_id: i64, new_password_hash: &str) -> Result<()> {
        // Update password and clear temporary_password
        self.conn.execute(
            "UPDATE users SET password_hash = ?1, temporary_password = NULL WHERE id = ?2",
            [new_password_hash, &user_id.to_string()],
        )?;
        Ok(())
    }

    // Create a password reset token
    pub fn create_password_reset_token(&self, user_id: i64, token: &str) -> Result<()> {
        // Token expires in 1 hour
        let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);
        let expires_at_str = expires_at.format("%Y-%m-%d %H:%M:%S").to_string();
        
        // Invalidate any existing tokens for this user
        self.conn.execute(
            "UPDATE password_reset_tokens SET used = 1 WHERE user_id = ?1 AND used = 0",
            [user_id],
        )?;
        
        // Create new token
        self.conn.execute(
            "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?1, ?2, ?3)",
            [user_id.to_string(), token.to_string(), expires_at_str],
        )?;
        
        Ok(())
    }

    // Verify and use password reset token
    pub fn verify_and_use_reset_token(&self, token: &str) -> Result<i64> {
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        
        // Check if token exists and is valid
        let user_id: i64 = self.conn.query_row(
            "SELECT user_id FROM password_reset_tokens 
             WHERE token = ?1 AND used = 0 AND expires_at > ?2",
            [token, &now],
            |row| row.get(0),
        )?;
        
        // Mark token as used
        self.conn.execute(
            "UPDATE password_reset_tokens SET used = 1 WHERE token = ?1",
            [token],
        )?;
        
        Ok(user_id)
    }

    // Get user by email for password reset
    pub fn get_user_by_email(&self, email: &str) -> Result<(i64, String)> {
        self.conn.query_row(
            "SELECT id, name FROM users WHERE email = ?1 AND is_active = 1",
            [email],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    // Business methods
    pub fn create_business(&self, name: &str, client_id: &str, address: Option<&str>, phone: Option<&str>, email: Option<&str>, primary_color: &str, secondary_color: &str, modules: &serde_json::Value, created_by: i64) -> Result<i64> {
        let modules_json = serde_json::to_string(modules).unwrap();
        let address_str = address.unwrap_or("");
        let phone_str = phone.unwrap_or("");
        let email_str = email.unwrap_or("");
        let created_by_str = created_by.to_string();

        self.conn.execute(
            "INSERT INTO businesses (name, client_id, address, phone, email, primary_color, secondary_color, modules_enabled, subscription_status, created_by, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'TRIAL', ?9, 1)",
            [
                &name,
                &client_id,
                &address_str,
                &phone_str,
                &email_str,
                &primary_color,
                &secondary_color,
                modules_json.as_str(),
                &created_by_str,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_businesses(&self) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare("SELECT * FROM businesses ORDER BY created_at DESC")?;
        let business_iter = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "client_id": row.get::<_, String>(2)?,
                "logo_path": row.get::<_, Option<String>>(3)?,
                "address": row.get::<_, Option<String>>(4)?,
                "phone": row.get::<_, Option<String>>(5)?,
                "email": row.get::<_, Option<String>>(6)?,
                "primary_color": row.get::<_, String>(7)?,
                "secondary_color": row.get::<_, String>(8)?,
                "modules_enabled": row.get::<_, String>(9)?,
                "subscription_status": row.get::<_, String>(10)?,
                "created_by": row.get::<_, i64>(11)?,
                "is_active": row.get::<_, bool>(12)?,
                "created_at": row.get::<_, String>(13)?
            }))
        })?;
        business_iter.collect()
    }

    pub fn update_business_status(&self, business_id: i64, is_active: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE businesses SET is_active = ?1 WHERE id = ?2",
            [is_active as i64, business_id],
        )?;
        Ok(())
    }

    pub fn update_business_settings(
        &self,
        business_id: i64,
        name: Option<&str>,
        address: Option<&str>,
        phone: Option<&str>,
        email: Option<&str>,
        primary_color: Option<&str>,
        secondary_color: Option<&str>,
        logo_path: Option<&str>,
    ) -> Result<()> {
        // Get current business data
        let current = self.get_business_by_id(business_id)?;
        
        let name_str = name.unwrap_or_else(|| current["name"].as_str().unwrap_or(""));
        let address_str = address.unwrap_or_else(|| current["address"].as_str().unwrap_or(""));
        let phone_str = phone.unwrap_or_else(|| current["phone"].as_str().unwrap_or(""));
        let email_str = email.unwrap_or_else(|| current["email"].as_str().unwrap_or(""));
        let primary_color_str = primary_color.unwrap_or_else(|| current["primary_color"].as_str().unwrap_or("#3B82F6"));
        let secondary_color_str = secondary_color.unwrap_or_else(|| current["secondary_color"].as_str().unwrap_or("#1E40AF"));
        let logo_path_str = logo_path.unwrap_or_else(|| current["logo_path"].as_str().unwrap_or(""));

        self.conn.execute(
            "UPDATE businesses SET name = ?1, address = ?2, phone = ?3, email = ?4, primary_color = ?5, secondary_color = ?6, logo_path = ?7 WHERE id = ?8",
            [name_str, address_str, phone_str, email_str, primary_color_str, secondary_color_str, logo_path_str, &business_id.to_string()],
        )?;
        Ok(())
    }

    pub fn get_business_by_id(&self, business_id: i64) -> Result<serde_json::Value> {
        let mut stmt = self.conn.prepare("SELECT * FROM businesses WHERE id = ?1")?;
        let mut rows = stmt.query_map([business_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "client_id": row.get::<_, String>(2)?,
                "logo_path": row.get::<_, Option<String>>(3)?,
                "address": row.get::<_, Option<String>>(4)?,
                "phone": row.get::<_, Option<String>>(5)?,
                "email": row.get::<_, Option<String>>(6)?,
                "primary_color": row.get::<_, String>(7)?,
                "secondary_color": row.get::<_, String>(8)?,
                "modules_enabled": row.get::<_, String>(9)?,
                "subscription_status": row.get::<_, String>(10)?,
                "created_by": row.get::<_, i64>(11)?,
                "is_active": row.get::<_, bool>(12)?,
                "created_at": row.get::<_, String>(13)?
            }))
        })?;

        if let Some(business) = rows.next() {
            business
        } else {
            Err(rusqlite::Error::QueryReturnedNoRows)
        }
    }

    pub fn reset_database(&self) -> Result<()> {
        // Clear all data from all tables
        self.conn.execute("DELETE FROM inventory_transactions", [])?;
        self.conn.execute("DELETE FROM sale_items", [])?;
        self.conn.execute("DELETE FROM sales", [])?;
        self.conn.execute("DELETE FROM products", [])?;
        self.conn.execute("DELETE FROM businesses", [])?;
        self.conn.execute("DELETE FROM users", [])?;

        // Reset auto-increment counters
        self.conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('users', 'businesses', 'products', 'sales', 'sale_items', 'inventory_transactions')", [])?;

        println!("Database reset complete - all data cleared");
        Ok(())
    }

    pub fn get_orphaned_users(&self) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT u.id, u.username, u.name, u.business_id, u.role
             FROM users u
             LEFT JOIN businesses b ON u.business_id = b.id
             WHERE u.business_id IS NOT NULL AND b.id IS NULL AND u.role != 'SuperSuperAdmin'"
        )?;
        let user_iter = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "username": row.get::<_, String>(1)?,
                "name": row.get::<_, Option<String>>(2)?,
                "business_id": row.get::<_, Option<i64>>(3)?,
                "role": row.get::<_, String>(4)?
            }))
        })?;
        user_iter.collect()
    }

    pub fn fix_orphaned_users(&self) -> Result<()> {
        // Set business_id to NULL for users whose business no longer exists
        let rows_affected = self.conn.execute(
            "UPDATE users SET business_id = NULL WHERE business_id IS NOT NULL AND business_id NOT IN (SELECT id FROM businesses)",
            [],
        )?;

        println!("Fixed {} orphaned users by clearing their business_id", rows_affected);
        Ok(())
    }

    pub fn fix_product_is_active_values(&self) -> Result<i32> {
        // Fix products where is_active is stored as string "true"/"false" instead of integer 1/0
        let fixed = self.conn.execute(
            "UPDATE products SET is_active = 1 WHERE is_active = 'true' OR is_active = 'True' OR is_active = 'TRUE'",
            [],
        )?;
        
        let fixed_false = self.conn.execute(
            "UPDATE products SET is_active = 0 WHERE is_active = 'false' OR is_active = 'False' OR is_active = 'FALSE'",
            [],
        )?;
        
        println!("Fixed {} products with is_active='true' to 1", fixed);
        println!("Fixed {} products with is_active='false' to 0", fixed_false);
        Ok((fixed + fixed_false).min(i32::MAX as usize) as i32)
    }

    pub fn fix_users_without_business_id(&self) -> Result<i32> {
        // For SuperAdmin users without business_id, try to find their business
        let mut fixed = 0;
        
        // Get all SuperAdmin users without business_id
        let mut stmt = self.conn.prepare(
            "SELECT id, email, username FROM users WHERE role LIKE '%SuperAdmin%' AND business_id IS NULL"
        )?;
        let users = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;

        for user_result in users {
            let (user_id, email, _username) = user_result?;
            
            // Try to find business by email
            if let Some(email_val) = email {
                if let Ok(business_id) = self.conn.query_row(
                    "SELECT id FROM businesses WHERE email = ?1 LIMIT 1",
                    [&email_val],
                    |row| row.get::<_, i64>(0),
                ) {
                    self.conn.execute(
                        "UPDATE users SET business_id = ?1 WHERE id = ?2",
                        [business_id, user_id],
                    )?;
                    fixed += 1;
                    println!("Fixed user {} (email match) - assigned to business {}", user_id, business_id);
                    continue;
                }
            }
            
            // Try to find business by created_by (if this user created a business)
            if let Ok(business_id) = self.conn.query_row(
                "SELECT id FROM businesses WHERE created_by = ?1 LIMIT 1",
                [user_id],
                |row| row.get::<_, i64>(0),
            ) {
                self.conn.execute(
                    "UPDATE users SET business_id = ?1 WHERE id = ?2",
                    [business_id, user_id],
                )?;
                fixed += 1;
                println!("Fixed user {} (created_by match) - assigned to business {}", user_id, business_id);
            }
        }
        
        Ok(fixed)
    }

    pub fn check_business_exists(&self, name: &str, email: Option<&str>) -> Result<bool> {
        let count: i64 = if let Some(email_val) = email {
            let mut stmt = self.conn.prepare(
                "SELECT COUNT(*) FROM businesses WHERE name = ?1 OR email = ?2"
            )?;
            stmt.query_row([name, email_val], |row| row.get(0))?
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT COUNT(*) FROM businesses WHERE name = ?1"
            )?;
            stmt.query_row([name], |row| row.get(0))?
        };

        Ok(count > 0)
    }

    pub fn remove_duplicate_businesses(&self) -> Result<i32> {
        // Find duplicates by name or email, keep the oldest one (lowest id)
        let mut stmt = self.conn.prepare(
            "DELETE FROM businesses 
             WHERE id NOT IN (
                 SELECT MIN(id) 
                 FROM businesses 
                 GROUP BY name, COALESCE(email, '')
             )"
        )?;
        let deleted = stmt.execute([])?;
        Ok(deleted.min(i32::MAX as usize) as i32)
    }

    pub fn delete_all_businesses(&self) -> Result<()> {
        // Delete all related data first (due to foreign key constraints)
        self.conn.execute("DELETE FROM inventory_transactions", [])?;
        self.conn.execute("DELETE FROM sale_items", [])?;
        self.conn.execute("DELETE FROM sales", [])?;
        self.conn.execute("DELETE FROM products", [])?;
        
        // Delete all businesses
        self.conn.execute("DELETE FROM businesses", [])?;
        
        // Reset auto-increment counters
        self.conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('businesses', 'products', 'sales', 'sale_items', 'inventory_transactions')", [])?;
        
        // Update users to remove business_id references
        self.conn.execute("UPDATE users SET business_id = NULL WHERE business_id IS NOT NULL", [])?;
        
        println!("All businesses deleted successfully");
        Ok(())
    }

    pub fn get_business_admin_password(&self, business_id: i64) -> Result<serde_json::Value> {
        let mut stmt = self.conn.prepare(
            "SELECT username, temporary_password FROM users WHERE business_id = ?1 AND role LIKE '%SuperAdmin%' LIMIT 1"
        )?;
        let result = stmt.query_row([business_id], |row| {
            Ok(serde_json::json!({
                "username": row.get::<_, String>(0)?,
                "password": row.get::<_, Option<String>>(1)?
            }))
        });
        
        match result {
            Ok(val) => Ok(val),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(serde_json::json!({
                "username": null,
                "password": null
            })),
            Err(e) => Err(e)
        }
    }

    pub fn reset_business_admin_password(&self, business_id: i64, password_hash: &str, temporary_password: &str) -> Result<serde_json::Value> {
        // Role is stored as JSON string, so we need to match it
        // First, check if user exists and get username
        let username_result: Result<String, rusqlite::Error> = self.conn.query_row(
            "SELECT username FROM users WHERE business_id = ?1 AND role LIKE '%SuperAdmin%' LIMIT 1",
            [business_id],
            |row| row.get(0),
        );

        let username = match username_result {
            Ok(name) => name,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
            Err(e) => return Err(e),
        };

        // Update password_hash and temporary_password for the business admin
        let rows_updated = self.conn.execute(
            "UPDATE users SET password_hash = ?1, temporary_password = ?2 WHERE business_id = ?3 AND role LIKE '%SuperAdmin%'",
            [password_hash, temporary_password, &business_id.to_string()],
        )?;

        if rows_updated == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        Ok(serde_json::json!({
            "username": username
        }))
    }

    // Get business notification emails based on configured roles
    pub fn get_business_notification_emails(&self, business_id: i64) -> Result<Vec<String>> {
        // Get notification roles from email_config, default to 'SuperAdmin,Manager'
        let notification_roles: String = self.conn.query_row(
            "SELECT COALESCE(notification_roles, 'SuperAdmin,Manager') FROM email_config WHERE business_id = ?1",
            [business_id],
            |row| row.get(0),
        ).unwrap_or_else(|_| "SuperAdmin,Manager".to_string());
        
        // Parse roles (comma-separated)
        let roles: Vec<&str> = notification_roles.split(',').map(|s| s.trim()).collect();
        
        // Build SQL query with role conditions
        let role_conditions: Vec<String> = roles.iter()
            .map(|role| format!("role = '{}'", role))
            .collect();
        let role_filter = role_conditions.join(" OR ");
        
        let query = format!(
            "SELECT email FROM users 
             WHERE business_id = ?1 
             AND ({})
             AND email IS NOT NULL 
             AND email != ''
             AND is_active = 1",
            role_filter
        );
        
        let mut stmt = self.conn.prepare(&query)?;
        let email_iter = stmt.query_map([business_id], |row| {
            Ok(row.get::<_, String>(0)?)
        })?;
        
        email_iter.collect()
    }

    pub fn get_business_staff_count(&self, business_id: i64) -> Result<serde_json::Value> {
        // Count users by role for this business
        let admin_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM users WHERE business_id = ?1 AND role = 'SuperAdmin'",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);

        let manager_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM users WHERE business_id = ?1 AND role = 'Manager'",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);

        let secretary_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM users WHERE business_id = ?1 AND role = 'Secretary'",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);

        let staff_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM users WHERE business_id = ?1 AND role = 'Staff'",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);

        let total_count = admin_count + manager_count + secretary_count + staff_count;

        // Staff limits (excluding admin)
        let max_manager = 1;
        let max_secretary = 1;
        let max_staff = 4;
        let max_total = 6; // Including admin

        Ok(serde_json::json!({
            "admin": admin_count,
            "manager": manager_count,
            "secretary": secretary_count,
            "staff": staff_count,
            "total": total_count,
            "limits": {
                "max_manager": max_manager,
                "max_secretary": max_secretary,
                "max_staff": max_staff,
                "max_total": max_total
            },
            "available": {
                "manager": max_manager - manager_count,
                "secretary": max_secretary - secretary_count,
                "staff": max_staff - staff_count,
                "total": max_total - total_count
            }
        }))
    }

    // Get order history for a business with optional date range
    pub fn get_order_history(&self, business_id: i64, start_date: Option<&str>, end_date: Option<&str>, limit: Option<i64>) -> Result<Vec<serde_json::Value>> {
        let limit_clause = if let Some(l) = limit {
            format!("LIMIT {}", l)
        } else {
            String::new()
        };

        let date_filter = if let (Some(start), Some(end)) = (start_date, end_date) {
            format!("AND DATE(s.created_at) BETWEEN '{}' AND '{}'", start, end)
        } else {
            String::new()
        };

        let query = format!(
            "SELECT s.id, s.user_id, s.total_amount, s.payment_method, s.payment_status, 
                    s.created_at, s.notes, u.name as user_name, u.email as user_email,
                    COUNT(DISTINCT si.id) as item_count
             FROM sales s
             JOIN users u ON s.user_id = u.id
             LEFT JOIN sale_items si ON s.id = si.sale_id
             WHERE u.business_id = ?1 {}
             GROUP BY s.id
             ORDER BY s.created_at DESC {}",
            date_filter, limit_clause
        );

        let mut stmt = self.conn.prepare(&query)?;
        
        let sale_iter = stmt.query_map([business_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "user_id": row.get::<_, i64>(1)?,
                "total_amount": row.get::<_, f64>(2)?,
                "payment_method": row.get::<_, String>(3)?,
                "payment_status": row.get::<_, String>(4)?,
                "created_at": row.get::<_, String>(5)?,
                "notes": row.get::<_, Option<String>>(6)?,
                "user_name": row.get::<_, Option<String>>(7)?,
                "user_email": row.get::<_, Option<String>>(8)?,
                "item_count": row.get::<_, i64>(9)?
            }))
        })?;
        sale_iter.collect()
    }

    // Get sale items for a specific sale
    pub fn get_sale_items(&self, sale_id: i64) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT si.id, si.sale_id, si.product_id, si.quantity, si.unit_price, si.total_price,
                    p.name as product_name, p.category as product_category
             FROM sale_items si
             JOIN products p ON si.product_id = p.id
             WHERE si.sale_id = ?1
             ORDER BY si.id"
        )?;
        
        let item_iter = stmt.query_map([sale_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "sale_id": row.get::<_, i64>(1)?,
                "product_id": row.get::<_, i64>(2)?,
                "quantity": row.get::<_, i32>(3)?,
                "unit_price": row.get::<_, f64>(4)?,
                "total_price": row.get::<_, f64>(5)?,
                "product_name": row.get::<_, String>(6)?,
                "product_category": row.get::<_, String>(7)?
            }))
        })?;
        item_iter.collect()
    }

    // Get pending sales for a business
    pub fn get_pending_sales(&self, business_id: i64) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.user_id, s.total_amount, s.payment_method, s.payment_status, 
                    s.created_at, s.notes, u.name as user_name, u.email as user_email,
                    COUNT(si.id) as item_count
             FROM sales s
             JOIN users u ON s.user_id = u.id
             LEFT JOIN sale_items si ON s.id = si.sale_id
             WHERE s.payment_status = 'PENDING' 
             AND u.business_id = ?1
             GROUP BY s.id
             ORDER BY s.created_at DESC"
        )?;
        
        let sale_iter = stmt.query_map([business_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "user_id": row.get::<_, i64>(1)?,
                "total_amount": row.get::<_, f64>(2)?,
                "payment_method": row.get::<_, String>(3)?,
                "payment_status": row.get::<_, String>(4)?,
                "created_at": row.get::<_, String>(5)?,
                "notes": row.get::<_, Option<String>>(6)?,
                "user_name": row.get::<_, Option<String>>(7)?,
                "user_email": row.get::<_, Option<String>>(8)?,
                "item_count": row.get::<_, i64>(9)?
            }))
        })?;
        sale_iter.collect()
    }

    // Get all pending items summary for a business
    pub fn get_pending_items_summary(&self, business_id: i64) -> Result<serde_json::Value> {
        // Count pending sales
        let pending_sales_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sales s 
             JOIN users u ON s.user_id = u.id 
             WHERE s.payment_status = 'PENDING' AND u.business_id = ?1",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);

        // Count low stock products
        let low_stock_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM products 
             WHERE business_id = ?1 
             AND is_active = 1 
             AND (fridge_stock <= min_stock_level OR show_stock <= min_stock_level OR store_stock <= min_stock_level)
             AND (fridge_stock > 0 OR show_stock > 0 OR store_stock > 0)",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);

        // Count out of stock products
        let out_of_stock_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM products 
             WHERE business_id = ?1 
             AND is_active = 1 
             AND fridge_stock = 0 AND show_stock = 0 AND store_stock = 0",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);

        Ok(serde_json::json!({
            "pending_sales": pending_sales_count,
            "low_stock_products": low_stock_count,
            "out_of_stock_products": out_of_stock_count,
            "total_pending": pending_sales_count + low_stock_count + out_of_stock_count
        }))
    }

    // Get low stock products for a business
    pub fn get_low_stock_products_for_business(&self, business_id: i64) -> Result<Vec<Product>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, fridge_stock, show_stock, store_stock, barcode, serial_number, image_path, is_active, created_at 
             FROM products 
             WHERE business_id = ?1 
             AND is_active = 1 
             AND (fridge_stock <= min_stock_level OR show_stock <= min_stock_level OR store_stock <= min_stock_level)
             AND (fridge_stock > 0 OR show_stock > 0 OR store_stock > 0)
             ORDER BY fridge_stock ASC, show_stock ASC"
        )?;
        
        let product_iter = stmt.query_map([business_id], |row| {
            let is_active_int: i64 = row.get(15)?;
            let is_active = is_active_int != 0;
            
            Ok(Product {
                id: row.get(0)?,
                business_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                category: row.get(4)?,
                price: row.get(5)?,
                cost_price: row.get(6)?,
                stock_quantity: row.get(7)?,
                min_stock_level: row.get(8)?,
                fridge_stock: row.get(9)?,
                show_stock: row.get(10)?,
                store_stock: row.get(11)?,
                barcode: row.get(12)?,
                serial_number: row.get(13)?,
                image_path: row.get::<_, Option<String>>(14)?,
                is_active,
                created_at: row.get(16)?,
            })
        })?;
        product_iter.collect()
    }

    // Get out of stock products for a business
    pub fn get_out_of_stock_products_for_business(&self, business_id: i64) -> Result<Vec<Product>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, fridge_stock, show_stock, store_stock, barcode, serial_number, image_path, is_active, created_at 
             FROM products 
             WHERE business_id = ?1 
             AND is_active = 1 
             AND fridge_stock = 0 AND show_stock = 0 AND store_stock = 0
             ORDER BY name"
        )?;
        
        let product_iter = stmt.query_map([business_id], |row| {
            let is_active_int: i64 = row.get(15)?;
            let is_active = is_active_int != 0;
            
            Ok(Product {
                id: row.get(0)?,
                business_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                category: row.get(4)?,
                price: row.get(5)?,
                cost_price: row.get(6)?,
                stock_quantity: row.get(7)?,
                min_stock_level: row.get(8)?,
                fridge_stock: row.get(9)?,
                show_stock: row.get(10)?,
                store_stock: row.get(11)?,
                barcode: row.get(12)?,
                serial_number: row.get(13)?,
                image_path: row.get::<_, Option<String>>(14)?,
                is_active,
                created_at: row.get(16)?,
            })
        })?;
        product_iter.collect()
    }

    // Mark sale as completed
    pub fn mark_sale_as_completed(&self, sale_id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE sales SET payment_status = 'COMPLETED' WHERE id = ?1",
            [sale_id],
        )?;
        Ok(())
    }

    // Get sales report for a business within date range
    pub fn get_sales_report(&self, business_id: i64, start_date: &str, end_date: &str) -> Result<serde_json::Value> {
        // Get total sales
        let total_sales: f64 = self.conn.query_row(
            "SELECT COALESCE(SUM(s.total_amount), 0) 
             FROM sales s
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) BETWEEN ?2 AND ?3",
            rusqlite::params![business_id, start_date, end_date],
            |row| row.get(0),
        ).unwrap_or(0.0);

        // Get total count
        let total_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) 
             FROM sales s
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) BETWEEN ?2 AND ?3",
            rusqlite::params![business_id, start_date, end_date],
            |row| row.get(0),
        ).unwrap_or(0);

        // Get sales by payment method
        let mut stmt = self.conn.prepare(
            "SELECT s.payment_method, COUNT(*) as count, SUM(s.total_amount) as total
             FROM sales s
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) BETWEEN ?2 AND ?3
             GROUP BY s.payment_method"
        )?;
        
        let payment_methods: Vec<serde_json::Value> = stmt.query_map(rusqlite::params![business_id, start_date, end_date], |row| {
            Ok(serde_json::json!({
                "method": row.get::<_, String>(0)?,
                "count": row.get::<_, i64>(1)?,
                "total": row.get::<_, f64>(2)?
            }))
        })?.collect::<Result<Vec<_>>>()?;

        // Get daily sales breakdown
        let mut daily_stmt = self.conn.prepare(
            "SELECT DATE(s.created_at) as sale_date, COUNT(*) as count, SUM(s.total_amount) as total
             FROM sales s
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) BETWEEN ?2 AND ?3
             GROUP BY DATE(s.created_at)
             ORDER BY sale_date"
        )?;
        
        let daily_sales: Vec<serde_json::Value> = daily_stmt.query_map(rusqlite::params![business_id, start_date, end_date], |row| {
            Ok(serde_json::json!({
                "date": row.get::<_, String>(0)?,
                "count": row.get::<_, i64>(1)?,
                "total": row.get::<_, f64>(2)?
            }))
        })?.collect::<Result<Vec<_>>>()?;

        Ok(serde_json::json!({
            "total_sales": total_sales,
            "total_count": total_count,
            "average_sale": if total_count > 0 { total_sales / total_count as f64 } else { 0.0 },
            "payment_methods": payment_methods,
            "daily_sales": daily_sales,
            "start_date": start_date,
            "end_date": end_date
        }))
    }

    // Get top selling products for a business within date range
    pub fn get_top_products(&self, business_id: i64, start_date: &str, end_date: &str, limit: i64) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT 
                p.id,
                p.name,
                p.category,
                p.price,
                SUM(si.quantity) as total_quantity,
                SUM(si.total_price) as total_revenue,
                COUNT(DISTINCT si.sale_id) as sale_count
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             JOIN users u ON s.user_id = u.id
             JOIN products p ON si.product_id = p.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) BETWEEN ?2 AND ?3
             GROUP BY p.id, p.name, p.category, p.price
             ORDER BY total_revenue DESC
             LIMIT ?4"
        )?;
        
        let products: Vec<serde_json::Value> = stmt.query_map(rusqlite::params![business_id, start_date, end_date, limit], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "category": row.get::<_, String>(2)?,
                "price": row.get::<_, f64>(3)?,
                "total_quantity": row.get::<_, i64>(4)?,
                "total_revenue": row.get::<_, f64>(5)?,
                "sale_count": row.get::<_, i64>(6)?
            }))
        })?.collect::<Result<Vec<_>>>()?;
        
        Ok(products)
    }

    // Get staff performance report
    pub fn get_staff_performance(&self, business_id: i64, start_date: &str, end_date: &str) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT 
                u.id,
                u.name,
                u.role,
                COUNT(s.id) as sale_count,
                SUM(s.total_amount) as total_revenue,
                AVG(s.total_amount) as average_sale
             FROM sales s
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) BETWEEN ?2 AND ?3
             GROUP BY u.id, u.name, u.role
             ORDER BY total_revenue DESC"
        )?;
        
        let staff: Vec<serde_json::Value> = stmt.query_map(rusqlite::params![business_id, start_date, end_date], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, Option<String>>(1)?,
                "role": row.get::<_, String>(2)?,
                "sale_count": row.get::<_, i64>(3)?,
                "total_revenue": row.get::<_, f64>(4)?,
                "average_sale": row.get::<_, f64>(5)?
            }))
        })?.collect::<Result<Vec<_>>>()?;
        
        Ok(staff)
    }

    // Get today's sales summary for daily report
    pub fn get_today_sales_summary(&self, business_id: i64, date: &str) -> Result<(f64, i64, Vec<(String, i64)>), rusqlite::Error> {
        // Get total sales for the day
        let total_sales: f64 = self.conn.query_row(
            "SELECT COALESCE(SUM(s.total_amount), 0) 
             FROM sales s
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) = ?2",
            rusqlite::params![business_id, date],
            |row| row.get(0),
        )?;

        // Get transaction count
        let transaction_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) 
             FROM sales s
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) = ?2",
            rusqlite::params![business_id, date],
            |row| row.get(0),
        )?;

        // Get top products (limit 10)
        let mut stmt = self.conn.prepare(
            "SELECT p.name, SUM(si.quantity) as qty
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             JOIN users u ON s.user_id = u.id
             JOIN products p ON si.product_id = p.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) = ?2
             GROUP BY p.id, p.name
             ORDER BY qty DESC
             LIMIT 10"
        )?;
        
        let top_products: Vec<(String, i64)> = stmt.query_map(rusqlite::params![business_id, date], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?.collect::<Result<Vec<_>>>()?;

        Ok((total_sales, transaction_count, top_products))
    }

    // Get revenue analytics summary
    pub fn get_revenue_analytics(&self, business_id: i64) -> Result<serde_json::Value> {
        // Today's revenue
        let today_revenue: f64 = self.conn.query_row(
            "SELECT COALESCE(SUM(s.total_amount), 0) 
             FROM sales s
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) = DATE('now')",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0.0);

        // This week's revenue
        let week_revenue: f64 = self.conn.query_row(
            "SELECT COALESCE(SUM(s.total_amount), 0) 
             FROM sales s
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) >= DATE('now', '-7 days')",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0.0);

        // This month's revenue
        let month_revenue: f64 = self.conn.query_row(
            "SELECT COALESCE(SUM(s.total_amount), 0) 
             FROM sales s
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) >= DATE('now', 'start of month')",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0.0);

        // All time revenue
        let all_time_revenue: f64 = self.conn.query_row(
            "SELECT COALESCE(SUM(s.total_amount), 0) 
             FROM sales s
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0.0);

        // Today's count
        let today_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) 
             FROM sales s
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 
             AND s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) = DATE('now')",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);

        Ok(serde_json::json!({
            "today": {
                "revenue": today_revenue,
                "count": today_count
            },
            "week": {
                "revenue": week_revenue
            },
            "month": {
                "revenue": month_revenue
            },
            "all_time": {
                "revenue": all_time_revenue
            }
        }))
    }

    // Get report permissions for a business
    pub fn get_report_permissions(&self, business_id: i64) -> Result<serde_json::Value> {
        let result = self.conn.query_row(
            "SELECT manager_can_view, secretary_can_view, staff_can_view 
             FROM report_permissions 
             WHERE business_id = ?1",
            [business_id],
            |row| {
                Ok(serde_json::json!({
                    "manager_can_view": row.get::<_, i64>(0)? != 0,
                    "secretary_can_view": row.get::<_, i64>(1)? != 0,
                    "staff_can_view": row.get::<_, i64>(2)? != 0
                }))
            },
        );

        match result {
            Ok(permissions) => Ok(permissions),
            Err(_) => {
                // Return default permissions if not found (SuperAdmin only)
                Ok(serde_json::json!({
                    "manager_can_view": false,
                    "secretary_can_view": false,
                    "staff_can_view": false
                }))
            }
        }
    }

    // Save report permissions for a business
    pub fn save_report_permissions(&self, business_id: i64, manager_can_view: bool, secretary_can_view: bool, staff_can_view: bool) -> Result<()> {
        // Check if record exists
        let exists = self.conn.query_row(
            "SELECT COUNT(*) FROM report_permissions WHERE business_id = ?1",
            [business_id],
            |row| row.get::<_, i64>(0),
        ).unwrap_or(0) > 0;

        if exists {
            self.conn.execute(
                "UPDATE report_permissions 
                 SET manager_can_view = ?1, secretary_can_view = ?2, staff_can_view = ?3, updated_at = CURRENT_TIMESTAMP
                 WHERE business_id = ?4",
                [if manager_can_view { 1 } else { 0 }, if secretary_can_view { 1 } else { 0 }, if staff_can_view { 1 } else { 0 }, business_id],
            )?;
        } else {
            self.conn.execute(
                "INSERT INTO report_permissions (business_id, manager_can_view, secretary_can_view, staff_can_view)
                 VALUES (?1, ?2, ?3, ?4)",
                [business_id, if manager_can_view { 1 } else { 0 }, if secretary_can_view { 1 } else { 0 }, if staff_can_view { 1 } else { 0 }],
            )?;
        }
        Ok(())
    }

    // Check if user can view reports
    pub fn can_user_view_reports(&self, business_id: i64, user_role: &str) -> Result<bool> {
        // SuperAdmin can always view
        if user_role == "SuperAdmin" {
            return Ok(true);
        }

        let permissions = self.get_report_permissions(business_id)?;
        
        match user_role {
            "Manager" => Ok(permissions["manager_can_view"].as_bool().unwrap_or(false)),
            "Secretary" => Ok(permissions["secretary_can_view"].as_bool().unwrap_or(false)),
            "Staff" => Ok(permissions["staff_can_view"].as_bool().unwrap_or(false)),
            _ => Ok(false)
        }
    }

    // Get inventory movement report for a business
    pub fn get_inventory_movements(&self, business_id: i64, start_date: &str, end_date: &str) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT 
                it.id,
                it.product_id,
                p.name as product_name,
                p.category,
                it.transaction_type,
                it.quantity,
                it.reason,
                u.name as user_name,
                u.role as user_role,
                it.created_at
             FROM inventory_transactions it
             JOIN products p ON it.product_id = p.id
             JOIN users u ON it.user_id = u.id
             WHERE p.business_id = ?1
             AND DATE(it.created_at) BETWEEN ?2 AND ?3
             ORDER BY it.created_at DESC"
        )?;
        
        let movements: Vec<serde_json::Value> = stmt.query_map(rusqlite::params![business_id, start_date, end_date], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "product_id": row.get::<_, i64>(1)?,
                "product_name": row.get::<_, String>(2)?,
                "category": row.get::<_, String>(3)?,
                "transaction_type": row.get::<_, String>(4)?,
                "quantity": row.get::<_, i32>(5)?,
                "reason": row.get::<_, Option<String>>(6)?,
                "user_name": row.get::<_, Option<String>>(7)?,
                "user_role": row.get::<_, String>(8)?,
                "created_at": row.get::<_, String>(9)?
            }))
        })?.collect::<Result<Vec<_>>>()?;
        
        Ok(movements)
    }

    // Get inventory transfers report
    pub fn get_inventory_transfers(&self, business_id: i64, start_date: &str, end_date: &str) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT 
                it.id,
                it.product_id,
                p.name as product_name,
                p.category,
                it.transaction_type,
                it.quantity,
                it.reason,
                u.name as user_name,
                it.created_at
             FROM inventory_transactions it
             JOIN products p ON it.product_id = p.id
             JOIN users u ON it.user_id = u.id
             WHERE p.business_id = ?1
             AND it.transaction_type LIKE 'TRANSFER_%'
             AND DATE(it.created_at) BETWEEN ?2 AND ?3
             ORDER BY it.created_at DESC"
        )?;
        
        let transfers: Vec<serde_json::Value> = stmt.query_map(rusqlite::params![business_id, start_date, end_date], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "product_id": row.get::<_, i64>(1)?,
                "product_name": row.get::<_, String>(2)?,
                "category": row.get::<_, String>(3)?,
                "transaction_type": row.get::<_, String>(4)?,
                "quantity": row.get::<_, i32>(5)?,
                "reason": row.get::<_, Option<String>>(6)?,
                "user_name": row.get::<_, Option<String>>(7)?,
                "created_at": row.get::<_, String>(8)?
            }))
        })?.collect::<Result<Vec<_>>>()?;
        
        Ok(transfers)
    }

    // Get inventory adjustments report
    pub fn get_inventory_adjustments(&self, business_id: i64, start_date: &str, end_date: &str) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT 
                it.id,
                it.product_id,
                p.name as product_name,
                p.category,
                it.transaction_type,
                it.quantity,
                it.reason,
                u.name as user_name,
                it.created_at
             FROM inventory_transactions it
             JOIN products p ON it.product_id = p.id
             JOIN users u ON it.user_id = u.id
             WHERE p.business_id = ?1
             AND it.transaction_type = 'ADJUSTMENT'
             AND DATE(it.created_at) BETWEEN ?2 AND ?3
             ORDER BY it.created_at DESC"
        )?;
        
        let adjustments: Vec<serde_json::Value> = stmt.query_map(rusqlite::params![business_id, start_date, end_date], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "product_id": row.get::<_, i64>(1)?,
                "product_name": row.get::<_, String>(2)?,
                "category": row.get::<_, String>(3)?,
                "transaction_type": row.get::<_, String>(4)?,
                "quantity": row.get::<_, i32>(5)?,
                "reason": row.get::<_, Option<String>>(6)?,
                "user_name": row.get::<_, Option<String>>(7)?,
                "created_at": row.get::<_, String>(8)?
            }))
        })?.collect::<Result<Vec<_>>>()?;
        
        Ok(adjustments)
    }

    // Get inventory summary report
    pub fn get_inventory_summary(&self, business_id: i64) -> Result<serde_json::Value> {
        // Total products
        let total_products: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM products WHERE business_id = ?1 AND is_active = 1",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);

        // Total stock value (using cost_price)
        let total_stock_value: f64 = self.conn.query_row(
            "SELECT COALESCE(SUM((fridge_stock + show_stock + store_stock) * cost_price), 0)
             FROM products WHERE business_id = ?1 AND is_active = 1",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0.0);

        // Total stock quantity
        let total_stock_quantity: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(fridge_stock + show_stock + store_stock), 0)
             FROM products WHERE business_id = ?1 AND is_active = 1",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);

        // Low stock count
        let low_stock_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM products 
             WHERE business_id = ?1 
             AND is_active = 1 
             AND (fridge_stock <= min_stock_level OR show_stock <= min_stock_level OR store_stock <= min_stock_level)
             AND (fridge_stock > 0 OR show_stock > 0 OR store_stock > 0)",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);

        // Out of stock count
        let out_of_stock_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM products 
             WHERE business_id = ?1 
             AND is_active = 1 
             AND fridge_stock = 0 AND show_stock = 0 AND store_stock = 0",
            [business_id],
            |row| row.get(0),
        ).unwrap_or(0);

        Ok(serde_json::json!({
            "total_products": total_products,
            "total_stock_value": total_stock_value,
            "total_stock_quantity": total_stock_quantity,
            "low_stock_count": low_stock_count,
            "out_of_stock_count": out_of_stock_count
        }))
    }

    // Export all data for backup
    pub fn export_all_data(&self) -> Result<serde_json::Value> {
        let users = self.get_all_users()?;
        let businesses = self.get_businesses()?;
        let products = self.get_all_products()?;
        let sales = self.get_all_sales()?;
        let sale_items = self.get_all_sale_items()?;
        
        // Get inventory transactions
        let inventory_transactions: Vec<serde_json::Value> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, product_id, transaction_type, quantity, reason, user_id, created_at
                 FROM inventory_transactions
                 ORDER BY id"
            )?;
            let iter = stmt.query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "product_id": row.get::<_, i64>(1)?,
                    "transaction_type": row.get::<_, String>(2)?,
                    "quantity": row.get::<_, i32>(3)?,
                    "reason": row.get::<_, Option<String>>(4)?,
                    "user_id": row.get::<_, i64>(5)?,
                    "created_at": row.get::<_, String>(6)?
                }))
            })?;
            iter.collect::<Result<Vec<_>>>()?
        };

        // Get email configs
        let email_configs: Vec<serde_json::Value> = {
            let mut stmt = self.conn.prepare(
                "SELECT business_id, smtp_server, smtp_port, username, from_email, from_name, use_tls, enabled, notification_roles, low_stock_enabled, pending_sales_enabled, daily_reports_enabled
                 FROM email_config"
            )?;
            let iter = stmt.query_map([], |row| {
                Ok(serde_json::json!({
                    "business_id": row.get::<_, i64>(0)?,
                    "smtp_server": row.get::<_, String>(1)?,
                    "smtp_port": row.get::<_, i64>(2)?,
                    "username": row.get::<_, String>(3)?,
                    "from_email": row.get::<_, String>(4)?,
                    "from_name": row.get::<_, String>(5)?,
                    "use_tls": row.get::<_, i64>(6)? != 0,
                    "enabled": row.get::<_, i64>(7)? != 0,
                    "notification_roles": row.get::<_, Option<String>>(8)?,
                    "low_stock_enabled": row.get::<_, Option<i64>>(9)?.unwrap_or(1) != 0,
                    "pending_sales_enabled": row.get::<_, Option<i64>>(10)?.unwrap_or(1) != 0,
                    "daily_reports_enabled": row.get::<_, Option<i64>>(11)?.unwrap_or(0) != 0,
                }))
            })?;
            iter.collect::<Result<Vec<_>>>()?
        };

        // Get report permissions
        let report_permissions: Vec<serde_json::Value> = {
            let mut stmt = self.conn.prepare(
                "SELECT business_id, manager_can_view, secretary_can_view, staff_can_view
                 FROM report_permissions"
            )?;
            let iter = stmt.query_map([], |row| {
                Ok(serde_json::json!({
                    "business_id": row.get::<_, i64>(0)?,
                    "manager_can_view": row.get::<_, i64>(1)? != 0,
                    "secretary_can_view": row.get::<_, i64>(2)? != 0,
                    "staff_can_view": row.get::<_, i64>(3)? != 0,
                }))
            })?;
            iter.collect::<Result<Vec<_>>>()?
        };

        // Convert products to JSON
        let products_json: Vec<serde_json::Value> = products.iter().map(|p| {
            serde_json::json!({
                "id": p.id,
                "business_id": p.business_id,
                "name": p.name,
                "description": p.description,
                "category": p.category,
                "price": p.price,
                "cost_price": p.cost_price,
                "stock_quantity": p.stock_quantity,
                "min_stock_level": p.min_stock_level,
                "fridge_stock": p.fridge_stock,
                "show_stock": p.show_stock,
                "store_stock": p.store_stock,
                "barcode": p.barcode,
                "serial_number": p.serial_number,
                "image_path": p.image_path,
                "is_active": p.is_active,
                "created_at": p.created_at,
            })
        }).collect();

        Ok(serde_json::json!({
            "version": "1.0",
            "export_date": chrono::Utc::now().to_rfc3339(),
            "data": {
                "users": users,
                "businesses": businesses,
                "products": products_json,
                "sales": sales,
                "sale_items": sale_items,
                "inventory_transactions": inventory_transactions,
                "email_configs": email_configs,
                "report_permissions": report_permissions,
            },
            "summary": {
                "users_count": users.len(),
                "businesses_count": businesses.len(),
                "products_count": products_json.len(),
                "sales_count": sales.len(),
                "sale_items_count": sale_items.len(),
            }
        }))
    }

    // Restore data from backup (import)
    pub fn restore_from_backup(&self, backup_data: &serde_json::Value) -> Result<()> {
        // First, clear existing data (optional - you might want to merge instead)
        // For safety, we'll clear only after confirming backup is valid
        let data = backup_data.get("data")
            .ok_or_else(|| rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(1),
                Some("Invalid backup format: missing 'data' key".to_string())
            ))?;

        // Start transaction for atomic restore
        self.conn.execute("BEGIN TRANSACTION", [])?;

        // Clear existing data
        let _ = self.conn.execute("DELETE FROM sale_items", []);
        let _ = self.conn.execute("DELETE FROM sales", []);
        let _ = self.conn.execute("DELETE FROM inventory_transactions", []);
        let _ = self.conn.execute("DELETE FROM products", []);
        let _ = self.conn.execute("DELETE FROM email_config", []);
        let _ = self.conn.execute("DELETE FROM report_permissions", []);
        let _ = self.conn.execute("DELETE FROM businesses", []);
        let _ = self.conn.execute("DELETE FROM users", []);

        // Restore users
        if let Some(users) = data.get("users").and_then(|v| v.as_array()) {
            for user in users {
                let id = user["id"].as_i64().unwrap_or(0);
                let username = user["username"].as_str().unwrap_or("");
                let password_hash = user["password_hash"].as_str().unwrap_or("");
                let role = user["role"].as_str().unwrap_or("Staff");
                let name = user["name"].as_str().unwrap_or("");
                let email = user["email"].as_str();
                let business_id = user["business_id"].as_i64();
                let temp_pass = user["temporary_password"].as_str();
                let created_at = user["created_at"].as_str().unwrap_or("");
                let is_active = user["is_active"].as_bool().unwrap_or(true);

                self.conn.execute(
                    "INSERT INTO users (id, username, password_hash, role, name, email, business_id, temporary_password, created_at, is_active) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    [&id.to_string(), username, password_hash, role, name, email.unwrap_or(""), &business_id.map(|v| v.to_string()).unwrap_or_default(), temp_pass.unwrap_or(""), created_at, &(is_active as i64).to_string()]
                )?;
            }
        }

        // Restore businesses
        if let Some(businesses) = data.get("businesses").and_then(|v| v.as_array()) {
            for business in businesses {
                let id = business["id"].as_i64().unwrap_or(0);
                let name = business["name"].as_str().unwrap_or("");
                let client_id = business["client_id"].as_str().unwrap_or("");
                let logo_path = business["logo_path"].as_str();
                let address = business["address"].as_str();
                let phone = business["phone"].as_str();
                let email = business["email"].as_str();
                let primary_color = business["primary_color"].as_str().unwrap_or("#3B82F6");
                let secondary_color = business["secondary_color"].as_str().unwrap_or("#1E40AF");
                let modules_enabled = business["modules_enabled"].as_str().unwrap_or("[]");
                let subscription_status = business["subscription_status"].as_str().unwrap_or("TRIAL");
                let created_by = business["created_by"].as_i64().unwrap_or(0);
                let is_active = business["is_active"].as_bool().unwrap_or(true);
                let created_at = business["created_at"].as_str().unwrap_or("");

                self.conn.execute(
                    "INSERT INTO businesses (id, name, client_id, logo_path, address, phone, email, primary_color, secondary_color, modules_enabled, subscription_status, created_by, is_active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                    [&id.to_string(), name, client_id, logo_path.unwrap_or(""), address.unwrap_or(""), phone.unwrap_or(""), email.unwrap_or(""), primary_color, secondary_color, modules_enabled, subscription_status, &created_by.to_string(), &(is_active as i64).to_string(), created_at]
                )?;
            }
        }

        // Restore products (similar pattern for other tables)
        if let Some(products) = data.get("products").and_then(|v| v.as_array()) {
            for product in products {
                let id = product["id"].as_i64().unwrap_or(0);
                let business_id = product["business_id"].as_i64().unwrap_or(0);
                let name = product["name"].as_str().unwrap_or("");
                let description = product["description"].as_str();
                let category = product["category"].as_str().unwrap_or("BAR");
                let price = product["price"].as_f64().unwrap_or(0.0);
                let cost_price = product["cost_price"].as_f64().unwrap_or(0.0);
                let stock_quantity = product["stock_quantity"].as_i64().unwrap_or(0) as i32;
                let min_stock_level = product["min_stock_level"].as_i64().unwrap_or(0) as i32;
                let fridge_stock = product["fridge_stock"].as_i64().unwrap_or(0) as i32;
                let show_stock = product["show_stock"].as_i64().unwrap_or(0) as i32;
                let store_stock = product["store_stock"].as_i64().unwrap_or(0) as i32;
                let barcode = product["barcode"].as_str();
                let serial_number = product["serial_number"].as_str();
                let image_path = product["image_path"].as_str();
                let is_active = product["is_active"].as_bool().unwrap_or(true);
                let created_at = product["created_at"].as_str().unwrap_or("");

                self.conn.execute(
                    "INSERT INTO products (id, business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, fridge_stock, show_stock, store_stock, barcode, serial_number, image_path, is_active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                    [&id.to_string(), &business_id.to_string(), name, description.unwrap_or(""), category, &price.to_string(), &cost_price.to_string(), &stock_quantity.to_string(), &min_stock_level.to_string(), &fridge_stock.to_string(), &show_stock.to_string(), &store_stock.to_string(), barcode.unwrap_or(""), serial_number.unwrap_or(""), image_path.unwrap_or(""), &(is_active as i64).to_string(), created_at]
                )?;
            }
        }

        // Restore sales and sale_items (similar pattern)
        if let Some(sales) = data.get("sales").and_then(|v| v.as_array()) {
            for sale in sales {
                let id = sale["id"].as_i64().unwrap_or(0);
                let user_id = sale["user_id"].as_i64().unwrap_or(0);
                let total_amount = sale["total_amount"].as_f64().unwrap_or(0.0);
                let payment_method = sale["payment_method"].as_str().unwrap_or("CASH");
                let payment_status = sale["payment_status"].as_str().unwrap_or("COMPLETED");
                let created_at = sale["created_at"].as_str().unwrap_or("");
                let notes = sale["notes"].as_str();

                self.conn.execute(
                    "INSERT INTO sales (id, user_id, total_amount, payment_method, payment_status, created_at, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    [&id.to_string(), &user_id.to_string(), &total_amount.to_string(), payment_method, payment_status, created_at, notes.unwrap_or("")]
                )?;
            }
        }

        if let Some(sale_items) = data.get("sale_items").and_then(|v| v.as_array()) {
            for item in sale_items {
                let id = item["id"].as_i64().unwrap_or(0);
                let sale_id = item["sale_id"].as_i64().unwrap_or(0);
                let product_id = item["product_id"].as_i64().unwrap_or(0);
                let quantity = item["quantity"].as_i64().unwrap_or(0) as i32;
                let unit_price = item["unit_price"].as_f64().unwrap_or(0.0);
                let total_price = item["total_price"].as_f64().unwrap_or(0.0);

                self.conn.execute(
                    "INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, total_price) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    [&id.to_string(), &sale_id.to_string(), &product_id.to_string(), &quantity.to_string(), &unit_price.to_string(), &total_price.to_string()]
                )?;
            }
        }

        // Restore inventory transactions
        if let Some(transactions) = data.get("inventory_transactions").and_then(|v| v.as_array()) {
            for tx in transactions {
                let id = tx["id"].as_i64().unwrap_or(0);
                let product_id = tx["product_id"].as_i64().unwrap_or(0);
                let transaction_type = tx["transaction_type"].as_str().unwrap_or("");
                let quantity = tx["quantity"].as_i64().unwrap_or(0) as i32;
                let reason = tx["reason"].as_str();
                let user_id = tx["user_id"].as_i64().unwrap_or(0);
                let created_at = tx["created_at"].as_str().unwrap_or("");

                self.conn.execute(
                    "INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, reason, user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    [&id.to_string(), &product_id.to_string(), transaction_type, &quantity.to_string(), reason.unwrap_or(""), &user_id.to_string(), created_at]
                )?;
            }
        }

        // Restore email configs
        if let Some(configs) = data.get("email_configs").and_then(|v| v.as_array()) {
            for config in configs {
                let business_id = config["business_id"].as_i64().unwrap_or(0);
                let smtp_server = config["smtp_server"].as_str().unwrap_or("smtp.gmail.com");
                let smtp_port = config["smtp_port"].as_i64().unwrap_or(587);
                let username = config["username"].as_str().unwrap_or("");
                let from_email = config["from_email"].as_str().unwrap_or("");
                let from_name = config["from_name"].as_str().unwrap_or("POS System");
                let use_tls = config["use_tls"].as_bool().unwrap_or(true);
                let enabled = config["enabled"].as_bool().unwrap_or(true);
                let notification_roles = config["notification_roles"].as_str().unwrap_or("SuperAdmin,Manager");
                let low_stock_enabled = config["low_stock_enabled"].as_bool().unwrap_or(true);
                let pending_sales_enabled = config["pending_sales_enabled"].as_bool().unwrap_or(true);
                let daily_reports_enabled = config["daily_reports_enabled"].as_bool().unwrap_or(false);

                // Note: password is not exported for security, so we skip it or use empty
                self.conn.execute(
                    "INSERT INTO email_config (business_id, smtp_server, smtp_port, username, password, from_email, from_name, use_tls, enabled, notification_roles, low_stock_enabled, pending_sales_enabled, daily_reports_enabled) VALUES (?1, ?2, ?3, ?4, '', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    [&business_id.to_string(), smtp_server, &smtp_port.to_string(), username, from_email, from_name, &(use_tls as i64).to_string(), &(enabled as i64).to_string(), notification_roles, &(low_stock_enabled as i64).to_string(), &(pending_sales_enabled as i64).to_string(), &(daily_reports_enabled as i64).to_string()]
                )?;
            }
        }

        // Restore report permissions
        if let Some(perms) = data.get("report_permissions").and_then(|v| v.as_array()) {
            for perm in perms {
                let business_id = perm["business_id"].as_i64().unwrap_or(0);
                let manager_can_view = perm["manager_can_view"].as_bool().unwrap_or(false);
                let secretary_can_view = perm["secretary_can_view"].as_bool().unwrap_or(false);
                let staff_can_view = perm["staff_can_view"].as_bool().unwrap_or(false);

                self.conn.execute(
                    "INSERT INTO report_permissions (business_id, manager_can_view, secretary_can_view, staff_can_view) VALUES (?1, ?2, ?3, ?4)",
                    [&business_id.to_string(), &(manager_can_view as i64).to_string(), &(secretary_can_view as i64).to_string(), &(staff_can_view as i64).to_string()]
                )?;
            }
        }

        // Commit transaction
        self.conn.execute("COMMIT", [])?;
        Ok(())
    }

    // Kitchen Order Queue methods
    pub fn create_kitchen_order(
        &self,
        sale_id: i64,
        sale_item_id: i64,
        product_id: i64,
        product_name: &str,
        quantity: i32,
        notes: Option<&str>,
    ) -> Result<i64> {
        let notes_str = notes.unwrap_or("");
        self.conn.execute(
            "INSERT INTO kitchen_orders (sale_id, sale_item_id, product_id, product_name, quantity, status, notes) 
             VALUES (?1, ?2, ?3, ?4, ?5, 'PENDING', ?6)",
            [&sale_id.to_string(), &sale_item_id.to_string(), &product_id.to_string(), product_name, &quantity.to_string(), notes_str],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_kitchen_orders(&self, business_id: i64, status: Option<&str>) -> Result<Vec<serde_json::Value>> {
        let status_filter = if let Some(s) = status {
            format!("AND ko.status = '{}'", s)
        } else {
            String::new()
        };

        let query = format!(
            "SELECT ko.id, ko.sale_id, ko.sale_item_id, ko.product_id, ko.product_name, ko.quantity, 
                    ko.status, ko.notes, ko.created_at, ko.started_at, ko.ready_at, ko.completed_at,
                    ko.prepared_by, s.total_amount, s.payment_method, u.name as customer_name,
                    (julianday(COALESCE(ko.completed_at, datetime('now'))) - julianday(ko.created_at)) * 24 * 60 as elapsed_minutes
             FROM kitchen_orders ko
             JOIN sale_items si ON ko.sale_item_id = si.id
             JOIN sales s ON ko.sale_id = s.id
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 {}
             ORDER BY ko.created_at DESC",
            status_filter
        );

        let mut stmt = self.conn.prepare(&query)?;
        let order_iter = stmt.query_map([business_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "sale_id": row.get::<_, i64>(1)?,
                "sale_item_id": row.get::<_, i64>(2)?,
                "product_id": row.get::<_, i64>(3)?,
                "product_name": row.get::<_, String>(4)?,
                "quantity": row.get::<_, i32>(5)?,
                "status": row.get::<_, String>(6)?,
                "notes": row.get::<_, Option<String>>(7)?,
                "created_at": row.get::<_, String>(8)?,
                "started_at": row.get::<_, Option<String>>(9)?,
                "ready_at": row.get::<_, Option<String>>(10)?,
                "completed_at": row.get::<_, Option<String>>(11)?,
                "prepared_by": row.get::<_, Option<i64>>(12)?,
                "total_amount": row.get::<_, f64>(13)?,
                "payment_method": row.get::<_, String>(14)?,
                "customer_name": row.get::<_, Option<String>>(15)?,
                "elapsed_minutes": row.get::<_, Option<f64>>(16)?.map(|v| v as i64),
            }))
        })?;
        order_iter.collect()
    }

    pub fn update_kitchen_order_status(
        &self,
        order_id: i64,
        status: &str,
        prepared_by: Option<i64>,
    ) -> Result<()> {
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        
        match status {
            "PREPARING" => {
                self.conn.execute(
                    "UPDATE kitchen_orders SET status = ?1, started_at = ?2, prepared_by = ?3 WHERE id = ?4",
                    [status, &now, &prepared_by.map(|v| v.to_string()).unwrap_or_default(), &order_id.to_string()],
                )?;
            }
            "READY" => {
                self.conn.execute(
                    "UPDATE kitchen_orders SET status = ?1, ready_at = ?2 WHERE id = ?3",
                    [status, &now, &order_id.to_string()],
                )?;
            }
            "COMPLETED" => {
                self.conn.execute(
                    "UPDATE kitchen_orders SET status = ?1, completed_at = ?2 WHERE id = ?3",
                    [status, &now, &order_id.to_string()],
                )?;
            }
            _ => {
                self.conn.execute(
                    "UPDATE kitchen_orders SET status = ?1 WHERE id = ?2",
                    [status, &order_id.to_string()],
                )?;
            }
        }
        Ok(())
    }

    pub fn get_pending_kitchen_orders_count(&self, business_id: i64) -> Result<i64> {
        self.conn.query_row(
            "SELECT COUNT(*) FROM kitchen_orders ko
             JOIN sale_items si ON ko.sale_item_id = si.id
             JOIN sales s ON ko.sale_id = s.id
             JOIN users u ON s.user_id = u.id
             WHERE u.business_id = ?1 AND ko.status IN ('PENDING', 'PREPARING')",
            [business_id],
            |row| row.get(0),
        )
    }

    // System-wide reports (for SuperSuperAdmin)
    pub fn get_system_revenue_summary(&self, start_date: Option<&str>, end_date: Option<&str>) -> Result<serde_json::Value> {
        let date_filter = if let (Some(start), Some(end)) = (start_date, end_date) {
            format!("AND DATE(s.created_at) BETWEEN '{}' AND '{}'", start, end)
        } else {
            String::new()
        };

        // Total revenue across all businesses
        let total_revenue: f64 = self.conn.query_row(
            &format!(
                "SELECT COALESCE(SUM(s.total_amount), 0) 
                 FROM sales s
                 WHERE s.payment_status = 'COMPLETED' {}",
                date_filter
            ),
            [],
            |row| row.get(0),
        ).unwrap_or(0.0);

        // Total transaction count
        let total_transactions: i64 = self.conn.query_row(
            &format!(
                "SELECT COUNT(*) 
                 FROM sales s
                 WHERE s.payment_status = 'COMPLETED' {}",
                date_filter
            ),
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        // Total active businesses
        let total_businesses: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM businesses WHERE is_active = 1",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        // Revenue by business
        let mut stmt = self.conn.prepare(&format!(
            "SELECT b.id, b.name, COALESCE(SUM(s.total_amount), 0) as revenue, COUNT(DISTINCT s.id) as transactions
             FROM businesses b
             LEFT JOIN users u ON b.id = u.business_id
             LEFT JOIN sales s ON u.id = s.user_id AND s.payment_status = 'COMPLETED' {}
             WHERE b.is_active = 1
             GROUP BY b.id, b.name
             ORDER BY revenue DESC",
            date_filter
        ))?;

        let business_revenue: Vec<serde_json::Value> = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "business_id": row.get::<_, i64>(0)?,
                "business_name": row.get::<_, String>(1)?,
                "revenue": row.get::<_, f64>(2)?,
                "transactions": row.get::<_, i64>(3)?,
            }))
        })?.collect::<Result<Vec<_>>>()?;

        // Today's revenue
        let today_revenue: f64 = self.conn.query_row(
            "SELECT COALESCE(SUM(s.total_amount), 0) 
             FROM sales s
             WHERE s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) = DATE('now')",
            [],
            |row| row.get(0),
        ).unwrap_or(0.0);

        // This month's revenue
        let month_revenue: f64 = self.conn.query_row(
            "SELECT COALESCE(SUM(s.total_amount), 0) 
             FROM sales s
             WHERE s.payment_status = 'COMPLETED'
             AND DATE(s.created_at) >= DATE('now', 'start of month')",
            [],
            |row| row.get(0),
        ).unwrap_or(0.0);

        Ok(serde_json::json!({
            "total_revenue": total_revenue,
            "total_transactions": total_transactions,
            "total_businesses": total_businesses,
            "today_revenue": today_revenue,
            "month_revenue": month_revenue,
            "average_revenue_per_business": if total_businesses > 0 { total_revenue / total_businesses as f64 } else { 0.0 },
            "business_revenue": business_revenue,
            "start_date": start_date,
            "end_date": end_date,
        }))
    }
}
