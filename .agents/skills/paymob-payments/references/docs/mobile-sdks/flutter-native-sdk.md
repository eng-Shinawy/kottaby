---
title: "Flutter Native SDK"
url: https://developers.paymob.com/paymob-docs/mobile-sdks/flutter-native-sdk
tab: developers
breadcrumbs: "Mobile SDKs > Flutter Native SDK"
---

# Flutter Native SDK
**Outcome** \- Integrate Paymob's official Flutter SDK

* * *

The**Flutter SDK** connects your Flutter app to the native Paymob iOS and Android SDKs. Both native SDKs are bundled inside the SDK; no separate downloads or manual native code changes are required on either platform.

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

> **Info:**
> 
> The Flutter SDK plugin supports a minimum Android SDK version of 23 (Android 6.0) and a minimum iOS version of 13.0.

## Installation

### Add the dependency

In your `pubspec.yaml`Add the SDK under dependencies:

```dart
dependencies:
  flutter_paymob_sdk:
    git:
      url: https://github.com/PaymobAccept/flutter_sdk.git
``` 

Then run:

```dart
flutter pub get
``` 

### Android configurations

#### Configure Gradle repositories

In `android/settings.gradle.kts`, add the following inside the `dependencyResolutionManagement`block:

```kotlin
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://storage.googleapis.com/download.flutter.io") }
        maven { url = uri("https://jitpack.io") }

        val flutterPluginsDeps = file("../.flutter-plugins-dependencies")
        if (flutterPluginsDeps.exists()) {
            @Suppress("UNCHECKED_CAST")
            val json = groovy.json.JsonSlurper().parse(flutterPluginsDeps) as Map<String, Any>
            @Suppress("UNCHECKED_CAST")
            val androidPlugins = ((json["plugins"] as? Map<String, Any>)?.get("android")
                as? List<Map<String, Any>>) ?: emptyList()
            androidPlugins.find { it["name"] == "flutter_paymob_sdk" }
                ?.get("path")
                ?.let { maven { url = uri("${it}android/libs") } }
        }
    }
}
``` 

#### Enable Data Binding

In `android/app/build.gradle.kts`, inside the `android {}`block:

```kotlin
android {
    buildFeatures {
        dataBinding = true
    }
}
``` 

### IOS

Run `pod install`

The [`PaymobSDK.xcframework`](https://PaymobSDK.xcframework) Is bundled inside the SDK and picked up automatically by CocoaPods.

* * *

## Usage

### Import and initialize

In your Dart file, import the plugin and create a `PaymobService` instance:

```dart
import 'package:flutter_paymob_sdk/flutter_paymob_sdk.dart';

final service = PaymobService();
``` 

### Launch the payment SDK

```dart
final result = await paymobService.payWithPaymob(
  publicKey: publicKey,
  clientSecret: clientSecret,
  customization: PaymobCustomization(
    appName: 'My Store',
    buttonBackgroundColor: Colors.blue,
    buttonTextColor: Colors.white,
    showSaveCard: true,
    saveCardDefault: false,
  ),
);

if (result.isSuccessful) {
  // Payment succeeded
} else if (result.isFailure) {
  // Payment failed
} else if (result.isPending) {
  // Payment is pending
}
``` 

The `result` is an instance object of the `PaymobPaymentResult` class. It will also include the two parameters below:

Title

Description

**Property**| **Type**| **Description**  
---|---|---  
transactionDetails| Map<String, dynamic>?| Transaction data (**successful** payments only)  
errorMessage| String?| Error description if status is **isFailure**  
  
> **Info:**
> 
> You should configure the response callback URL for the integration ID in use to the appropriate URL listed below, based on the region. This ensures your after-payment actions run correctly based on the **actual payment status** returned by Paymob.
> 
> **Egypt** : `https://accept.paymob.com/api/acceptance/post_pay`
> 
> **Oman** : `https://oman.paymob.com/api/acceptance/post_pay`
> 
> **Saudi Arabia:** `https://ksa.paymob.com/api/acceptance/post_pay`
> 
> **United Arab Emirates:** ` https://uae.paymob.com/api/acceptance/post_pay`

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
> ![](https://d24lr4zqs1tgqh.cloudfront.net/98a01035-d4ae-4cce-9f65-b13f098bdc5c.jpg)

> **Info:**
> 
> For generating a save card token to be used within a Moto transaction later, please refer to this [link](https://developers.paymob.com/paymob-docs/developers/pay-with-saved-cards/create-card-token) for generating a save card token.

### Optional UI customization

The following optional parameters can be passed inside `PaymobCustomization` to customize the SDK appearance and behavior:

```dart
PaymobCustomization(
  // Branding
  appName: 'My Store',
  androidAppLogo: 'ic_launcher',     // Android: drawable/mipmap resource name
  iosAppLogo: 'assets/logo.png',     // iOS: Flutter asset path

  // Button
  buttonBackgroundColor: Colors.blue,
  buttonTextColor: Colors.white,

  // Card saving
  showSaveCard: true,
  saveCardDefault: false,

  // Screens
  showTransactionResult: true,       // Show/hide the built-in result screen after payment

  // iOS only
  isKeyboardHandlingEnabled: true,   // SDK keyboard avoidance behavior
)
``` 

> **Info:**
> 
> #### **App logo**
> 
> The logo parameter is split into two `androidAppLogo` and `iosAppLogo`, because each platform stores image assets differently.
> 
> #### Android**:**
> 
> Pass the name of an image resource that already exists in your Android project under `res/drawable/` or `res/mipmap/`. Every Flutter app comes with `ic_launcher` by default, so you can use that or add your own.
> 
> #### IOS
> 
> Pass the path of a Flutter asset. The image must first be added to your `pubspec.yaml` under `flutter: assets:`, Then pass the same path to the plugin.
