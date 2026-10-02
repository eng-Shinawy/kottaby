---
title: "React Native SDK"
url: https://developers.paymob.com/paymob-docs/mobile-sdks/react-native-sdk
tab: developers
breadcrumbs: "Mobile SDKs > React Native SDK"
---

# React Native SDK
**Outcome** \- Integrate Paymob's React Native SDK

* * *

### Supported payment methods

  - **Cards**

  - **Wallets**

  - **Apple Pay**

  - **Google Pay**

  - **Bank Installments**

  - **vaLU**

  - **Souhoola**

  - **Forsa**

  - **Premium6**

  - **Aman Installments**

## **Installation Steps for React Native SDK**

To get started with the `paymob-reactnative` package, follow these steps:

  - Open your terminal, navigate to your React Native project directory, and install the `paymob-reactnative` package using yarn:

`yarn add paymob-reactnative@https://github.com/PaymobAccept/paymob-reactnative-sdk.git`

* * *

#### Enable data binding for Android

Add the following snippet to your app-level `build.gradle`file.

```java
android {

    buildFeatures { dataBinding = true }

}
``` 

* * *

## Using Paymob

To begin using the Paymob SDK in your react native application, start by importing the module in your component:

```javascript
import Paymob, { PaymentResult, CreditCardType } from 'paymob-reactnative';
``` 

## Customize the SDK

You can adjust the SDK’s look and behavior to match your app’s branding before showing the payment screen.

```javascript
Paymob.setAppIcon(base64Image); // Set your merchant logo using a base64 encoded image

Paymob.setAppName('Paymob SDK'); // Customize merchant app name displayed in the Paymob interface

Paymob.setButtonTextColor('#FFFFFF'); // Set the text color of buttons in the SDK

Paymob.setButtonBackgroundColor('#000000'); // Set the background color of buttons in the SDK

Paymob.setShowSaveCard(true); // Enable the option for users to save their cards

Paymob.setSaveCardDefault(true); // Set saved card option as default for transactions
``` 

These options help keep the payment experience consistent with your app’s design.

> **Info:**
> 
> ### **Important Notice**
> 
> Make sure all customization is done **before** calling`**Paymob.presentPayVC()**`**.** Any changes made after that won’t appear on the payment screen.

## Listen for payment results

To handle payment results effectively, you can add a listener that will respond to different transaction statuses. This is crucial for providing feedback to users about their payment transactions:

```javascript
Paymob.setSdkListener((status: PaymentResult) => {

  switch (status) {

    case PaymentResult.SUCCESS:

      // Handle successful payment

      break;

    case PaymentResult.FAIL:

      // Handle failed payment

      break;

    case PaymentResult.PENDING:

      // Handle pending payment status

      break;

  }

});
``` 

This listener will allow you to implement logic based on the result of the payment process, enhancing the user experience.

### Invoking the SDK

After configuring the SDK, you can invoke the Paymob payment interface with the following code:

```javascript
const savedBankCards = [

  {

    maskedPan: '1234', // The masked card number displayed to the user

    savedCardToken: 'CARD_TOKEN', // The token representing the saved card

    creditCard: CreditCardType.MASTERCARD, // The type of the credit card (e.g., Mastercard)

  },

];



Paymob.presentPayVC('CLIENT_SECRET', 'PUBLIC_KEY', savedBankCards);
``` 

**Note:** The `savedBankCards` parameter is optional. If you do not have saved bank cards to provide, you can simply call the `presentPayVC` method without it.

This function call opens the Paymob payment interface, allowing users to complete their transactions securely. Make sure to replace `'CLIENT_SECRET'` and `'PUBLIC_KEY'` with your actual credentials.

Here’s the updated explanation with a revised first sentence and the inclusion of the repository cloning step:

* * *

# Example App

To explore the SDK or test its features, you can clone the repository and run the example app by following these steps:

  1. **Clone the Repository** Clone the repository to your local machine.

`yarn`

**2\. Run the Example App**

You can run the example app for both iOS and Android platforms:

  - To run the app on iOS, use the following command:

`yarn example ios`

  - To run the app on Android, use this command:

`yarn example android`

By following these steps, you can explore the functionality of the SDK in the example app.

## Test Credentials

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.
