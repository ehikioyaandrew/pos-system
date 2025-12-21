use lettre::{
    Message, AsyncTransport,
    message::{header::ContentType, Mailbox},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, Tokio1Executor,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailConfig {
    pub smtp_server: String,
    pub smtp_port: u16,
    pub username: String,
    pub password: String,
    pub from_email: String,
    pub from_name: String,
    pub use_tls: bool,
}

impl Default for EmailConfig {
    fn default() -> Self {
        Self {
            // Default to Gmail SMTP (free)
            smtp_server: "smtp.gmail.com".to_string(),
            smtp_port: 587,
            username: String::new(),
            password: String::new(),
            from_email: String::new(),
            from_name: "POS System".to_string(),
            use_tls: true,
        }
    }
}

pub struct EmailService {
    config: EmailConfig,
}

impl EmailService {
    pub fn new(config: EmailConfig) -> Self {
        Self { config }
    }

    pub async fn send_email(
        &self,
        to: &str,
        subject: &str,
        body: &str,
        is_html: bool,
    ) -> Result<(), String> {
        if self.config.username.is_empty() || self.config.password.is_empty() {
            return Err("Email not configured. Please set up SMTP credentials.".to_string());
        }

        let from_mailbox: Mailbox = format!("{} <{}>", self.config.from_name, self.config.from_email)
            .parse()
            .map_err(|e| format!("Invalid from email: {}", e))?;

        let to_mailbox: Mailbox = to
            .parse()
            .map_err(|e| format!("Invalid to email: {}", e))?;

        let email_builder = Message::builder()
            .from(from_mailbox)
            .to(to_mailbox)
            .subject(subject);

        let email = if is_html {
            email_builder
                .header(ContentType::TEXT_HTML)
                .body(body.to_string())
        } else {
            email_builder
                .header(ContentType::TEXT_PLAIN)
                .body(body.to_string())
        }
        .map_err(|e| format!("Failed to build email: {}", e))?;

        // Create async SMTP transport
        let builder = AsyncSmtpTransport::<Tokio1Executor>::relay(&self.config.smtp_server)
            .map_err(|e| format!("Failed to create SMTP relay: {}", e))?
            .port(self.config.smtp_port)
            .credentials(Credentials::new(
                self.config.username.clone(),
                self.config.password.clone(),
            ));

        let mailer = if self.config.use_tls {
            builder
        } else {
            builder
        }
        .build();

        // Send email asynchronously
        mailer
            .send(email)
            .await
            .map_err(|e| format!("Failed to send email: {}", e))?;

        Ok(())
    }

    pub async fn send_low_stock_alert(
        &self,
        to: &str,
        product_name: &str,
        current_stock: i32,
        min_stock: i32,
    ) -> Result<(), String> {
        let subject = format!("⚠️ Low Stock Alert: {}", product_name);
        let body = format!(
            r#"
            <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #dc2626;">Low Stock Alert</h2>
                <p>Product: <strong>{}</strong></p>
                <p>Current Stock: <strong style="color: #dc2626;">{}</strong></p>
                <p>Minimum Stock Level: <strong>{}</strong></p>
                <p>Please restock this product as soon as possible.</p>
                <hr>
                <p style="color: #6b7280; font-size: 12px;">This is an automated notification from your POS System.</p>
            </body>
            </html>
            "#,
            product_name, current_stock, min_stock
        );

        self.send_email(to, &subject, &body, true).await
    }

    pub async fn send_out_of_stock_alert(
        &self,
        to: &str,
        product_name: &str,
    ) -> Result<(), String> {
        let subject = format!("🚨 Out of Stock: {}", product_name);
        let body = format!(
            r#"
            <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #dc2626;">Out of Stock Alert</h2>
                <p>Product: <strong>{}</strong></p>
                <p style="color: #dc2626; font-size: 18px;"><strong>This product is completely out of stock!</strong></p>
                <p>Please restock immediately to avoid sales disruption.</p>
                <hr>
                <p style="color: #6b7280; font-size: 12px;">This is an automated notification from your POS System.</p>
            </body>
            </html>
            "#,
            product_name
        );

        self.send_email(to, &subject, &body, true).await
    }

    pub async fn send_pending_sale_notification(
        &self,
        to: &str,
        sale_id: i64,
        total_amount: f64,
        item_count: i64,
        created_at: &str,
    ) -> Result<(), String> {
        let subject = format!("💰 Pending Sale #{}", sale_id);
        let body = format!(
            r#"
            <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #2563eb;">Pending Sale Notification</h2>
                <p>Sale ID: <strong>#{}</strong></p>
                <p>Total Amount: <strong style="color: #059669;">₦{:.2}</strong></p>
                <p>Items: <strong>{}</strong></p>
                <p>Created: <strong>{}</strong></p>
                <p>This sale is pending completion. Please review and process the payment.</p>
                <hr>
                <p style="color: #6b7280; font-size: 12px;">This is an automated notification from your POS System.</p>
            </body>
            </html>
            "#,
            sale_id, total_amount, item_count, created_at
        );

        self.send_email(to, &subject, &body, true).await
    }

    pub async fn send_daily_sales_report(
        &self,
        to: &str,
        date: &str,
        total_sales: f64,
        transaction_count: i64,
        top_products: Vec<(String, i64)>,
    ) -> Result<(), String> {
        let subject = format!("📊 Daily Sales Report - {}", date);
        
        let top_products_html = if top_products.is_empty() {
            "<p>No sales today.</p>".to_string()
        } else {
            let mut html = "<table style='width: 100%; border-collapse: collapse; margin: 20px 0;'>".to_string();
            html.push_str("<tr style='background-color: #f3f4f6;'><th style='padding: 10px; text-align: left; border: 1px solid #ddd;'>Product</th><th style='padding: 10px; text-align: left; border: 1px solid #ddd;'>Quantity Sold</th></tr>");
            for (product, qty) in top_products {
                html.push_str(&format!(
                    "<tr><td style='padding: 10px; border: 1px solid #ddd;'>{}</td><td style='padding: 10px; border: 1px solid #ddd;'>{}</td></tr>",
                    product, qty
                ));
            }
            html.push_str("</table>");
            html
        };

        let body = format!(
            r#"
            <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #2563eb;">Daily Sales Report</h2>
                <p><strong>Date:</strong> {}</p>
                <div style="background-color: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="font-size: 24px; margin: 0;"><strong>Total Sales: ₦{:.2}</strong></p>
                    <p style="margin: 5px 0 0 0;">Transactions: {}</p>
                </div>
                <h3>Top Products</h3>
                {}
                <hr>
                <p style="color: #6b7280; font-size: 12px;">This is an automated daily report from your POS System.</p>
            </body>
            </html>
            "#,
            date, total_sales, transaction_count, top_products_html
        );

        self.send_email(to, &subject, &body, true).await
    }

    pub async fn send_new_user_registration_notification(
        &self,
        to: &str,
        new_user_name: &str,
        new_user_email: &str,
        new_user_role: &str,
        business_name: &str,
    ) -> Result<(), String> {
        let subject = format!("👤 New User Registered: {}", new_user_name);
        let body = format!(
            r#"
            <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #2563eb;">New User Registration</h2>
                <p>A new user has been registered in your POS system.</p>
                <div style="background-color: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Name:</strong> {}</p>
                    <p><strong>Email:</strong> {}</p>
                    <p><strong>Role:</strong> {}</p>
                    <p><strong>Business:</strong> {}</p>
                </div>
                <p>You can manage this user from the Staff Management section.</p>
                <hr>
                <p style="color: #6b7280; font-size: 12px;">This is an automated notification from your POS System.</p>
            </body>
            </html>
            "#,
            new_user_name, new_user_email, new_user_role, business_name
        );

        self.send_email(to, &subject, &body, true).await
    }

    pub async fn send_password_reset_email(
        &self,
        to: &str,
        user_name: &str,
        reset_token: &str,
        reset_url: Option<&str>,
    ) -> Result<(), String> {
        let subject = "🔒 Password Reset Request";
        let reset_link = if let Some(url) = reset_url {
            format!("<a href=\"{}\">Click here to reset your password</a>", url)
        } else {
            format!("Use this reset code: <strong>{}</strong>", reset_token)
        };
        
        let body = format!(
            r#"
            <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #2563eb;">Password Reset Request</h2>
                <p>Hello {},</p>
                <p>You have requested to reset your password for your POS System account.</p>
                <div style="background-color: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Reset Token:</strong> {}</p>
                    <p style="margin-top: 15px;">{}</p>
                </div>
                <p>If you did not request this password reset, please ignore this email.</p>
                <p><strong>Note:</strong> This reset token will expire in 1 hour.</p>
                <hr>
                <p style="color: #6b7280; font-size: 12px;">This is an automated email from your POS System.</p>
            </body>
            </html>
            "#,
            user_name, reset_token, reset_link
        );

        self.send_email(to, &subject, &body, true).await
    }
}

// Helper function to get email config from database or environment
pub fn get_email_config_from_env() -> EmailConfig {
    EmailConfig {
        smtp_server: std::env::var("SMTP_SERVER")
            .unwrap_or_else(|_| "smtp.gmail.com".to_string()),
        smtp_port: std::env::var("SMTP_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(587),
        username: std::env::var("SMTP_USERNAME").unwrap_or_default(),
        password: std::env::var("SMTP_PASSWORD").unwrap_or_default(),
        from_email: std::env::var("SMTP_FROM_EMAIL")
            .unwrap_or_else(|_| std::env::var("SMTP_USERNAME").unwrap_or_default()),
        from_name: std::env::var("SMTP_FROM_NAME")
            .unwrap_or_else(|_| "POS System".to_string()),
        use_tls: std::env::var("SMTP_USE_TLS")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(true),
    }
}

