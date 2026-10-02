---
title: "WordPress (WooCommerce)"
url: https://developers.paymob.com/paymob-docs/integration-paths/plugins/wordpress
tab: documentation
breadcrumbs: "Integration Paths > Plugins > WordPress (WooCommerce)"
---

# WordPress (WooCommerce)
![](https://d24lr4zqs1tgqh.cloudfront.net/2e06fda0-9c07-44b2-b104-6e4bd2f3cbd2-696e9edc0acf4f5a50bce69f.svg)

**Who is this for** \- For merchants and developers using WooCommerce who want to enable Paymob payments on their store.

**Outcome** \- Explore, Install, and Configure Paymob's powerful **WooCommerce** plugin

* * *

## Overview

The **Paymob WooCommerce plugin** enables merchants to accept payments directly on their WooCommerce stores while maintaining full control over the checkout experience and payment features. It supports multiple checkout options and advanced payment capabilities, allowing businesses to tailor the payment flow to their needs without custom development.

The plugin integrates seamlessly with WooCommerce, ensuring a smooth customer journey from checkout to payment confirmation.

## Key Capabilities

  - **Multiple Checkout Experiences** Support both **Unified Checkout** (hosted redirection) and **Pixel** (embedded checkout) to match your store’s flow. 

  - **Easy Configuration** Manage checkout settings and enable payment methods directly from the **Paymob Dashboard**. 

  - **Saved Cards** Let registered customers save and reuse cards securely for faster repeat purchases. 

  - **Flexible Payment Display** Show payment methods individually on the checkout page for better clarity and customization. 

  - **Subscription Support** Enable recurring payments for WooCommerce subscription products.

## Steps of Installation and Activation

You have two ways to install our WooCommerce plugin. Please check them below

#### From WooCommerce Marketplace

###### 1

Place an order for [**Paymob Payments**](https://woocommerce.com/products/paymob/) for free from **woocommerce.com** , click on the **Add to Cart** button, and click on the Proceed to **Checkout** button.

![](https://d24lr4zqs1tgqh.cloudfront.net/8a0cd11e-781e-4412-a8e5-73dbb17b0beb.jpg)

###### 2

Download the **.zip** file from the **My subscriptions** section of your [**WooCommerce account**](https://woocommerce.com/my-account/my-subscriptions/).

###### 3

Navigate to **Plugins** > **Add New Plugin** , click on the “**Upload Plugin** ", and then browse and select the downloaded Zip File from your system. After the file has been uploaded, click **"Install Now** “. After the plugin has been installed successfully, click on “**Activate Plugin** ”.

![](https://d24lr4zqs1tgqh.cloudfront.net/de415667-2e4a-49b1-b402-7402085f6740.jpg)

#### From WordPress Marketplace

Navigate to **Plugins** > **Add New Plugin** , search for "**Paymob for WooCommerce** ", click on “**Install Now** ”, and once installed, click on “**Activate** ” to activate the Plugin 

![](https://d24lr4zqs1tgqh.cloudfront.net/22367457-2223-4d07-83c7-f6fede168511.jpg)

## Configurations and Settings

After activation, the plugin will be listed under the **Plugins ⇒ Installed Plugins** section as "**Paymob for WooCommerce** ". Click on **Paymob Settings**

![](https://d24lr4zqs1tgqh.cloudfront.net/75e6cb30-9d8e-484b-9c87-d0c4187e52ff.jpg)

### Main Configuration Page

#### Connect with your Paymob account

You can connect the plugin with your Paymob account in two ways. Please check them below

#### Connect by signing in

![](https://d24lr4zqs1tgqh.cloudfront.net/c6e18b02-dafd-4201-b4d2-9fd385efc912.jpg)

  - Click on "**Connect your Paymob Account** " to go to the sign-in page

  - Select your **country** , enter your **username** or **mobile number** , and **password**

  - Verify your account using the **OTP**

> **Success:**
> 
> Congratulations, your plugin is connected now with your Paymob account, and you should be redirected to the "**Main Configuration** " page.

#### Manual Setup

![](https://d24lr4zqs1tgqh.cloudfront.net/117f2307-63d5-4c86-9155-c88f15bd88c9.jpg)

  - Click on **"Manual Setup"** and enter the **API Key, Public Key, and Secret Key.**

  - Click **Confirm** to connect your account.

> **Success:**
> 
> Congratulations, your plugin is connected now with your Paymob account. The plugin should be enabled by default on your store, and you should be redirected to the "**Main Configuration** " page.

#### Disconnect and Change Mode

From the Main Configuration page, you can disconnect and change mode (**Live** /**Test**)

![](https://d24lr4zqs1tgqh.cloudfront.net/3ad6c69f-8445-43a9-a25b-02a92de7ce53.jpg)

### Payment Configurations Page

On this page, you can control and configure your payment methods. It displays both **Live** and **Test** payment method integrations. You can switch between them as needed.

#### From this page, you can do:

  - Enable or disable Payment methods.

  - Edit (Name, Description, and integration ID, change the logo) by pressing the **Edit** button beside each payment method.

  - Reorder the payment methods by dragging the icon **(** ≡**)** up or down.

  - Update the **Webhook URLs** by pressing **Webhool URL** button.

![](https://d24lr4zqs1tgqh.cloudfront.net/d3fe751f-cef7-4f9c-9adb-4408f6a3d250.jpg)

> **Warning:**
> 
> **Important notes**
> 
>   - The **Pay With Paymob** option will avail all the payment methods on one option.
> 
> 

> 
> ![](https://d24lr4zqs1tgqh.cloudfront.net/0e2dc5c3-94cf-415d-9e37-b985425501e9.jpg)
> 
>   - Please change the logos only if you have your own and want to use them to avoid corrupting the default ones.
> 
> 

### Card Embedded Settings

This feature allows users to complete payments directly on your WooCommerce store.

> **Info:**
> 
> **Enabled by default.** To disable it, go to **Payment Integrations** and turn off **"paymob-pixel"**. If you wish to hide a specific payment method, simply avoid selecting its integration ID.

#### Main Configurations

You can:

  - Change the title

  - Select the Integration ID to be used for Cards, Apple Pay, and Google Pay payment seperatly

  - Control the save card option in the Pixel component 

![](https://d24lr4zqs1tgqh.cloudfront.net/af28976b-ca0d-44e6-8889-3bacc517bc9e.jpg)

#### UI Customizations

You can control a lot of the UI, like (Fonts, Colors, Sizes, …)

![](https://d24lr4zqs1tgqh.cloudfront.net/d0172d5f-9dd8-4cc8-8a7e-67514ff264cf.jpg)

### Subscription

#### Who Can Use It?

Any WooCommerce merchant with the WooCommerce Subscription Plugin installed.

> **Info:**
> 
> This section would only be shown if you have installed the WooCommerce Subscription Plugin.

#### Configurations

From this page, you can:

  - Enable or disable the Subscription feature.

  - Change the title and the description of the method in the WooCommerce Checkout page.

  - Configure the **3DS** and **Moto** integrations

> **Info:**
> 
> **3DS Integration** : The integration ID that will be used for the first transaction while the customer is subscribing.
> 
> **Moto Integration** : The integration ID that will be used for the future auto deductions for the already created subscriptions. If you don’t have one or both of these IDs, you can contact your account manager or send an email to [**support@paymob.com**](mailto:support@paymob.com) for assistance on getting the IDs.

#### How to Create Subscription Products on WooCommerce?

You can create Simple or Variable subscription products using WooCommerce’s existing setup.

**Required fields:**

  - Subscription Price

  - Frequency

Make sure to choose the equivalent for one of the frequencies (**Weekly, Monthly, Two months, Quarterly, Half annual**)

Optional fields:

  - Stop Renewing After = Number of billing cycles before the subscription auto stops.

  - Free Trial Period = Delays the start of the subscription.

  - Upfront Amount / Sign-Up Fee = One-time initial payment.

![](https://d24lr4zqs1tgqh.cloudfront.net/6accaea5-19c6-4366-b444-f09a628754f8.jpg)
