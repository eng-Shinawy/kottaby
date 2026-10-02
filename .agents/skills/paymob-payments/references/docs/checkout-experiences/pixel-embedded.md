---
title: "Pixel (Embedded)"
url: https://developers.paymob.com/paymob-docs/checkout-experiences/pixel-embedded
tab: developers
breadcrumbs: "Checkout Experiences > Pixel (Embedded)"
---

# Pixel (Embedded)
**Outcome** \- Integrate Paymob's pre-built UI (Pixel) in the merchant's checkout.

* * *

### Pre-Requisites

  - Integrate the Intention API as described in the documentation for the [Create Payment Intention API.](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)

  - Include the following script and stylesheets in your HTML file

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/paymob-pixel@latest/styles.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/paymob-pixel@latest/main.css">
<script src="https://cdn.jsdelivr.net/npm/paymob-pixel@latest/main.js" type="module"></script>
``` 

### Usage

Create a new Pixel instance

```javascript
new Pixel({   publicKey: 'egy_pk_live_XXXX',
   clientSecret: 'egy_csk_live_XXXX',
   paymentMethods: [ 'card','google-pay','apple-pay'],
   elementId: 'paymob-elements',
   disablePay: false,
   showSaveCard :true,
   forceSaveCard : true,
            beforePaymentComplete: async (paymentMethod) => 
{
       console.log('Before payment start');
       return true
   },   
    afterPaymentComplete: async (response) =>
 {
       console.log('After Bannas payment');
   },   onPaymentCancel: () => {
       console.log('Payment has been canceled');
   },   cardValidationChanged: (isValid) => {
       console.log("Is valid ? ", isValid)
   },   customStyle: {
    Font_Family: 'Gotham',
    Font_Size_Label: '16',
    Font_Size_Input_Fields: '16',
    Font_Size_Payment_Button: '14',
    Font_Weight_Label: 400,
    Font_Weight_Input_Fields: 200,
    Font_Weight_Payment_Button: 600,
    Color_Container: '#FFF',
    Color_Border_Input_Fields: '#D0D5DD',
    Color_Border_Payment_Button: '#A1B8FF',
    Radius_Border: '8',
    Color_Disabled: '#A1B8FF',
    Color_Error: '#CC1142',
    Color_Primary: '#144DFF',
    Color_Input_Fields: '#FFF',
    Text_Color_For_Label: '#000',
    Text_Color_For_Payment_Button: '#FFF',
    Text_Color_For_Input_Fields: '#000',
    Color_For_Text_Placeholder: '#667085',
    Width_of_Container: '100%',
    Vertical_Padding: '40',
    Vertical_Spacing_between_components: '18',
    Container_Padding: '0'
   },});
        
</script>
``` 

> **Info:**
> 
> **Note** : If Google Pay is passed as a Payment Method, you must include the Google Pay SDK
> 
> <script src="https://pay.google.com/gp/p/js/pay.js"></script>

> **Warning:**
> 
> Google Pay isn't supported in **Egypt** yet; it's coming soon. Stay tuned.

#### Properties

The full list of properties is as follows:

Property name

Type

Definition

publicKey| String| To know how to get your public key, please check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page.  
---|---|---  
  
clientSecret| String| Once you fire the Intention API, you will receive “**client_secret** ” in the API Response, which will be used in the Pixel SDK. Client Secret is unique for each Order, and it expires in an hour.  
  
paymentMethods| Array of String| Pass “card” for Card Payments, "google-pay" for Google Pay, and “apple-pay” for Apple Pay.  
  
elementId| String| ID of the HTML element where the checkout pixel will be embedded.  
  
disablePay| Boolean| Pass true. If you don’t want to use Paymob’s Pay Button for Card Payment, in this case, you will dispatchEvent with the name (payFromOutside) to fire the pay.  
  
showSaveCard| Boolean| If this option is set to TRUE, users will have the option to save their card details for future payment.  
  
forceSaveCard| Boolean| If this option is set to true, the user's card details will be saved automatically without requiring their consent  
  
afterPaymentComplete| Function| This Functionality will be processed after payment is processed by Paymob. Check the full example below.  
  
customStyle| Object| You can pass custom styles; for more details, check the full example below.  
  
#### Events

We have one event that will be used if you want to trigger the payment from a custom Pay button, not Pixel's Pay button:

Title

Description

Event| Definition  
---|---  
  
payFromOutside| In case you need to use you pay button instead of the SDK pay button.  
  
```html
<button id="payFromOutsideButton">Pay From Outside Button</button>
``` 

```javascript
const button = document.getElementById('payFromOutsideButton');
      button?.addEventListener
	  ('click', function () 
	  {
        // Calling pay request
        const event = new Event('payFromOutside');
        window.dispatchEvent(event);
      });
