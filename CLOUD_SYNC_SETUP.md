# ☁️ Cloud Backup & Sync Setup

## Overview
This POS system includes cloud backup capabilities using **Supabase** (free tier) for data synchronization and backup.

## 🚀 Quick Setup

### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Sign up/Login to your account
3. Click "New Project"
4. Fill in project details:
   - **Name**: `pos-system-backup`
   - **Database Password**: Choose a strong password
   - **Region**: Select closest to your location

### 2. Get API Keys
After project creation (takes ~2 minutes):
1. Go to **Settings** → **API**
2. Copy these values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon/public key**: `eyJ...`
   - **service_role key**: `eyJ...` (keep secret!)

### 3. Configure Database Tables
Run these SQL commands in **Supabase SQL Editor**:

```sql
-- Users backup table
CREATE TABLE users_backup (
    id BIGINT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    name TEXT,
    email TEXT,
    role TEXT NOT NULL,
    business_id BIGINT,
    created_at TEXT,
    synced_at TIMESTAMP DEFAULT NOW()
);

-- Businesses backup table
CREATE TABLE businesses_backup (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    client_id TEXT UNIQUE NOT NULL,
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
    synced_at TIMESTAMP DEFAULT NOW()
);

-- Products backup table
CREATE TABLE products_backup (
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
    is_active BOOLEAN DEFAULT TRUE,
    created_at TEXT,
    synced_at TIMESTAMP DEFAULT NOW()
);

-- Sales backup table
CREATE TABLE sales_backup (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    total_amount REAL NOT NULL,
    payment_method TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    created_at TEXT,
    notes TEXT,
    synced_at TIMESTAMP DEFAULT NOW()
);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE users_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE products_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_backup ENABLE ROW LEVEL SECURITY;
```

### 4. Update Rust Code
Edit `src-tauri/src/lib.rs`:

```rust
// Replace placeholder values with your actual Supabase credentials
const SUPABASE_URL: &str = "https://your-project-id.supabase.co";
const SUPABASE_ANON_KEY: &str = "your-anon-key";
const SUPABASE_SERVICE_ROLE_KEY: &str = "your-service-role-key";
```

### 5. Test Connection
1. Run the app
2. Login as Super Super Admin
3. Go to Dashboard → Cloud Backup & Sync section
4. Click "Backup to Cloud" to test

## 📊 Features

### ✅ Current Features
- **Data Preparation**: Automatically collects all local data
- **Sync Status**: Shows connection status and last sync time
- **Orphaned User Cleanup**: Fixes data consistency issues
- **Manual Sync**: Backup/Restore buttons in admin dashboard

### 🚧 Coming Soon
- **Automatic Sync**: Real-time synchronization
- **Multi-device Support**: Sync across multiple POS terminals
- **Conflict Resolution**: Handle data conflicts between devices
- **Selective Backup**: Choose what data to sync

## 💰 Free Tier Limits

**Supabase Free Tier:**
- **Database**: 500MB storage
- **Bandwidth**: 50MB/month
- **Users**: Unlimited
- **Projects**: 2 (can upgrade for more)

**Our Usage Estimate:**
- **100 businesses**: ~50MB
- **1000 products**: ~10MB
- **10,000 sales**: ~20MB
- **Total**: ~80MB (well within limits)

## 🔒 Security

- **Row Level Security**: Enabled on all tables
- **API Keys**: Separate public/service role keys
- **Encryption**: Data encrypted in transit and at rest
- **Access Control**: Only authenticated admin access

## 🆘 Troubleshooting

### "Sync failed" errors
1. Check Supabase project is active
2. Verify API keys are correct
3. Check internet connection
4. Review Supabase dashboard for errors

### Data not syncing
1. Ensure tables exist in Supabase
2. Check column names match exactly
3. Verify user permissions
4. Check Supabase logs

### Performance issues
- Sync large datasets during off-hours
- Consider pagination for large data sets
- Monitor Supabase usage dashboard

## 📞 Support

For issues with cloud sync:
1. Check this documentation
2. Review Supabase dashboard
3. Check application logs
4. Contact support with error details

---

**🎉 Your POS system now has enterprise-grade backup and sync capabilities!**







