---
title: "PrestaShop"
url: https://developers.paymob.com/paymob-docs/integration-paths/plugins/prestashop
tab: documentation
breadcrumbs: "Integration Paths > Plugins > PrestaShop"
---

# PrestaShop
![](https://d24lr4zqs1tgqh.cloudfront.net/23458291-8b73-4e9f-99c4-6659858a6eda-696d49c90e7d4e9e101be737.svg)

**Who is this for -** For PrestaShop merchants and technical admins who want to enable Paymob payments on their store without building a custom integration

**Outcome -** Explore, Install, and Configure Paymob's **PrestaShop** plugin

### Overview

The Paymob **PrestaShop** plugin allows merchants to accept online payments directly on their PrestaShop store through a ready-to-use integration. It supports multiple payment methods and handles the full checkout flow securely, enabling a smooth payment experience without requiring custom development.

Supported versions: **1.6, 1.7, and 8**

### Installation Steps

###### 1

Download the Paymob PrestaShop module from this [**link**](https://gitlab.com/paymob-integrations/public-plugins/-/tree/main/unified%20checkout/PrestaShop?ref_type=heads).

###### 2

Login into **Prestashop** admin panel ⇒ **Modules ⇒** **Module Manager ⇒** **Upload** a module.

###### 3

Select the Paymob downloaded `**.zip**` file.

![](https://d24lr4zqs1tgqh.cloudfront.net/cbf732d4-c541-409e-8d8a-5f6aa6f55512.jpg)

###### 4

You will see that the module is now uploaded and installed, and the Paymob module will appear on the module list.

![](https://d24lr4zqs1tgqh.cloudfront.net/e1444b76-b1e5-4ee1-9e30-eafff17c3397.jpg)

### Plugin Configuration

###### 1

From the **Prestashop** admin panel, in the left menu, **Payments ⇒** **payment methods**.

###### 2

Click on the **Configure** button beside the Paymob payment method to start the configuration.

###### 3

You can name your payment method according to the one you need to display in the checkout page.

###### 4

Add all the **credentials** needed by pasting each key in its place.

> **Info:**
> 
> You can get all the credentials from your Paymob dashboard. Check the **Getting Integration Credentials**.

###### 5

Enter the**integration IDs** separated by a comma (**,**).

![](https://d24lr4zqs1tgqh.cloudfront.net/22f303b6-5e38-4156-89d6-91affe12ab51.jpg)

###### 6

Copy the integration callback URL that exists in the Paymob **PrestaShop** setting page, then paste it into each payment integration in the Paymob account.

> **Info:**
> 
> You check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page for more guidance on how to update the callback URLs on the Paymob dashboard.

###### 7

**Save** the changes

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.