``` 

#### Functions

The full list of functions is as follows:

Function

Definition

What should you do with?

cardValidationChanged| This Functionality will be processed whenever the card validation status changes.| Writes the function logic  
---|---|---  
  
beforePaymentComplete| Merchants can implement their own custom logic or functions before the payment is processed by Paymob. Check the full example below.| Writes the function logic  
  
afterPaymentComplete| This Functionality will be processed after payment is processed by Paymob. Check the full example below.| Writes the function logic  
  
onPaymentCancel| This function applies exclusively to Apple Pay. Merchants can implement their own custom logic to handle scenarios where a user cancels the Apple Pay payment by closing the Apple Pay SDK.| Writes the function logic  
  
updateIntentionData| Update the intention data within the SDK if any changes occur to the intention. For more details, refer to[**the Intention Update API documentation**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention).| Calls the function  
  
### Full sample

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Pixel Experience</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/paymob-pixel@latest/styles.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/paymob-pixel@latest/main.css">
  <style>
    .content {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      justify-content: center;
      align-items: center;
      margin-top: 2rem;
    }
    #paymob-elements {
      width: 50%;
    }

    #payFromOutsideButton {
      padding: 0.5rem;
      background-color: blue;
      color: white;
      border-radius: 0.2rem;
    }
  </style>
</head>
<body>
  <div class="header" style="padding: 1rem; background-color: rgb(233, 255, 207);">
    Hello in my website
  </div>
  <div class="wrapper">
    <div class="content">
      <div id="paymob-elements"></div>
      <button id="payFromOutsideButton">Pay From Outside Button</button>
    </div>
  </div>

  <div class="footer"></div>

  <script src="https://cdn.jsdelivr.net/npm/paymob-pixel@latest/main.js" type="module"></script>
  <script>
    // Configuration

    const BASE_URL= {
      "EGY": "https://accept.paymob.com/",
      "OMN": "https://oman.paymob.com/",
      "KSA": "https://ksa.paymob.com/",
      "UAE": "https://uae.paymob.com/"
    }

    const CONFIG = {
      PUBLIC_KEY: 'egy_pk_test_yVnwxxxxxxxxxxxxxxxxxxxxxxx',
      SECRET_KEY: 'egy_sk_test_3f1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      CLIENT_SECRET: 'egy_csk_test_cad1xxxxxxxxxxxxxxxxxxxxx',
      INTENTION_API_URL: BASE_URL.EGY + 'v1/intention/'
    };
    console.log(CONFIG.INTENTION_API_URL)

    // Merchant button logic
    const button = document.getElementById('payFromOutsideButton');
    button?.addEventListener('click', async function() {


      console.log('Updating payment intention...');

      const myHeaders = new Headers();
      myHeaders.append("Authorization", `Token ${CONFIG.SECRET_KEY}`);
      myHeaders.append("Content-Type", "application/json");

      const raw = JSON.stringify({
        "accept_order_id": 446579232,
        "amount": 3000,
        "items": [
          {
            "name": "Item name",
            "amount": 2000,
            "description": "Item description",
            "quantity": 1
          },
          {
            "name": "Item name",
            "amount": 1000,
            "description": "Item description",
            "quantity": 1
          }
        ],
        "billing_data": {
          "apartment": "dumy",
          "first_name": "test",
          "last_name": "update",
          "street": "dumy",
          "building": "dumy",
          "phone_number": "01010101010",
          "city": "dumy",
          "country": "dumy",
          "email": "test@email.com",
          "floor": "dumy",
          "state": "dumy"
        },
        "extras": {
          "ee": 22
        },
        "notification_url": "https://webhook.site/e4081416-3343-4c06-878b-sds55dfd37",
        "redirection_url": "https://google.com/"
      });

      const requestOptions = {
        method: "PUT",
        headers: myHeaders,
        body: raw,
        redirect: "follow"
      };

      try {
        console.log(CONFIG.CLIENT_SECRET);
        console.log(CONFIG.INTENTION_API_URL+CONFIG.CLIENT_SECRET)
        const response = await fetch(`${CONFIG.INTENTION_API_URL}${CONFIG.CLIENT_SECRET}`, requestOptions);
        console.log(response);
      } catch (error) {
        console.error('Error updating intention:', error);
      }

      console.log('Updating Pixel');
      const update_pixel_response = await Pixel.updateIntentionData();
      console.log('Pixel Updated', update_pixel_response);


      // Calling pay request
      const event = new Event('payFromOutside');
      window.dispatchEvent(event);
    });

    onload = (event) => {
      button.style = "display: none;"
      let pixel_instance = new Pixel({
        publicKey: CONFIG.PUBLIC_KEY,
        clientSecret: CONFIG.CLIENT_SECRET,
        paymentMethods: ['card', 'google-pay', 'apple-pay'],
        elementId: 'paymob-elements',
        disablePay: true,
        showSaveCard: false,
        forceSaveCard: true,

        beforePaymentComplete: async () => {
          console.log('Before payment start');          
          console.log('Waiting for 5 seconds...');
          await new Promise(res => setTimeout(() => res(''), 5000));
          console.log('Before payment end');
        },

        afterPaymentComplete: async (response) => {
          console.log('After payment logic');
          console.log(response);
          await new Promise(res => setTimeout(() => res(''), 5000));
        },

        onPaymentCancel: () => {
          console.log('Payment has been canceled');
        },

        cardValidationChanged: (isValid) => {
          if (isValid === true) {
            button.style = "display: block;"
            console.log("valid");
          } else {
            button.style = "display: none;"
            console.log("not valid");
          }
        },

        customStyle: {
          Font_Family: 'Gotham',
          Font_Size_Label: '16',
          Font_Size_Input_Fields: '16',
          Font_Size_Payment_Button: '14',
          Font_Weight_Label: 400,
          Font_Weight_Input_Fields: 200,
          Font_Weight_Payment_Button: 600,
          Color_Container: '#FFF',
          Color_Border_Input_Fields: '#D0D5DD',
          Color_Border_Payment_Button: '#A1B8FF',
          Radius_Border: '8',
          Color_Disabled: '#A1B8FF',
          Color_Error: '#CC1142',
          Color_Primary: '#144DFF',
          Color_Input_Fields: '#FFF',
          Text_Color_For_Label: '#000',
          Text_Color_For_Payment_Button: '#FFF',
          Text_Color_For_Input_Fields: '#000',
          Color_For_Text_Placeholder: '#667085',
          Width_of_Container: '100%',
          Vertical_Padding: '40',
          Vertical_Spacing_between_components: '18',
          Container_Padding: '0'
        }
      });
    };
  </script>
</body>
</html>
``` 

> **Error:**
> 
> Never put the Secret Key in frontend code. Backend creates/updates intentions; frontend only receives public key and client secret.
> 
> The above sample is for testing only.

### Test Credentials

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.
