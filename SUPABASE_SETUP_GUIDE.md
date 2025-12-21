# 🚀 Supabase Cloud Sync Setup - Step by Step

This guide will help you set up Supabase (free tier) for online database syncing with your POS system.

## Step 1: Create Supabase Account & Project

1. **Go to [supabase.com](https://supabase.com)**
2. **Click "Start your project"** or **Sign up** (it's free!)
3. **Sign up with GitHub** (recommended) or email
4. **Click "New Project"**
5. **Fill in project details:**
   - **Name**: `pos-system-sync` (or your preferred name)
   - **Database Password**: Create a strong password (save it!)
   - **Region**: Choose closest to your location
   - **Pricing Plan**: Select **Free** tier
6. **Click "Create new project"**
7. **Wait 2-3 minutes** for project to be ready

## Step 2: Get Your API Keys

1. **Once project is ready**, go to **Settings** (gear icon) → **API**
2. **Copy these values** (you'll need them):
   - **Project URL**: `https://xxxxxxxxxxxxx.supabase.co`
   - **anon public key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (long string)
   - **service_role key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (keep this secret!)

## Step 3: Create Database Tables

1. **Go to SQL Editor** (left sidebar)
2. **Click "New query"**
3. **Copy and paste this SQL** (click "Run" button):

```sql
-- Users sync table
CREATE TABLE IF NOT EXISTS users_sync (
    id BIGINT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    email TEXT,
    role TEXT NOT NULL,
    business_id BIGINT,
    temporary_password TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TEXT,
    synced_at TIMESTAMP DEFAULT NOW(),
    last_modified TIMESTAMP DEFAULT NOW()
);

-- Businesses sync table
CREATE TABLE IF NOT EXISTS businesses_sync (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    client_id TEXT UNIQUE NOT NULL,
    logo_path TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    primary_color TEXT DEFAULT '#3B82F6',
    secondary_color TEXT DEFAULT '#1E40AF',
    modules_enabled TEXT NOT NULL,
    subscription_status TEXT DEFAULT 'TRIAL',
    created_by BIGINT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TEXT,
    synced_at TIMESTAMP DEFAULT NOW(),
    last_modified TIMESTAMP DEFAULT NOW()
);

-- Products sync table
CREATE TABLE IF NOT EXISTS products_sync (
    id BIGINT PRIMARY KEY,
    business_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    cost_price REAL NOT NULL,
    stock_quantity INTEGER DEFAULT 0,
    min_stock_level INTEGER DEFAULT 0,
    barcode TEXT,
    image_path TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TEXT,
    synced_at TIMESTAMP DEFAULT NOW(),
    last_modified TIMESTAMP DEFAULT NOW()
);

-- Sales sync table
CREATE TABLE IF NOT EXISTS sales_sync (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    total_amount REAL NOT NULL,
    payment_method TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    notes TEXT,
    created_at TEXT,
    synced_at TIMESTAMP DEFAULT NOW(),
    last_modified TIMESTAMP DEFAULT NOW()
);

-- Sale items sync table
CREATE TABLE IF NOT EXISTS sale_items_sync (
    id BIGINT PRIMARY KEY,
    sale_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    synced_at TIMESTAMP DEFAULT NOW(),
    last_modified TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_business_id ON users_sync(business_id);
CREATE INDEX IF NOT EXISTS idx_products_business_id ON products_sync(business_id);
CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales_sync(user_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items_sync(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items_sync(product_id);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE users_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE products_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items_sync ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (for now - you can restrict later)
CREATE POLICY "Allow all operations" ON users_sync FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON businesses_sync FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON products_sync FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON sales_sync FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON sale_items_sync FOR ALL USING (true) WITH CHECK (true);
```

4. **Click "Run"** (or press Ctrl+Enter)
5. **Verify tables were created** by going to **Table Editor** (left sidebar)

## Step 4: Configure Your Application

1. **Open** `pos-system/src-tauri/src/lib.rs`
2. **Find these lines** (around line 9-12):
   ```rust
   const SUPABASE_URL: &str = "https://your-project.supabase.co";
   const SUPABASE_ANON_KEY: &str = "your-anon-key";
   const SUPABASE_SERVICE_ROLE_KEY: &str = "your-service-role-key";
   ```
3. **Replace with your actual values** from Step 2:
   ```rust
   const SUPABASE_URL: &str = "https://xxxxxxxxxxxxx.supabase.co";
   const SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
   const SUPABASE_SERVICE_ROLE_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
   ```

## Step 5: Test the Connection

1. **Build and run your application**:
   ```bash
   npm run tauri:dev
   ```
2. **Login as Super Super Admin**
3. **Go to Dashboard** → Look for **Cloud Sync** section
4. **Click "Sync to Cloud"** to test
5. **Check Supabase Dashboard** → **Table Editor** to see if data appears

## Step 6: Clear Local Data (Optional - Fresh Start)

If you want to start fresh:

1. **In your app**, go to **Super Admin Dashboard**
2. **Click "Reset Database"** (if available)
3. **Or manually delete** the local database file:
   - Windows: `C:\Users\YourName\AppData\Roaming\pos-system\pos.db`
   - macOS: `~/Library/Application Support/pos-system/pos.db`
   - Linux: `~/.local/share/pos-system/pos.db`

## ✅ You're Done!

Your POS system is now connected to Supabase! 

### How It Works:

1. **Local First**: All data is saved locally first (works offline)
2. **Sync to Cloud**: When you click "Sync to Cloud", data is pushed to Supabase
3. **Sync from Cloud**: When you click "Sync from Cloud", data is pulled from Supabase
4. **Automatic**: Future versions will support automatic background sync

### Free Tier Limits:

- ✅ **500MB database storage** (plenty for thousands of records)
- ✅ **50MB/month bandwidth** (enough for regular syncing)
- ✅ **Unlimited projects** (you can create multiple)
- ✅ **No credit card required**

### Next Steps:

- Test creating a business and syncing it
- Test creating products and syncing them
- Test making a sale and syncing it
- Monitor your usage in Supabase dashboard

## 🆘 Troubleshooting

### "Connection failed" error
- Check your internet connection
- Verify Supabase URL is correct
- Make sure project is active (not paused)

### "Authentication failed" error
- Verify API keys are correct
- Check if you copied the full key (they're long!)

### "Table not found" error
- Make sure you ran the SQL script in Step 3
- Check Table Editor to verify tables exist

### Data not syncing
- Check Supabase logs (Settings → Logs)
- Verify Row Level Security policies are set correctly
- Check application console for error messages

---

**🎉 Congratulations! Your POS system now has cloud backup and sync!**




