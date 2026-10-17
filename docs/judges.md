# Testing StoryQuest

The release packages talk to our hosted server, which stays online until November 20, 2026. No accounts or keys are needed.

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
2. Watch the first scene. When it ends, pick one of the two choices.
3. At the next choice, pick **Something else**, press the microphone button on the remote (or type) and say an idea such as "the dragon is afraid of butterflies". The next scene is made from your idea.
4. Press Back at any time for the pause menu. "Alexa, pause" also works.
5. At the end, scan the QR code with a phone to watch your whole story as one movie.

The first scene of each daily story is ready instantly. Preset choices are usually ready before the scene ends. A custom idea takes a few seconds while the scene is written and rendered.
