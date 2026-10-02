---
title: "Apple Pay - Certificates Creation"
url: https://developers.paymob.com/paymob-docs/need-help/faq/apple-pay-certificates-creation
tab: documentation
breadcrumbs: "Need Help? > FAQ > Apple Pay - Certificates Creation"
---

# Apple Pay - Certificates Creation
### What You'll Create

  - **Certificate 1:** Merchant Identity Certificate (verifies your business)

  - **Certificate 2:** Payment Processing Certificate (encrypts payment data)

> **Info:**
> 
> At the end of this page, you'll find a tool that will guide and help you while creating the certificates.

### Prerequisites Check

**🟢 For Developers:**

Before starting, verify OpenSSL is installed:

```bash
openssl version
``` 

**If you see a version number →→** You're ready!

**If you see "command not found" →→** Install OpenSSL:

###### 1

#### **macOS**

```bash
brew install openssl
``` 

###### 2

#### **Ubuntu/Debian**

```bash
sudo apt update
sudo apt install openssl
``` 

###### 3

#### **Windows**

[Download OpenSSL Installer](https://slproweb.com/products/Win32OpenSSL.html)

### How to create the Merchant Identity Certificate?

###### 1

#### Generate RSA Private Key

**🟢 For Developers:**

```bash
openssl genpkey -algorithm RSA -out merchant_identity.key
``` 

This creates the RSA private key (2048-bit) named `**merchant_identity.key**`

###### 2

#### Generate CSR for Merchant Certificate

**🟢 For Developers:**

```bash
openssl req -new -key merchant_identity.key -out merchant_identity.csr
``` 

This creates the CSR file named `**merchant_identity.csr**`

###### 3

#### Upload CSR to Apple

**🔵 For Everyone:**

  1. Go to Apple Developer Portal → Your Merchant ID

  2. Scroll to **"Apple Pay Merchant Identity Certificate"**

  3. Click **"Create Certificate"**

  4. Upload your `merchant_identity.csr` file

  5. Click **"Continue"**

  6. Download the generated certificate (e.g., `**merchant_id.cer**`)

###### 4

#### Convert Certificate Format

**🟢 For Developers:**

```bash
openssl x509 -inform DER -in merchant_id.cer -out merchant_certificate.pem
``` 

This creates the PEM file named `merchant_certificate.pem`

###### 5

#### Certificate 1 Complete!

You now have:

  - `merchant_identity.key` (private key)

  - `merchant_id.cer` (certificate)

  - `merchant_certificate.pem` (certificate)

### How to create the Payment Processing Certificate?

###### 1

#### Generate Private Key

**🟢 For Developers:**

```bash
openssl ecparam -genkey -name prime256v1 -out payment_processing.key
``` 

This creates the RSA private key (2048-bit) named `**payment_processing.key**`

###### 2

#### Generate Certificate Signing Request (CSR)

**🟢** **For Developers:**

> **Info:**
> 
> **Critical Fields:**
> 
>   - **Country Name:** Must be 2 letters
> 
>   - **Common Name:** Must be your exact domain
> 
> 

> 
> **Note** : Skip optional fields by pressing Enter

This creates the CSR file named `payment_processing.csr`

###### 3

#### Upload CSR to Apple

**🔵 For Everyone:**

  1. Go to Apple Developer Portal → Your Merchant ID

  2. Scroll to **"Apple Pay Payment Processing Certificate"**

  3. Click **"Create Certificate"**

  4. Click **"Choose File"**

  5. Select your `payment_processing.csr` file

  6. Click **"Continue"**

  7. Apple generates your certificate - Click **"Download"**

  8. Save the file (it will be named something like `apple_pay.cer`)

###### 4

#### Convert Certificate Format

**🟢 For Developers:**

Apple provides the certificate in `.cer` format, but we need `.pem` format:

```bash
openssl x509 -inform DER -in apple_pay.cer -out payment_certificate.pem
``` 

This creates the PEM file named `**payment_certificate.pem**`

###### 5

#### Certificate 2 Complete!

You now have:

  - `payment_processing.key` (private key)

  - `apple_pay.cer` (certificate)

  - `payment_certificate.pem` (certificate)

### All Certificate Files Ready!

**You should now have these 6 files:**

payment_processing.key (Payment private key)

apple_pay.cer (Payment certificate)

payment_certificate.pem (Payment certificate)

merchant_identity.key (Merchant private key)

merchant_id.cer (Merchant certificate)

merchant_certificate.pem (Merchant certificate)

### Secure File Sharing

**🔵 For Everyone:**

**Password-Protected ZIP (Recommended)**

  1. Place all files in a folder

  2. Compress to ZIP with password protection

  3. Send **ZIP** via email to [**support@paymob.com**](mailto:support@paymob.com)

  4. Send password via separate channel (SMS/WhatsApp)

### Helper Tool
