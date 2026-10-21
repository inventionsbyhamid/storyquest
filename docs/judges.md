# Testing StoryQuest

The release packages talk to our hosted server at https://storyquest.dijmo.com, which stays online until November 20, 2026. No accounts or keys are needed.

## On a Fire TV Stick with Vega OS

Fire TV Stick 4K Select (2025), Fire TV Stick HD (2026) or Fire TV Stick 4K (2026).

1. Install the Vega SDK on your computer: https://developer.amazon.com/docs/vega/0.24/install-vega-sdk.html
2. Put the stick in developer mode: `vega devmode login`, then follow the prompts.
3. Download `StoryQuest_armv7.vpkg` from the latest release on GitHub.
4. Install and launch:

```bash
vega device install-app -p StoryQuest_armv7.vpkg
vega device launch-app -a com.storyquest.tv.main
```

## In the Vega Virtual Device

1. Install the Vega SDK as above and start the device: `vega virtual-device start`
2. Download `StoryQuest_x86_64.vpkg` (Intel Mac or Ubuntu) or `StoryQuest_aarch64.vpkg` (Apple Silicon Mac).
3. Install and launch:

```bash
vega device install-app -p StoryQuest_x86_64.vpkg
vega device launch-app -a com.storyquest.tv.main
```

## What to try

1. On **Tonight's Stories**, move between the cards with the D pad and press Select on any story.
2. Watch the first scene. When it ends, pick one of the choices. Choices with a picture are filmed and play at once. If you press nothing, a countdown picks a filmed choice for you.
3. Press Back at any time for the pause menu, where you can also report a scene. "Alexa, pause" also works.
4. At the end, scan the QR code with a phone to watch your whole story as one movie.

## About filming during judging

Every new scene is filmed by AI video and costs us money, so the hosted server has a fixed budget. During judging it plays the scenes that are already filmed and does not film new ones:

* Choices that were never filmed say "Not filmed yet". If none can play, the app offers Start over or Home.
* Something else and Make your own say "Paused".

The demo video shows live filming, including a custom idea. To try it yourself with no keys, run the server locally with its built in stand in story writer and clips (see "Run it yourself" in the README), point `apps/vega/src/config.ts` at it and build the app. Something else and Make your own then work end to end, after a short grown ups question.
