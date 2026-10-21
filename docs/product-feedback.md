# Product feedback

For each tool we answer: what we used it for, what worked well, what needs work, how onboarding felt, and whether we would build with it again. Detailed reproduction steps for every issue are in the [friction log](friction-log.md).

## Vega SDK 0.24 and Vega CLI 1.4

* **Used for:** building the StoryQuest app for Fire TV (Vega OS), packaging `.vpkg` files for armv7, aarch64 and x86_64, installing and launching on the virtual device, reading device logs.
* **Worked well:** once installed, one build produced packages for every architecture in under a minute. `vega device start-log-stream` was the single most useful debugging tool: native media pipeline logs next to our JavaScript logs made a playback failure easy to diagnose. The CLI's `device` subcommands (install, launch, running apps, installed apps) are clear and scriptable.
* **Needs work:** the installer has undocumented requirements (jq, non root user) and cannot be automated without tricks. `build-kepler` hung silently in a non interactive shell. `run-app` failed to determine the app while `launch-app` worked with the same name.
* **Onboarding:** about two hours from zero to the sample running on a virtual device, almost all of it on installer and environment issues, not on React Native.
* **Again?** Yes. React Native for Vega let us share one UI package with Android TV and the web, and the build tooling is fast once set up.

## Vega Virtual Device

* **Used for:** all on device testing (we had no Fire TV at the start), screenshots and screen recordings for the demo.
* **Worked well:** with KVM it boots in about 10 seconds. The emulator console (port 5554) gives full resolution screenshots and smooth 1080p screen recordings (`screenrecord start`), and remote keys can be scripted, which let us run full story playthroughs automatically and record our demo.
* **Needs work:** headless Linux use needs undocumented fixes: IPv6 in containers, software OpenGL instead of `--no-gl-accel` (which renders a black screen), and stale lock cleanup. The boot failure message ("failed to access shell" after 600 seconds) hid the real error. Without a GPU, video plays at about half speed, so playback cannot be judged there, and after long sessions the device stopped taking key input until it was restarted. An official container image and a documented recording command would remove most of this.
* **Again?** Yes, and we packaged our setup as an open source image (vega-headless) so others can skip the trial and error.

## React Native multi TV sample (AmazonAppDev)

* **Used for:** the starting point: monorepo layout, Vega metro configuration, remote control plumbing, the W3C media player integration.
* **Worked well:** the Vega metro config with mappings to the `@amazon-devices` ports saved hours, and the player screen showed the surface handle lifecycle clearly. Building for Vega, Android TV and web from one codebase worked as advertised.
* **Needs work:** the Vega app is still on React Native 0.72 while the Expo app is on 0.81, so shared code has to satisfy two React versions and two TypeScript setups. A note on which shared APIs are safe for both would help.
* **Again?** Yes.

## W3C media player (`@amazon-devices/react-native-w3cmedia`)

* **Used for:** playing every story scene, reusing one player and switching the source for each clip.
* **Worked well:** hardware H.264 decoding of our MP4 clips, and `ended` and `playing` events that drive our story state machine. We also registered Vega Media Controls so play and pause from the remote and from Alexa reach the app.
* **Needs work:** plain http media URLs fail with an opaque `MPB Call failed with code: 50004` while fetch and images work over http. A clear error or a documented https requirement would have saved us an hour.
* **Again?** Yes.

## Vega system keyboard and voice dictation

* **Used for:** the Something else feature, where a family types or says their own story idea.
* **Worked well:** focusing a TextInput opens the system keyboard with a built in hint to hold the microphone button and dictate, so voice input needed no extra code.
* **Needs work:** it would help to know from JavaScript whether the text came from dictation, so the app could skip a confirm step for voice input.
* **Again?** Yes.

## fal (MiniMax H3 Max Turbo)

* **Used for:** every video clip: text to video for openings, image to video from the previous clip's last frame for every following scene.
* **Worked well:** _to be completed after live testing_
* **Needs work:** _to be completed_
