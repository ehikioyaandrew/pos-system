mod database;

use database::*;
use std::sync::Mutex;
use std::fs;
use base64::{Engine as _, engine::general_purpose};
use tauri::State;

// Cloud sync configuration (to be filled with actual Supabase credentials)
const SUPABASE_URL: &str = "https://your-project.supabase.co";
const SUPABASE_ANON_KEY: &str = "your-anon-key";
const SUPABASE_SERVICE_ROLE_KEY: &str = "your-service-role-key";

pub struct AppState {
    db: Mutex<Database>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join("pos-system");

    std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");

    let db_path = app_data_dir.join("pos.db");
    let db = Database::new(&db_path).expect("Failed to initialize database");

    tauri::Builder::default()
        .manage(AppState {
            db: Mutex::new(db),
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
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
            get_business_admin_password,
            reset_business_admin_password,
            fix_users_without_business_id,
            fix_product_is_active_values,
            save_product_image,
            get_product_image,
            check_for_updates,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
    let user_id = db.create_user(&username, &password_hash, &role, name.as_deref(), email.as_deref(), business_id, temporary_password.as_deref())
        .map_err(|e| format!("Failed to create user: {}", e))?;
    println!("User created successfully with ID: {}", user_id);
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
    let barcode: Option<String> = request["barcode"].as_str().map(|s| s.to_string());
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
        barcode,
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

#[tauri::command]
async fn get_sales_report(
    state: State<'_, AppState>,
    start_date: String,
    end_date: String
) -> Result<Vec<SaleReport>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.conn.prepare(
        "SELECT s.id, s.total_amount, s.payment_method, s.created_at, u.name as user_name,
                COUNT(si.id) as item_count
         FROM sales s
         JOIN users u ON s.user_id = u.id
         LEFT JOIN sale_items si ON s.sale_id = si.sale_id
         WHERE s.created_at BETWEEN ?1 AND ?2
         GROUP BY s.id
         ORDER BY s.created_at DESC"
    ).map_err(|e| format!("Failed to prepare statement: {}", e))?;

    let report_iter = stmt.query_map([start_date, end_date], |row: &rusqlite::Row| {
        Ok(SaleReport {
            id: row.get(0)?,
            total_amount: row.get(1)?,
            payment_method: row.get(2)?,
            created_at: row.get(3)?,
            user_name: row.get(4)?,
            item_count: row.get(5)?,
        })
    }).map_err(|e| format!("Failed to query sales: {}", e))?;

    report_iter.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect results: {}", e))
}

#[derive(serde::Serialize)]
struct SaleReport {
    id: i64,
    total_amount: f64,
    payment_method: String,
    created_at: String,
    user_name: String,
    item_count: i64,
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
}

#[tauri::command]
async fn process_sale(
    state: State<'_, AppState>,
    request: ProcessSaleRequest
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().unwrap();

    // Calculate total amount
    let mut total_amount = 0.0;
    let items_count = request.items.len();
    for item in &request.items {
        total_amount += item.unit_price * item.quantity as f64;
    }

    // Create sale
    let sale_id = db.create_sale(request.staff_id, total_amount, &request.payment_method)
        .map_err(|e| format!("Failed to create sale: {}", e))?;

    // Add sale items and update inventory
    for item in request.items {
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
        db.update_stock(item.product_id, -(item.quantity as i32), "SALE", request.staff_id, Some("Sale transaction"))
            .map_err(|e| format!("Failed to update stock: {}", e))?;
    }

    // Return sale information
    Ok(serde_json::json!({
        "sale_id": sale_id,
        "total_amount": total_amount,
        "payment_method": request.payment_method,
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
    let db = state.db.lock().unwrap();

    // Get all data for sync
    let users = db.get_all_users().map_err(|e| format!("Failed to get users: {}", e))?;
    let businesses = db.get_businesses().map_err(|e| format!("Failed to get businesses: {}", e))?;
    let products = db.get_all_products().map_err(|e| format!("Failed to get products: {}", e))?;
    let sales = db.get_all_sales().map_err(|e| format!("Failed to get sales: {}", e))?;

    // TODO: Implement actual Supabase sync
    // For now, just return sync statistics
    let sync_data = serde_json::json!({
        "users_count": users.len(),
        "businesses_count": businesses.len(),
        "products_count": products.len(),
        "sales_count": sales.len(),
        "status": "success",
        "message": "Data prepared for cloud sync (Supabase integration pending)",
        "last_sync": chrono::Utc::now().to_rfc3339()
    });

    println!("Prepared data for cloud sync: {} users, {} businesses, {} products, {} sales",
             users.len(), businesses.len(), products.len(), sales.len());

    Ok(sync_data)
}

#[tauri::command]
async fn sync_from_cloud(_state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    // TODO: Implement actual Supabase sync
    // For now, return mock response
    let sync_result = serde_json::json!({
        "status": "success",
        "message": "Cloud sync download (Supabase integration pending)",
        "downloaded": {
            "users": 0,
            "businesses": 0,
            "products": 0,
            "sales": 0
        },
        "last_sync": chrono::Utc::now().to_rfc3339()
    });

    println!("Cloud sync download completed (mock)");
    Ok(sync_result)
}

#[tauri::command]
async fn get_sync_status(_state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    // TODO: Check actual sync status with Supabase
    Ok(serde_json::json!({
        "cloud_enabled": false,
        "last_sync": null,
        "pending_changes": 0,
        "status": "offline",
        "message": "Cloud sync not yet configured (Supabase integration pending)"
    }))
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
async fn check_for_updates(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_updater::UpdaterBuilder;
    
    match UpdaterBuilder::new().app_handle(app.clone()).build().await {
        Ok(updater) => {
            match updater.check().await {
                Ok(update) => {
                    if let Some(update) = update {
                        Ok(serde_json::json!({
                            "available": true,
                            "version": update.version,
                            "date": update.date,
                            "body": update.body,
                            "current_version": app.package_info().version.to_string()
                        }))
                    } else {
                        Ok(serde_json::json!({
                            "available": false,
                            "current_version": app.package_info().version.to_string()
                        }))
                    }
                }
                Err(e) => Err(format!("Failed to check for updates: {}", e))
            }
        }
        Err(e) => Err(format!("Failed to initialize updater: {}", e))
    }
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_updater::UpdaterBuilder;
    
    match UpdaterBuilder::new().app_handle(app.clone()).build().await {
        Ok(updater) => {
            match updater.check().await {
                Ok(Some(update)) => {
                    match update.download_and_install(
                        |chunk_length, content_length| {
                            println!("Downloaded {} of {} bytes", chunk_length, content_length.unwrap_or(0));
                        },
                        || {
                            println!("Download finished, installing...");
                        }
                    ).await {
                        Ok(_) => {
                            // Restart the app after installation
                            app.restart();
                            Ok(serde_json::json!({
                                "success": true,
                                "message": "Update installed successfully. The application will restart."
                            }))
                        }
                        Err(e) => Err(format!("Failed to install update: {}", e))
                    }
                }
                Ok(None) => Err("No update available".to_string()),
                Err(e) => Err(format!("Failed to check for updates: {}", e))
            }
        }
        Err(e) => Err(format!("Failed to initialize updater: {}", e))
    }
}

