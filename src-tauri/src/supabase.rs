use serde_json::Value;

pub struct SupabaseClient {
    url: String,
    key: String,
    client: reqwest::Client,
}

impl SupabaseClient {
    pub fn new(url: &str, key: &str) -> Self {
        Self {
            url: url.to_string(),
            key: key.to_string(),
            client: reqwest::Client::new(),
        }
    }

    pub async fn upsert_users(&self, users: Vec<Value>) -> Result<(), String> {
        if users.is_empty() {
            return Ok(());
        }

        let url = format!("{}/rest/v1/users_backup", self.url);
        let response = self
            .client
            .post(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates")
            .json(&users)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Supabase error: {} - {}", status, error_text));
        }

        Ok(())
    }

    pub async fn upsert_businesses(&self, businesses: Vec<Value>) -> Result<(), String> {
        if businesses.is_empty() {
            return Ok(());
        }

        let url = format!("{}/rest/v1/businesses_backup", self.url);
        let response = self
            .client
            .post(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates")
            .json(&businesses)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Supabase error: {} - {}", status, error_text));
        }

        Ok(())
    }

    pub async fn upsert_products(&self, products: Vec<Value>) -> Result<(), String> {
        if products.is_empty() {
            return Ok(());
        }

        let url = format!("{}/rest/v1/products_backup", self.url);
        let response = self
            .client
            .post(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates")
            .json(&products)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Supabase error: {} - {}", status, error_text));
        }

        Ok(())
    }

    pub async fn upsert_sales(&self, sales: Vec<Value>) -> Result<(), String> {
        if sales.is_empty() {
            return Ok(());
        }

        let url = format!("{}/rest/v1/sales_backup", self.url);
        let response = self
            .client
            .post(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates")
            .json(&sales)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Supabase error: {} - {}", status, error_text));
        }

        Ok(())
    }

    pub async fn upsert_sale_items(&self, sale_items: Vec<Value>) -> Result<(), String> {
        if sale_items.is_empty() {
            return Ok(());
        }

        let url = format!("{}/rest/v1/sale_items_backup", self.url);
        let response = self
            .client
            .post(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates")
            .json(&sale_items)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Supabase error: {} - {}", status, error_text));
        }

        Ok(())
    }

    pub async fn fetch_users(&self) -> Result<Vec<Value>, String> {
        let url = format!("{}/rest/v1/users_backup?select=*", self.url);
        let response = self
            .client
            .get(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch users: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Supabase error: {} - {}", status, error_text));
        }

        let users: Vec<Value> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(users)
    }

    pub async fn fetch_businesses(&self) -> Result<Vec<Value>, String> {
        let url = format!("{}/rest/v1/businesses_backup?select=*", self.url);
        let response = self
            .client
            .get(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch businesses: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Supabase error: {} - {}", status, error_text));
        }

        let businesses: Vec<Value> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(businesses)
    }

    pub async fn fetch_products(&self) -> Result<Vec<Value>, String> {
        let url = format!("{}/rest/v1/products_backup?select=*", self.url);
        let response = self
            .client
            .get(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch products: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Supabase error: {} - {}", status, error_text));
        }

        let products: Vec<Value> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(products)
    }

    pub async fn fetch_sales(&self) -> Result<Vec<Value>, String> {
        let url = format!("{}/rest/v1/sales_backup?select=*", self.url);
        let response = self
            .client
            .get(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch sales: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Supabase error: {} - {}", status, error_text));
        }

        let sales: Vec<Value> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(sales)
    }

    pub async fn fetch_sale_items(&self) -> Result<Vec<Value>, String> {
        let url = format!("{}/rest/v1/sale_items_backup?select=*", self.url);
        let response = self
            .client
            .get(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch sale items: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Supabase error: {} - {}", status, error_text));
        }

        let sale_items: Vec<Value> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(sale_items)
    }

    pub async fn test_connection(&self) -> Result<bool, String> {
        let url = format!("{}/rest/v1/", self.url);
        let response = self
            .client
            .get(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .send()
            .await
            .map_err(|e| format!("Connection test failed: {}", e))?;

        Ok(response.status().is_success())
    }

    async fn upsert_table(&self, table: &str, rows: Vec<Value>) -> Result<(), String> {
        if rows.is_empty() {
            return Ok(());
        }
        let url = format!("{}/rest/v1/{}", self.url, table);
        let response = self
            .client
            .post(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates")
            .json(&rows)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Supabase error: {} - {}", status, error_text));
        }
        Ok(())
    }

    async fn fetch_table(&self, table: &str) -> Result<Vec<Value>, String> {
        let url = format!("{}/rest/v1/{}?select=*", self.url, table);
        let response = self
            .client
            .get(&url)
            .header("apikey", &self.key)
            .header("Authorization", &format!("Bearer {}", self.key))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch {}: {}", table, e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            // Table may not exist yet — treat as empty
            if status.as_u16() == 404 || error_text.contains("does not exist") {
                return Ok(vec![]);
            }
            return Err(format!("Supabase error: {} - {}", status, error_text));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Failed to parse {}: {}", table, e))
    }

    pub async fn upsert_activity_logs(&self, rows: Vec<Value>) -> Result<(), String> {
        self.upsert_table("activity_logs_backup", rows).await
    }

    pub async fn fetch_activity_logs(&self) -> Result<Vec<Value>, String> {
        self.fetch_table("activity_logs_backup").await
    }

    pub async fn upsert_customer_debts(&self, rows: Vec<Value>) -> Result<(), String> {
        self.upsert_table("customer_debts_backup", rows).await
    }

    pub async fn fetch_customer_debts(&self) -> Result<Vec<Value>, String> {
        self.fetch_table("customer_debts_backup").await
    }

    pub async fn upsert_debt_entries(&self, rows: Vec<Value>) -> Result<(), String> {
        self.upsert_table("debt_entries_backup", rows).await
    }

    pub async fn fetch_debt_entries(&self) -> Result<Vec<Value>, String> {
        self.fetch_table("debt_entries_backup").await
    }
}

