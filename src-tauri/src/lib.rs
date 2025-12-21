mod database;
mod supabase;
mod email;

use std::sync::{Mutex, Arc};
use database::*;
use supabase::SupabaseClient;
use email::{EmailService, EmailConfig};
use rand::Rng;
use tauri::Manager;

// Helper function to check and send low stock email notifications
async fn check_and_send_low_stock_email(db: Arc<Mutex<Database>>, product_id: i64, business_id: i64) {
    // Extract all needed data before any await points
    let email_data: Option<(String, i32, i32, i32, i32, EmailConfig, Vec<String>, bool)> = {
        let db = db.lock().unwrap();
        // Get product details
        let product_result = db.conn.query_row(
            "SELECT name, fridge_stock, show_stock, store_stock, min_stock_level FROM products WHERE id = ?1",
            [product_id],
            |row: &rusqlite::Row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, i32>(3)?,
                    row.get::<_, i32>(4)?,
                ))
            },
        );

        if let Ok((name, fridge_stock, show_stock, store_stock, min_stock)) = product_result {
            // Check if any stock type is low or out
            let fridge_low = fridge_stock <= min_stock;
            let show_low = show_stock <= min_stock;
            let store_low = store_stock <= min_stock;
            let is_low = fridge_low || show_low || store_low;
            let is_out = fridge_stock == 0 && show_stock == 0 && store_stock == 0;
            
            if is_low || is_out {
                // Check if low stock notifications are enabled
                let low_stock_enabled: i64 = db.conn.query_row(
                    "SELECT COALESCE(low_stock_enabled, 1) FROM email_config WHERE business_id = ?1 AND enabled = 1",
                    [business_id],
                    |row: &rusqlite::Row| row.get(0),
                ).unwrap_or(1);
                
                if low_stock_enabled != 0 {
                    // Get email config
                    let config_result = db.conn.query_row(
                        "SELECT smtp_server, smtp_port, username, password, from_email, from_name, use_tls FROM email_config WHERE business_id = ?1 AND enabled = 1",
                        [business_id],
                        |row: &rusqlite::Row| {
                            Ok(EmailConfig {
                                smtp_server: row.get(0)?,
                                smtp_port: row.get::<_, i64>(1)? as u16,
                                username: row.get(2)?,
                                password: row.get(3)?,
                                from_email: row.get(4)?,
                                from_name: row.get(5)?,
                                use_tls: row.get::<_, i64>(6)? != 0,
                            })
                        },
                    );

                    if let Ok(config) = config_result {
                        // Get notification emails (based on configured roles)
                        if let Ok(emails) = db.get_business_notification_emails(business_id) {
                            Some((name, fridge_stock, show_stock, store_stock, min_stock, config, emails, is_out))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    if let Some((name, fridge_stock, show_stock, store_stock, min_stock, config, emails, is_out)) = email_data {
        let email_service = EmailService::new(config);
        let total_stock = fridge_stock + show_stock + store_stock;
        
        for email in emails {
            if is_out {
                let _ = email_service.send_out_of_stock_alert(&email, &name).await;
            } else {
                let _ = email_service.send_low_stock_alert(&email, &name, total_stock, min_stock).await;
            }
        }
    }
}

// Helper function to send pending sales notification
async fn send_pending_sales_notification(
    db: Arc<Mutex<Database>>,
    business_id: i64,
    sale_id: i64,
    total_amount: f64,
    item_count: i64,
) {
    // Extract all needed data before any await points
    let email_data: Option<(EmailConfig, Vec<String>)> = {
        let db = db.lock().unwrap();
        // Get email config
        let config_result = db.conn.query_row(
            "SELECT smtp_server, smtp_port, username, password, from_email, from_name, use_tls FROM email_config WHERE business_id = ?1 AND enabled = 1",
            [business_id],
            |row: &rusqlite::Row| {
                Ok(EmailConfig {
                    smtp_server: row.get(0)?,
                    smtp_port: row.get::<_, i64>(1)? as u16,
                    username: row.get(2)?,
                    password: row.get(3)?,
                    from_email: row.get(4)?,
                    from_name: row.get(5)?,
                    use_tls: row.get::<_, i64>(6)? != 0,
                })
            },
        );

        if let Ok(config) = config_result {
            // Check if pending sales notifications are enabled
            let pending_sales_enabled: i64 = db.conn.query_row(
                "SELECT COALESCE(pending_sales_enabled, 1) FROM email_config WHERE business_id = ?1 AND enabled = 1",
                [business_id],
                |row: &rusqlite::Row| row.get(0),
            ).unwrap_or(1);
            
            if pending_sales_enabled != 0 {
                // Get notification emails (based on configured roles)
                if let Ok(emails) = db.get_business_notification_emails(business_id) {
                    Some((config, emails))
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    if let Some((config, emails)) = email_data {
        let email_service = EmailService::new(config);
        let created_at = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        
        for email in emails {
            let _ = email_service
                .send_pending_sale_notification(&email, sale_id, total_amount, item_count, &created_at)
                .await;
        }
    }
}
use std::fs;
use base64::{Engine as _, engine::general_purpose};
use tauri::State;

// Cloud sync configuration - loaded from environment variables
// Set these in a .env file in the src-tauri directory or as environment variables
fn get_supabase_url() -> String {
    std::env::var("SUPABASE_URL")
        .unwrap_or_else(|_| "https://your-project.supabase.co".to_string())
}

fn get_supabase_anon_key() -> String {
    std::env::var("SUPABASE_ANON_KEY")
        .unwrap_or_else(|_| String::new())
}

fn get_supabase_service_role_key() -> String {
    std::env::var("SUPABASE_SERVICE_ROLE_KEY")
        .unwrap_or_else(|_| String::new())
}

pub struct AppState {
    db: Arc<Mutex<Database>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables from .env file if it exists
    // This allows configuration via .env file in src-tauri directory
    let _ = dotenv::dotenv();
    
    let app_data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join("pos-system");

    if let Err(e) = std::fs::create_dir_all(&app_data_dir) {
        eprintln!("CRITICAL: Failed to create app data directory: {}", e);
        std::process::exit(1);
    }

    let db_path = app_data_dir.join("pos.db");
    let db = match Database::new(&db_path) {
        Ok(db) => db,
        Err(e) => {
            eprintln!("CRITICAL: Failed to initialize database at {:?}: {}", db_path, e);
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .manage(AppState {
            db: Arc::new(Mutex::new(db)),
        })
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Ensure main window is visible and focused
            if let Some(window) = app.get_webview_window("main") {
                let _: Result<(), _> = window.show();
                let _: Result<(), _> = window.set_focus();
            }
            
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            has_super_super_admin,
            authenticate_user,
            create_user,
            create_business,
            get_businesses,
            update_business_status,
            update_business_settings,
            save_business_logo,
            get_business_by_id,
            change_password,
            create_product,
            get_all_products,
            get_products_for_business,
            get_low_stock_products,
            create_sale,
            process_sale,
            update_stock,
            get_sales_report,
            reset_database,
            get_orphaned_users,
            fix_orphaned_users,
            sync_to_cloud,
            sync_from_cloud,
            get_sync_status,
            get_business_staff_count,
            check_business_exists,
            remove_duplicate_businesses,
            delete_all_businesses,
            get_business_admin_password,
            reset_business_admin_password,
            fix_users_without_business_id,
            fix_product_is_active_values,
            save_product_image,
            get_product_image,
            update_stock_type,
            transfer_stock,
            find_product_by_code,
            save_email_config,
            get_email_config,
            send_test_email,
            send_low_stock_email,
            send_pending_sales_email,
            send_daily_sales_report,
            send_new_user_notification,
            request_password_reset,
            reset_password_with_token,
            export_database_backup,
            import_database_backup,
            get_pending_items_summary,
            get_pending_sales,
            get_order_history,
            get_sale_items,
            get_kitchen_orders,
            update_kitchen_order_status,
            get_pending_kitchen_orders_count,
            get_system_revenue_summary,
            get_low_stock_products_for_business,
            get_out_of_stock_products_for_business,
            mark_sale_as_completed,
            get_sales_report,
            get_top_products,
            get_staff_performance,
            get_revenue_analytics,
            get_report_permissions,
            save_report_permissions,
            can_user_view_reports,
            get_inventory_movements,
            get_inventory_transfers,
            get_inventory_adjustments,
            get_inventory_summary,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("CRITICAL: Failed to run Tauri application: {}", e);
            std::process::exit(1);
        });
}

#[tauri::command]
async fn has_super_super_admin(state: State<'_, AppState>) -> Result<bool, String> {
    let db = state.db.lock().unwrap();
    db.has_super_super_admin()
        .map_err(|e| format!("Failed to check super super admin: {}", e))
}

#[tauri::command]
async fn authenticate_user(state: State<'_, AppState>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    let username: String = serde_json::from_value(request["username"].clone()).map_err(|e| format!("Invalid username: {}", e))?;
    let password_hash: String = serde_json::from_value(request["password_hash"].clone()).map_err(|e| format!("Invalid password: {}", e))?;

    db.authenticate_user(&username, &password_hash)
        .map_err(|e| format!("Authentication failed: {}", e))
}

#[tauri::command]
async fn create_user(state: State<'_, AppState>, request: serde_json::Value) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    let username_raw: String = serde_json::from_value(request["username"].clone())
        .map_err(|e| format!("Invalid username: {}", e))?;
    let username = username_raw.trim().to_string();
    let password_hash: String = serde_json::from_value(request["password_hash"].clone()).map_err(|e| format!("Invalid password: {}", e))?;
    let role: serde_json::Value = request["role"].clone();
    let name: Option<String> = request["name"].as_str().map(|s| s.trim().to_string());
    let email: Option<String> = request["email"].as_str().map(|s| s.trim().to_string());
    let business_id: Option<i64> = request["business_id"].as_i64();
    let temporary_password: Option<String> = request["temporary_password"].as_str().map(|s| s.to_string());

    println!("Creating user with username: '{}', business_id: {:?}", username, business_id);
    
    // Prepare data for email notification before creating user
    let user_name_str = name.as_deref().unwrap_or(&username).to_string();
    let user_email_str = email.as_deref().unwrap_or("").to_string();
    let role_str = role.as_str().unwrap_or("Unknown").to_string();
    let bid = business_id;
    
    let user_id = db.create_user(&username, &password_hash, &role, name.as_deref(), email.as_deref(), business_id, temporary_password.as_deref())
        .map_err(|e| format!("Failed to create user: {}", e))?;
    println!("User created successfully with ID: {}", user_id);

    // Send new user registration notification email if business_id exists
    // Do this after releasing the database lock
    if let Some(business_id_val) = bid {
        let user_name_clone = user_name_str.clone();
        let user_email_clone = user_email_str.clone();
        let role_clone = role_str.clone();
        let db_arc = state.db.clone();
        
        tokio::spawn(async move {
            let _ = send_new_user_registration_helper(db_arc, business_id_val, &user_name_clone, &user_email_clone, &role_clone).await;
        });
    }

    Ok(user_id)
}

#[tauri::command]
async fn create_business(state: State<'_, AppState>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    let name: String = serde_json::from_value(request["name"].clone()).map_err(|e| format!("Invalid name: {}", e))?;

    // Generate client_id if not provided
    let client_id: String = if let Some(client_id_val) = request["client_id"].as_str() {
        client_id_val.to_string()
    } else {
        // Generate a unique client ID
        format!("CLI{:06}", chrono::Utc::now().timestamp() % 1000000)
    };

    let address: Option<String> = request["address"].as_str().map(|s| s.to_string());
    let phone: Option<String> = request["phone"].as_str().map(|s| s.to_string());
    let email: Option<String> = request["email"].as_str().map(|s| s.to_string());
    let primary_color: String = serde_json::from_value(request["theme_primary_color"].clone()).unwrap_or("#3B82F6".to_string());
    let secondary_color: String = serde_json::from_value(request["theme_secondary_color"].clone()).unwrap_or("#1E40AF".to_string());
    let modules: serde_json::Value = request["modules_enabled"].clone();
    let created_by: i64 = serde_json::from_value(request["createdBy"].clone()).map_err(|e| format!("Invalid createdBy: {}", e))?;

    // Check for duplicates before creating
    let exists = db.check_business_exists(&name, email.as_deref())
        .map_err(|e| format!("Failed to check business: {}", e))?;
    if exists {
        return Err(format!("A business with the name '{}' or email '{}' already exists", name, email.as_deref().unwrap_or("")));
    }

    let business_id = db.create_business(&name, &client_id, address.as_deref(), phone.as_deref(), email.as_deref(), &primary_color, &secondary_color, &modules, created_by)
        .map_err(|e| format!("Failed to create business: {}", e))?;

    // Return both business_id and client_id
    Ok(serde_json::json!({
        "business_id": business_id,
        "client_id": client_id
    }))
}

#[tauri::command]
async fn get_businesses(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    let businesses = db.get_businesses()
        .map_err(|e| format!("Failed to get businesses: {}", e))?;

    println!("Found {} businesses in database", businesses.len());
    for business in &businesses {
        println!("Business: {} (ID: {})", business["name"], business["id"]);
    }

    Ok(businesses)
}

#[tauri::command]
async fn update_business_status(state: State<'_, AppState>, request: serde_json::Value) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    // Handle both { request: { ... } } and { business_id: ..., is_active: ... } patterns
    let data = if request.get("request").is_some() {
        request["request"].clone()
    } else {
        request.clone()
    };
    let business_id: i64 = serde_json::from_value(data["business_id"].clone()).map_err(|e| format!("Invalid business_id: {}", e))?;
    let is_active: bool = serde_json::from_value(data["is_active"].clone()).map_err(|e| format!("Invalid is_active: {}", e))?;

    db.update_business_status(business_id, is_active)
        .map_err(|e| format!("Failed to update business status: {}", e))
}

#[tauri::command]
async fn get_business_by_id(state: State<'_, AppState>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    // Handle both direct number and object formats
    let business_id: i64 = if request.is_number() {
        request.as_i64().ok_or_else(|| "Invalid business_id: not a number".to_string())?
    } else {
        request["businessId"].as_i64()
            .or_else(|| request["business_id"].as_i64())
            .ok_or_else(|| "Invalid business_id: missing or invalid".to_string())?
    };
    db.get_business_by_id(business_id)
        .map_err(|e| format!("Failed to get business: {}", e))
}

#[tauri::command]
async fn change_password(state: State<'_, AppState>, user_id: i64, new_password_hash: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.change_password(user_id, &new_password_hash)
        .map_err(|e| format!("Failed to change password: {}", e))
}

#[tauri::command]
async fn create_product(state: State<'_, AppState>, request: serde_json::Value) -> Result<i64, String> {
    let db = state.db.lock().unwrap();

    // Extract individual fields from the request
    let business_id: i64 = serde_json::from_value(request["business_id"].clone()).map_err(|e| format!("Invalid business_id: {}", e))?;
    println!("create_product called with business_id: {}", business_id);
    let name: String = serde_json::from_value(request["name"].clone()).map_err(|e| format!("Invalid name: {}", e))?;
    let description: Option<String> = request["description"].as_str().map(|s| s.to_string());
    let category: String = serde_json::from_value(request["category"].clone()).map_err(|e| format!("Invalid category: {}", e))?;
    let price: f64 = serde_json::from_value(request["price"].clone()).map_err(|e| format!("Invalid price: {}", e))?;
    // Handle both cost_price and costPrice, default to 0 if not provided
    let cost_price: f64 = request["cost_price"].as_f64()
        .or_else(|| request["costPrice"].as_f64())
        .unwrap_or(0.0);
    // Handle both stock_quantity and stockQuantity, default to 0 if not provided
    let stock_quantity: i32 = request["stock_quantity"].as_i64()
        .or_else(|| request["stockQuantity"].as_i64())
        .map(|v| v as i32)
        .unwrap_or(0);
    // Handle both min_stock_level and minStockLevel, default to 0 if not provided
    let min_stock_level: i32 = request["min_stock_level"].as_i64()
        .or_else(|| request["minStockLevel"].as_i64())
        .map(|v| v as i32)
        .unwrap_or(0);
    // Handle new stock fields
    let fridge_stock: i32 = request["fridge_stock"].as_i64()
        .or_else(|| request["fridgeStock"].as_i64())
        .map(|v| v as i32)
        .unwrap_or(0);
    let show_stock: i32 = request["show_stock"].as_i64()
        .or_else(|| request["showStock"].as_i64())
        .map(|v| v as i32)
        .unwrap_or(0);
    let store_stock: i32 = request["store_stock"].as_i64()
        .or_else(|| request["storeStock"].as_i64())
        .map(|v| v as i32)
        .unwrap_or(0);
    let barcode: Option<String> = request["barcode"].as_str().map(|s| s.to_string());
    let serial_number: Option<String> = request["serial_number"].as_str()
        .or_else(|| request["serialNumber"].as_str())
        .map(|s| s.to_string());
    let image_path: Option<String> = request["image_path"].as_str()
        .or_else(|| request["imagePath"].as_str())
        .map(|s| s.to_string());

    // Create product struct without id (it will be auto-generated)
    let product = Product {
        id: 0, // This will be ignored and auto-generated
        business_id,
        name,
        description,
        category,
        price,
        cost_price,
        stock_quantity,
        min_stock_level,
        fridge_stock,
        show_stock,
        store_stock,
        barcode,
        serial_number,
        image_path,
        is_active: true,
        created_at: "".to_string(), // This will be set by the database
    };

    db.create_product(&product)
        .map_err(|e| format!("Failed to create product: {}", e))
}

#[tauri::command]
async fn get_all_products(state: State<'_, AppState>) -> Result<Vec<Product>, String> {
    let db = state.db.lock().unwrap();
    db.get_all_products()
        .map_err(|e| format!("Failed to get products: {}", e))
}

#[tauri::command]
async fn get_products_for_business(state: State<'_, AppState>, business_id: i64) -> Result<Vec<Product>, String> {
    let db = state.db.lock().unwrap();
    println!("get_products_for_business called with business_id: {}", business_id);
    if business_id <= 0 {
        return Err("Invalid business_id: must be greater than 0".to_string());
    }
    db.get_products_for_business(business_id)
        .map_err(|e| format!("Failed to get products for business: {}", e))
}

#[tauri::command]
async fn get_low_stock_products(state: State<'_, AppState>) -> Result<Vec<Product>, String> {
    let db = state.db.lock().unwrap();
    db.get_low_stock_products()
        .map_err(|e| format!("Failed to get low stock products: {}", e))
}

#[tauri::command]
async fn create_sale(
    state: State<'_, AppState>,
    user_id: i64,
    items: Vec<SaleItemRequest>,
    payment_method: String
) -> Result<i64, String> {
    let db = state.db.lock().unwrap();

    // Calculate total amount
    let mut total_amount = 0.0;
    for item in &items {
        total_amount += item.unit_price * item.quantity as f64;
    }

    // Create sale
    let sale_id = db.create_sale(user_id, total_amount, &payment_method)
        .map_err(|e| format!("Failed to create sale: {}", e))?;

    // Add sale items and update inventory
    for item in items {
        // Insert sale item
        db.conn.execute(
            "INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, total_price)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            [
                &sale_id.to_string(),
                &item.product_id.to_string(),
                &item.quantity.to_string(),
                &item.unit_price.to_string(),
                &(item.unit_price * item.quantity as f64).to_string(),
            ],
        ).map_err(|e| format!("Failed to add sale item: {}", e))?;

        // Update stock
        db.update_stock(item.product_id, -(item.quantity as i32), "SALE", user_id, Some("Sale transaction"))
            .map_err(|e| format!("Failed to update stock: {}", e))?;
    }

    Ok(sale_id)
}

#[tauri::command]
async fn update_stock(
    state: State<'_, AppState>,
    product_id: i64,
    quantity_change: i32,
    transaction_type: String,
    user_id: i64,
    reason: Option<String>
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.update_stock(product_id, quantity_change, &transaction_type, user_id, reason.as_deref())
        .map_err(|e| format!("Failed to update stock: {}", e))
}


#[derive(serde::Deserialize)]
struct SaleItemRequest {
    product_id: i64,
    quantity: i32,
    unit_price: f64,
}

#[derive(serde::Deserialize)]
struct ProcessSaleRequest {
    items: Vec<SaleItemRequest>,
    payment_method: String,
    staff_id: i64,
    business_id: i64,
    location: Option<String>, // "fridge" or "show" - defaults to "fridge" for POS
}

#[tauri::command]
async fn process_sale(
    state: State<'_, AppState>,
    request: ProcessSaleRequest
) -> Result<serde_json::Value, String> {
    // Calculate total amount
    let mut total_amount = 0.0;
    let items_count = request.items.len();
    for item in &request.items {
        total_amount += item.unit_price * item.quantity as f64;
    }

    // Collect items for later processing (after releasing db lock)
    let mut items_to_check: Vec<(i64, i64)> = Vec::new();
    
    // Do all database operations in a block scope
    let (_sale_id, business_id, sale_id_val, total_amount_val, items_count_val, payment_method) = {
        let db = state.db.lock().unwrap();

        // Create sale
        let sale_id = db.create_sale(request.staff_id, total_amount, &request.payment_method)
            .map_err(|e| format!("Failed to create sale: {}", e))?;
        
        // Add sale items and update inventory
        for item in request.items {
            // Get product details to check category
            let product_result = db.conn.query_row(
                "SELECT category, name FROM products WHERE id = ?1",
                [item.product_id],
                |row: &rusqlite::Row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            );

            // Insert sale item
            db.conn.execute(
                "INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, total_price)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                [
                    &sale_id.to_string(),
                    &item.product_id.to_string(),
                    &item.quantity.to_string(),
                    &item.unit_price.to_string(),
                    &(item.unit_price * item.quantity as f64).to_string(),
                ],
            ).map_err(|e| format!("Failed to add sale item: {}", e))?;
            
            let sale_item_id = db.conn.last_insert_rowid();

            // Update stock based on location (fridge or show)
            let location = request.location.as_deref().unwrap_or("fridge");
            db.update_stock_type(item.product_id, location, -(item.quantity as i32), request.staff_id, Some("Sale transaction"))
                .map_err(|e| format!("Failed to update stock: {}", e))?;

            // Create kitchen order if product is KITCHEN category
            if let Ok((category, product_name)) = product_result {
                if category == "KITCHEN" {
                    let _ = db.create_kitchen_order(
                        sale_id,
                        sale_item_id,
                        item.product_id,
                        &product_name,
                        item.quantity,
                        None,
                    );
                }
            }
            
            // Store for low stock check after releasing lock
            items_to_check.push((item.product_id, request.business_id));
        }
        
        // Return values needed after lock is released
        (sale_id, request.business_id, sale_id, total_amount, items_count as i64, request.payment_method.clone())
    };
    
    // Send pending sales notification email (after lock is dropped)
    send_pending_sales_notification(state.db.clone(), business_id, sale_id_val, total_amount_val, items_count_val).await;
    
    // Check for low stock after releasing the database lock
    for (product_id, bid) in items_to_check {
        check_and_send_low_stock_email(state.db.clone(), product_id, bid).await;
    }

    // Return sale information
    Ok(serde_json::json!({
        "sale_id": sale_id_val,
        "total_amount": total_amount_val,
        "payment_method": payment_method,
        "items": items_count,
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

#[tauri::command]
async fn reset_database(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.reset_database()
        .map_err(|e| format!("Failed to reset database: {}", e))
}

#[tauri::command]
async fn get_orphaned_users(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    db.get_orphaned_users()
        .map_err(|e| format!("Failed to get orphaned users: {}", e))
}

#[tauri::command]
async fn fix_orphaned_users(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.fix_orphaned_users()
        .map_err(|e| format!("Failed to fix orphaned users: {}", e))
}

#[tauri::command]
async fn sync_to_cloud(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    // Check if Supabase is configured
    let supabase_url = get_supabase_url();
    let service_key = get_supabase_service_role_key();
    
    if supabase_url == "https://your-project.supabase.co" || service_key.is_empty() {
        return Err("Supabase not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables or create a .env file in src-tauri directory.".to_string());
    }

    // Get all data for sync in a block scope
    let (users, businesses, products_json, sales, sale_items, users_count, businesses_count, products_count, sales_count, sale_items_count) = {
        let db = state.db.lock().unwrap();

        // Get all data for sync
        let users = db.get_all_users().map_err(|e| format!("Failed to get users: {}", e))?;
        let businesses = db.get_businesses().map_err(|e| format!("Failed to get businesses: {}", e))?;
        let products = db.get_all_products().map_err(|e| format!("Failed to get products: {}", e))?;
        let sales = db.get_all_sales().map_err(|e| format!("Failed to get sales: {}", e))?;
        let sale_items = db.get_all_sale_items().map_err(|e| format!("Failed to get sale items: {}", e))?;

        // Convert products to JSON format with all stock fields
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
                "created_at": p.created_at
            })
        }).collect();

        // Get counts before moving the vectors
        let users_count = users.len();
        let businesses_count = businesses.len();
        let products_count = products.len();
        let sales_count = sales.len();
        let sale_items_count = sale_items.len();

        // Return all data (lock is released when block ends)
        (users, businesses, products_json, sales, sale_items, users_count, businesses_count, products_count, sales_count, sale_items_count)
    };

    // Create Supabase client
    let client = SupabaseClient::new(&supabase_url, &service_key);

    // Sync to Supabase (lock is already released)
    client.upsert_users(users).await
        .map_err(|e| format!("Failed to sync users: {}", e))?;
    
    client.upsert_businesses(businesses).await
        .map_err(|e| format!("Failed to sync businesses: {}", e))?;
    
    client.upsert_products(products_json).await
        .map_err(|e| format!("Failed to sync products: {}", e))?;
    
    client.upsert_sales(sales).await
        .map_err(|e| format!("Failed to sync sales: {}", e))?;
    
    client.upsert_sale_items(sale_items).await
        .map_err(|e| format!("Failed to sync sale items: {}", e))?;

    let sync_data = serde_json::json!({
        "users_count": users_count,
        "businesses_count": businesses_count,
        "products_count": products_count,
        "sales_count": sales_count,
        "sale_items_count": sale_items_count,
        "status": "success",
        "message": "Data successfully synced to cloud",
        "last_sync": chrono::Utc::now().to_rfc3339()
    });

    println!("Successfully synced to cloud: {} users, {} businesses, {} products, {} sales, {} sale items",
             users_count, businesses_count, products_count, sales_count, sale_items_count);

    Ok(sync_data)
}

#[tauri::command]
async fn sync_from_cloud(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    // Check if Supabase is configured
    let supabase_url = get_supabase_url();
    let anon_key = get_supabase_anon_key();
    
    if supabase_url == "https://your-project.supabase.co" || anon_key.is_empty() {
        return Err("Supabase not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables or create a .env file in src-tauri directory.".to_string());
    }

    let client = SupabaseClient::new(&supabase_url, &anon_key);
    
    // Fetch data from Supabase
    let cloud_users = client.fetch_users().await
        .map_err(|e| format!("Failed to fetch users: {}", e))?;
    let cloud_businesses = client.fetch_businesses().await
        .map_err(|e| format!("Failed to fetch businesses: {}", e))?;
    let cloud_products = client.fetch_products().await
        .map_err(|e| format!("Failed to fetch products: {}", e))?;
    let cloud_sales = client.fetch_sales().await
        .map_err(|e| format!("Failed to fetch sales: {}", e))?;
    let cloud_sale_items = client.fetch_sale_items().await
        .map_err(|e| format!("Failed to fetch sale items: {}", e))?;

    let db = state.db.lock().unwrap();

    // Import users (upsert - update if exists, insert if not)
    let mut users_count = 0;
    for user in cloud_users {
        let id = user.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let username = user.get("username").and_then(|v| v.as_str()).unwrap_or("");
        let password_hash = user.get("password_hash").and_then(|v| v.as_str()).unwrap_or("");
        let role = user.get("role").and_then(|v| v.as_str()).unwrap_or("Staff");
        let name = user.get("name").and_then(|v| v.as_str());
        let email = user.get("email").and_then(|v| v.as_str());
        let business_id = user.get("business_id").and_then(|v| v.as_i64());
        let temp_pass = user.get("temporary_password").and_then(|v| v.as_str());
        let is_active = user.get("is_active").and_then(|v| v.as_bool()).unwrap_or(true);

        // Check if user exists
        let exists = db.conn.query_row(
            "SELECT COUNT(*) FROM users WHERE id = ?1",
            [id],
            |row: &rusqlite::Row| row.get::<_, i64>(0)
        ).unwrap_or(0) > 0;

        if exists {
            // Update existing user
            db.conn.execute(
                "UPDATE users SET username = ?1, password_hash = ?2, role = ?3, name = ?4, email = ?5, business_id = ?6, temporary_password = ?7, is_active = ?8 WHERE id = ?9",
                [username, password_hash, role, name.unwrap_or(""), email.unwrap_or(""), &business_id.map(|v| v.to_string()).unwrap_or_default(), temp_pass.unwrap_or(""), &(is_active as i64).to_string(), &id.to_string()]
            ).ok();
        } else {
            // Insert new user
            db.conn.execute(
                "INSERT INTO users (id, username, password_hash, role, name, email, business_id, temporary_password, is_active) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                [&id.to_string(), username, password_hash, role, name.unwrap_or(""), email.unwrap_or(""), &business_id.map(|v| v.to_string()).unwrap_or_default(), temp_pass.unwrap_or(""), &(is_active as i64).to_string()]
            ).ok();
        }
        users_count += 1;
    }

    // Import businesses (upsert logic)
    let mut businesses_count = 0;
    for business in cloud_businesses {
        let id = business.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let name = business.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let client_id = business.get("client_id").and_then(|v| v.as_str()).unwrap_or("");
        let logo_path = business.get("logo_path").and_then(|v| v.as_str());
        let address = business.get("address").and_then(|v| v.as_str());
        let phone = business.get("phone").and_then(|v| v.as_str());
        let email = business.get("email").and_then(|v| v.as_str());
        let primary_color = business.get("primary_color").and_then(|v| v.as_str()).unwrap_or("#3B82F6");
        let secondary_color = business.get("secondary_color").and_then(|v| v.as_str()).unwrap_or("#1E40AF");
        let modules_enabled = business.get("modules_enabled").and_then(|v| v.as_str()).unwrap_or("[]");
        let subscription_status = business.get("subscription_status").and_then(|v| v.as_str()).unwrap_or("TRIAL");
        let created_by = business.get("created_by").and_then(|v| v.as_i64()).unwrap_or(1);
        let is_active = business.get("is_active").and_then(|v| v.as_bool()).unwrap_or(true);
        let created_at = business.get("created_at").and_then(|v| v.as_str()).unwrap_or("");

        let exists = db.conn.query_row(
            "SELECT COUNT(*) FROM businesses WHERE id = ?1",
            [id],
            |row: &rusqlite::Row| row.get::<_, i64>(0)
        ).unwrap_or(0) > 0;

        if exists {
            db.conn.execute(
                "UPDATE businesses SET name = ?1, client_id = ?2, logo_path = ?3, address = ?4, phone = ?5, email = ?6, primary_color = ?7, secondary_color = ?8, modules_enabled = ?9, subscription_status = ?10, created_by = ?11, is_active = ?12, created_at = ?13 WHERE id = ?14",
                [name, client_id, logo_path.unwrap_or(""), address.unwrap_or(""), phone.unwrap_or(""), email.unwrap_or(""), primary_color, secondary_color, modules_enabled, subscription_status, &created_by.to_string(), &(is_active as i64).to_string(), created_at, &id.to_string()]
            ).ok();
        } else {
            db.conn.execute(
                "INSERT INTO businesses (id, name, client_id, logo_path, address, phone, email, primary_color, secondary_color, modules_enabled, subscription_status, created_by, is_active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                [&id.to_string(), name, client_id, logo_path.unwrap_or(""), address.unwrap_or(""), phone.unwrap_or(""), email.unwrap_or(""), primary_color, secondary_color, modules_enabled, subscription_status, &created_by.to_string(), &(is_active as i64).to_string(), created_at]
            ).ok();
        }
        businesses_count += 1;
    }

    // Import products (upsert logic)
    let mut products_count = 0;
    for product in cloud_products {
        let id = product.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let business_id = product.get("business_id").and_then(|v| v.as_i64()).unwrap_or(0);
        let name = product.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let description = product.get("description").and_then(|v| v.as_str());
        let category = product.get("category").and_then(|v| v.as_str()).unwrap_or("BAR");
        let price = product.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let cost_price = product.get("cost_price").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let stock_quantity = product.get("stock_quantity").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        let min_stock_level = product.get("min_stock_level").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        let fridge_stock = product.get("fridge_stock").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        let show_stock = product.get("show_stock").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        let store_stock = product.get("store_stock").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        let barcode = product.get("barcode").and_then(|v| v.as_str());
        let serial_number = product.get("serial_number").and_then(|v| v.as_str());
        let image_path = product.get("image_path").and_then(|v| v.as_str());
        let is_active = product.get("is_active").and_then(|v| v.as_bool()).unwrap_or(true);
        let created_at = product.get("created_at").and_then(|v| v.as_str()).unwrap_or("");

        let exists = db.conn.query_row(
            "SELECT COUNT(*) FROM products WHERE id = ?1",
            [id],
            |row: &rusqlite::Row| row.get::<_, i64>(0)
        ).unwrap_or(0) > 0;

        if exists {
            db.conn.execute(
                "UPDATE products SET business_id = ?1, name = ?2, description = ?3, category = ?4, price = ?5, cost_price = ?6, stock_quantity = ?7, min_stock_level = ?8, fridge_stock = ?9, show_stock = ?10, store_stock = ?11, barcode = ?12, serial_number = ?13, image_path = ?14, is_active = ?15, created_at = ?16 WHERE id = ?17",
                [&business_id.to_string(), name, description.unwrap_or(""), category, &price.to_string(), &cost_price.to_string(), &stock_quantity.to_string(), &min_stock_level.to_string(), &fridge_stock.to_string(), &show_stock.to_string(), &store_stock.to_string(), barcode.unwrap_or(""), serial_number.unwrap_or(""), image_path.unwrap_or(""), &(is_active as i64).to_string(), created_at, &id.to_string()]
            ).ok();
        } else {
            db.conn.execute(
                "INSERT INTO products (id, business_id, name, description, category, price, cost_price, stock_quantity, min_stock_level, fridge_stock, show_stock, store_stock, barcode, serial_number, image_path, is_active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                [&id.to_string(), &business_id.to_string(), name, description.unwrap_or(""), category, &price.to_string(), &cost_price.to_string(), &stock_quantity.to_string(), &min_stock_level.to_string(), &fridge_stock.to_string(), &show_stock.to_string(), &store_stock.to_string(), barcode.unwrap_or(""), serial_number.unwrap_or(""), image_path.unwrap_or(""), &(is_active as i64).to_string(), created_at]
            ).ok();
        }
        products_count += 1;
    }

    // Import sales (upsert logic)
    let mut sales_count = 0;
    for sale in cloud_sales {
        let id = sale.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let user_id = sale.get("user_id").and_then(|v| v.as_i64()).unwrap_or(0);
        let total_amount = sale.get("total_amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let payment_method = sale.get("payment_method").and_then(|v| v.as_str()).unwrap_or("CASH");
        let payment_status = sale.get("payment_status").and_then(|v| v.as_str()).unwrap_or("PENDING");
        let notes = sale.get("notes").and_then(|v| v.as_str());
        let created_at = sale.get("created_at").and_then(|v| v.as_str()).unwrap_or("");

        let exists = db.conn.query_row(
            "SELECT COUNT(*) FROM sales WHERE id = ?1",
            [id],
            |row: &rusqlite::Row| row.get::<_, i64>(0)
        ).unwrap_or(0) > 0;

        if exists {
            db.conn.execute(
                "UPDATE sales SET user_id = ?1, total_amount = ?2, payment_method = ?3, payment_status = ?4, notes = ?5, created_at = ?6 WHERE id = ?7",
                [&user_id.to_string(), &total_amount.to_string(), payment_method, payment_status, notes.unwrap_or(""), created_at, &id.to_string()]
            ).ok();
        } else {
            db.conn.execute(
                "INSERT INTO sales (id, user_id, total_amount, payment_method, payment_status, notes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                [&id.to_string(), &user_id.to_string(), &total_amount.to_string(), payment_method, payment_status, notes.unwrap_or(""), created_at]
            ).ok();
        }
        sales_count += 1;
    }

    // Import sale items (upsert logic)
    let mut sale_items_count = 0;
    for item in cloud_sale_items {
        let id = item.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let sale_id = item.get("sale_id").and_then(|v| v.as_i64()).unwrap_or(0);
        let product_id = item.get("product_id").and_then(|v| v.as_i64()).unwrap_or(0);
        let quantity = item.get("quantity").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        let unit_price = item.get("unit_price").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let total_price = item.get("total_price").and_then(|v| v.as_f64()).unwrap_or(0.0);

        let exists = db.conn.query_row(
            "SELECT COUNT(*) FROM sale_items WHERE id = ?1",
            [id],
            |row: &rusqlite::Row| row.get::<_, i64>(0)
        ).unwrap_or(0) > 0;

        if exists {
            db.conn.execute(
                "UPDATE sale_items SET sale_id = ?1, product_id = ?2, quantity = ?3, unit_price = ?4, total_price = ?5 WHERE id = ?6",
                [&sale_id.to_string(), &product_id.to_string(), &quantity.to_string(), &unit_price.to_string(), &total_price.to_string(), &id.to_string()]
            ).ok();
        } else {
            db.conn.execute(
                "INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, total_price) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                [&id.to_string(), &sale_id.to_string(), &product_id.to_string(), &quantity.to_string(), &unit_price.to_string(), &total_price.to_string()]
            ).ok();
        }
        sale_items_count += 1;
    }

    let sync_result = serde_json::json!({
        "status": "success",
        "message": "Data successfully synced from cloud",
        "downloaded": {
            "users": users_count,
            "businesses": businesses_count,
            "products": products_count,
            "sales": sales_count,
            "sale_items": sale_items_count
        },
        "last_sync": chrono::Utc::now().to_rfc3339()
    });

    println!("Successfully synced from cloud: {} users, {} businesses, {} products, {} sales, {} sale items",
             users_count, businesses_count, products_count, sales_count, sale_items_count);

    Ok(sync_result)
}

#[tauri::command]
async fn get_sync_status(_state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    // Check if Supabase is configured
    let supabase_url = get_supabase_url();
    let anon_key = get_supabase_anon_key();
    
    if supabase_url == "https://your-project.supabase.co" || anon_key.is_empty() {
        return Ok(serde_json::json!({
            "cloud_enabled": false,
            "last_sync": null,
            "pending_changes": 0,
            "status": "not_configured",
            "message": "Cloud sync not yet configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables or create a .env file in src-tauri directory."
        }));
    }

    // Test connection
    let client = SupabaseClient::new(&supabase_url, &anon_key);
    match client.test_connection().await {
        Ok(true) => {
            Ok(serde_json::json!({
                "cloud_enabled": true,
                "last_sync": null,
                "pending_changes": 0,
                "status": "online",
                "message": "Connected to Supabase"
            }))
        }
        Ok(false) | Err(_) => {
            Ok(serde_json::json!({
                "cloud_enabled": true,
                "last_sync": null,
                "pending_changes": 0,
                "status": "offline",
                "message": "Cannot connect to Supabase. Check your internet connection and credentials."
            }))
        }
    }
}

#[tauri::command]
async fn get_business_staff_count(state: State<'_, AppState>, business_id: i64) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    db.get_business_staff_count(business_id)
        .map_err(|e| format!("Failed to get staff count: {}", e))
}

#[tauri::command]
async fn check_business_exists(state: State<'_, AppState>, name: String, email: Option<String>) -> Result<bool, String> {
    let db = state.db.lock().unwrap();
    db.check_business_exists(&name, email.as_deref())
        .map_err(|e| format!("Failed to check business: {}", e))
}

#[tauri::command]
async fn remove_duplicate_businesses(state: State<'_, AppState>) -> Result<i32, String> {
    let db = state.db.lock().unwrap();
    db.remove_duplicate_businesses()
        .map_err(|e| format!("Failed to remove duplicates: {}", e))
}

#[tauri::command]
async fn delete_all_businesses(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.delete_all_businesses()
        .map_err(|e| format!("Failed to delete all businesses: {}", e))
}

#[tauri::command]
async fn get_business_admin_password(state: State<'_, AppState>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    // Handle both { request: { ... } } and { business_id: ... } patterns
    let data = if request.get("request").is_some() {
        request["request"].clone()
    } else {
        request.clone()
    };
    let business_id: i64 = serde_json::from_value(data["business_id"].clone())
        .or_else(|_| serde_json::from_value(data.clone()))
        .map_err(|e| format!("Invalid business_id: {}", e))?;
    db.get_business_admin_password(business_id)
        .map_err(|e| format!("Failed to get admin password: {}", e))
}

#[tauri::command]
async fn fix_users_without_business_id(state: State<'_, AppState>) -> Result<i32, String> {
    let db = state.db.lock().unwrap();
    db.fix_users_without_business_id()
        .map_err(|e| format!("Failed to fix users: {}", e))
}

#[tauri::command]
async fn fix_product_is_active_values(state: State<'_, AppState>) -> Result<i32, String> {
    let db = state.db.lock().unwrap();
    db.fix_product_is_active_values()
        .map_err(|e| format!("Failed to fix products: {}", e))
}

#[tauri::command]
async fn reset_business_admin_password(state: State<'_, AppState>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    // Handle both { request: { ... } } and direct parameters
    let data = if request.get("request").is_some() {
        request["request"].clone()
    } else {
        request.clone()
    };
    let business_id: i64 = serde_json::from_value(data["business_id"].clone())
        .map_err(|e| format!("Invalid business_id: {}", e))?;
    let password_hash: String = serde_json::from_value(data["password_hash"].clone())
        .map_err(|e| format!("Invalid password_hash: {}", e))?;
    let temporary_password: String = serde_json::from_value(data["temporary_password"].clone())
        .map_err(|e| format!("Invalid temporary_password: {}", e))?;

    db.reset_business_admin_password(business_id, &password_hash, &temporary_password)
        .map_err(|e| format!("Failed to reset admin password: {}", e))
}

#[tauri::command]
async fn save_product_image(
    image_data: String,
    product_name: String,
    business_id: i64
) -> Result<String, String> {
    // Get app data directory
    let app_data_dir = dirs::data_dir()
        .ok_or_else(|| "Failed to get app data directory".to_string())?
        .join("pos-system");

    // Create business-specific images directory
    let images_dir = app_data_dir.join("images").join(business_id.to_string());
    fs::create_dir_all(&images_dir)
        .map_err(|e| format!("Failed to create images directory: {}", e))?;

    // Generate filename from product name and timestamp
    let sanitized_name = product_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let timestamp = chrono::Utc::now().timestamp();
    let filename = format!("{}_{}.png", sanitized_name, timestamp);
    let file_path = images_dir.join(&filename);

    // Decode base64 image data
    let base64_data = image_data
        .strip_prefix("data:image/")
        .and_then(|s| s.find(',').map(|i| &s[i+1..]))
        .unwrap_or(&image_data);
    
    let image_bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    // Save image file
    fs::write(&file_path, image_bytes)
        .map_err(|e| format!("Failed to save image: {}", e))?;

    // Return relative path for storage in database
    Ok(format!("images/{}/{}", business_id, filename))
}

#[tauri::command]
async fn get_product_image(image_path: String) -> Result<Vec<u8>, String> {
    // Get app data directory
    let app_data_dir = dirs::data_dir()
        .ok_or_else(|| "Failed to get app data directory".to_string())?
        .join("pos-system");

    // Construct full path
    let full_path = app_data_dir.join(&image_path);
    
    // Read image file
    fs::read(&full_path)
        .map_err(|e| format!("Failed to read image: {}", e))
}

#[tauri::command]
async fn save_business_logo(
    image_data: String,
    business_id: i64,
) -> Result<String, String> {
    // Get app data directory
    let app_data_dir = dirs::data_dir()
        .ok_or_else(|| "Failed to get app data directory".to_string())?
        .join("pos-system");

    // Create business-specific logos directory
    let logos_dir = app_data_dir.join("logos").join(business_id.to_string());
    fs::create_dir_all(&logos_dir)
        .map_err(|e| format!("Failed to create logos directory: {}", e))?;

    // Generate filename with timestamp
    let timestamp = chrono::Utc::now().timestamp();
    let filename = format!("logo_{}.png", timestamp);
    let file_path = logos_dir.join(&filename);

    // Decode base64 image data
    let base64_data = image_data
        .strip_prefix("data:image/")
        .and_then(|s| s.find(',').map(|i| &s[i+1..]))
        .unwrap_or(&image_data);
    
    let image_bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    // Write image file
    fs::write(&file_path, image_bytes)
        .map_err(|e| format!("Failed to save logo: {}", e))?;

    // Return relative path for database storage
    let relative_path = format!("logos/{}/{}", business_id, filename);
    Ok(relative_path)
}

#[tauri::command]
async fn update_business_settings(state: State<'_, AppState>, request: serde_json::Value) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let business_id: i64 = serde_json::from_value(request["business_id"].clone())
        .map_err(|e| format!("Invalid business_id: {}", e))?;
    
    let name: Option<String> = request["name"].as_str().map(|s| s.trim().to_string());
    let address: Option<String> = request["address"].as_str().map(|s| s.trim().to_string());
    let phone: Option<String> = request["phone"].as_str().map(|s| s.trim().to_string());
    let email: Option<String> = request["email"].as_str().map(|s| s.trim().to_string());
    let primary_color: Option<String> = request["primary_color"].as_str().map(|s| s.to_string());
    let secondary_color: Option<String> = request["secondary_color"].as_str().map(|s| s.to_string());
    let logo_path: Option<String> = request["logo_path"].as_str().map(|s| s.to_string());

    db.update_business_settings(
        business_id,
        name.as_deref(),
        address.as_deref(),
        phone.as_deref(),
        email.as_deref(),
        primary_color.as_deref(),
        secondary_color.as_deref(),
        logo_path.as_deref(),
    )
    .map_err(|e| format!("Failed to update business settings: {}", e))
}

#[tauri::command]
async fn update_stock_type(
    state: State<'_, AppState>,
    product_id: i64,
    stock_type: String,
    quantity_change: i32,
    user_id: i64,
    reason: Option<String>
) -> Result<(), String> {
    let business_id = {
        let db = state.db.lock().unwrap();
        db.update_stock_type(product_id, &stock_type, quantity_change, user_id, reason.as_deref())
            .map_err(|e| format!("Failed to update stock: {}", e))?;
        
        // Get business_id before dropping the lock
        db.conn.query_row(
            "SELECT business_id FROM products WHERE id = ?1",
            [product_id],
            |row: &rusqlite::Row| row.get::<_, i64>(0),
        ).ok()
    };
    
    // Check if product is now low stock and send email notification
    if let Some(bid) = business_id {
        check_and_send_low_stock_email(state.db.clone(), product_id, bid).await;
    }
    
    Ok(())
}

#[tauri::command]
async fn transfer_stock(
    state: State<'_, AppState>,
    product_id: i64,
    from: String,
    to: String,
    quantity: i32,
    user_id: i64
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.transfer_stock(product_id, &from, &to, quantity, user_id)
        .map_err(|e| format!("Failed to transfer stock: {}", e))
}

#[tauri::command]
async fn find_product_by_code(
    state: State<'_, AppState>,
    code: String,
    business_id: i64
) -> Result<Option<Product>, String> {
    let db = state.db.lock().unwrap();
    db.find_product_by_code(&code, business_id)
        .map_err(|e| format!("Failed to find product: {}", e))
}

// Email configuration commands
#[tauri::command]
async fn save_email_config(
    state: State<'_, AppState>,
    request: serde_json::Value
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let business_id: i64 = serde_json::from_value(request["business_id"].clone())
        .map_err(|e| format!("Invalid business_id: {}", e))?;
    let smtp_server: String = serde_json::from_value(request["smtp_server"].clone())
        .unwrap_or_else(|_| "smtp.gmail.com".to_string());
    let smtp_port: i64 = request["smtp_port"].as_i64().unwrap_or(587);
    let username: String = serde_json::from_value(request["username"].clone())
        .map_err(|e| format!("Invalid username: {}", e))?;
    let password: String = serde_json::from_value(request["password"].clone())
        .map_err(|e| format!("Invalid password: {}", e))?;
    let from_email: String = serde_json::from_value(request["from_email"].clone())
        .unwrap_or_else(|_| username.clone());
    let from_name: String = serde_json::from_value(request["from_name"].clone())
        .unwrap_or_else(|_| "POS System".to_string());
    let use_tls: bool = request["use_tls"].as_bool().unwrap_or(true);
    let enabled: bool = request["enabled"].as_bool().unwrap_or(true);
    let notification_roles: String = serde_json::from_value(request["notification_roles"].clone())
        .unwrap_or_else(|_| "SuperAdmin,Manager".to_string());
    let low_stock_enabled: bool = request["low_stock_enabled"].as_bool().unwrap_or(true);
    let pending_sales_enabled: bool = request["pending_sales_enabled"].as_bool().unwrap_or(true);
    let daily_reports_enabled: bool = request["daily_reports_enabled"].as_bool().unwrap_or(false);

    // Check if config exists
    let exists: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM email_config WHERE business_id = ?1",
        [business_id],
        |row: &rusqlite::Row| row.get(0),
    ).unwrap_or(0);

    if exists > 0 {
        // Update existing config
        db.conn.execute(
            "UPDATE email_config SET smtp_server = ?1, smtp_port = ?2, username = ?3, password = ?4, from_email = ?5, from_name = ?6, use_tls = ?7, enabled = ?8, notification_roles = ?9, low_stock_enabled = ?10, pending_sales_enabled = ?11, daily_reports_enabled = ?12, updated_at = CURRENT_TIMESTAMP WHERE business_id = ?13",
            [
                &smtp_server,
                &smtp_port.to_string(),
                &username,
                &password,
                &from_email,
                &from_name,
                &(use_tls as i64).to_string(),
                &(enabled as i64).to_string(),
                &notification_roles,
                &(low_stock_enabled as i64).to_string(),
                &(pending_sales_enabled as i64).to_string(),
                &(daily_reports_enabled as i64).to_string(),
                &business_id.to_string(),
            ],
        ).map_err(|e| format!("Failed to update email config: {}", e))?;
    } else {
        // Insert new config
        db.conn.execute(
            "INSERT INTO email_config (business_id, smtp_server, smtp_port, username, password, from_email, from_name, use_tls, enabled, notification_roles, low_stock_enabled, pending_sales_enabled, daily_reports_enabled) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            [
                &business_id.to_string(),
                &smtp_server,
                &smtp_port.to_string(),
                &username,
                &password,
                &from_email,
                &from_name,
                &(use_tls as i64).to_string(),
                &(enabled as i64).to_string(),
                &notification_roles,
                &(low_stock_enabled as i64).to_string(),
                &(pending_sales_enabled as i64).to_string(),
                &(daily_reports_enabled as i64).to_string(),
            ],
        ).map_err(|e| format!("Failed to save email config: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn get_email_config(
    state: State<'_, AppState>,
    business_id: i64
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    
    let result = db.conn.query_row(
        "SELECT smtp_server, smtp_port, username, from_email, from_name, use_tls, enabled, COALESCE(notification_roles, 'SuperAdmin,Manager'), COALESCE(low_stock_enabled, 1), COALESCE(pending_sales_enabled, 1), COALESCE(daily_reports_enabled, 0) FROM email_config WHERE business_id = ?1",
        [business_id],
        |row: &rusqlite::Row| {
            Ok(serde_json::json!({
                "smtp_server": row.get::<_, String>(0)?,
                "smtp_port": row.get::<_, i64>(1)?,
                "username": row.get::<_, String>(2)?,
                "from_email": row.get::<_, String>(3)?,
                "from_name": row.get::<_, String>(4)?,
                "use_tls": row.get::<_, i64>(5)? != 0,
                "enabled": row.get::<_, i64>(6)? != 0,
                "notification_roles": row.get::<_, String>(7)?,
                "low_stock_enabled": row.get::<_, i64>(8)? != 0,
                "pending_sales_enabled": row.get::<_, i64>(9)? != 0,
            }))
        },
    );

    match result {
        Ok(config) => Ok(config),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // Return default config if not found
            Ok(serde_json::json!({
                "smtp_server": "smtp.gmail.com",
                "smtp_port": 587,
                "username": "",
                "from_email": "",
                "from_name": "POS System",
                "use_tls": true,
                "enabled": false,
                "notification_roles": "SuperAdmin,Manager",
                "low_stock_enabled": true,
                "pending_sales_enabled": true,
                "daily_reports_enabled": false,
            }))
        }
        Err(e) => Err(format!("Failed to get email config: {}", e)),
    }
}

#[tauri::command]
async fn send_test_email(
    state: State<'_, AppState>,
    request: serde_json::Value
) -> Result<(), String> {
    let business_id: i64 = serde_json::from_value(request["business_id"].clone())
        .map_err(|e| format!("Invalid business_id: {}", e))?;
    let to_email: String = serde_json::from_value(request["to_email"].clone())
        .map_err(|e| format!("Invalid email: {}", e))?;

    let config = {
        let db = state.db.lock().unwrap();
        let config_result = db.conn.query_row(
            "SELECT smtp_server, smtp_port, username, password, from_email, from_name, use_tls FROM email_config WHERE business_id = ?1 AND enabled = 1",
            [business_id],
            |row: &rusqlite::Row| {
                Ok(EmailConfig {
                    smtp_server: row.get(0)?,
                    smtp_port: row.get::<_, i64>(1)? as u16,
                    username: row.get(2)?,
                    password: row.get(3)?,
                    from_email: row.get(4)?,
                    from_name: row.get(5)?,
                    use_tls: row.get::<_, i64>(6)? != 0,
                })
            },
        );

        match config_result {
            Ok(c) => c,
            Err(_) => return Err("Email not configured for this business".to_string()),
        }
    };

    let email_service = EmailService::new(config);
    email_service
        .send_email(
            &to_email,
            "Test Email from POS System",
            "This is a test email to verify your email configuration is working correctly.",
            false,
        )
        .await
        .map_err(|e| format!("Failed to send test email: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn send_low_stock_email(
    state: State<'_, AppState>,
    business_id: i64,
    product_name: String,
    current_stock: i32,
    min_stock: i32,
    to_email: String,
) -> Result<(), String> {
    let config = {
        let db = state.db.lock().unwrap();
        let config_result = db.conn.query_row(
            "SELECT smtp_server, smtp_port, username, password, from_email, from_name, use_tls FROM email_config WHERE business_id = ?1 AND enabled = 1",
            [business_id],
            |row: &rusqlite::Row| {
                Ok(EmailConfig {
                    smtp_server: row.get(0)?,
                    smtp_port: row.get::<_, i64>(1)? as u16,
                    username: row.get(2)?,
                    password: row.get(3)?,
                    from_email: row.get(4)?,
                    from_name: row.get(5)?,
                    use_tls: row.get::<_, i64>(6)? != 0,
                })
            },
        );

        match config_result {
            Ok(c) => c,
            Err(_) => return Err("Email not configured for this business".to_string()),
        }
    };

    let email_service = EmailService::new(config);
    email_service
        .send_low_stock_alert(&to_email, &product_name, current_stock, min_stock)
        .await
        .map_err(|e| format!("Failed to send email: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_pending_items_summary(
    state: State<'_, AppState>,
    business_id: i64
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    db.get_pending_items_summary(business_id)
        .map_err(|e| format!("Failed to get pending items summary: {}", e))
}

#[tauri::command]
async fn get_pending_sales(
    state: State<'_, AppState>,
    business_id: i64
) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    db.get_pending_sales(business_id)
        .map_err(|e| format!("Failed to get pending sales: {}", e))
}

#[tauri::command]
async fn get_order_history(
    state: State<'_, AppState>,
    business_id: i64,
    start_date: Option<String>,
    end_date: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    db.get_order_history(
        business_id,
        start_date.as_deref(),
        end_date.as_deref(),
        limit,
    )
    .map_err(|e| format!("Failed to get order history: {}", e))
}

#[tauri::command]
async fn get_sale_items(
    state: State<'_, AppState>,
    sale_id: i64
) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    db.get_sale_items(sale_id)
        .map_err(|e| format!("Failed to get sale items: {}", e))
}

#[tauri::command]
async fn get_low_stock_products_for_business(
    state: State<'_, AppState>,
    business_id: i64
) -> Result<Vec<Product>, String> {
    let db = state.db.lock().unwrap();
    db.get_low_stock_products_for_business(business_id)
        .map_err(|e| format!("Failed to get low stock products: {}", e))
}

#[tauri::command]
async fn get_out_of_stock_products_for_business(
    state: State<'_, AppState>,
    business_id: i64
) -> Result<Vec<Product>, String> {
    let db = state.db.lock().unwrap();
    db.get_out_of_stock_products_for_business(business_id)
        .map_err(|e| format!("Failed to get out of stock products: {}", e))
}

#[tauri::command]
async fn mark_sale_as_completed(
    state: State<'_, AppState>,
    sale_id: i64
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.mark_sale_as_completed(sale_id)
        .map_err(|e| format!("Failed to mark sale as completed: {}", e))
}

#[tauri::command]
async fn get_sales_report(
    state: State<'_, AppState>,
    business_id: i64,
    start_date: String,
    end_date: String
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    db.get_sales_report(business_id, &start_date, &end_date)
        .map_err(|e| format!("Failed to get sales report: {}", e))
}

#[tauri::command]
async fn get_top_products(
    state: State<'_, AppState>,
    business_id: i64,
    start_date: String,
    end_date: String,
    limit: i64
) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    db.get_top_products(business_id, &start_date, &end_date, limit)
        .map_err(|e| format!("Failed to get top products: {}", e))
}

#[tauri::command]
async fn get_staff_performance(
    state: State<'_, AppState>,
    business_id: i64,
    start_date: String,
    end_date: String
) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    db.get_staff_performance(business_id, &start_date, &end_date)
        .map_err(|e| format!("Failed to get staff performance: {}", e))
}

#[tauri::command]
async fn get_kitchen_orders(
    state: State<'_, AppState>,
    business_id: i64,
    status: Option<String>
) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    db.get_kitchen_orders(business_id, status.as_deref())
        .map_err(|e| format!("Failed to get kitchen orders: {}", e))
}

#[tauri::command]
async fn update_kitchen_order_status(
    state: State<'_, AppState>,
    order_id: i64,
    status: String,
    prepared_by: Option<i64>
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.update_kitchen_order_status(order_id, &status, prepared_by)
        .map_err(|e| format!("Failed to update kitchen order status: {}", e))
}

#[tauri::command]
async fn get_pending_kitchen_orders_count(
    state: State<'_, AppState>,
    business_id: i64
) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    db.get_pending_kitchen_orders_count(business_id)
        .map_err(|e| format!("Failed to get pending kitchen orders count: {}", e))
}

#[tauri::command]
async fn get_revenue_analytics(
    state: State<'_, AppState>,
    business_id: i64
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    db.get_revenue_analytics(business_id)
        .map_err(|e| format!("Failed to get revenue analytics: {}", e))
}

#[tauri::command]
async fn get_report_permissions(
    state: State<'_, AppState>,
    business_id: i64
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    db.get_report_permissions(business_id)
        .map_err(|e| format!("Failed to get report permissions: {}", e))
}

#[tauri::command]
async fn save_report_permissions(
    state: State<'_, AppState>,
    business_id: i64,
    manager_can_view: bool,
    secretary_can_view: bool,
    staff_can_view: bool
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.save_report_permissions(business_id, manager_can_view, secretary_can_view, staff_can_view)
        .map_err(|e| format!("Failed to save report permissions: {}", e))
}

#[tauri::command]
async fn can_user_view_reports(
    state: State<'_, AppState>,
    business_id: i64,
    user_role: String
) -> Result<bool, String> {
    let db = state.db.lock().unwrap();
    db.can_user_view_reports(business_id, &user_role)
        .map_err(|e| format!("Failed to check report permissions: {}", e))
}

#[tauri::command]
async fn get_inventory_movements(
    state: State<'_, AppState>,
    business_id: i64,
    start_date: String,
    end_date: String
) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    db.get_inventory_movements(business_id, &start_date, &end_date)
        .map_err(|e| format!("Failed to get inventory movements: {}", e))
}

#[tauri::command]
async fn get_inventory_transfers(
    state: State<'_, AppState>,
    business_id: i64,
    start_date: String,
    end_date: String
) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    db.get_inventory_transfers(business_id, &start_date, &end_date)
        .map_err(|e| format!("Failed to get inventory transfers: {}", e))
}

#[tauri::command]
async fn get_inventory_adjustments(
    state: State<'_, AppState>,
    business_id: i64,
    start_date: String,
    end_date: String
) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    db.get_inventory_adjustments(business_id, &start_date, &end_date)
        .map_err(|e| format!("Failed to get inventory adjustments: {}", e))
}

#[tauri::command]
async fn get_inventory_summary(
    state: State<'_, AppState>,
    business_id: i64
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    db.get_inventory_summary(business_id)
        .map_err(|e| format!("Failed to get inventory summary: {}", e))
}

#[tauri::command]
async fn send_pending_sales_email(
    state: State<'_, AppState>,
    business_id: i64,
    to_email: String,
) -> Result<(), String> {
    let (pending_sales, config) = {
        let db = state.db.lock().unwrap();
        
        // Get pending sales
        let pending_sales = db.get_pending_sales(business_id)
            .map_err(|e| format!("Failed to get pending sales: {}", e))?;

        if pending_sales.is_empty() {
            return Ok(()); // No pending sales to notify about
        }

        // Get email config
        let config_result = db.conn.query_row(
            "SELECT smtp_server, smtp_port, username, password, from_email, from_name, use_tls FROM email_config WHERE business_id = ?1 AND enabled = 1",
            [business_id],
            |row: &rusqlite::Row| {
                Ok(EmailConfig {
                    smtp_server: row.get(0)?,
                    smtp_port: row.get::<_, i64>(1)? as u16,
                    username: row.get(2)?,
                    password: row.get(3)?,
                    from_email: row.get(4)?,
                    from_name: row.get(5)?,
                    use_tls: row.get::<_, i64>(6)? != 0,
                })
            },
        );

        let config = match config_result {
            Ok(c) => c,
            Err(_) => return Err("Email not configured for this business".to_string()),
        };

        (pending_sales, config)
    };

    let email_service = EmailService::new(config);
    
    // Send notification for each pending sale
    for sale in pending_sales {
        let sale_id = sale["id"].as_i64().unwrap_or(0);
        let total_amount = sale["total_amount"].as_f64().unwrap_or(0.0);
        let item_count = sale["item_count"].as_i64().unwrap_or(0);
        let created_at = sale["created_at"].as_str().unwrap_or("");

        email_service
            .send_pending_sale_notification(&to_email, sale_id, total_amount, item_count, created_at)
            .await
            .map_err(|e| format!("Failed to send email for sale #{}: {}", sale_id, e))?;
    }

    Ok(())
}

// Helper function to send daily sales report
async fn send_daily_sales_report_helper(
    db: Arc<Mutex<Database>>,
    business_id: i64,
    date: &str,
) -> Result<(), String> {
    // Extract all needed data before any await points
    let email_data: Option<(EmailConfig, Vec<String>, f64, i64, Vec<(String, i64)>)> = {
        let db = db.lock().unwrap();
        // Get email config
        let config_result = db.conn.query_row(
            "SELECT smtp_server, smtp_port, username, password, from_email, from_name, use_tls FROM email_config WHERE business_id = ?1 AND enabled = 1",
            [business_id],
            |row: &rusqlite::Row| {
                Ok(EmailConfig {
                    smtp_server: row.get(0)?,
                    smtp_port: row.get::<_, i64>(1)? as u16,
                    username: row.get(2)?,
                    password: row.get(3)?,
                    from_email: row.get(4)?,
                    from_name: row.get(5)?,
                    use_tls: row.get::<_, i64>(6)? != 0,
                })
            },
        );

        if let Ok(config) = config_result {
            // Check if daily reports are enabled
            let daily_reports_enabled: i64 = db.conn.query_row(
                "SELECT COALESCE(daily_reports_enabled, 0) FROM email_config WHERE business_id = ?1 AND enabled = 1",
                [business_id],
                |row: &rusqlite::Row| row.get(0),
            ).unwrap_or(0);
            
            if daily_reports_enabled != 0 {
                // Get today's sales summary
                let (total_sales, transaction_count, top_products) = db.get_today_sales_summary(business_id, date)
                    .map_err(|e| format!("Failed to get today's sales summary: {}", e))?;

                // Get notification emails
                if let Ok(emails) = db.get_business_notification_emails(business_id) {
                    Some((config, emails, total_sales, transaction_count, top_products))
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    if let Some((config, emails, total_sales, transaction_count, top_products)) = email_data {
        let email_service = EmailService::new(config);
        
        for email in emails {
            let _ = email_service
                .send_daily_sales_report(&email, date, total_sales, transaction_count, top_products.clone())
                .await;
        }
    }

    Ok(())
}

#[tauri::command]
async fn send_daily_sales_report(
    state: State<'_, AppState>,
    business_id: i64,
    date: Option<String>,
) -> Result<(), String> {
    let report_date = date.unwrap_or_else(|| {
        chrono::Utc::now().format("%Y-%m-%d").to_string()
    });
    
    send_daily_sales_report_helper(state.db.clone(), business_id, &report_date).await
}

// Helper function to send new user registration notification
async fn send_new_user_registration_helper(
    db: Arc<Mutex<Database>>,
    business_id: i64,
    new_user_name: &str,
    new_user_email: &str,
    new_user_role: &str,
) -> Result<(), String> {
    // Extract all needed data before any await points
    let email_data: Option<(EmailConfig, Vec<String>, String)> = {
        let db = db.lock().unwrap();
        // Get business name
        let business_name: String = db.conn.query_row(
            "SELECT name FROM businesses WHERE id = ?1",
            [business_id],
            |row: &rusqlite::Row| row.get(0),
        ).unwrap_or_else(|_| "Unknown Business".to_string());

        // Get email config
        let config_result = db.conn.query_row(
            "SELECT smtp_server, smtp_port, username, password, from_email, from_name, use_tls FROM email_config WHERE business_id = ?1 AND enabled = 1",
            [business_id],
            |row: &rusqlite::Row| {
                Ok(EmailConfig {
                    smtp_server: row.get(0)?,
                    smtp_port: row.get::<_, i64>(1)? as u16,
                    username: row.get(2)?,
                    password: row.get(3)?,
                    from_email: row.get(4)?,
                    from_name: row.get(5)?,
                    use_tls: row.get::<_, i64>(6)? != 0,
                })
            },
        );

        if let Ok(config) = config_result {
            // Get notification emails (admins/managers)
            if let Ok(emails) = db.get_business_notification_emails(business_id) {
                Some((config, emails, business_name))
            } else {
                None
            }
        } else {
            None
        }
    };

    if let Some((config, emails, business_name)) = email_data {
        let email_service = EmailService::new(config);
        
        for email in emails {
            let _ = email_service
                .send_new_user_registration_notification(&email, new_user_name, new_user_email, new_user_role, &business_name)
                .await;
        }
    }

    Ok(())
}

#[tauri::command]
async fn send_new_user_notification(
    state: State<'_, AppState>,
    business_id: i64,
    new_user_name: String,
    new_user_email: String,
    new_user_role: String,
) -> Result<(), String> {
    send_new_user_registration_helper(state.db.clone(), business_id, &new_user_name, &new_user_email, &new_user_role).await
}

#[tauri::command]
async fn request_password_reset(
    state: State<'_, AppState>,
    email: String,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    
    // Get user by email
    let (user_id, user_name): (i64, String) = db.get_user_by_email(&email)
        .map_err(|_| "User with this email not found".to_string())?;
    
    // Get user's business_id if available
    let business_id: Option<i64> = db.conn.query_row(
        "SELECT business_id FROM users WHERE id = ?1",
        [user_id],
        |row: &rusqlite::Row| row.get(0),
    ).ok();
    
    // Generate random token
    let token = format!("{:x}", rand::thread_rng().gen::<u128>());
    
    // Create reset token in database
    db.create_password_reset_token(user_id, &token)
        .map_err(|e| format!("Failed to create reset token: {}", e))?;
    
    // Send email if business has email configured
    if let Some(bid) = business_id {
        let config_result = db.conn.query_row(
            "SELECT smtp_server, smtp_port, username, password, from_email, from_name, use_tls FROM email_config WHERE business_id = ?1 AND enabled = 1",
            [bid],
            |row: &rusqlite::Row| {
                Ok(EmailConfig {
                    smtp_server: row.get(0)?,
                    smtp_port: row.get::<_, i64>(1)? as u16,
                    username: row.get(2)?,
                    password: row.get(3)?,
                    from_email: row.get(4)?,
                    from_name: row.get(5)?,
                    use_tls: row.get::<_, i64>(6)? != 0,
                })
            },
        );
        
        if let Ok(config) = config_result {
            let email_service = EmailService::new(config);
            let _db_arc = state.db.clone();
            let email_clone = email.clone();
            let user_name_clone = user_name.clone();
            let token_clone = token.clone();
            
            tokio::spawn(async move {
                let _ = email_service
                    .send_password_reset_email(&email_clone, &user_name_clone, &token_clone, None)
                    .await;
            });
        }
    }
    
    Ok(())
}

#[tauri::command]
async fn reset_password_with_token(
    state: State<'_, AppState>,
    token: String,
    new_password_hash: String,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    
    // Verify token and get user_id
    let user_id = db.verify_and_use_reset_token(&token)
        .map_err(|_| "Invalid or expired reset token".to_string())?;
    
    // Change password
    db.change_password(user_id, &new_password_hash)
        .map_err(|e| format!("Failed to change password: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn export_database_backup(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db = state.db.lock().unwrap();
    let backup_data = db.export_all_data()
        .map_err(|e| format!("Failed to export database: {}", e))?;
    
    // Convert to JSON string
    serde_json::to_string_pretty(&backup_data)
        .map_err(|e| format!("Failed to serialize backup: {}", e))
}

#[tauri::command]
async fn import_database_backup(
    state: State<'_, AppState>,
    backup_json: String,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    
    // Parse JSON
    let backup_data: serde_json::Value = serde_json::from_str(&backup_json)
        .map_err(|e| format!("Invalid backup file format: {}", e))?;
    
    // Restore from backup
    db.restore_from_backup(&backup_data)
        .map_err(|e| format!("Failed to restore database: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn get_system_revenue_summary(
    state: State<'_, AppState>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();
    db.get_system_revenue_summary(start_date.as_deref(), end_date.as_deref())
        .map_err(|e| format!("Failed to get system revenue summary: {}", e))
}


