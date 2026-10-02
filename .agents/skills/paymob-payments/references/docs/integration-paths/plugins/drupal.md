---
title: "Drupal"
url: https://developers.paymob.com/paymob-docs/integration-paths/plugins/drupal
tab: documentation
breadcrumbs: "Integration Paths > Plugins > Drupal"
---

# Drupal
![](https://d24lr4zqs1tgqh.cloudfront.net/23458291-8b73-4e9f-99c4-6659858a6eda-696d49c90e7d4e9e101be737.svg)

**Who is this for -** For developers or site administrators managing Drupal websites who need to add Paymob payments to a custom or Drupal Commerce–based setup

**Outcome -** Explore, Install, and Configure Paymob's **Drupal** plugin

### Overview

The Paymob Drupal module allows you to integrate Paymob’s payment gateway into a Drupal-based website, enabling secure online payments while leveraging Drupal’s flexible content and commerce capabilities.

You can check the Paymob **Drupal** Commerce module from the [Drupal marketplace](https://www.drupal.org/project/paymob). 

### Installation Steps

###### 1

In the server cmd terminal, install the **Paymob Payment** module for**Drupal** Commerce e-commerce via Composer using the following command.

```powershell
composer require paymob_drupal/commerce_paymob
``` 

###### 2

In the **admin panel** , the Extend tab, search for the **Paymob module** , select it, and click the **install** button to install it.

![](https://d24lr4zqs1tgqh.cloudfront.net/d5374404-c1f1-4225-88cf-3d6d828a0461.jpg)

### Plugin Configuration

###### 1

In the **Drupal Commerce** Admin Panel Menu **Commerce ⇒** **Configuration ⇒** **Payments ⇒** **Payment Gateways** section, paste each key in its place, select **Paymob payment** , paste each key in its place in the settings page

![](https://d24lr4zqs1tgqh.cloudfront.net/f72bcf50-ea27-42fd-941e-0d889a2af21d.jpg)

> **Info:**
> 
> You can get all the credentials from your Paymob dashboard. Check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials).

###### 2

Enter the **integration IDs** separated by a comma (**,**).

###### 3

Copy the integration **callback URL** that exists in the Paymob **Drupal Commerce** setting page. Then, paste it into each payment integration/method in the Paymob account.

> **Info:**
> 
> You check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page for more guidance on how to update the callback URLs on the Paymob dashboard.

###### 4

**Save** the changes

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.
