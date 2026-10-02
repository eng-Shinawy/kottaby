---
title: "Transaction inquiry & Reports"
url: https://developers.paymob.com/paymob-docs/payments-and-features/core-features/transaction-inquiry-and-reports
tab: documentation
breadcrumbs: "Payments & Features > Core Features > Transaction inquiry & Reports"
---

# Transaction inquiry & Reports
![](https://d24lr4zqs1tgqh.cloudfront.net/2fbfd244-bff7-427d-b268-39b7b6c490d2-696e9edc0acf4f5a50bce69f.svg)

**Who is this for -** Product managers, business owners, finance teams, and stakeholders who need visibility into payment activity and reporting, without focusing on technical implementation details

**Outcome -** Understand the available ways to access transaction data, and identify which option best fits your operational and reporting needs

* * *

Paymob provides multiple ways to **track, review, and analyze payment activity** , allowing merchants to monitor transactions, investigate issues, and support financial reporting needs.

## Available Options

Paymob supports **three ways** to inquire about transactions and access payment data:

### 1\. Transaction Inquiry APIs

Transaction Inquiry APIs allow you to **retrieve transaction details programmatically** using identifiers such as**transaction ID** , **order ID** , or **merchant order ID**.

This option is suitable if you need to access transaction data from internal systems

> **Warning:**
> 
> Paymob provides a callback mechanism that should be used as the primary method for receiving transaction details after every payment or payment-related action. Callbacks ensure timely and reliable updates to your system.
> 
> Transaction Inquiry APIs should be used only for manual checks from your system or as a fallback mechanism in case a callback is missed.

> **Info:**
> 
> Check the technical implementation guide in the [**Transaction Inquiry APIs guide under the Developers Reference sections**](https://developers.paymob.com/paymob-docs/transaction-inquiry-apis)

### 2\. Reports via Dashboard

The Paymob Dashboard enables you to **generate reports for transactions and transfers**.

With dashboard reports, you can:

  - Select date ranges and relevant criteria 

  - Create the report

  - Export reports for accounting, auditing, or internal analysis

This option is ideal for finance and operations teams who rely on **periodic reporting**.

> **Info:**
> 
> The selected date range must be within one month, starting from the chosen start date.

#### How to create a report

###### 1

**Navigate to the Reports Tab**

Go to the Reports tab from the left navigation sidebar

###### 2

**Choose the Report Type**

Choose if you need a report for Transactions or transfers, or another report type.

> **Info:**
> 
> If Transactions is selected, you need to select the transaction status also (**All Transactions, Successful Transactions,** or **Declined Transactions**)

###### 3

**Press the Generate Button**

Once you press the **Generate** button, a report with the status pending will be generated. It'll take a while to be ready for download.

###### 4

**Download the Report**

Once you press the **Download** button, a CSV file will be downloaded to your device.

![](https://d24lr4zqs1tgqh.cloudfront.net/d79efbe9-900a-4f54-a7c4-f89ca9a57a1a.jpg)

### 3\. Transaction Filtering in the Dashboard

You can also **view and filter transactions directly from the Paymob Dashboard** for day-to-day monitoring and quick lookups.

This option is covered in detail in the [**Dashboard**](https://developers.paymob.com/paymob-docs/getting-started/dashboard) documentation and is intended for operational use rather than reporting or automation purposes.

## Choosing the Right Option

Use Case

Recommended Option

Automated or system-based transaction checks| Transaction Inquiry APIs  
---|---  
  
Financial reporting and reconciliation| Dashboard Reports  
  
Quick transaction lookup or status check| Dashboard Filtering  
  
* * *
