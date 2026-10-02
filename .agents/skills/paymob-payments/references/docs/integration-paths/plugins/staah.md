---
title: "Staah"
url: https://developers.paymob.com/paymob-docs/integration-paths/plugins/staah
tab: documentation
breadcrumbs: "Integration Paths > Plugins > Staah"
---

# Staah
![](https://d24lr4zqs1tgqh.cloudfront.net/c290ecd8-558e-4a90-8d44-9e40d24c6918-696e9edc0acf4f5a50bce69f.svg)

**Who is this for** \- For Business Owners & Operations Teams & Developers who want to accept online payments on Staah

**Outcome** \- Explore, Install, and Configure Paymob's **Staah** plugin

* * *

### Overview

#### ﻿What is STAAH?

STAAH is a hotel distribution and revenue management platform that enables hotels to manage inventory, room rates, and bookings across multiple online channels from a single system.

####  STAAH × Paymob Integration

STAAH is integrated with Paymob using the Intention-based setup. Any merchant using STAAHʼs platform for their hotel website can choose Paymob as their payment provider.

### Installation Steps

﻿

###### 1

Go to **Booking Engine** ⇒ **Settings** ⇒ **Payment Gateway**

![](https://d24lr4zqs1tgqh.cloudfront.net/c1f57b43-3411-478a-a254-1bb18b0e663c.jpg)

###### 2

Scroll down to the “**Other Partners** ” section ⇒ Search for and select **Paymob**

![](https://d24lr4zqs1tgqh.cloudfront.net/a89e6ba7-8fb8-461d-acaa-130cd57718e4.jpg)

###### 3

Click on "**Connect** " ⇒ A pop-up will appear ⇒ Click "**Proceed to Connect** "

![](https://d24lr4zqs1tgqh.cloudfront.net/77f7d966-9712-4916-b52f-96a70a471b62.jpg)

### Plugin Configuration

###### 1

**Fill in the following details**

  - Choose Payment Gateway: **Paymob**

  - **API Key**

  - **Secret Key**

  - **Public Key**

  - **HMAC**

  - **Display Name**(shown on the Booking Engine)

  - **Payment Type** (select supported card networks)

![](https://d24lr4zqs1tgqh.cloudfront.net/6782a7a4-c8c5-4a9f-af64-ff217489104e.jpg)

> **Info:**
> 
> You can get all the credentials from your Paymob dashboard. Check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials).

###### 2

**Verify the configured Callback URLs**

Verify the **callback URLs** configured in your **Integration IDs** through the Paymob Dashboard.

These URLs should match the fixed callback URLs listed below, which are also available on the **Paymob Staah Configuration** page.

If the URLs are not configured correctly, copy the values below and update the callback URL field in each payment integration within your Paymob account.

> **Info:**
> 
> **Fixed URLs**
> 
> Transaction Processed Callback: `**https://securepay.staah.net/PG/paymob/webhook.php**`
> 
> Transaction Response Callback: `**https://securepay.staah.net/PG/paymob/response.php**`

![](https://d24lr4zqs1tgqh.cloudfront.net/e09e657f-92d3-4296-8bfe-de0fa6deb428.jpg)

> **Info:**
> 
> You check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials#Change-Callback-for-the-Integration-IDs) page for more guidance on how to validate and edit the callback URLs on the Paymob dashboard.

###### 3

Click "**Sync** ".

* * *

### FAQs

###### 1

**Where can a merchant find the Transaction ID for any booking on STAAH?**

When a user clicks on any booking, the Transaction ID will be displayed under the Payment ID field

![](https://d24lr4zqs1tgqh.cloudfront.net/fc423f34-316b-405b-bb44-47e30ddfd66f.jpg)
