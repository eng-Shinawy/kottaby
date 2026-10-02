---
title: "Magento 2"
url: https://developers.paymob.com/paymob-docs/integration-paths/plugins/magento
tab: documentation
breadcrumbs: "Integration Paths > Plugins > Magento 2"
---

# Magento 2
![](https://d24lr4zqs1tgqh.cloudfront.net/23458291-8b73-4e9f-99c4-6659858a6eda-696d49c90e7d4e9e101be737.svg)

**Who is this for -** Merchants and developers using **Magento** who want to integrate Paymob payments into their store using an officially supported plugin.

**Outcome -** Explore, Install, and Configure **Paymob's Magento** plugin

### Overview

The Paymob **Magento** plugin enables you to accept online payments securely on your Magento store using Paymob’s payment gateway. It supports a wide range of payment methods and provides a seamless checkout experience for your customers.

You can check it on the [**Adobe Marketplace**](https://commercemarketplace.adobe.com/paymob-magento-payment.html)

### Installation Steps

###### 1

Run the below command to install the Paymob Payment via composer

```powershell
composer require paymob/magento-payment
``` 

###### 2

Run the **Magento** commands below to enable the Paymob Module

```powershell
php -f bin/magento module:enable --clear-static-content Paymob_Payment  
php bin/magento setup:upgrade 
php bin/magento setup:di:compile  
php bin/magento setup:static-content:deploy -f  
php bin/magento cache:clean  
php bin/magento cache:flush
``` 

### Plugin Configuration

###### 1

In **Magento Admin Panel** Menu **Stores** → **Configuration**

###### 2

Expand **Sales** Menu ⇒ select **Payment Methods** ⇒ **Accept Paymob payment** , then paste each key of the below in its place in the settings page. 

  - **Secret Key**

  - **Public Key**

  - **API key**

  - **HMAC secret**

> **Info:**
> 
> You can get all the credentials from your Paymob dashboard. Check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials).

###### 3

Enter the**integration IDs** separated by a comma (**,**).

![](https://d24lr4zqs1tgqh.cloudfront.net/2f245532-f194-4ce9-a76f-c4d8e46a6fe8.jpg)

###### 4

Copy the integration callback URL that exists in the Paymob **Magento** setting page. Then, paste it into each payment integration in the Paymob dashboard.

> **Info:**
> 
> You check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page for more guidance on how to update the callback URLs on the Paymob dashboard.

###### 5

**Save** the changes

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.
