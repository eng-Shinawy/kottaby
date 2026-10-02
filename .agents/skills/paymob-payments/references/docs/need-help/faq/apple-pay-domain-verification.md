---
title: "Apple Pay - Domain Verification"
url: https://developers.paymob.com/paymob-docs/need-help/faq/apple-pay-domain-verification
tab: documentation
breadcrumbs: "Need Help? > FAQ > Apple Pay - Domain Verification"
---

# Apple Pay - Domain Verification
### How to verify?

###### 1

### Access Apple Developer Portal

🔵 For Everyone:

  1. Go to [Apple Developer Portal](https://developer.apple.com/account/)

  2. Sign in with your Apple ID

  3. Click **"Certificates, Identifiers & Profiles"**

###### 2

### Create or Select Merchant ID

🔵 For Everyone:

  1. In the left sidebar, click **"Identifiers"**

  2. Click the **dropdown** and select **"Merchant IDs"**

  3. You have two options:

**Option A: Create New Merchant ID**

  - Click the **"+"** button

  - Choose **"Merchant IDs"**

  - Enter a description (e.g., "My Shop Apple Pay")

  - Enter an identifier (e.g., `merchant.com.myshop`)

  - Click **"Continue"** then **"Register"**

**Option B: Use Existing Merchant ID**

  - Click on your existing Merchant ID

###### 3

### Enable Domain Verification

**🔵 For Everyone:**

  1. On your Merchant ID page, scroll down to **"Merchant Domains"**

  2. Click **"Add Domain"**

###### 4

### Enter Your Domain

**🔵 For Everyone:**

  1. Enter your domain name: `yourwebsite.com`

  2. Click **"Next"**

> **Error:**
> 
> Don't include `https://` or `www.` Just the domain: `myshop.com`

###### 5

### Download Verification File

**🔵 For Everyone:**

Apple will generate a file with this exact name: “**apple-developer-merchantid-domain-association** ”. Please click **"Download" and** save it to your computer.

> **Error:**
> 
> Please don't rename it or add any extensions like`**.txt**`**,**`**.json**`, …

###### 6

### Upload to Your Website

Place this file in a specific location on your website, like below:

[`https://yourdomain/.well-known/apple-developer-merchantid-domain-association`](https://yourdomain/.well-known/apple-developer-merchantid-domain-association)

Please check the below for more guidance 

#### 🟢 For WordPress Users

**Method 1: Using cPanel File Manager**

  1. Log in to your hosting **cPanel**

  2. Open **"File Manager"**

  3. Navigate to `public_html/` (your WordPress root folder)

  4. Click **"New Folder"**

  5. Use a folder name `.well-known` (include the dot!)

  6. Open the `.well-known` folder

  7. Click **"Upload"**

  8. Upload the Apple verification file

  9. Done!

**Method 2: Using FTP (FileZilla)**

  1. Connect to your website via FTP

  2. Navigate to the root directory (where you see `wp-config.php`)

  3. Create a new folder: `.well-known`

  4. Enter the `.well-known` folder

  5. Upload the Apple verification file

  6. Done!

**Visual Guide:**

#### 🟢 For non CMS Websites

**Ubuntu/Linux Server:**

```bash
# Navigate to your web root
cd /var/www/html/

# Create .well-known directory
mkdir -p .well-known

# Upload your file (use SCP, SFTP, or manual upload)
# Place it at: /var/www/html/.well-known/apple-developer-merchantid-domain-association

# Set proper permissions
chmod 644 .well-known/apple-developer-merchantid-domain-association
``` 

**Windows Server:**

```powershell
# Navigate to your web root (typically)
cd C:\inetpub\wwwroot\

# Create .well-known folder
mkdir .well-known

# Place the verification file inside this folder
``` 

* * *

### Validate the verification

###### 1

### Test File Accessibility

**🔵 For Everyone:**

  1. Open your browser (use Incognito/Private mode)

  2. Visit: `https://yourdomain.com/.well-known/apple-developer-merchantid-domain-association`

  3. You should see a long string of text (the certificate content)

**If you see the text →→** Perfect! Continue to next step.

**If you see 404 Not Found →→** File not in the right place, review Step 1.6

**If you see 403 Forbidden →→** Permission issue - set file permissions to 644

###### 2

### Complete Verification

**🔵 For Everyone:**

  1. Return to Apple Developer Portal

  2. Click **"Verify"** button

  3. Apple will check if the file is accessible

  4. Wait 30 seconds to 2 minutes

**If you see Success! →→** Your domain will appear under **"Registered Domains"**
