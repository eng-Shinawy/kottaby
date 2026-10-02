---
title: "Odoo"
url: https://developers.paymob.com/paymob-docs/integration-paths/plugins/odoo
tab: documentation
breadcrumbs: "Integration Paths > Plugins > Odoo"
---

# Odoo
![](https://d24lr4zqs1tgqh.cloudfront.net/d0ceb3b3-a2e3-49cb-acd1-b68c271bb41d-696e9edc0acf4f5a50bce69f.svg)

**Who is this for** : For merchants and developers using Odoo who want to enable Paymob payments on their store.

**Outcome** : Explore, Install, and Configure Paymob's powerful Odoo modules

* * *

## Overview 

Paymob offers multiple Odoo integrations to support different Odoo versions and deployment models. `Odoo 18`, `17`, `16`, and `15` Built and maintained by Paymob, these modules are available for merchants using `Odoo.sh` and `Odoo On-Premise.`

## Odoo Version 18 

The Odoo Payment Plugin is available for merchants using Odoo.sh and Odoo On-Premise.

* * *

#### **Installation & Configuration Steps**

###### 1

Merchants can access the plugin via [**Paymob** | **Odoo Apps Store**.](https://apps.odoo.com/apps/modules/18.0/paymob)

###### 2

Once you deploy the plugin on the Odoo Instance, navigate to **Configuration ⇒ Payment Providers**.

![](https://d24lr4zqs1tgqh.cloudfront.net/2365d462-c29e-4ffb-972b-024217c78a08.jpg)

###### 3

Activate the Paymob Plugin.

![](https://d24lr4zqs1tgqh.cloudfront.net/568e1a51-0a32-4b59-ad0d-d21f22f1ddae.jpg)

###### 4

After activation is complete, you will be directed to the screen below:

![](https://d24lr4zqs1tgqh.cloudfront.net/d8a17a51-2829-4f9f-bd81-19bea66386b2.jpg)

###### 5

**Credential Section**

  - If the "Enabled" state is selected, the plugin will be in the Published state. Enter the Live Mode API Key, Secret Key, and Public Key.

  - If the "Test Mode" state is selected, the plugin will be in the Unpublished state. Enter the Test Mode API Key, Secret Key, and Public Key.

  - If you select LIVE Mode, all transactions will involve real money.

> **Info:**
> 
> To get your keys, you can check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page

> **Warning:**
> 
> The secret and public keys for Test and Live Mode are different.

###### 6

After entering the keys, click on **“Validate”**. If the keys are validated successfully, all the Payment Methods will be enabled for the given set of keys.

###### 7

Merchants can view the available payment methods on the **Configuration Page.**

![](https://d24lr4zqs1tgqh.cloudfront.net/ad529663-ae79-4a1d-8334-ad33583dd566.jpg)

###### 8

The merchant can click on “Enable Payment Methods” to view all the Payment Integrations for the entered Keys. By default, the Payment Methods will be in a disabled state. Merchants will need to enable the Payment Methods. Merchants can edit the logo of Payment Methods and change the name of Payment Method by clicking on the respective Payment Methods. It’s recommended not to edit the name and logo of Payment Methods. In Odoo 18, payment methods will be displayed as a list. Payments that are in an Active State will be shown on Odoo's Checkout

![](https://d24lr4zqs1tgqh.cloudfront.net/eee507ea-8bc6-44c9-890b-1189164ce911.jpg)

###### 9

**Webhook Configurations** \- Once the merchant enables any Payment Method, the webhook will be automatically configured in the Paymob System for that integration ID.

###### 10

**Card Tokenization** In case the merchant wants to enable the “Pay with Saved Card” feature for the consumer, the following steps need to be followed:

If the user consents to save the card during the initial transaction, the user will be shown the option to pay with saved cards for subsequent transactions.

> **Info:**
> 
> To enable the Save Card checkbox in the Unified Checkout, you can check the [**Checkout Customization**](https://developers.paymob.com/paymob-docs/getting-started/dashboard#Checkout-Customization) part in the Dashboard guide.

* * *

### **FAQs**

###### 1

**Regions supported?**

The plugin is available in **Egypt** , **UAE** , **KSA** , and **Oman**.

###### 2

**Features supported?**

  - **Auth + Capture Model.**

  - **Full** and **Partial Refunds**.

* * *

## Odoo Version 17

The Odoo Payment Plugin is available for merchants using Odoo.sh and Odoo On-Premise.

* * *

#### **Installation & Configuration Steps**

###### 1

Merchants can access the plugin via [**Paymob** | **Odoo Apps Store**.](https://apps.odoo.com/apps/modules/18.0/paymob)

###### 2

Once you deploy the plugin on the Odoo Instance, navigate to **Configuration → Payment Providers**.

![](https://d24lr4zqs1tgqh.cloudfront.net/7f1756be-515d-43d5-aa14-1c332a37de07.jpg)

###### 3

Activate the Paymob Plugin.

![](https://d24lr4zqs1tgqh.cloudfront.net/9f40dc92-3752-49bf-a43a-9e64ea92e33f.jpg)

###### 4

After activation is complete, you will be directed to the screen below:

![](https://d24lr4zqs1tgqh.cloudfront.net/ed9e9397-d139-4fe0-af59-0a9c53b7fb60.jpg)

###### 5

**Credential Section**

  - If the "Enabled" state is selected, the plugin will be in the Published state. Enter the Live Mode API Key, Secret Key, and Public Key.

  - If the "Test Mode" state is selected, the plugin will be in the Unpublished state. Enter the Test Mode API Key, Secret Key, and Public Key.

  - If you select LIVE Mode, all transactions will involve real money.

> **Info:**
> 
> To get your keys, you can check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/getting-started/dashboard#Checkout-Customization) page

> **Warning:**
> 
> The secret and public keys for Test and Live Mode are different.

###### 6

After entering the keys, click on **“Validate”**. If the keys are validated successfully, all the Payment Methods will be enabled for the given set of keys.

###### 7

Merchants can view the available payment methods on the **Configuration Page.**

![](https://d24lr4zqs1tgqh.cloudfront.net/914df814-46c2-47c3-b402-49406a5bbf14.jpg)

###### 8

The merchant can click on “Enable Payment Methods” to view all the Payment Integrations for the entered Keys. By default, the Payment Methods will be in a disabled state. Merchants will need to enable the Payment Methods. Merchants can edit the logo of Payment Methods and change the name of Payment Method by clicking on the respective Payment Methods. It’s recommended not to edit the name and logo of Payment Methods. In Odoo 17, payment methods will be displayed as a list. Payments that are in an Active State will be shown on Odoo's Checkout

![](https://d24lr4zqs1tgqh.cloudfront.net/39336f1c-bf37-408d-be73-f1e8a9d8e706.jpg)

###### 9

**Webhook Configurations** \- Once the merchant enables any Payment Method, the webhook will be automatically configured in the Paymob System for that integration ID.

###### 10

**Card Tokenization** In case the merchant wants to enable the “Pay with Saved Card” feature for the consumer, the following steps need to be followed:

If the user consents to save the card during the initial transaction, the user will be shown the option to pay with saved cards for subsequent transactions.

> **Info:**
> 
> To enable the Save Card checkbox in the Unified Checkout, you can check the [**Checkout Customization**](https://developers.paymob.com/paymob-docs/getting-started/dashboard#Checkout-Customization) part in the Dashboard guide.

* * *

### **FAQs**

###### 1

**Regions supported?**

The plugin is available in **Egypt** , **UAE** , **KSA** , and **Oman**.

###### 2

**Features supported?**

  - **Auth + Capture Model.**

  - **Full** and **Partial Refunds**.

* * *

## Odoo Version 16

The Odoo Payment Plugin is available for merchants using Odoo.sh and Odoo On-Premise.

* * *

### **Installation & Configuration Steps**

###### 1

Merchants can access the plugin via [**Paymob** | **Odoo Apps Store**.](https://apps.odoo.com/apps/modules/18.0/paymob)

###### 2

Once you deploy the plugin on the Odoo Instance, navigate to **Configuration ⇒ Payment Providers**.

![](https://d24lr4zqs1tgqh.cloudfront.net/87dbb271-9415-481c-8940-c21c226e713b.jpg)

###### 3

Activate the Paymob Plugin.

![](https://d24lr4zqs1tgqh.cloudfront.net/e8373d3b-fcc3-4f68-ae4f-6687cb302fd9.jpg)

###### 4

After activation is complete, you will be directed to the screen below:

![](https://d24lr4zqs1tgqh.cloudfront.net/08fbbb11-2be7-4a67-80df-59b0daca1930.jpg)

###### 5

#### **Credential Section**

If the state "Enabled" is selected, the plugin will be in the Published state. Enter the Live Mode API Key, Secret Key, Public Key & the LIVE Payment Integration IDs are to be made available on Paymob’s Checkout.

If the state "Test Mode" is selected, the plugin will be in the Unpublished state. Enter the Test Mode API Key, Secret Key, Public Key & the TEST Payment Integration ID are to be made available on Paymob’s Checkout for testing Purposes.

**Note:** The keys for Test and Live Mode are different..

> **Info:**
> 
> To get your keys, you can check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page

> **Warning:**
> 
> The secret and public keys for Test and Live Mode are different.

###### 6

After entering the keys & the integration id’s, click on "Validate." If the keys are successfully validated, all the payment methods associated with the entered integration IDs will be enabled.

###### 7

Merchants can view the available payment methods on the **Configuration Page** under the Payment Form section.

In Odoo 16, payment methods will not be displayed as a list. Instead, only the provider name or the The name set by the merchant in the "Displayed as" label will appear on Odoo's checkout.

![](https://d24lr4zqs1tgqh.cloudfront.net/a337b3d1-c980-4a75-bd35-df50af1c0ef8.jpg)

###### 8

**Webhook Configurations** \- Once merchants enter the Integration IDs in the Credentials section and the keys are validated, the webhook will be automatically configured in the Paymob system for those integration IDs.

###### 09

**Card Tokenization** In case the merchant wants to enable the “Pay with Saved Card” feature for the consumer, the following steps need to be followed:

If the user consents to save the card during the initial transaction, the user will be shown the option to pay with saved cards for subsequent transactions.

> **Info:**
> 
> To enable the Save Card checkbox in the Unified Checkout, you can check the [**Checkout Customization**](https://developers.paymob.com/paymob-docs/getting-started/dashboard#Checkout-Customization) part in the Dashboard guide.

* * *

### **FAQs**

###### 1

**Regions supported?**

The plugin is available in **Egypt** , **UAE** , **KSA** , and **Oman**.

###### 2

**Features supported?**

  - **Auth + Capture Model.**

  - **Full** and **Partial Refunds**.

* * *

## Odoo Version 15

The Odoo Payment Plugin is available for merchants using Odoo.sh and Odoo On-Premise.

* * *

### **Installation & Configuration Steps**

###### 1

Merchants can access the plugin via [**Paymob** | **Odoo Apps Store**.](https://apps.odoo.com/apps/modules/18.0/paymob)

###### 2

Once you deploy the plugin on the Odoo Instance, navigate to **Configuration ⇒ Payment Acquirers.**

![](https://d24lr4zqs1tgqh.cloudfront.net/af9a529e-da36-43ab-951a-2bc533b1cb6e.jpg)

###### 3

Activate the Paymob Plugin.

![](https://d24lr4zqs1tgqh.cloudfront.net/ed1939f2-be22-4f75-835d-1a5f7c983f91.jpg)

###### 4

After activation is complete, you will be directed to the screen below:

![](https://d24lr4zqs1tgqh.cloudfront.net/c8fe4fbf-382e-4ac0-868e-d60f8ac82526.jpg)

###### 5

#### **Credential Section**

If the state "Enabled" is selected, the plugin will be in the Published state. Enter the API Key, Secret Key, Public Key & the LIVE Payment Integration IDs are to be made available on Paymob’s Checkout.

If the state "Test Mode" is selected, the plugin will be in the Unpublished state. Enter the API Key, Secret Key, Public Key & the TEST Payment Integration ID are to be made available on Paymob’s Checkout for testing Purposes.

> **Info:**
> 
> To get your keys, you can check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page

> **Warning:**
> 
> The secret and public keys for Test and Live Mode are different.

###### 6

After entering the keys & the integration id’s, click on "Validate." If the keys are successfully validated, all the payment methods associated with the entered integration IDs will be enabled.

###### 7

Merchants can view the available payment methods on the **Configuration Page** under the Payment Form section.

In Odoo 15, payment methods will not be displayed as a list. Instead, only the provider name, or the name set by the merchant in the "Displayed as" label will appear on Odoo's checkout.

![](https://d24lr4zqs1tgqh.cloudfront.net/720c42a5-86f5-48b9-a59c-e51acb8865e5.jpg)

###### 8

**Webhook Configurations** \- Once merchants enter the Integration IDs in the Credentials section and the keys are validated, the webhook will be automatically configured in the Paymob system for those integration IDs.

###### 09

**Card Tokenization** In case the merchant wants to enable the “**Pay with Saved Card** ” feature for the consumer, the following steps need to be followed:

If the user consents to save the card during the initial transaction, the user will be shown the option to pay with saved cards for subsequent transactions. 

> **Info:**
> 
> To enable the Save Card checkbox in the Unified Checkout, you can check the [**Checkout Customization**](https://developers.paymob.com/paymob-docs/getting-started/dashboard#Checkout-Customization) part in the Dashboard guide.

* * *

### **FAQs**

###### 1

**Regions supported?**

The plugin is available in **Egypt** , **UAE** , **KSA** , and **Oman**.

###### 2

**Features supported?**

  - **Auth + Capture Model.**

  - **Full** and **Partial Refunds**.

* * *

## Odoo enterprise

It's the standard version of Odoo and allows its users to utilize all its modules with limited customization. Currently, Paymob is available as a payment provider on its invoicing, sales, website, and e-commerce apps, providing merchants with a streamlined onboarding process and an embedded payment experience.

* * *

### How to Accept Payments using Paymob on Odoo? 

###### 1

#### Navigate to Configuration ⇒ Payment Providers.

![](https://d24lr4zqs1tgqh.cloudfront.net/1761068d-6f14-4ca0-afd2-94e95c022722.jpg)

###### 2

#### Find Paymob in the list of available providers.

###### 3

#### Click Install to add Paymob as a payment option.

![](https://d24lr4zqs1tgqh.cloudfront.net/0aab9c2e-2b7c-4218-81fa-9babee05976d.jpg)

###### 4

#### After installation, click Activate to begin configuration.

![](https://d24lr4zqs1tgqh.cloudfront.net/201c7249-8ef3-4358-b44b-7fe6fc6ab048.jpg)

###### 5

#### You will be directed to the Paymob configuration screen.

###### 6

#### Set up Paymob credentials in the **Credential Section**

![](https://d24lr4zqs1tgqh.cloudfront.net/12e3bdb1-d728-4ccb-922b-a2026d3c5187.jpg)

####  Configuration Based on Mode:

• If “Enabled” is selected, the plugin will be in the Published state.

→ Enter your Live HMAC, API Key, Secret Key, and Public Key.

• If “Test Mode” is selected, the plugin will be in the Unpublished state.

→ Enter your Test HMAC, API Key, Secret Key, and Public Key.

> **Info:**
> 
> To get your keys, you can check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page


  - Select the Account Country (e.g., Egypt).

###### 7

#### Navigate to the Configuration Section

###### 8

#### Click Enable Payment Methods.

![](https://d24lr4zqs1tgqh.cloudfront.net/bb007ef5-e537-46e4-a728-cc9c4d767a88.jpg)

###### 9

#### Select the payment methods you'd like to activate on Odoo's checkout

![](https://d24lr4zqs1tgqh.cloudfront.net/45e9cb20-94e3-4df0-9e8a-3f51973332d8.jpg)

###### 10

### After selecting your payment methods:

• Click the “**Synchronize with Paymob** ” button.

![](https://d24lr4zqs1tgqh.cloudfront.net/3f386e90-0622-4b93-aa55-969e36d83083.jpg)

• This confirms your configuration and finalizes the setup. 

![](https://d24lr4zqs1tgqh.cloudfront.net/9d0a4907-b57f-4aee-ae7d-209ecc9d1892.jpg)

#### Once synchronization is successful:

• Your Paymob integration is complete.

• You can now accept payments directly on your Odoo store. Feel free to contact [support@paymob.com](https://mailto:support@paymob.com) if you have any issues or inquiries. We will be glad to help you.
