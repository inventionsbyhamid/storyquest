# Testing Sparks purchases (Vega IAP)

## How the app buys Sparks

1. On launch the app calls `PurchasingService.getUserData` and sends the IAP user id as `x-iap-user-id` on every API request. The wallet belongs to that id.
2. It loads `GET /v1/wallet`, then `getProductData` for the wallet's SKUs to show localized prices.
3. Buying: `purchase({ sku })` → `POST /v1/purchases/verify` → only after the server credits Sparks, `notifyFulfillment(FULFILLED)`.
4. On launch and whenever the app returns to the foreground it calls `getPurchaseUpdates` and verifies, then fulfills, any consumable that was paid for but never fulfilled.
5. If the IAP service is missing (the library or `getUserData` fails), the app switches to simulated purchases with receipt ids `fake-<uuid>` and user id `fake-user-<deviceId>`. Only a server with `IAP_MODE=fake` accepts these. Any other server rejects the first one, and the app then turns purchases off for the session. Free scenes keep working either way.

Logs to watch: `[IAP]` lines come from the store wrapper and `[Sparks]` lines from the wallet logic.

SKUs: `storyquest.sparks.10` (10 Sparks) and `storyquest.sparks.25` (25 Sparks), both consumable.

## Manifest

Already in `apps/vega/manifest.toml`:

```toml
[[wants.service]]
id = "com.amazon.iap.core.service"
[[wants.module]]
id = "/com.amazon.iap.core@IIAPCoreUI"
[[wants.service]]
id = "com.amazon.iap.tester.service"        # App Tester, sandbox mode
[[wants.module]]
id = "/com.amazonappstore.iap.tester@IIAPTesterUI"

[[needs.module]]
id = "/com.amazon.kepler.appstore.iap.purchase.core@IAppstoreIAPPurchaseCoreService"
```

If the Virtual Device refuses to install the app because that last module is missing, move it from `needs` to `wants` for local testing.

## Sandbox testing with App Tester

App Tester answers the IAP calls from a JSON file instead of the real Appstore. SDK Tester must not be installed at the same time.

1. **Make the item file.** Download it from the app's page in the Apps & Games Developer Portal, or write it by hand, and name it `amazon.sdktester.json`:

   ```json
   {
     "storyquest.sparks.10": {
       "itemType": "CONSUMABLE",
       "price": 11.99,
       "title": "10 Sparks",
       "description": "Ten newly filmed scenes",
       "smallIconUrl": "https://example.com/sparks.png"
     },
     "storyquest.sparks.25": {
       "itemType": "CONSUMABLE",
       "price": 24.99,
       "title": "25 Sparks",
       "description": "Twenty five newly filmed scenes",
       "smallIconUrl": "https://example.com/sparks.png"
     }
   }
   ```

2. **Put it on the device.** The file must end up at `/tmp/scratch/com.amazonappstore.iap.tester/amazon.sdktester.json`.

   Virtual Device:
   ```sh
   vega exec vda shell mkdir -p /tmp/scratch/com.amazonappstore.iap.tester/
   vega device copy-to -s amazon.sdktester.json --destination /tmp/scratch/com.amazonappstore.iap.tester
   ```
   Fire TV:
   ```sh
   vega exec vda shell mkdir -p /tmp/scratch/com.amazonappstore.iap.tester/
   vega exec vda push amazon.sdktester.json /tmp/
   vega exec vda shell cp /tmp/amazon.sdktester.json /tmp/scratch/com.amazonappstore.iap.tester/
   ```

3. **Turn on sandbox mode for StoryQuest.** Create `amazon.config.json` containing `{ "debug.amazon.sandboxmode": "debug" }` and copy it to `/tmp/scratch/com.storyquest.tv/` the same way. Then close and reopen the app. To go back to production, set the value to `prod` or delete the file.

4. **Install and open App Tester.** Get the App Tester `.vpkg` for the current SDK release from the Configure App Tester page, then:
   ```sh
   vega run-app <path>/<apptester>.vpkg com.amazonappstore.iap.tester.ui -d VirtualDevice
   vega exec vda shell vmsgr send pkg://com.amazonappstore.iap.tester.ui
   ```
   In App Tester, "IAP Items in JSON File" shows the items it loaded. To stop it: `vlcm terminate-app -f -p com.amazonappstore.iap.tester`.

5. **Run the server in sandbox mode** (`IAP_MODE=sandbox` with the IAP shared secret) so receipts go to the RVS Cloud Sandbox.

## Virtual Device caveat

The App Tester pages we read (Vega 0.23 and 0.24) only say it runs on a Virtual Device or a Fire TV. They do not list host requirements, and we have not seen the IAP service work on our Linux x86 Virtual Device. If `[IAP] getUserData failed` shows in the logs, the IAP service is not there. The app then simulates purchases, so run the server with `IAP_MODE=fake` for demos on that device and use a real Fire TV for sandbox testing.

## Checks

* First launch: the pill shows "Your first custom scene is on us"; the first Something else idea is free.
* With 0 Sparks: Something else, a paid choice card, or Make your own opens Get more Sparks.
* Buying: the price comes from App Tester; after "Sparks added" the original action carries on.
* Backing out of the Amazon purchase screen shows "No Sparks were bought, and nothing was charged."
* Close the app right after paying, before the Sparks show up: on the next launch they are credited and the purchase is fulfilled. App Tester shows it as fulfilled.
* Server down during a purchase: the app says the Sparks will appear later, and the purchase stays unfulfilled until the next successful launch.
* Purchases off on the server: the sheet explains that purchases are not available, and free scenes still work.

Sources: [Vega IAP API](https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_keplerscript-appstore-iap-lib.html), [Configure App Tester](https://developer.amazon.com/docs/vega/0.24/configure-app-tester.html), [Use App Tester](https://developer.amazon.com/docs/vega/0.24/use-app-tester.html), [Test IAP in production mode](https://developer.amazon.com/docs/vega/0.24/iap-production-mode.html).
