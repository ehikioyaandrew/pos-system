//! Offline POS helpers on top of the local SQLite database.
use crate::database::Database;
use rusqlite::{params, Result};
use serde_json::Value;

impl Database {
    /// Schema pieces required for offline supermarket POS (debt, staff price, audit, categories).
    pub fn migrate_offline_schema(&self) -> Result<()> {
        let _ = self.conn.execute(
            "ALTER TABLE products ADD COLUMN staff_price REAL DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE products ADD COLUMN sports_stock INTEGER DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE products ADD COLUMN packaging TEXT",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE sales ADD COLUMN business_id INTEGER",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE sales ADD COLUMN synced_at TEXT",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE sales ADD COLUMN location TEXT",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE sale_items ADD COLUMN synced_at TEXT",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE users ADD COLUMN is_hidden INTEGER DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE users ADD COLUMN last_login TEXT",
            [],
        );

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS customer_debts (
                id INTEGER PRIMARY KEY,
                business_id INTEGER NOT NULL,
                customer_name TEXT NOT NULL,
                customer_key TEXT NOT NULL,
                total_charged REAL NOT NULL DEFAULT 0,
                total_paid REAL NOT NULL DEFAULT 0,
                balance REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'OPEN',
                created_at TEXT,
                updated_at TEXT,
                UNIQUE(business_id, customer_key)
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS debt_entries (
                id INTEGER PRIMARY KEY,
                debt_id INTEGER NOT NULL,
                business_id INTEGER NOT NULL,
                entry_type TEXT NOT NULL,
                amount REAL NOT NULL,
                sale_id INTEGER,
                note TEXT,
                created_by INTEGER,
                created_at TEXT,
                FOREIGN KEY (debt_id) REFERENCES customer_debts(id)
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY,
                business_id INTEGER NOT NULL,
                actor_user_id INTEGER,
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id TEXT,
                summary TEXT,
                before_json TEXT,
                after_json TEXT,
                created_at TEXT,
                synced_at TEXT
            )",
            [],
        )?;
        let _ = self.conn.execute(
            "ALTER TABLE activity_logs ADD COLUMN synced_at TEXT",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE customer_debts ADD COLUMN synced_at TEXT",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE debt_entries ADD COLUMN entry_date TEXT",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE debt_entries ADD COLUMN synced_at TEXT",
            [],
        );

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS product_categories (
                id INTEGER PRIMARY KEY,
                business_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS sync_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            )",
            [],
        )?;

