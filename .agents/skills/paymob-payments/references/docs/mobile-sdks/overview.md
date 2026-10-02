---
title: "Overview"
url: https://developers.paymob.com/paymob-docs/mobile-sdks/overview
tab: developers
breadcrumbs: "Mobile SDKs > Overview"
---

# Overview
**Outcome** \- Know the available Mobile SDKs and how it works.

* * *

**Paymob’s Mobile SDKs** enable native payment acceptance within mobile applications. They support multiple mobile platforms and frameworks, allowing merchants to integrate Paymob’s checkout experience directly into their apps using a consistent payment flow.

> **Success:**
> 
> Native Android and IOS SDKs now support the embedded checkout experience.

### Supported Mobile SDKs

[![](https://d24lr4zqs1tgqh.cloudfront.net/30a820da-edff-4235-9d25-fa7cadb87066-696e9edc0acf4f5a50bce69f.svg)IOS](https://developers.paymob.com/paymob-docs/developers/mobile-sdks/ios-sdk)[![](https://d24lr4zqs1tgqh.cloudfront.net/812b1d68-ead0-4e1b-b64e-3986cdc449c6-696e9edc0acf4f5a50bce69f.svg)Android](https://developers.paymob.com/paymob-docs/developers/mobile-sdks/android-sdk)[![](https://d24lr4zqs1tgqh.cloudfront.net/5cd0ee1f-f677-4f47-8df6-c3f11dd878b5-696e9edc0acf4f5a50bce69f.svg)Flutter Bridge ](https://developers.paymob.com/paymob-docs/developers/mobile-sdks/flutter-sdk)[![](https://d24lr4zqs1tgqh.cloudfront.net/60c84936-a946-47ff-a9a5-107b23e2ec41-696e9edc0acf4f5a50bce69f.svg)React Native](https://developers.paymob.com/paymob-docs/developers/mobile-sdks/react-native-sdk)

### How does it work?

Mobile SDKs use the same backend flow as other Paymob checkout experiences. Before starting a payment in the mobile app, your system must create a payment intention and obtain a **client secret,** which will be used to initialize the SDK.

###### 1

#### **Create Intention**

You need to call the [**Intention Creation API**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention) to get a **client secret**

###### 2

#### Initialize the **SDK**

Initialize the Mobile SDK by passing:

  - The **client secret** obtained from the previous step 

  - Your **public key** , available in the Paymob dashboard 

  - Optional configuration parameters that control how the checkout UI is rendered

###### 3

#### **Receive the payment results**

After the payment is completed, the SDK triggers **predefined callback functions** based on the payment status. You are required to implement the logic for these callbacks to define how your application should behave in each scenario.


