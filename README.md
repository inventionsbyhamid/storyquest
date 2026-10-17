# StoryQuest

**Tonight's story is yours to choose.** StoryQuest is a Fire TV app where every scene of a family story is an AI generated video clip with sound. When a scene ends, the family picks what happens next with the remote, or presses the microphone button and says their own idea, and the next scene plays.

Six new stories arrive every day. Every family starts from the same openings, every family ends somewhere different, and every ending can be shared with a QR code.

* Demo video: _link coming with the submission_
* Built for the Fire TV track of the Amazon Developer hackathon "Build, Ship, Shape"
* Runs on Fire TV with Vega OS (React Native for Vega), with the same UI on Android TV and the web for development

## What it does

* **Tonight's Stories.** Six fresh stories each day, planned by Claude on Amazon Bedrock with a seasonal touch.
* **Every scene is video.** Each scene is an 8 second clip with music, sound effects and voices, made by MiniMax H3 Max Turbo.
* **Choices with the D pad, ideas with your voice.** Two choices after every scene, plus Something else, where the remote microphone dictates any idea into the story.
* **Seamless cuts.** Each clip starts on the exact last frame of the previous one, so the story flows like one film.
* **Instant choices.** While a scene plays, both possible next scenes are already being made.
* **Shared story trees.** Popular paths are made once and then play instantly for every family. Custom ideas grow a private branch.
* **Share the ending.** The end screen shows a QR code to a web page with the whole story as one movie, plus stats like "Only 8% of families opened the moon door".
* **Safe for everyone.** An audience setting (Kids, Family, Grown ups) shapes the writing, and every typed idea and every scene passes a safety check.
* **Free to watch, Sparks to film your own.** Daily stories and their paths are free. Scenes filmed only for your family use Sparks, bought with Amazon In App Purchasing. No sign up: Sparks follow your Amazon account. Your first custom scene is free.

## Try it (judges)

1. **Watch the demo video** linked above.
2. **Sideload on a Fire TV Stick with Vega OS:** download `StoryQuest_armv7.vpkg` from the latest GitHub release, then follow the steps in [docs/judges.md](docs/judges.md).
3. **Run it in the Vega Virtual Device:** download `StoryQuest_x86_64.vpkg` (Intel Mac or Ubuntu) or `StoryQuest_aarch64.vpkg` (Apple Silicon) from the release and run `vega device install-app -p <file>` then `vega device launch-app -a com.storyquest.tv.main`.

The release build talks to our hosted server, so no keys or setup are needed. The server stays up until judging ends on November 20, 2026.

## How it works

```
Fire TV app (Vega OS, React Native)
        │  HTTPS JSON and MP4
        ▼
StoryQuest server (Node 22, Fastify, SQLite)
  ├─ story director   Claude on Amazon Bedrock
  ├─ safety           Amazon Bedrock Guardrails
  ├─ video            fal, MiniMax H3 Max Turbo (image to video)
  └─ media            ffmpeg: posters, last frames, the shared movie
```

1. **Story bible.** Each story has a fixed art style and a fixed description for every character. They are copied into every video prompt so characters stay recognisable.
2. **Director.** For every new scene, Claude gets the bible, the story so far, the choice taken and where the scene sits in a six scene arc, and returns the scene as JSON: a summary for memory, an on screen caption, the video prompt and the next two choices.
3. **Video.** The video model renders the scene starting from the last frame of the previous clip.
4. **Prefetch.** When a family arrives at a scene, both next scenes start generating at once, so a choice usually plays immediately.
5. **Dedupe.** A unique constraint on (parent, choice) means two families picking the same new path at the same time share one generation.

More detail in [docs/design.md](docs/design.md).

### Fire TV and Vega features used

* React Native for Vega with the Vega W3C media player for playback, one decoder reused for every clip.
* Spatial focus navigation for the remote, with accessibility labels on every focusable card so Alexa voice navigation can select them.
* Remote microphone dictation into the system keyboard for custom story ideas.
* Vega Media Controls, so Play, Pause and "Alexa, pause" work.
* Built and tested with the Vega SDK 0.24 and the Vega Virtual Device.

