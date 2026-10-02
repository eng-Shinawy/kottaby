---
title: "New Dashboard"
url: https://developers.paymob.com/paymob-docs/getting-started/new-dashboard
tab: documentation
breadcrumbs: "Getting Started > New Dashboard"
---

# New Dashboard
![](https://d24lr4zqs1tgqh.cloudfront.net/ad54d630-364b-4c66-9764-98aad70f6179-696e9edc0acf4f5a50bce69f.svg)

**Who is this for** - Everyone

**Outcome** - Full and quick guide for the new Paymob dashboard.

* * *

﻿﻿ 

## **Overview**

Our Dashboard allows you to monitor and analyze all payment activities from a single, centralized platform. You will have access to detailed payment histories, transaction insights, and comprehensive analytics to support leading informed business decisions.

## Home Page

The **Home** section provides a high-level summary of your business performance.

#### Filters

  - Time period

  - Channels (Online, POS, Paymob App)

  - Currency

#### Performance Comparison

  - Total Sales (Current vs Previous)

  - Net Sales (Current vs Previous)

  - Terminals Revenue (Current vs Previous)

  - Payment Methods Usage

#### Insights & Highlights

  - Top Failure Reasons

  - Performance Highlights

## Transactions

The **Transactions** section allows you to view and manage all transactions.

#### Summary View

Provides a quick overview of:

  - Total Sales

  - Total Transactions

  - Refunded Transactions

#### Actions

Depending on the transaction status and type, you can:

  - Refund

  - Void

  - Capture

#### Filters

  - Time period

  - Status (Success, Pending, Declined

  - Currency

  - Payment Method (Cards, Mobile Wallets, Valu, etc.)

  - Transaction Type (3D Secure, Capture, Void, Refund, etc.)

  - Channels (Online, POS, Paymob App)

  - Transaction ID

  - Order ID

  - Terminal ID

  - Integration ID

  - Merchant Order ID

  - Phone Number

  - Fingerprint (unique card identifier across the merchant account)

#### Transaction Details

Selecting a transaction opens a detailed view with:

  - Details (Transaction & Order information)

  - Payment Method

  - Transaction Breakdown (amount details)

  - Customer (customer information)

## Orders

The **Orders** section displays all created orders.

#### Filters

  - Time period

  - Status (Paid, Unpaid)

  - Currency

  - Split Payments

  - Order ID

  - Merchant Order ID

  - Order URL

  - Created By

  - Phone Number

  - Last four digits of the card

#### Order Details

Selecting an order opens its full details view. If the order is paid, the Shipping and Client details will appear.

#### Actions

**Delete Order** : Hides the order from the dashboard (does not delete it from the system)

## Quick Links

The **Quick Links** section allows you to manage payment links.

#### Filters

  - Time period

  - Status (Paid, Unpaid, Canceled)

  - Currency

  - Merchant Payment Link ID

  - Payment Link URL

  - Phone Number

#### Quick Link Details

Selecting a link shows its full details.

#### Actions

  - **Cancel**

  - **Share**

> **Info:**
> 
> For a detailed overview, refer to the [**Quick Links**](https://developers.paymob.com/paymob-docs/integration-paths/no-code/payment-links) page.

## Settings

The **Settings** section allows you to manage your account configuration.

### Business Profile

#### Business Info

  - Update business name, account type, sector, and industry

  - Upload and manage business logo

#### Social Media

  - Add and manage social media links

### Profile Details

#### Contact Info

  - Manage phone numbers

#### Account Information

  - View account details

  - Change password

### Checkout Customization

From the **Merchant Dashboard** , you can fully personalize the checkout experience to align with your brand and business needs.

#### Branding

  - Add your business logo and details

  - Customize brand colors

  - Select fonts that match your brand identity

  - Choose button styles (Rounded or Rectangular)

#### Payment

  - Choose how payment methods are displayed (Tabs or List)

  - Enable or disable specific payment methods

  - Show or hide billing address fields

  - Display purchased item details

  - Enable the “Save Card” option

  - Activate Split Payments and control the number of cards allowed

  - Display Terms & Conditions link

  - Enable or disable payment retries

#### Post-Payment

  - Show a custom thank-you message

  - Customize the post-payment redirection flow

> **Info:**
> 
> Notes:
> 
> \- Changes will only take effect after you click "**Apply changes** ".
> 
> \- If you wish to revert to the default settings provided by Paymob, click "**Reset** ".

### Payment Integrations

Manage all payment integrations from the Payment Integrations tab

  - Retrieve integration credentials based on selected mode (Live / Test)

  - Add test integrations for payment methods:

    - Cards (MIGS)

    - Wallets

    - Kiosk payments

  - Update callback URLs for each integration

> **Info:**
> 
> Make sure that you have selected the desired mode (live/test)

### API Keys

Access and manage your credentials:

  - Secret Key

  - Public Key

  - API Key

  - HMAC Secret

### Users & Permissions

The Users & Permissions section allows you to define roles, control access levels, and add sub-users to your account.

### Roles

The system has the following roles, and you can edit them or add your own custom roles.

Role

Description

Admin| Manages daily operations, including orders, products, payments, and staff access.  
---|---  
  
Owner| Full access to manage the account, payments, integrations, team, and security settings.  
  
Developer| Manages payment integrations, API keys, and iframes.  
  
Finance| View-only access to orders, transactions, payment links, and transfers.  
  
Operations| Manages orders, products, transactions, payment links, payment actions (capture, refund, void), payment integrations, and transfers.  
  
Sales| View-only access to orders, products, iframes, payment links, transactions, payment integrations, and transfers.  
  
**Actions**

  - Add role

  - Update Role permissions


#### Users

You can filter and manage the users

**Filters**

  - Name

  - Phone Number

  - Email

  - Role

  - Status (Active, Pending, and Expired)

**Actions**

  - Invite Member

  - Update role

  - Delete user