        Ok(())
    }

    pub fn create_sale_full(
        &self,
        sale_id: i64,
        user_id: i64,
        business_id: i64,
        total_amount: f64,
        payment_method: &str,
        payment_status: &str,
        notes: Option<&str>,
        created_at: &str,
        location: Option<&str>,
    ) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO sales (id, user_id, business_id, total_amount, payment_method, payment_status, notes, created_at, location)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                sale_id,
                user_id,
                business_id,
                total_amount,
                payment_method,
                payment_status,
                notes.unwrap_or(""),
                created_at,
                location.unwrap_or("fridge")
            ],
        )?;
        Ok(sale_id)
    }

    pub fn get_stock_for_location(&self, product_id: i64, location: &str) -> Result<(String, i32)> {
        let (name, fridge, show, sports) = self.conn.query_row(
            "SELECT name,
                    COALESCE(fridge_stock, 0),
                    COALESCE(show_stock, 0),
                    COALESCE(sports_stock, 0)
             FROM products WHERE id = ?1",
            [product_id],
            |row| Ok((row.get::<_, String>(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        let available = match location {
            "show" => show,
            "sports" => sports,
            _ => fridge,
        };
        Ok((name, available))
    }

    pub fn get_sales_log(
        &self,
        business_id: i64,
        staff_id: Option<i64>,
        date_from: Option<&str>,
        date_to: Option<&str>,
    ) -> Result<Vec<Value>> {
        let from = date_from.filter(|s| !s.is_empty()).unwrap_or("1970-01-01");
        let to = date_to.filter(|s| !s.is_empty()).unwrap_or("9999-12-31");
        let staff = staff_id.unwrap_or(-1);

        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.user_id, s.total_amount, s.payment_method, s.payment_status,
                    s.notes, s.created_at,
                    COALESCE(u.name, u.username, '') as staff_name,
                    COALESCE(s.location, 'fridge') as location
             FROM sales s
             LEFT JOIN users u ON u.id = s.user_id
             WHERE (s.business_id = ?1 OR (s.business_id IS NULL AND u.business_id = ?1))
               AND (?2 < 0 OR s.user_id = ?2)
               AND date(s.created_at) >= date(?3)
               AND date(s.created_at) <= date(?4)
               AND UPPER(COALESCE(s.payment_status, '')) != 'CANCELLED'
             ORDER BY s.created_at DESC
             LIMIT 500",
        )?;

        let rows = stmt.query_map(params![business_id, staff, from, to], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "user_id": row.get::<_, i64>(1)?,
                "total_amount": row.get::<_, f64>(2)?,
                "payment_method": row.get::<_, String>(3)?,
                "payment_status": row.get::<_, String>(4)?,
                "notes": row.get::<_, Option<String>>(5)?,
                "created_at": row.get::<_, String>(6)?,
                "staff_name": row.get::<_, String>(7)?,
                "location": row.get::<_, String>(8)?,
            }))
        })?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get_sale_receipt(&self, sale_id: i64, business_id: Option<i64>) -> Result<Value> {
        let sale = self.conn.query_row(
            "SELECT s.id, s.user_id, s.total_amount, s.payment_method, s.payment_status,
                    s.notes, s.created_at, COALESCE(u.name, u.username, '') as staff_name,
                    s.business_id, COALESCE(s.location, 'fridge')
             FROM sales s
             LEFT JOIN users u ON u.id = s.user_id
             WHERE s.id = ?1",
            [sale_id],
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "user_id": row.get::<_, i64>(1)?,
                    "total_amount": row.get::<_, f64>(2)?,
                    "payment_method": row.get::<_, String>(3)?,
                    "payment_status": row.get::<_, String>(4)?,
                    "notes": row.get::<_, Option<String>>(5)?,
                    "created_at": row.get::<_, String>(6)?,
                    "staff_name": row.get::<_, String>(7)?,
                    "business_id": row.get::<_, Option<i64>>(8)?,
                    "location": row.get::<_, String>(9)?,
                }))
            },
        )?;

        if let Some(bid) = business_id {
            if let Some(sale_bid) = sale.get("business_id").and_then(|v| v.as_i64()) {
                if sale_bid != bid {
                    // still allow if staff belongs to business
                }
            }
            let _ = bid;
        }

        let mut stmt = self.conn.prepare(
            "SELECT si.id, si.product_id, si.quantity, si.unit_price, si.total_price,
                    COALESCE(p.name, 'Item') as product_name
             FROM sale_items si
             LEFT JOIN products p ON p.id = si.product_id
             WHERE si.sale_id = ?1",
        )?;
        let items = stmt
            .query_map([sale_id], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "product_id": row.get::<_, i64>(1)?,
                    "quantity": row.get::<_, i32>(2)?,
                    "unit_price": row.get::<_, f64>(3)?,
                    "total_price": row.get::<_, f64>(4)?,
                    "product_name": row.get::<_, String>(5)?,
                    "name": row.get::<_, String>(5)?,
                }))
            })?
            .collect::<Result<Vec<_>>>()?;

        let bid = sale.get("business_id").and_then(|v| v.as_i64());
        let (biz_name, biz_addr, biz_phone) = if let Some(id) = bid {
            self.conn
                .query_row(
                    "SELECT COALESCE(name, ''), COALESCE(address, ''), COALESCE(phone, '')
                     FROM businesses WHERE id = ?1",
                    [id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .unwrap_or_default()
        } else {
            (String::new(), String::new(), String::new())
        };

        let notes = sale.get("notes").and_then(|v| v.as_str()).unwrap_or("");
        let customer = if notes.to_uppercase().starts_with("DEBT:") {
            notes[5..].trim().to_string()
        } else if !notes.trim().is_empty() {
            notes.trim().to_string()
        } else {
            "Walk-in customer".into()
        };

        Ok(serde_json::json!({
            "id": sale.get("id"),
            "user_id": sale.get("user_id"),
            "total_amount": sale.get("total_amount"),
            "payment_method": sale.get("payment_method"),
            "payment_status": sale.get("payment_status"),
            "notes": sale.get("notes"),
            "created_at": sale.get("created_at"),
            "staff_name": sale.get("staff_name"),
            "business_id": sale.get("business_id"),
            "location": sale.get("location"),
            "customer_name": customer,
            "business_name": biz_name,
            "business_address": biz_addr,
            "business_phone": biz_phone,
            "items": items,
        }))
    }

    pub fn void_sale(&self, sale_id: i64, business_id: i64, actor_user_id: i64) -> Result<Value> {
        let (status, method, amount, notes, location, sale_bid): (
            String,
            String,
            f64,
            String,
            String,
            i64,
        ) = self.conn.query_row(
            "SELECT COALESCE(payment_status, ''), COALESCE(payment_method, ''),
                    COALESCE(total_amount, 0), COALESCE(notes, ''),
                    COALESCE(location, 'fridge'), COALESCE(business_id, 0)
             FROM sales WHERE id = ?1",
            [sale_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )?;

        if sale_bid != 0 && sale_bid != business_id {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        if status.to_uppercase() == "CANCELLED" {
            return Ok(serde_json::json!({ "ok": false, "error": "already_voided" }));
        }

        let mut stmt = self.conn.prepare(
            "SELECT product_id, quantity FROM sale_items WHERE sale_id = ?1",
        )?;
        let lines: Vec<(i64, i32)> = stmt
            .query_map([sale_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>>>()?;

        let loc = location.to_lowercase();
        if loc != "sports" {
            for (product_id, qty) in &lines {
                self.update_stock_type(
                    *product_id,
                    &loc,
                    *qty,
                    actor_user_id,
                    Some("Void sale — stock returned"),
                )?;
            }
        }

        if method.to_uppercase() == "DEBT" && amount > 0.0 {
            let customer = if notes.to_uppercase().starts_with("DEBT:") {
                notes[5..].trim().to_string()
            } else {
                notes.trim().to_string()
            };
            if !customer.is_empty() {
                let key = Self::normalize_customer_key(&customer);
                let now = chrono::Utc::now().to_rfc3339();
                let _ = self.conn.execute(
                    "UPDATE customer_debts
                     SET total_charged = MAX(0, total_charged - ?1),
                         balance = MAX(0, balance - ?1),
                         updated_at = ?2
                     WHERE business_id = ?3 AND customer_key = ?4",
                    params![amount, now, business_id, key],
                );
                let _ = self.conn.execute(
                    "UPDATE customer_debts SET status = CASE WHEN balance <= 0.0001 THEN 'PAID' ELSE 'OPEN' END
                     WHERE business_id = ?1 AND customer_key = ?2",
                    params![business_id, key],
                );
                if let Ok(debt_id) = self.conn.query_row(
                    "SELECT id FROM customer_debts WHERE business_id = ?1 AND customer_key = ?2",
                    params![business_id, key],
                    |row| row.get::<_, i64>(0),
                ) {
                    let entry_id = chrono::Utc::now().timestamp_millis();
                    let _ = self.conn.execute(
                        "INSERT INTO debt_entries
                         (id, debt_id, business_id, entry_type, amount, sale_id, note, created_by, created_at)
                         VALUES (?1, ?2, ?3, 'VOID', ?4, ?5, ?6, ?7, ?8)",
                        params![
                            entry_id,
                            debt_id,
                            business_id,
                            amount,
                            sale_id,
                            format!("Void sale #{}", sale_id),
                            actor_user_id,
                            now
                        ],
                    );
                }
            }
        }

        self.conn.execute(
            "UPDATE sales SET payment_status = 'CANCELLED' WHERE id = ?1",
            [sale_id],
        )?;

        let _ = self.log_activity(
            business_id,
            Some(actor_user_id),
            "SALE_VOIDED",
            "sale",
            &sale_id.to_string(),
            &format!("Voided sale #{}", sale_id),
            None,
        );

        Ok(serde_json::json!({ "ok": true, "sale_id": sale_id }))
    }

    pub fn get_sales_email_preview(
        &self,
        business_id: i64,
        report_date: &str,
    ) -> Result<Value> {
        let mut sale_stmt = self.conn.prepare(
            "SELECT s.id, COALESCE(s.location, 'fridge'), s.created_at FROM sales s
             LEFT JOIN users u ON u.id = s.user_id
             WHERE (s.business_id = ?1 OR (s.business_id IS NULL AND u.business_id = ?1))
               AND date(s.created_at) >= date(?2)
               AND UPPER(COALESCE(s.payment_status, '')) != 'CANCELLED'",
        )?;
        let sales: Vec<(i64, String, String)> = sale_stmt
            .query_map(params![business_id, report_date], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .collect::<Result<Vec<_>>>()?;
        let sale_ids: Vec<i64> = sales
            .iter()
            .filter(|s| s.2.starts_with(report_date))
            .map(|s| s.0)
            .collect();
        let sale_loc: std::collections::HashMap<i64, String> =
            sales.iter().map(|s| (s.0, s.1.clone())).collect();
        let sale_on_day: std::collections::HashMap<i64, bool> = sales
            .iter()
            .map(|s| (s.0, s.2.starts_with(report_date)))
            .collect();
        let all_sale_ids: Vec<i64> = sales.iter().map(|s| s.0).collect();

        type Prod = (String, f64, f64, i32, i32, i32, i32);
        let mut products: std::collections::HashMap<i64, Prod> =
            std::collections::HashMap::new();
        let mut pstmt = self.conn.prepare(
            "SELECT id, name, COALESCE(price, 0), COALESCE(staff_price, 0),
                    COALESCE(fridge_stock,0), COALESCE(show_stock,0), COALESCE(store_stock,0),
                    COALESCE(fridge_stock,0)+COALESCE(show_stock,0)+COALESCE(store_stock,0)+COALESCE(sports_stock,0)
             FROM products WHERE business_id = ?1",
        )?;
        let prows = pstmt.query_map([business_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, i32>(4)?,
                row.get::<_, i32>(5)?,
                row.get::<_, i32>(6)?,
                row.get::<_, i32>(7)?,
            ))
        })?;
        for r in prows {
            let (id, name, price, staff, fridge, show, store, left) = r?;
            products.insert(id, (name, price, staff, fridge, show, store, left));
        }

        let mut new_fridge: std::collections::HashMap<i64, i32> =
            std::collections::HashMap::new();
        let mut new_fridge_after: std::collections::HashMap<i64, i32> =
            std::collections::HashMap::new();
        let mut store_out_after: std::collections::HashMap<i64, i32> =
            std::collections::HashMap::new();
        if let Ok(mut mstmt) = self.conn.prepare(
            "SELECT it.product_id, it.transaction_type, it.quantity, COALESCE(it.reason, ''), it.created_at
             FROM inventory_transactions it
             JOIN products p ON p.id = it.product_id
             WHERE p.business_id = ?1 AND date(it.created_at) >= date(?2)",
        ) {
            if let Ok(mrows) = mstmt.query_map(params![business_id, report_date], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            }) {
                for mr in mrows.flatten() {
                    let (pid, typ, qty, reason, created) = mr;
                    if qty <= 0 {
                        continue;
                    }
                    let t = typ.to_uppercase();
                    let on_day = created.starts_with(report_date);
                    let into = t.contains("TO_FRIDGE")
                        || (t == "STOCK_FRIDGE" && !reason.to_lowercase().contains("void"));
                    let out_store = t.contains("TRANSFER_STORE")
                        || t.contains("TO_FRIDGE")
                        || t.contains("TO_SHOW");
                    if on_day {
                        if into {
                            *new_fridge.entry(pid).or_insert(0) += qty;
                        }
                    } else {
                        if into {
                            *new_fridge_after.entry(pid).or_insert(0) += qty;
                        }
                        if out_store {
                            *store_out_after.entry(pid).or_insert(0) += qty;
                        }
                    }
                }
            }
        }

        #[derive(Clone)]
        struct Line {
            name: String,
            qty: i32,
            amount: f64,
        }
        let mut normal: std::collections::HashMap<String, Line> = std::collections::HashMap::new();
        let mut staff_map: std::collections::HashMap<String, Line> = std::collections::HashMap::new();
        let mut fridge_sold: std::collections::HashMap<i64, i32> = std::collections::HashMap::new();
        let mut fridge_sold_after: std::collections::HashMap<i64, i32> =
            std::collections::HashMap::new();
        let mut show_sold: std::collections::HashMap<i64, i32> = std::collections::HashMap::new();

        for sid in &all_sale_ids {
            let loc = sale_loc
                .get(sid)
                .map(|s| s.to_lowercase())
                .unwrap_or_else(|| "fridge".into());
            let on_day = *sale_on_day.get(sid).unwrap_or(&false);
            let mut istmt = self.conn.prepare(
                "SELECT product_id, quantity, unit_price, total_price FROM sale_items WHERE sale_id = ?1",
            )?;
            let irows = istmt.query_map([sid], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, f64>(3)?,
                ))
            })?;
            for ir in irows {
                let (pid, qty, unit, total) = ir?;
                let (name, normal_p, staff_p, _, _, _, _) = products
                    .get(&pid)
                    .cloned()
                    .unwrap_or_else(|| (format!("Product {}", pid), 0.0, 0.0, 0, 0, 0, 0));
                let amount = if total > 0.0 { total } else { unit * qty as f64 };
                if on_day {
                    let is_staff = staff_p > 0.0
                        && (unit - staff_p).abs() < 0.001
                        && (unit - normal_p).abs() > 0.001;
                    let map = if is_staff { &mut staff_map } else { &mut normal };
                    let entry = map.entry(name.clone()).or_insert(Line {
                        name: name.clone(),
                        qty: 0,
                        amount: 0.0,
                    });
                    entry.qty += qty;
                    entry.amount += amount;
                }
                if loc == "show" {
                    if on_day {
                        *show_sold.entry(pid).or_insert(0) += qty;
                    }
                } else if loc != "sports" {
                    if on_day {
                        *fridge_sold.entry(pid).or_insert(0) += qty;
                    } else {
                        *fridge_sold_after.entry(pid).or_insert(0) += qty;
                    }
                }
            }
        }

        let to_lines = |m: std::collections::HashMap<String, Line>| {
            let mut v: Vec<Value> = m
                .into_values()
                .map(|l| {
                    serde_json::json!({ "name": l.name, "qty": l.qty, "amount": l.amount })
                })
                .collect();
            v.sort_by(|a, b| {
                let ba = b.get("amount").and_then(|x| x.as_f64()).unwrap_or(0.0);
                let aa = a.get("amount").and_then(|x| x.as_f64()).unwrap_or(0.0);
                ba.partial_cmp(&aa).unwrap_or(std::cmp::Ordering::Equal)
            });
            v
        };
        let normal_lines = to_lines(normal);
        let staff_lines = to_lines(staff_map);
        let normal_total: f64 = normal_lines
            .iter()
            .map(|l| l.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0))
            .sum();
        let staff_total: f64 = staff_lines
            .iter()
            .map(|l| l.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0))
            .sum();

        let mut sold_ids: Vec<i64> = fridge_sold.keys().copied().collect();
        for id in show_sold.keys() {
            if !sold_ids.contains(id) {
                sold_ids.push(*id);
            }
        }
        let mut sold: Vec<Value> = sold_ids
            .into_iter()
            .map(|id| {
                let (name, _, _, fridge, _, store, left) = products
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| (format!("Product {}", id), 0.0, 0.0, 0, 0, 0, 0));
                let fsold = *fridge_sold.get(&id).unwrap_or(&0);
                let ssold = *show_sold.get(&id).unwrap_or(&0);
                let added = *new_fridge.get(&id).unwrap_or(&0);
                let fridge_left = (fridge + *fridge_sold_after.get(&id).unwrap_or(&0)
                    - *new_fridge_after.get(&id).unwrap_or(&0))
                .max(0);
                let fridge_before = (fridge_left + fsold - added).max(0);
                let store_left = (store + *store_out_after.get(&id).unwrap_or(&0)).max(0);
                serde_json::json!({
                    "name": name,
                    "sold": fsold,
                    "fridge_sold": fsold,
                    "fridge_left": fridge_left,
                    "fridge_before": fridge_before,
                    "new_stock": added,
                    "store": store_left,
                    "show_sold": ssold,
                    "left": left,
                    "before": fridge_before
                })
            })
            .collect();
        sold.sort_by(|a, b| {
            let ba = b.get("fridge_sold").and_then(|x| x.as_i64()).unwrap_or(0);
            let aa = a.get("fridge_sold").and_then(|x| x.as_i64()).unwrap_or(0);
            ba.cmp(&aa)
        });

        Ok(serde_json::json!({
            "periodLabel": report_date,
            "kind": "daily",
            "reminder": true,
            "salesCount": sale_ids.len(),
            "normal": { "total": normal_total, "lines": normal_lines },
            "staff": { "total": staff_total, "lines": staff_lines },
            "sold": sold,
        }))
    }

    fn normalize_customer_key(name: &str) -> String {
        name.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
    }

    pub fn charge_sale_to_debt(
        &self,
        business_id: i64,
        customer_name: &str,
        amount: f64,
        sale_id: i64,
        staff_id: i64,
        entry_date: &str,
    ) -> Result<()> {
        let key = Self::normalize_customer_key(customer_name);
        let now = entry_date.to_string();
        let debt_id: i64 = {
            let existing: Result<i64> = self.conn.query_row(
                "SELECT id FROM customer_debts WHERE business_id = ?1 AND customer_key = ?2",
                params![business_id, key],
                |row| row.get(0),
            );
            match existing {
                Ok(id) => {
                    self.conn.execute(
                        "UPDATE customer_debts
                         SET total_charged = total_charged + ?1,
                             balance = balance + ?1,
                             status = 'OPEN',
                             updated_at = ?2
                         WHERE id = ?3",
                        params![amount, now, id],
                    )?;
                    id
                }
                Err(_) => {
                    let id = chrono::Utc::now().timestamp_millis();
                    self.conn.execute(
                        "INSERT INTO customer_debts
                         (id, business_id, customer_name, customer_key, total_charged, total_paid, balance, status, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?5, 'OPEN', ?6, ?6)",
                        params![id, business_id, customer_name.trim(), key, amount, now],
                    )?;
                    id
                }
            }
        };

        let entry_id = chrono::Utc::now().timestamp_millis() + 1;
        self.conn.execute(
            "INSERT INTO debt_entries
             (id, debt_id, business_id, entry_type, amount, sale_id, note, created_by, created_at)
             VALUES (?1, ?2, ?3, 'CHARGE', ?4, ?5, ?6, ?7, ?8)",
            params![
                entry_id,
                debt_id,
                business_id,
                amount,
                sale_id,
                format!("Sale #{}", sale_id),
                staff_id,
                now
            ],
        )?;
        Ok(())
    }

    pub fn get_debtors(&self, business_id: i64, open_only: bool) -> Result<Vec<Value>> {
        let sql = if open_only {
            "SELECT id, business_id, customer_name, customer_key, total_charged, total_paid, balance, status, created_at, updated_at
             FROM customer_debts
             WHERE business_id = ?1 AND balance > 0.0001
             ORDER BY customer_name"
        } else {
            "SELECT id, business_id, customer_name, customer_key, total_charged, total_paid, balance, status, created_at, updated_at
             FROM customer_debts
             WHERE business_id = ?1
             ORDER BY customer_name"
        };
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map([business_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "business_id": row.get::<_, i64>(1)?,
                "customer_name": row.get::<_, String>(2)?,
                "customer_key": row.get::<_, String>(3)?,
                "total_charged": row.get::<_, f64>(4)?,
                "total_paid": row.get::<_, f64>(5)?,
                "balance": row.get::<_, f64>(6)?,
                "status": row.get::<_, String>(7)?,
                "created_at": row.get::<_, String>(8)?,
                "updated_at": row.get::<_, String>(9)?,
            }))
        })?;
        rows.collect()
    }

    pub fn get_debt_sales(&self, business_id: i64) -> Result<Vec<Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.user_id, s.total_amount, s.payment_method, s.payment_status, s.notes, s.created_at,
                    COALESCE(u.name, u.username, '') as staff_name
             FROM sales s
             LEFT JOIN users u ON u.id = s.user_id
             WHERE (s.business_id = ?1 OR u.business_id = ?1)
               AND UPPER(s.payment_method) = 'DEBT'
             ORDER BY s.created_at DESC
             LIMIT 300",
        )?;
        let rows = stmt.query_map([business_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "user_id": row.get::<_, i64>(1)?,
                "total_amount": row.get::<_, f64>(2)?,
                "payment_method": row.get::<_, String>(3)?,
                "payment_status": row.get::<_, String>(4)?,
                "notes": row.get::<_, Option<String>>(5)?,
                "created_at": row.get::<_, String>(6)?,
                "staff_name": row.get::<_, String>(7)?,
            }))
        })?;
        rows.collect()
    }

    pub fn record_debt_payment(
        &self,
        business_id: i64,
        debt_id: i64,
        amount: f64,
        staff_id: i64,
        note: Option<&str>,
    ) -> Result<Value> {
        if amount <= 0.0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        let now = chrono::Utc::now().to_rfc3339();
        let (balance, customer_name): (f64, String) = self.conn.query_row(
            "SELECT balance, customer_name FROM customer_debts WHERE id = ?1 AND business_id = ?2",
            params![debt_id, business_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let pay = amount.min(balance);
        let new_balance = (balance - pay).max(0.0);
        let status = if new_balance <= 0.0001 {
            "PAID"
        } else {
            "OPEN"
        };
        self.conn.execute(
            "UPDATE customer_debts
             SET total_paid = total_paid + ?1,
                 balance = ?2,
                 status = ?3,
                 updated_at = ?4
             WHERE id = ?5",
            params![pay, new_balance, status, now, debt_id],
        )?;
        let entry_id = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO debt_entries
             (id, debt_id, business_id, entry_type, amount, sale_id, note, created_by, created_at)
             VALUES (?1, ?2, ?3, 'PAYMENT', ?4, NULL, ?5, ?6, ?7)",
            params![
                entry_id,
                debt_id,
                business_id,
                pay,
                note.unwrap_or("Payment"),
                staff_id,
                now
            ],
        )?;

        // Complete related DEBT sales when account is cleared
        if status == "PAID" {
            let _ = self.conn.execute(
                "UPDATE sales SET payment_status = 'COMPLETED'
                 WHERE business_id = ?1 AND UPPER(payment_method) = 'DEBT'
                   AND payment_status = 'PENDING'
                   AND (notes LIKE ?2 OR notes LIKE ?3)",
                params![
                    business_id,
                    format!("%{}%", customer_name),
                    format!("DEBT:{}", customer_name)
                ],
            );
        }

        Ok(serde_json::json!({
            "debt_id": debt_id,
            "amount_paid": pay,
            "balance": new_balance,
            "status": status,
            "customer_name": customer_name,
        }))
    }

    pub fn mark_debt_paid_by_sale(&self, sale_id: i64) -> Result<()> {
        let (business_id, notes, amount): (Option<i64>, Option<String>, f64) =
            self.conn.query_row(
                "SELECT business_id, notes, total_amount FROM sales WHERE id = ?1",
                [sale_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
        let business_id = business_id.unwrap_or(0);
        let customer = notes
            .as_deref()
            .unwrap_or("")
            .strip_prefix("DEBT:")
            .unwrap_or_else(|| notes.as_deref().unwrap_or(""))
            .trim();
        if customer.is_empty() || business_id == 0 {
            self.conn.execute(
                "UPDATE sales SET payment_status = 'COMPLETED' WHERE id = ?1",
                [sale_id],
            )?;
            return Ok(());
        }
        let key = Self::normalize_customer_key(customer);
        let debt_id: i64 = self.conn.query_row(
            "SELECT id FROM customer_debts WHERE business_id = ?1 AND customer_key = ?2",
            params![business_id, key],
            |row| row.get(0),
        )?;
        let _ = self.record_debt_payment(business_id, debt_id, amount, 0, Some("Mark sale paid"))?;
        self.conn.execute(
            "UPDATE sales SET payment_status = 'COMPLETED' WHERE id = ?1",
            [sale_id],
        )?;
        Ok(())
    }

    pub fn add_manual_debt(
        &self,
        business_id: i64,
        customer_name: &str,
        amount: f64,
        staff_id: i64,
        note: Option<&str>,
    ) -> Result<Value> {
        let now = chrono::Utc::now().to_rfc3339();
        let sale_id = chrono::Utc::now().timestamp_millis();
        self.create_sale_full(
            sale_id,
            staff_id,
            business_id,
            amount,
            "DEBT",
            "PENDING",
            Some(&format!(
                "DEBT:{}{}",
                customer_name.trim(),
                note.map(|n| format!(" | {}", n)).unwrap_or_default()
            )),
            &now,
            None,
        )?;
        self.charge_sale_to_debt(business_id, customer_name, amount, sale_id, staff_id, &now)?;
        Ok(serde_json::json!({ "sale_id": sale_id, "amount": amount }))
    }

    pub fn get_activity_logs(&self, business_id: i64, limit: i64) -> Result<Vec<Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.business_id, a.actor_user_id, a.action, a.entity_type, a.entity_id,
                    a.summary, a.before_json, a.after_json, a.created_at,
                    COALESCE(u.name, u.username, '') as actor_name,
                    COALESCE(u.is_hidden, 0) as actor_hidden
             FROM activity_logs a
             LEFT JOIN users u ON u.id = a.actor_user_id
             WHERE a.business_id = ?1
             ORDER BY a.created_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![business_id, limit.max(1).min(300)], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "business_id": row.get::<_, i64>(1)?,
                "actor_user_id": row.get::<_, Option<i64>>(2)?,
                "action": row.get::<_, String>(3)?,
                "entity_type": row.get::<_, Option<String>>(4)?,
                "entity_id": row.get::<_, Option<String>>(5)?,
                "summary": row.get::<_, Option<String>>(6)?,
                "before_json": row.get::<_, Option<String>>(7)?,
                "after_json": row.get::<_, Option<String>>(8)?,
                "created_at": row.get::<_, String>(9)?,
                "actor_name": row.get::<_, String>(10)?,
                "actor_hidden": row.get::<_, i64>(11).unwrap_or(0),
            }))
        })?;
        let mut out = Vec::new();
        for r in rows {
            let v = r?;
            let hidden = v.get("actor_hidden").and_then(|x| x.as_i64()).unwrap_or(0) != 0;
            let summary = v.get("summary").and_then(|x| x.as_str()).unwrap_or("").to_lowercase();
            let after = v.get("after_json").and_then(|x| x.as_str()).unwrap_or("").to_lowercase();
            if hidden || summary.contains("admin2") || after.contains("\"username\":\"admin2\"") {
                continue;
            }
            out.push(v);
        }
        Ok(out)
    }

    pub fn log_activity(
        &self,
        business_id: i64,
        actor_user_id: Option<i64>,
        action: &str,
        entity_type: &str,
        entity_id: &str,
        summary: &str,
        after_json: Option<&str>,
    ) -> Result<()> {
        self.log_activity_full(
            business_id,
            actor_user_id,
            action,
            entity_type,
            entity_id,
            summary,
            None,
            after_json,
        )
    }

    pub fn log_activity_full(
        &self,
        business_id: i64,
        actor_user_id: Option<i64>,
        action: &str,
        entity_type: &str,
        entity_id: &str,
        summary: &str,
        before_json: Option<&str>,
        after_json: Option<&str>,
    ) -> Result<()> {
        // Skip audit for ghost/support users
        if let Some(uid) = actor_user_id {
            let hidden: i64 = self
                .conn
                .query_row(
                    "SELECT COALESCE(is_hidden, 0) FROM users WHERE id = ?1",
                    [uid],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            if hidden != 0 {
                return Ok(());
            }
        }

        let id = chrono::Utc::now().timestamp_millis();
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO activity_logs
             (id, business_id, actor_user_id, action, entity_type, entity_id, summary, before_json, after_json, created_at, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL)",
            params![
                id,
                business_id,
                actor_user_id,
                action,
                entity_type,
                entity_id,
                summary,
                before_json.unwrap_or(""),
                after_json.unwrap_or(""),
                now
            ],
        )?;
        Ok(())
    }

    /// Edit sale date and/or line prices (qty split). Writes SALE_EDITED audit log.
    pub fn update_sale_details(
        &self,
        sale_id: i64,
        business_id: i64,
        sale_date: Option<&str>,
        items: Option<&[Value]>,
        actor_user_id: Option<i64>,
    ) -> Result<Value> {
        let (user_id, before_total, before_created, notes): (i64, f64, String, Option<String>) =
            self.conn.query_row(
                "SELECT user_id, total_amount, created_at, notes FROM sales WHERE id = ?1",
                [sale_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?;

        let staff_bid: Option<i64> = self
            .conn
            .query_row(
                "SELECT business_id FROM users WHERE id = ?1",
                [user_id],
                |row| {
                    Ok(match row.get_ref(0)? {
                        rusqlite::types::ValueRef::Integer(i) => Some(i),
                        rusqlite::types::ValueRef::Text(t) => {
                            let s = String::from_utf8_lossy(t);
                            if s.trim().is_empty() {
                                None
                            } else {
                                s.trim().parse().ok()
                            }
                        }
                        _ => None,
                    })
                },
            )
            .ok()
            .flatten();

        let sale_bid: Option<i64> = self
            .conn
            .query_row(
                "SELECT business_id FROM sales WHERE id = ?1",
                [sale_id],
                |row| {
                    Ok(match row.get_ref(0)? {
                        rusqlite::types::ValueRef::Integer(i) => Some(i),
                        rusqlite::types::ValueRef::Text(t) => {
                            let s = String::from_utf8_lossy(t);
                            if s.trim().is_empty() {
                                None
                            } else {
                                s.trim().parse().ok()
                            }
                        }
                        _ => None,
                    })
                },
            )
            .ok()
            .flatten();

        let belongs = sale_bid == Some(business_id) || staff_bid == Some(business_id);
        if !belongs {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        let mut created_at = before_created.clone();
        if let Some(date_str) = sale_date {
            let trimmed = date_str.trim();
            if !trimmed.is_empty() {
                // Accept YYYY-MM-DD or full ISO
                if trimmed.len() == 10 && trimmed.chars().nth(4) == Some('-') {
                    created_at = format!("{}T12:00:00.000Z", trimmed);
                } else {
                    created_at = trimmed.to_string();
                }
            }
        }

        let mut after_total = before_total;
        let mut items_after: Option<Vec<Value>> = None;

        if let Some(price_updates) = items {
            if !price_updates.is_empty() {
                let mut stmt = self.conn.prepare(
                    "SELECT product_id, quantity FROM sale_items WHERE sale_id = ?1",
                )?;
                let existing: Vec<(i64, i32)> = stmt
                    .query_map([sale_id], |row| Ok((row.get(0)?, row.get(1)?)))?
                    .collect::<Result<Vec<_>>>()?;
                if existing.is_empty() {
                    return Err(rusqlite::Error::QueryReturnedNoRows);
                }

                let mut original_qty: std::collections::HashMap<i64, i32> =
                    std::collections::HashMap::new();
                for (pid, qty) in &existing {
                    *original_qty.entry(*pid).or_insert(0) += qty;
                }

                let mut next_lines: Vec<(i64, i32, f64)> = Vec::new();
                for line in price_updates {
                    let pid = line
                        .get("product_id")
                        .or_else(|| line.get("productId"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let qty = line
                        .get("quantity")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0) as i32;
                    let unit = line
                        .get("unit_price")
                        .or_else(|| line.get("unitPrice"))
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    if pid > 0 && qty > 0 {
                        if unit < 0.0 {
                            return Err(rusqlite::Error::InvalidQuery);
                        }
                        next_lines.push((pid, qty, unit));
                    }
                }
                if next_lines.is_empty() {
                    return Err(rusqlite::Error::QueryReturnedNoRows);
                }

                let mut next_qty: std::collections::HashMap<i64, i32> =
                    std::collections::HashMap::new();
                for (pid, qty, _) in &next_lines {
                    *next_qty.entry(*pid).or_insert(0) += qty;
                }
                for (pid, qty) in &original_qty {
                    if next_qty.get(pid).copied().unwrap_or(0) != *qty {
                        return Err(rusqlite::Error::InvalidQuery);
                    }
                }
                for pid in next_qty.keys() {
                    if !original_qty.contains_key(pid) {
                        return Err(rusqlite::Error::InvalidQuery);
                    }
                }

                self.conn
                    .execute("DELETE FROM sale_items WHERE sale_id = ?1", [sale_id])?;

                let base_id = chrono::Utc::now().timestamp_millis();
                after_total = 0.0;
                let mut saved = Vec::new();
                for (i, (pid, qty, unit)) in next_lines.iter().enumerate() {
                    let line_total = (*qty as f64) * unit;
                    after_total += line_total;
                    let item_id = base_id + i as i64 + 1;
                    self.conn.execute(
                        "INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, total_price)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![item_id, sale_id, pid, qty, unit, line_total],
                    )?;
                    saved.push(serde_json::json!({
                        "product_id": pid,
                        "quantity": qty,
                        "unit_price": unit,
                        "total_price": line_total,
                    }));
                }
                items_after = Some(saved);
            }
        }

        self.conn.execute(
            "UPDATE sales SET total_amount = ?1, created_at = ?2, business_id = COALESCE(business_id, ?3) WHERE id = ?4",
            params![after_total, created_at, business_id, sale_id],
        )?;

        // Keep debt CHARGE in sync when this sale is a DEBT sale
        if let Ok((entry_id, debt_id)) = self.conn.query_row(
            "SELECT id, debt_id FROM debt_entries
             WHERE sale_id = ?1 AND business_id = ?2 AND UPPER(entry_type) = 'CHARGE'
             LIMIT 1",
            params![sale_id, business_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        ) {
            let _ = self.conn.execute(
                "UPDATE debt_entries SET amount = ?1, entry_date = ?2 WHERE id = ?3",
                params![after_total, created_at, entry_id],
            );
            // Recalc debt totals
            let (charged, paid): (f64, f64) = self.conn.query_row(
                "SELECT
                    COALESCE(SUM(CASE WHEN UPPER(entry_type) != 'PAYMENT' THEN amount ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN UPPER(entry_type) = 'PAYMENT' THEN amount ELSE 0 END), 0)
                 FROM debt_entries WHERE debt_id = ?1 AND business_id = ?2",
                params![debt_id, business_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let balance = charged - paid;
            let status = if balance <= 0.0001 { "PAID" } else { "OPEN" };
            let now = chrono::Utc::now().to_rfc3339();
            let _ = self.conn.execute(
                "UPDATE customer_debts
                 SET total_charged = ?1, total_paid = ?2, balance = ?3, status = ?4, updated_at = ?5
                 WHERE id = ?6",
                params![charged, paid, balance.max(0.0), status, now, debt_id],
            );
            let _ = notes;
        }

        let before = serde_json::json!({
            "total_amount": before_total,
            "created_at": before_created,
        });
        let after = serde_json::json!({
            "total_amount": after_total,
            "created_at": created_at,
            "items": items_after,
        });
        let _ = self.log_activity_full(
            business_id,
            actor_user_id.or(Some(user_id)),
            "SALE_EDITED",
            "sale",
            &sale_id.to_string(),
            &format!("Sale #{} edited", sale_id),
            Some(&before.to_string()),
            Some(&after.to_string()),
        );

        Ok(serde_json::json!({
            "id": sale_id,
            "total_amount": after_total,
            "created_at": created_at,
            "business_id": business_id,
        }))
    }

    pub fn get_all_activity_logs(&self) -> Result<Vec<Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, business_id, actor_user_id, action, entity_type, entity_id, summary,
                    before_json, after_json, created_at, synced_at
             FROM activity_logs ORDER BY created_at DESC LIMIT 2000",
        )?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = stmt.query_map([], |row| {
            let created: String = row.get(9)?;
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "business_id": row.get::<_, i64>(1)?,
                "actor_user_id": row.get::<_, Option<i64>>(2)?,
                "action": row.get::<_, String>(3)?,
                "entity_type": row.get::<_, Option<String>>(4)?,
                "entity_id": row.get::<_, Option<String>>(5)?,
                "summary": row.get::<_, Option<String>>(6)?,
                "before_json": row.get::<_, Option<String>>(7)?,
                "after_json": row.get::<_, Option<String>>(8)?,
                "created_at": created,
                "synced_at": row.get::<_, Option<String>>(10)?.unwrap_or_else(|| now.clone()),
            }))
        })?;
        rows.collect()
    }

    pub fn get_all_customer_debts(&self) -> Result<Vec<Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, business_id, customer_name, customer_key, total_charged, total_paid, balance,
                    status, created_at, updated_at, synced_at
             FROM customer_debts",
        )?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "business_id": row.get::<_, i64>(1)?,
                "customer_name": row.get::<_, String>(2)?,
                "customer_key": row.get::<_, String>(3)?,
                "total_charged": row.get::<_, f64>(4)?,
                "total_paid": row.get::<_, f64>(5)?,
                "balance": row.get::<_, f64>(6)?,
                "status": row.get::<_, String>(7)?,
                "created_at": row.get::<_, Option<String>>(8)?,
                "updated_at": row.get::<_, Option<String>>(9)?,
                "synced_at": row.get::<_, Option<String>>(10)?.unwrap_or_else(|| now.clone()),
            }))
        })?;
        rows.collect()
    }

    pub fn get_all_debt_entries(&self) -> Result<Vec<Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, debt_id, business_id, entry_type, amount, sale_id, note, created_by,
                    created_at, entry_date, synced_at
             FROM debt_entries",
        )?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = stmt.query_map([], |row| {
            let created: Option<String> = row.get(8)?;
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "debt_id": row.get::<_, i64>(1)?,
                "business_id": row.get::<_, i64>(2)?,
                "entry_type": row.get::<_, String>(3)?,
                "amount": row.get::<_, f64>(4)?,
                "sale_id": row.get::<_, Option<i64>>(5)?,
                "note": row.get::<_, Option<String>>(6)?,
                "created_by": row.get::<_, Option<i64>>(7)?,
                "created_at": created.clone(),
                "entry_date": row.get::<_, Option<String>>(9)?.or(created),
                "synced_at": row.get::<_, Option<String>>(10)?.unwrap_or_else(|| now.clone()),
            }))
        })?;
        rows.collect()
    }

    pub fn upsert_activity_log_row(&self, row: &Value) -> Result<()> {
        let id = row.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        if id == 0 {
            return Ok(());
        }
        self.conn.execute(
            "INSERT INTO activity_logs
             (id, business_id, actor_user_id, action, entity_type, entity_id, summary, before_json, after_json, created_at, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               summary = excluded.summary,
               before_json = excluded.before_json,
               after_json = excluded.after_json,
               synced_at = excluded.synced_at",
            params![
                id,
                row.get("business_id").and_then(|v| v.as_i64()).unwrap_or(0),
                row.get("actor_user_id").and_then(|v| v.as_i64()),
                row.get("action").and_then(|v| v.as_str()).unwrap_or("UNKNOWN"),
                row.get("entity_type").and_then(|v| v.as_str()),
                row.get("entity_id").and_then(|v| v.as_str()),
                row.get("summary").and_then(|v| v.as_str()),
                row.get("before_json").and_then(|v| v.as_str()),
                row.get("after_json").and_then(|v| v.as_str()),
                row.get("created_at").and_then(|v| v.as_str()).unwrap_or(""),
                row.get("synced_at").and_then(|v| v.as_str()),
            ],
        )?;
        Ok(())
    }

    pub fn upsert_customer_debt_row(&self, row: &Value) -> Result<()> {
        let id = row.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        if id == 0 {
            return Ok(());
        }
        let name = row.get("customer_name").and_then(|v| v.as_str()).unwrap_or("");
        let key = row
            .get("customer_key")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| Self::normalize_customer_key(name));
        let charged = row.get("total_charged").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let paid = row.get("total_paid").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let balance = row
            .get("balance")
            .and_then(|v| v.as_f64())
            .unwrap_or(charged - paid);
        self.conn.execute(
            "INSERT INTO customer_debts
             (id, business_id, customer_name, customer_key, total_charged, total_paid, balance, status, created_at, updated_at, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               total_charged = excluded.total_charged,
               total_paid = excluded.total_paid,
               balance = excluded.balance,
               status = excluded.status,
               updated_at = excluded.updated_at,
               synced_at = excluded.synced_at",
            params![
                id,
                row.get("business_id").and_then(|v| v.as_i64()).unwrap_or(0),
                name,
                key,
                charged,
                paid,
                balance,
                row.get("status").and_then(|v| v.as_str()).unwrap_or("OPEN"),
                row.get("created_at").and_then(|v| v.as_str()),
                row.get("updated_at").and_then(|v| v.as_str()),
                row.get("synced_at").and_then(|v| v.as_str()),
            ],
        )?;
        Ok(())
    }

    pub fn upsert_debt_entry_row(&self, row: &Value) -> Result<()> {
        let id = row.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        if id == 0 {
            return Ok(());
        }
        self.conn.execute(
            "INSERT INTO debt_entries
             (id, debt_id, business_id, entry_type, amount, sale_id, note, created_by, created_at, entry_date, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               amount = excluded.amount,
               entry_date = excluded.entry_date,
               note = excluded.note,
               synced_at = excluded.synced_at",
            params![
                id,
                row.get("debt_id").and_then(|v| v.as_i64()).unwrap_or(0),
                row.get("business_id").and_then(|v| v.as_i64()).unwrap_or(0),
                row.get("entry_type").and_then(|v| v.as_str()).unwrap_or("CHARGE"),
                row.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0),
                row.get("sale_id").and_then(|v| v.as_i64()),
                row.get("note").and_then(|v| v.as_str()),
                row.get("created_by").and_then(|v| v.as_i64()),
                row.get("created_at").and_then(|v| v.as_str()),
                row.get("entry_date").and_then(|v| v.as_str()),
                row.get("synced_at").and_then(|v| v.as_str()),
            ],
        )?;
        Ok(())
    }

    pub fn get_product_categories(&self, business_id: i64) -> Result<Vec<Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, business_id, name, created_at FROM product_categories
             WHERE business_id = ?1 ORDER BY name",
        )?;
        let rows = stmt.query_map([business_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "business_id": row.get::<_, i64>(1)?,
                "name": row.get::<_, String>(2)?,
                "created_at": row.get::<_, Option<String>>(3)?,
            }))
        })?;
        let mut cats: Vec<Value> = rows.collect::<Result<Vec<_>>>()?;
        if cats.is_empty() {
            // Derive from product category strings
            let mut stmt2 = self.conn.prepare(
                "SELECT DISTINCT category FROM products WHERE business_id = ?1 AND category IS NOT NULL AND category != ''",
            )?;
            let derived = stmt2.query_map([business_id], |row| row.get::<_, String>(0))?;
            for (i, name) in derived.enumerate() {
                let name = name?;
                cats.push(serde_json::json!({
                    "id": -(i as i64 + 1),
                    "business_id": business_id,
                    "name": name,
                }));
            }
        }
        Ok(cats)
    }

    pub fn create_product_category(&self, business_id: i64, name: &str) -> Result<Value> {
        let id = chrono::Utc::now().timestamp_millis();
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO product_categories (id, business_id, name, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, business_id, name.trim(), now],
        )?;
        Ok(serde_json::json!({ "id": id, "business_id": business_id, "name": name.trim() }))
    }

    pub fn delete_product_category(&self, business_id: i64, category_id: i64) -> Result<bool> {
        let n = self.conn.execute(
            "DELETE FROM product_categories WHERE id = ?1 AND business_id = ?2",
            params![category_id, business_id],
        )?;
        Ok(n > 0)
    }

    pub fn get_users_for_business(&self, business_id: i64) -> Result<Vec<Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, username, name, email, role, is_active, created_at, business_id, last_login,
                    COALESCE(is_hidden, 0), temporary_password
             FROM users
             WHERE CAST(business_id AS TEXT) = CAST(?1 AS TEXT)
             ORDER BY name, username",
        )?;
        let rows = stmt.query_map([business_id], |row| {
            let role: String = row.get(4)?;
            let role_val = if role.starts_with('"') || role.starts_with('{') {
                serde_json::from_str(&role).unwrap_or(Value::String(role.clone()))
            } else {
                Value::String(role)
            };
            let temp: Option<String> = row.get(10)?;
            let is_hidden: i64 = row.get(9).unwrap_or(0);
            let bid = match row.get_ref(7)? {
                rusqlite::types::ValueRef::Null => None,
                rusqlite::types::ValueRef::Integer(i) => Some(i),
                rusqlite::types::ValueRef::Text(t) => {
                    let s = String::from_utf8_lossy(t);
                    let trimmed = s.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        trimmed.parse::<i64>().ok()
                    }
                }
                rusqlite::types::ValueRef::Real(f) => Some(f as i64),
                _ => None,
            };
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "username": row.get::<_, String>(1)?,
                "name": row.get::<_, Option<String>>(2)?,
                "email": row.get::<_, Option<String>>(3)?,
                "role": role_val,
                "is_active": row.get::<_, i64>(5).unwrap_or(1) != 0,
                "created_at": row.get::<_, Option<String>>(6)?,
                "business_id": bid,
                "last_login": row.get::<_, Option<String>>(8)?,
                "is_hidden": is_hidden != 0,
                "has_temporary_password": temp.as_ref().map(|t| !t.is_empty()).unwrap_or(false),
            }))
        })?;
        rows.collect()
    }

    pub fn get_dashboard_metrics(&self, business_id: i64) -> Result<Value> {
        let today_sales: f64 = self.conn.query_row(
            "SELECT COALESCE(SUM(total_amount), 0) FROM sales s
             LEFT JOIN users u ON u.id = s.user_id
             WHERE (s.business_id = ?1 OR u.business_id = ?1)
               AND date(s.created_at) = date('now', 'localtime')
               AND s.payment_status != 'CANCELLED'",
            [business_id],
            |row| row.get(0),
        )?;
        let today_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sales s
             LEFT JOIN users u ON u.id = s.user_id
             WHERE (s.business_id = ?1 OR u.business_id = ?1)
               AND date(s.created_at) = date('now', 'localtime')",
            [business_id],
            |row| row.get(0),
        )?;
        let product_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM products WHERE business_id = ?1 AND is_active = 1",
            [business_id],
            |row| row.get(0),
        )?;
        let pending: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sales s
             LEFT JOIN users u ON u.id = s.user_id
             WHERE (s.business_id = ?1 OR u.business_id = ?1)
               AND s.payment_status = 'PENDING'",
            [business_id],
            |row| row.get(0),
        )?;
        Ok(serde_json::json!({
            "today_sales": today_sales,
            "today_revenue": today_sales,
            "today_transactions": today_count,
            "product_count": product_count,
            "pending_sales": pending,
        }))
    }

    pub fn set_sync_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO sync_meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_sync_meta(&self, key: &str) -> Option<String> {
        self.conn
            .query_row(
                "SELECT value FROM sync_meta WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .ok()
    }

    /// One-time: keep first line when the same product+price appears twice on a sale.
    /// Does not wipe the DB (would lose unsynced sales).
    pub fn repair_dup_sale_lines_once(&self) -> Result<bool> {
        const KEY: &str = "repair_dup_sale_lines_v107";
        if self.get_sync_meta(KEY).as_deref() == Some("1") {
            return Ok(false);
        }

        self.conn.execute(
            "DELETE FROM sale_items
             WHERE id NOT IN (
               SELECT MIN(id) FROM sale_items GROUP BY sale_id, product_id, unit_price
             )",
            [],
        )?;

        self.conn.execute(
            "UPDATE sales
             SET total_amount = COALESCE((
               SELECT SUM(COALESCE(si.total_price, si.unit_price * si.quantity, 0))
               FROM sale_items si
               WHERE si.sale_id = sales.id
             ), 0)",
            [],
        )?;

        self.set_sync_meta(KEY, "1")?;
        Ok(true)
    }
}
