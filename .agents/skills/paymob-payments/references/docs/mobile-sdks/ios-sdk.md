---
title: "IOS SDK"
url: https://developers.paymob.com/paymob-docs/mobile-sdks/ios-sdk
tab: developers
breadcrumbs: "Mobile SDKs > IOS SDK"
---

# IOS SDK
**Outcome** \- Integrate Paymob's native iOS SDK

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

## Installation

You can install the iOS SDK in **one of two ways**. Choose **only one** method.

###  Option 1: Cocoa installation

PaymobSDK is available through [CocoaPods](https://cocoapods.org/). 

#### Add Pod Dependency

Simply add the following line to your Podfile:

```swift
pod 'Paymob'
``` 

#### Install Pods

Run `pod install` command in the terminal

#### Open Workspace

Open your project using the`.xcworkspace` file

#### Change the embedding option to "Embed & Sign"

In the general settings of your project, under libraries and frameworks, change the library from "**Do not embed** " to "**Embed and Sign** "

![](https://d24lr4zqs1tgqh.cloudfront.net/5e59f000-6804-44d4-a96d-500cab247391.jpg)

* * *

### Manual Installation

#### Download the SDK

Download the SDK from the provided [**link**](https://paymob-my.sharepoint.com/:f:/p/mahmoudyoussef/El9q1ULaxcBFkQurwvXkZQEBY9S-6dwhWL9xXQgjEnGPBQ?e=0sKgCf)and extract it on your local machine.

* * *

#### Add the SDK files to your project

Copy the extracted SDK files and place them inside your project’s folder structure.

* * *

#### Add the SDK to Xcode

Open your project in Xcode, then drag and drop the **PaymobSDK.xcframework** into **General → Frameworks, Libraries, and Embedded Content**.

* * *

#### Embed and sign the SDK

 In **Frameworks, Libraries, and Embedded Content** , change the SDK option from **Do Not Embed** to **Embed & Sign**.

![](https://d24lr4zqs1tgqh.cloudfront.net/9fa4315a-1bc0-4b34-9ae3-6a294b18f09c.jpg)

* * *

## Usage

### **Normal Checkout Flow**

#### Import the framework

```swift
import PaymobSDK
``` 

#### Add the delegate to the class, and add the protocol stubs

```swift
class ViewController: UIViewController, PaymobSDKDelegate {
``` 

It should look like this.

```swift
extension ViewController: PaymobSDKDelegate{

    func transactionRejected(message : String) {
        print("Transaction Rejected \(message)")        
    }
    
    func transactionAccepted(transactionDetails: [String : Any]) {
        print("Transaction Successfull: \(transactionDetails)")
    }
    
    func transactionPending() {
        print("Transaction Pending")
    }
}
``` 

> **Info:**
> 
> You should configure the response callback URL for the integration ID in use to the appropriate URL listed below, based on the region. This is required in order to run the callback functions (**transactionAccepted** , **transactionRejected** , and **transactionPending**).
> 
> **Egypt** : `https://accept.paymob.com/api/acceptance/post_pay`
> 
> **Oman** : `https://oman.paymob.com/api/acceptance/post_pay`
> 
> **Saudi Arabia:** `https://ksa.paymob.com/api/acceptance/post_pay`
> 
> **United Arab Emirates:** ` https://uae.paymob.com/api/acceptance/post_pay`

#### Create a constant

```swift
let paymob = PaymobSDK()
``` 

#### Pass self to delegate

```swift
paymob.delegate = self
``` 

#### Create the variables

```swift
// Replace this string with your payment key

let client_secret = "" //Put Client Secret Here

let public_key = "" // Put Public Key Here
``` 

**Client Secret**

A unique, intention-specific token used to redirect the customer to Paymob’s Unified Checkout or to render Paymob’s Pixel component.

> **Info:**
> 
> You can get a client secret by calling the [**Create Intention API request**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention).

**Public Key**

> **Info:**
> 
> To know how to get your public key, please check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page.

> **Info:**
> 
> If you’re using saved cards, pass the saved token as a string in the `card_tokens` array when calling [**the intention creation request**](https://developers.paymob.com/egypt/api-reference-guide/create-intention-payment-api)
> 
> ![](https://d24lr4zqs1tgqh.cloudfront.net/20b52d30-4568-4b59-a41a-05e6e11fdfef.jpg)

> **Info:**
> 
> For generating a save card token to be used within a Moto transaction later, please refer to this [link](https://developers.paymob.com/paymob-docs/developers/pay-with-saved-cards/create-card-token) for generating a save card token.

#### Customize the UI of the SDK

You can customize the UI of the SDK, such as

```swift
// the extra UI Customization parameters are

//sets the title to be the image you want
appIcon

//sets the title to be the name you want
appName

//changes the color of the buttons throughout the SDK, the default is black
buttonBackgroundColor

//changes the color of the buttons Texts throughout the SDK, the default is white
buttonTextColor

//set save card checkbox initial value
saveCardDefault

//set whether or not should show save card checkbox
showSaveCard

//used like this
let paymob = PaymobSDK()

paymob.paymobSDKCustomization.appIcon = UIImage()
paymob.paymobSDKCustomization.appName = ""
paymob.paymobSDKCustomization.buttonBackgroundColor = UIColor.black
paymob.paymobSDKCustomization.buttonTextColor = UIColor.white
paymob.paymobSDKCustomization.showSaveCard = true

paymob.paymobSDKCustomization.saveCardDefault = false

try paymob.presentPayVC(VC: self, PublicKey: public_key, ClientSecret: client_secret)
paymob.paymobSDKCustomization.saveCardDefault = false
``` 

#### **Run the SDK**

```swift
do{
    try paymob.presentPayVC(VC: self, PublicKey: public_key, ClientSecret: client_secret)
} catch let error {

}
``` 

* * *

### **Embedded Checkout Flow**


#### Add Container View to your **view** controller

###### 1

**Drag a UIView into your view controller in the storyboard.**

![](https://d24lr4zqs1tgqh.cloudfront.net/08fafef7-b420-4e32-9df0-757158e537ed.jpg)

###### 2

**Set Custom Class**

Select your view and set **Custom Class** ⇒ **PaymobCheckoutView**. This marks the view as the **default checkout UI** for the SDK.

![](https://d24lr4zqs1tgqh.cloudfront.net/03844be0-9a17-4886-bd4b-b1888a3cf9b5.jpg)

###### 3

**Set Height Constraint**

Select your container view in the storyboard.

Add a **Height constraint**.

Change the **Relation** to **Greater Than or Equal zero**. 

This allows the SDK to dynamically resize the view.

![](https://d24lr4zqs1tgqh.cloudfront.net/73436cdd-7042-4deb-9e4a-e52c4b5db45e.jpg)

###### 4

**Create an outlet for the checkout container view.**

```swift
@IBOutlet weak var paymobCheckoutView: PaymobCheckoutView!
``` 

###### 5

**Set Delegate**

```swift
override func viewDidLoad() {
        super.viewDidLoad()
        paymobCheckoutView.delegate = self
 }
``` 

#### Configure the Embedded Checkout View

After adding the SDK view and implementing the Callbacks, the final step is to configure the SDK view

```swift
let checkoutUICustomization = ""

override func viewDidLoad() {
    super.viewDidLoad()
    paymobCheckoutView.configure(
        uiCustomization: checkoutUICustomization,
        showAddNewCard: true,
        payFromOutside: false,
        showSaveCard: true,
        saveCardDefault: false
    )
}
``` 

#### **Set Payment Keys**

Whenever you make any [**update to the intention via API**](https://developers.paymob.com/paymob-docs/developers/intention-apis/update-intention), you will need to update the intention data inside the SDK

```swift
paymobCheckoutView.setPaymentKeys(
        publicKey: "YOUR_Public_Key",
        clientSecret: "Your_Client_Secret"
  )
``` 

**Client Secret**

A unique, intention-specific token used to redirect the customer to Paymob’s Unified Checkout or to render Paymob’s Pixel component.

> **Info:**
> 
> You can get a client secret by calling the [**Create Intention API request**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention).

**Public Key**

> **Info:**
> 
> To know how to get your public key, please check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page.

#### UI Customization (Optional)

```swift
let checkoutUICustomization = """
    {
      "Font_Family": "System",
      "Font_Size_Label": "16",
      "Font_Size_Input_Fields": "11",
      "Font_Size_Payment_Button": "16",
      "Font_Weight_Label": "500",
      "Font_Weight_Input_Fields": "500",
      "Font_Weight_Payment_Button": "900",
      "Color_Border_Input_Fields": "#DBE1EA",
      "Color_Disabled": "#00000080",
      "Color_Error": "#FF0000",
      "Color_Primary": "#144DFF",
      "Color_Input_Fields": "#FFFFFF",
      "Text_Color_For_Label": "#000000",
      "Text_Color_For_Payment_Button": "#FFFFFF",
      "Text_Color_For_Input_Fields": "#000000",
      "Color_For_Text_Placeholder": "#C7C7CD",
      "Payment_Button_Title": "Pay Now",
      "Radius_Border": "6",
      "Container_Padding": "16"
    }
    """

    override func viewDidLoad() {
        super.viewDidLoad()
        // Configure the containerView with the UI customization and other parameters
        paymobCheckoutView.delegate = self
        paymobCheckoutView.configure(
        uiCustomization: checkoutUICustomization,
        )
    }
``` 

> **Warning:**
> 
> Always call configure(uiCustomization:) inside viewDidLoad.
> 
> Use the same JSON structure and value types.
> 
> Missing keys will fall back to default values.

#### Trigger Payment from a Custom Button (Optional)

You can use the payFromOutside function only if you set the payFromOutside parameter to TRUE while configuring the SDK view.

###### 1

Pass payFromOutside property to TRUE

```swift
let checkoutUICustomization = ""

override func viewDidLoad() {
    super.viewDidLoad()
    paymobCheckoutView.configure(
        uiCustomization: checkoutUICustomization,
        showAddNewCard: true,
        payFromOutside: true,
        showSaveCard: true,
        saveCardDefault: false
    )
}
``` 

###### 2

Call the payFromOutside function whenever you want to start the payment

```swift
@IBAction func payButtonTapped(_ sender: Any) {
        paymobCheckoutView.payFromOutside()
    }
``` 

## Test Credentials

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.