### Design

The look is "picture book at night": flat inks, warm paper type, story titles in Fraunces, and AI scenes framed like illustrations. No gradients, no glows. The full system is in [docs/ui.md](docs/ui.md) and the logo, a Q whose tail forks into two paths, is in [assets/brand](assets/brand).

### AWS services used

* **Amazon Bedrock (Claude in Amazon Bedrock):** the story director, the bible writer and the daily story planner. See `apps/server/src/providers/director`.
* **Amazon Bedrock Guardrails:** checks every custom idea and every generated scene. See `apps/server/src/providers/safety/guardrails.ts`.

## Repository

```
apps/vega/            Fire TV app for Vega OS
apps/expo-multi-tv/   the same UI for Android TV, Fire OS and web (development)
apps/server/          API, story engine, providers, share page, Dockerfile
packages/shared-ui/   screens, components, API client, story state machine
packages/contracts/   request and response schemas shared by app and server
assets/brand/         logo, Fraunces font, store icons and background
docs/                 design, UI system, economics, friction log, product feedback, store listing
```

## Run it yourself

### Prerequisites
* Node 22 and Yarn 4 (`corepack enable`)
* ffmpeg (for the server)
* Vega SDK 0.24 for the Fire TV app ([install guide](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk.html))
* Optional for real AI: an AWS account with Claude enabled in Amazon Bedrock, and a fal API key

### Server

```bash
yarn install
cp apps/server/.env.example apps/server/.env   # fill in keys only if you want real AI
yarn dev:server                                # http://localhost:8080
```

Without keys the server uses built in fakes: a scripted story writer and ffmpeg generated placeholder clips, so the whole app works offline. Set `DIRECTOR=bedrock`, `VIDEO=fal` and `SAFETY=guardrails` with the matching keys to use the real services. Every variable is described in [apps/server/.env.example](apps/server/.env.example).

With Docker:

```bash
docker build -f apps/server/Dockerfile -t storyquest-api .
docker run -p 8080:8080 --env-file apps/server/.env -v storyquest-data:/data storyquest-api
```

### Fire TV app

Point the app at your server in `apps/vega/src/config.ts`, then:

```bash
yarn build:vega
vega virtual-device start
vega device install-app -p apps/vega/build/x86_64-release/vega_x86_64.vpkg
vega device launch-app -a com.storyquest.tv.main
```

For quick UI work the same screens run on Android TV or the web: `yarn dev:web`.

### Tests

```bash
yarn workspace @storyquest/server test
yarn workspace @multi-tv/shared-ui test
```

## Safety and privacy

* No accounts and no personal data. Each TV gets a random device id, used only for rate limits.
* Typed ideas and generated scenes pass Amazon Bedrock Guardrails, and the video model's own safety checker is on.
* Family text is treated only as story material, never as instructions to the model.

## Costs and business model

Every filmed scene costs about $0.36 (8 seconds of video at $0.04 a second plus the story director). Shared story trees are filmed once and reused by every family, so free stories have a fixed cost. Scenes filmed only for one family use Sparks, sold through the Amazon Appstore. A global daily video budget and a per device cap keep spending bounded, and when the budget runs out the already made paths keep playing. The numbers, including a 1000 signups a day simulation, are in [docs/economics.md](docs/economics.md).

## Website

The server also serves the public site: a home page, privacy policy, terms and support at `/`, `/privacy`, `/terms` and `/support`, plus share pages at `/s/<code>`.

## Built during the hackathon

StoryQuest started from Amazon's open source [react-native-multi-tv-app-sample](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample) (MIT-0, notice kept in [docs/LICENSE-amazon-sample-MIT-0.txt](docs/LICENSE-amazon-sample-MIT-0.txt)). We kept its monorepo layout, remote control plumbing and Vega media player integration. Everything else, the screens, the story engine, the server and the share page, was built during the hackathon.

* [Friction log](docs/friction-log.md)
* [Product feedback](docs/product-feedback.md)

## License

MIT, see [LICENSE](LICENSE).
