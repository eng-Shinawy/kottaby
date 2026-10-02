---
title: "OsCommerce"
url: https://developers.paymob.com/paymob-docs/integration-paths/plugins/oscommerce
tab: documentation
breadcrumbs: "Integration Paths > Plugins > OsCommerce"
---

# OsCommerce
![](https://d24lr4zqs1tgqh.cloudfront.net/23458291-8b73-4e9f-99c4-6659858a6eda-696d49c90e7d4e9e101be737.svg)

**Who is this for -** OsCommerce store owners and administrators looking to add Paymob as a payment option without building a custom integration

**Outcome -** Explore, Install, and Configure Paymob's **ZenCart** plugin

### Overview

The Paymob **osCommerce** plugin provides a straightforward way to connect your osCommerce store to Paymob, enabling secure payment processing without altering the platform’s core files.

### Installation Steps

###### 1

Download the Paymob PrestaShop module from this [**link**](https://gitlab.com/paymob-integrations/public-plugins/-/raw/main/unified%20checkout/OsCommerce/paymob_oscommerce.zip?ref_type=heads&inline=false).

###### 2

Extract the downloaded **osCommerce** module`**.zip**` file into your server in the path of the **osCommerce** project.

###### 3

Log in to the Oscommerce admin panel, navigate to **Modules** ⇒ **Payment** ⇒ **Online**.

###### 4

Click on the **Show not installed** checkbox, then search for **Paymob Payment** , then click on it and **install** the module.

![](https://d24lr4zqs1tgqh.cloudfront.net/fd4992f5-c3a8-4394-bef9-2e288ee3aad3.jpg)

### Plugin Configuration

###### 1

Paste each key in its place in the Paymob **Oscommerce** Settings page.

![](https://d24lr4zqs1tgqh.cloudfront.net/3e9865ee-c262-4221-acab-4260c657a79d.jpg)

> **Info:**
> 
> You can get all the credentials from your Paymob dashboard. Check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials).

###### 2

Enter the **integration IDs** separated by a comma (**,**).

###### 3

Copy the integration **callback URL** that exists in the Paymob **Oscommerce** Configuration page, then paste it into each payment integration in the Paymob account.

> **Info:**
> 
> You check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page for more guidance on how to update the callback URLs on the Paymob dashboard.

###### 5

**Save** the changes

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.
