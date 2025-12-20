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
    pub stock_quantity: i32,
    pub min_stock_level: i32,
    pub barcode: Option<String>,
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
                barcode TEXT,
                image_path TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (business_id) REFERENCES businesses (id)
            )",
            [],
        )?;

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
            "INSERT INTO products (business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, barcode, image_path, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            [
                &product.business_id.to_string(),
                &product.name,
                product.description.as_deref().unwrap_or(""),
                &product.category,
                &product.price.to_string(),
                &product.cost_price.to_string(),
                &product.stock_quantity.to_string(),
                &product.min_stock_level.to_string(),
                &product.barcode.as_deref().unwrap_or(""),
                &product.image_path.as_deref().unwrap_or(""),
                &is_active_int.to_string(),
            ],
        )?;
        let product_id = self.conn.last_insert_rowid();
        println!("Product created successfully with ID: {} for business_id: {} with is_active={}", product_id, product.business_id, is_active_int);
        Ok(product_id)
    }

    pub fn get_all_users(&self) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare("SELECT id, username, name, email, role, business_id, created_at FROM users ORDER BY id")?;
        let user_iter = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "username": row.get::<_, String>(1)?,
                "name": row.get::<_, Option<String>>(2)?,
                "email": row.get::<_, Option<String>>(3)?,
                "role": row.get::<_, String>(4)?,
                "business_id": row.get::<_, Option<i64>>(5)?,
                "created_at": row.get::<_, String>(6)?
            }))
        })?;
        user_iter.collect()
    }

    pub fn get_all_sales(&self) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.user_id, s.total_amount, s.payment_method, s.payment_status, s.created_at,
                    u.username as user_name, COUNT(si.id) as item_count
             FROM sales s
             LEFT JOIN users u ON s.user_id = u.id
             LEFT JOIN sale_items si ON s.id = si.sale_id
             GROUP BY s.id
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
                "user_name": row.get::<_, Option<String>>(6)?,
                "item_count": row.get::<_, Option<i64>>(7)?
            }))
        })?;
        sale_iter.collect()
    }

    pub fn get_all_products(&self) -> Result<Vec<Product>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, barcode, image_path, is_active, created_at 
             FROM products WHERE is_active = 1 ORDER BY name"
        )?;
        let product_iter = stmt.query_map([], |row| {
            // Map is_active from integer (1/0) to boolean
            let is_active_int: i64 = row.get(11)?;
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
                barcode: row.get(9)?,
                image_path: row.get::<_, Option<String>>(10)?,
                is_active,
                created_at: row.get(12)?,
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
            "SELECT id, business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, barcode, image_path, is_active, created_at 
             FROM products WHERE business_id = ?1 AND is_active = 1 ORDER BY name"
        )?;
        let product_iter = stmt.query_map([business_id], |row| {
            // Map is_active from integer (1/0) to boolean
            let is_active_int: i64 = row.get(11)?;
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
                barcode: row.get(9)?,
                image_path: row.get::<_, Option<String>>(10)?,
                is_active,
                created_at: row.get(12)?,
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
        // Update product stock
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

    pub fn get_low_stock_products(&self) -> Result<Vec<Product>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, barcode, image_path, is_active, created_at 
             FROM products WHERE stock_quantity <= min_stock_level AND is_active = 1"
        )?;
        let product_iter = stmt.query_map([], |row| {
            // Map is_active from integer (1/0) to boolean
            let is_active_int: i64 = row.get(11)?;
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
                barcode: row.get(9)?,
                image_path: row.get::<_, Option<String>>(10)?,
                is_active,
                created_at: row.get(12)?,
            })
        })?;
        product_iter.collect()
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

        // Return user data
        Ok(serde_json::json!({
            "id": id,
            "username": db_username,
            "role": serde_json::from_str::<serde_json::Value>(&role).unwrap_or(serde_json::Value::Null),
            "name": name,
            "email": email,
            "business_id": business_id
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
        self.conn.execute(
            "UPDATE users SET password_hash = ?1 WHERE id = ?2",
            [new_password_hash, &user_id.to_string()],
        )?;
        Ok(())
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
}
