# StoryQuest design

StoryQuest is a Fire TV app where every scene of a branching story is an AI generated video clip with sound. The family picks how the story continues with the remote, or says something new with the remote microphone, and the next scene plays.

## Goals

* Lean back fun for the whole family on the TV, controlled with the remote only.
* Every scene is real video with audio, not slides.
* Choices feel instant.
* Six new stories every day. Everyone starts from the same openings, every family ends somewhere different, and endings can be shared.
* Safe for all ages.

## Experience

### Home: Tonight's Stories
* A banner plays the focused story's opening clip, muted, after the poster shows.
* A row with the six stories of the day plus a Make your own card.
* Each card shows a title, a one line pitch, mood tags, an audience badge and how many families played it.

### Make your own
* A text field. Pressing the microphone button on the remote dictates into it. Typing also works.
* Mood chips: funny, adventure, cozy, mystery, a little spooky.
* Audience: Kids, Family, Grown ups.

### Story
* Each scene is one clip of about 8 seconds, full screen, with captions.
* When a clip ends, its last frame stays on screen and three cards appear: two choices with thumbnails and Something else.
* Something else opens the text field. The custom scene takes a few seconds and shows a short animation while it is made.
* Back opens a pause menu. Play and Pause work, and so does Alexa, pause.

### The End
* A title card, the share QR code and stats such as "Only 8% of families opened the moon door".
* Watch it as one movie, New story, Home.

## Story engine

### Story trees
Every story is a tree of scene nodes. A preset choice is an edge to a child node. Nodes on preset paths of a daily story are shared by everyone, so a popular path is generated once and then served from cache. A custom choice creates a private node owned by that story session, and everything below it stays private.

### Scene node
* summary: what happened, used as story memory
* videoPrompt: the prompt sent to the video model
* caption: one short line shown on screen
* choices: two short labels
* clip, poster (middle frame), lastFrame
* status: pending, generating, ready, failed

### Story bible
Fixed when a story starts: title, art style, setting, tone, audience and a fixed visual description for each character. The descriptions are copied into every video prompt so characters stay recognisable.

### Director
One Amazon Bedrock call (Claude) per new scene. Input: bible, summaries of the path so far, the choice taken, position in the arc and audience. Output is strict JSON validated by a schema: summary, caption, videoPrompt, two choices, isEnding and any new characters. The arc is 6 scenes for daily stories. The director is told where it is ("scene 4 of 6, the ending must land by scene 6").

### Scene pipeline
1. Director writes the scene.
2. Safety check on the director output (and on custom text before it is used).
3. Video model (fal, MiniMax H3 Max Turbo image to video) renders the scene starting from the parent's last frame. The root scene uses text to video.
4. The clip is stored, then ffmpeg extracts the poster and the last frame.
5. Node becomes ready.

### Prefetch
When a node becomes ready, both preset children start generating. Daily stories are warmed two levels deep when they are created. Custom choices generate on demand.

### Dedupe
A child node is claimed with a unique constraint on (parent, choice). If two families pick the same new branch at once, one generation runs and both wait for it.

### Text rules
No em dashes, en dashes or hyphens in any text a user sees. The director is told so and every generated string is sanitised on the server.

## Safety
* Audience setting changes the director instructions.
* Custom text and director output pass a safety checker (Amazon Bedrock Guardrails when configured, a local word list otherwise).
* The video model's own safety checker stays on.
* No accounts. Each TV has a random device id used only for rate limits and for its own story list.

## Budget
* Per device daily limit on new generations and a global daily cap.
* When a cap is reached, cached paths still play and Something else explains it will be back tomorrow.

## Sparks and purchases

* Daily stories and preset choices are free, because shared paths are made once and reused.
* Custom ideas cost real video, so they use Sparks: 1 for a Something else idea, 5 for a Make your own story. Each TV gets a free daily allowance first (5 ideas, 2 stories).
* Sparks are bought with Amazon In App Purchasing on Vega: consumable packs of 10 and 30. No sign up: the wallet belongs to the Amazon account's IAP user id, so it follows the family to every TV on that account.
* The app sends each receipt to the server, the server verifies it with the Amazon Receipt Verification Service, credits Sparks exactly once per receipt, and only then does the app mark the purchase fulfilled. Unfulfilled purchases are picked up again on the next launch.
* Modes: fake for development and tests, sandbox for App Tester, production for the Appstore.

## Architecture

```
Fire TV app (Vega, React Native)
        │  HTTPS JSON + MP4
        ▼
StoryQuest server (Node 22, Fastify)
  ├─ director: Amazon Bedrock (Claude) or a local fake
  ├─ safety: Bedrock Guardrails or a local word list
  ├─ video: fal MiniMax H3 Max Turbo or a local ffmpeg fake
  ├─ media: ffmpeg (poster, last frame, movie stitching)
  ├─ store: SQLite (nodes, stories, ideas, stats)
  └─ files: local disk served with long cache headers
```

The server runs as one Docker container. Every external dependency sits behind an interface with a fake, so the whole app runs end to end without any keys.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /v1/today | Today's stories |
| POST | /v1/stories | Start from an idea or from a prompt |
| GET | /v1/stories/:id | Story with its path |
| GET | /v1/nodes/:id?wait=8 | Scene, waits up to 8 s for it to be ready |
| POST | /v1/stories/:id/choose | Preset or custom choice, returns the next node |
| POST | /v1/stories/:id/finish | Builds the movie, returns share link and stats |
| GET | /v1/share/:slug | Data for the share page |
| GET | /s/:slug | Share page |
| GET | /media/* | Clips and images |
| POST | /v1/admin/daily | Create today's stories (admin token) |
| GET | /healthz | Health |

All request and response shapes live in packages/contracts and are validated on both sides.

## TV app

* Stack navigation: Home, Create, Story, End.
* Focus handled by react-tv-space-navigation from the sample.
* Story flow is a small state machine with tests: loading, playing, choosing, waiting, ending, finished.
* Seamless cuts: the next clip starts on the same frame the previous one ended on, and that frame is shown as a still while the next clip loads.
* One video player reused for every clip.
* Every focusable card has an accessibility label so the system voice navigation can read it.
* Never a blank screen: every wait has a still frame and a short message.

## Performance targets
* Home usable within 1.5 s of launch.
* Preset choice to next clip under 0.5 s.
* Custom choice under 10 s.

## Testing
* Server: unit tests for the director prompt and parsing, text sanitising, tree and dedupe logic, budget. Route tests with fakes.
* App: state machine tests and component tests.
* One live smoke script that uses real keys and costs money, run by hand.

## Repo rules
* No keys in git. .env is ignored, .env.example has empty values and a pre commit hook scans staged files.
* MIT license.
