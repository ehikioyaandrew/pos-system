# 📧 Email Notification Structure

## Current Implementation

### Who Receives Emails?
Currently, emails are sent to:
- **SuperAdmin** (Business Admin)
- **Manager** roles only

**NOT sent to:**
- Staff
- Secretary

### When Are Emails Sent?

#### 1. Low Stock Alerts
**Triggered when:**
- `fridge_stock <= min_stock_level` OR
- `show_stock <= min_stock_level` OR  
- `store_stock <= min_stock_level`

**Email sent to:** All SuperAdmin and Manager users with valid email addresses

**Email content:** 
- Product name
- Current total stock (fridge + show + store)
- Minimum stock level
- Alert message

#### 2. Out of Stock Alerts
**Triggered when:**
- `fridge_stock == 0` AND `show_stock == 0` AND `store_stock == 0`

**Email sent to:** All SuperAdmin and Manager users with valid email addresses

**Email content:**
- Product name
- Urgent out of stock alert

#### 3. Pending Sales Notifications
**Triggered when:**
- A sale is created with `payment_status = 'PENDING'`

**Email sent to:** All SuperAdmin and Manager users with valid email addresses

**Email content:**
- Sale ID
- Total amount
- Number of items
- Creation timestamp

### Stock Check Logic

The system checks **all three stock types**:
1. **Fridge Stock** - Stock available at POS (fridge)
2. **Show Stock** - Display/show stock
3. **Store Stock** - Warehouse/store stock

**Low Stock Detection:**
- If ANY of the three stock types falls below `min_stock_level`, an alert is sent
- The email shows the **total stock** (sum of all three)

**Out of Stock Detection:**
- Only when ALL three stock types are at 0

### Email Recipient Selection

Current query in `get_business_notification_emails()`:
```sql
SELECT email FROM users 
WHERE business_id = ?1 
AND (role = 'SuperAdmin' OR role = 'Manager')
AND email IS NOT NULL 
AND email != ''
AND is_active = 1
```

This means:
- ✅ SuperAdmin users get emails
- ✅ Manager users get emails
- ❌ Staff users do NOT get emails
- ❌ Secretary users do NOT get emails
- ❌ Users without email addresses are skipped
- ❌ Inactive users are skipped

## Configuration Options

Would you like to customize who receives emails? Options:

1. **Current (Admin + Manager only)** - Default
2. **Admin only** - Only SuperAdmin
3. **Admin + Manager + Secretary** - Include Secretary
4. **All staff** - Everyone with email
5. **Custom roles** - Select specific roles
6. **Per-notification type** - Different recipients for different alerts


