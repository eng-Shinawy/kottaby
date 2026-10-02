---
title: "Android SDK"
url: https://developers.paymob.com/paymob-docs/mobile-sdks/android-sdk
tab: developers
breadcrumbs: "Mobile SDKs > Android SDK"
---

# Android SDK
**Outcome** \- Integrate Paymob's native Android SDK

* * *

### Supported payment methods

  - **Cards**

  - **Wallets**

  - **Google Pay**

  - **Bank Installments**

  - **vaLU**

  - **Souhoola**

  - **Forsa**

  - **Premium6**

  - **Aman Installments**

### Manual installation

#### Download SDK files (.jar/.aar)

Download the SDK from this[ link ](https://paymob-my.sharepoint.com/:f:/p/ahmedsobhy/EjQrdOdzUzhIqlQmcsE9Hg0BOVjJYOu2BMGRClGVEa9dJA?e=hfFnnI)and unzip the “Sdk package” folder.

#### Locate the SDK files in `**app/libs/**` folder

Copy the SDK folder into the libs directory of your Android project.

![](https://d24lr4zqs1tgqh.cloudfront.net/d7dba1b4-0fab-49b0-838b-0a7bbd0a6f22.jpg)

![](https://d24lr4zqs1tgqh.cloudfront.net/13af2bfd-e6be-427e-ab2a-db582ed61c77.jpg)

#### Add the repository to `settings.gradle.kts`

Add required local Repositories as follows:

```kotlin
repositories {
    maven {
        url = rootProject.projectDir.toURI().resolve("libs")     }
    maven {
        url = uri("https://jitpack.io")
    }
 }
``` 

![](https://d24lr4zqs1tgqh.cloudfront.net/23f34018-2a04-4056-990e-3c579e0e4c86.jpg)

![](https://d24lr4zqs1tgqh.cloudfront.net/fd141f02-08b4-429c-bc50-4ee1a57e8859.jpg)

#### Add a dependency in `app/build.gradle.kts`

```kotlin
implementation("com.paymob.sdk:Paymob-SDK:{{latest version}}")//Please change this version number to match the version number of the downloaded sdk
``` 

![](https://d24lr4zqs1tgqh.cloudfront.net/4a8de2d8-f419-425e-8ab7-e4757acd5240.jpg)

#### Enable data binding in `app/build.gradle.kts`

Add your data-binding feature in BaseAppModuleExtensions as follows:

```kotlin
android {
    buildFeatures { dataBinding = true } }
``` 

![](https://d24lr4zqs1tgqh.cloudfront.net/8d7f15fe-4a8e-4236-a826-c8596ad5cd4f.jpg)

#### Sync gradle project

* * *

### **Usage imports**

```kotlin
import com.paymob.paymob_sdk.PaymobSdk
import com.paymob.paymob_sdk.domain.model.CreditCard
import com.paymob.paymob_sdk.domain.model.SavedCard
import com.paymob.paymob_sdk.ui.PaymobSdkListener
``` 

* * *

### **Implement Paymob Sdk listener interface**

```kotlin
class MainActivity : AppCompatActivity(), PaymobSdkListener { override fun onCreate(savedInstanceState: Bundle?) {…}
override fun onSuccess() {
//If the Payment is successful }
override fun onFailure() {
//If The Payment is declined }
override fun onPending() {
//If The Payment is pending }
}
``` 

> **Info:**
> 
> You should configure the response callback URL for the integration ID in use to the appropriate URL listed below, based on the region. This is required in order to run the callback functions (**onSuccess** , **onFailure** , and **onPending**).
> 
> **Egypt** : `https://accept.paymob.com/api/acceptance/post_pay`
> 
> **Oman** : `https://oman.paymob.com/api/acceptance/post_pay`
> 
> **Saudi Arabia:** `https://ksa.paymob.com/api/acceptance/post_pay`
> 
> **United Arab Emirates:** ` https://uae.paymob.com/api/acceptance/post_pay`

* * *

### **Normal Checkout Flow**

#### **Create a PaymobSdk instance**

**You can create the PaymobSdk instance using**`**PaymobSdk.Builder()**`

```kotlin
val paymobsdk = PaymobSdk.Builder(
context = this@MainActivity,
clientSecret = “CLIENT_SECRET”,//Place Client Secret here
publicKey = “PUBLIC_KEY”,//Place Public Key here
paymobSdkListener = this
)
.build()
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
> To pass the saved token to the SDK, you should pass the token as a string to the **card_tokens** array while calling [**the intention creation request**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)
> 
> ![](https://d24lr4zqs1tgqh.cloudfront.net/fbaeac8d-1038-4964-b93f-49b4d3a64d18.jpg)

> **Info:**
> 
> For generating a save card token to be used within a Moto transaction later, please refer to this [link](https://developers.paymob.com/paymob-docs/developers/pay-with-saved-cards/create-card-token) for generating a save card token.

#### **Customize the SDK payment sheet (Optional)**

**You can set the SDK buttons' color and buttons' text color using this builder object, for example:**

```kotlin
val paymobsdk = PaymobSdk.Builder(
context = this@MainActivity,
clientSecret = “CLIENT_SECRET”,//Place Client Secret here
publicKey = “PUBLIC_KEY”,//Place Public Key here
paymobSdkListener = this,
)
.setButtonBackgroundColor(Color.BLACK)//changes the color of button backgrounds throughout the SDK, and set by default to black
.setButtonTextColor(Color.WHITE)//changes the color of button texts throughout the SDK, and set by default to white
.showSaveCard(showSaveCard ?: true) //changes the ability for the sdk to save the card info or no
.saveCardByDefault(saveCardDefault ?: false) //changes the ability for the sdk if the save card checkbox is checked ot not
.build()
``` 

####  **Finally: Run the SDK**

**You can start the SDK by calling**

```kotlin
sdk.start()
``` 

* * *

### **Embedded Checkout Flow**

#### **Add PaymobCheckoutView to Layout**

Add the SDK view to your layout XML file. This view will be responsible for rendering the payment UI inside your screen.

```xml
<com.paymob.paymob_sdk.ui.embedded.PaymobCheckoutView
android:id="@+id/paymob_checkout_view"
android:layout_width="match_parent"
android:layout_height="wrap_content"/>
``` 

#### **Configure the Embedded Checkout View**

After adding the SDK view, the final step is to configure the SDK view.

```kotlin
class MainActivity : AppCompatActivity(), PaymobSdkListener {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val paymobCheckoutView =
            findViewById<PaymobCheckoutView>(R.id.paymob_checkout_view)

        val uiCustomizationJson = ""

        paymobCheckoutView.configure(
            activity = this@MainActivity,
            uiCustomization = uiCustomizationJson,
            showAddNewCard = true,
            showSaveCard = true,
            saveCardByDefault = false,
            payFromOutside = false,
            paymobSdkListener = this
        )
    }
}
``` 

#### **Set Payment Keys**

Whenever you make any [**update to the intention via the API**](https://developers.paymob.com/paymob-docs/developers/intention-apis/update-intention), you need to update the intention data inside the SDK.

```kotlin
paymobCheckoutView.setPaymentKeys(
    publicKey = "PUBLIC_KEY",
    clientSecret = "CLIENT_SECRET"
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

#### **UI Customization (Optional)**

You can customize the UI using a JSON configuration (All customization attributes are optional):

```kotlin
val fontId = R.id.my_font

val uiCustomizationJson = """
{
    "Font_Family": $fontId,
    "Font_Size_Label": "17",
    "Font_Size_Input_Fields": "11",
    "Font_Size_Payment_Button": "16",

    "Font_Weight_Label": "500",
    "Font_Weight_Input_Fields": "500",
    "Font_Weight_Payment_Button": "700",

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
    "Radius_Border": "30",
    "Container_Padding": "40"
}
""".trimIndent()

paymobCheckoutView.configure(
    activity = this@MainActivity,
    uiCustomization = uiCustomizationJson,
    paymobSdkListener = this
)
``` 

#### **Trigger Payment from a Custom Button (Optional)**

By default, the embedded component includes its own **Pay button**.

If the merchant wants to trigger payment from a **custom button** , follow these steps:

###### 1

**Enable the external trigger while configuring the Embedded Checkout View**

```kotlin
paymobCheckoutView.configure(
            activity = this@MainActivity,
            uiCustomization = uiCustomizationJson,
            showAddNewCard = true,
            showSaveCard = true,
            saveCardByDefault = false,
            payFromOutside = true,
            paymobSdkListener = this
        )
``` 

###### 2

**Call the payment function**

Inside the button click logic, call the PayFromOutside function:

```kotlin
paymobCheckoutView.PayFromOutside()
``` 

* * *

## Test Credentials

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.
