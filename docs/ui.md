# StoryQuest UI: picture book at night

StoryQuest feels like a picture book read in a dark room: warm paper type on a deep night, with the AI scenes as the illustrations. Every picture brings its own night: the server picks a deep color from each poster and last frame, and the screen around that picture takes it on, the way a streaming app's hero or a music player's now playing screen takes the color of the art. The memorable element is the story titles, set in Fraunces. Everything around them stays quiet.

## Hard rules

* Gradients only where a picture melts into its own night: the edges of the Home billboard and the top edge of the choice dock. Never as decoration on backgrounds, cards, buttons, skeletons or placeholders. Fades use an eased curve (components/EdgeFade.tsx), never a straight two stop ramp.
* No glows, drop shadows, blurs or neon. Depth comes from tone (ink vs raised ink) and from the focus frame.
* No sparkle or star icons, no emoji. The brand symbol is the forked Q mark only.
* No ALL CAPS labels, no letter spaced eyebrows, no middle dot meta strings, no arrows appended to buttons.
* Sentence case everywhere. No dashes or hyphens in any user facing text.
* One accent: marigold, used for focus and the single primary action on a screen. Nothing else is marigold.

## Tokens

| Token | Hex | Use |
| --- | --- | --- |
| ink | #1C2240 | every screen background |
| inkRaised | #262D52 | sheets on the app's own night (a picture's night gets its own raised tone) |
| inkLine | #3A4270 | 2px borders on unfocused cards and inputs |
| paper | #F1E6CF | primary text, the QR card, primary button text on marigold |
| paperDim | #B6AE9C | secondary text |
| marigold | #F0A830 | focus frame, primary button, the mark |
| scrim | rgba(28, 34, 64, 0.88) | solid panel behind text over video (caption plate, choice dock) |
| surface | paper at 8% | cards, buttons, chips and inputs, so they take the hue of whatever night is behind |
| surfaceLine | paper at 18% | 2px borders on those |

### Nights

`ink` is the app's own night. A picture's night replaces it while that picture is on screen.

* The server works it out when it saves a poster or last frame (`apps/server/src/tone.ts`): the hue with the most color in the picture, weighted by area and strength, set to OKLab lightness 0.26 with chroma between 0.03 and 0.075. Every night is equally dark, so paper text always reads. Grey pictures keep `ink`.
* The TV builds a tone from it (`theme/tone.ts`): night, raised (8% paper), line (18% paper) and scrim (night at 90%). Screens share it through `ToneContext`.
* Where a night shows: Home follows the focused story; the story screen follows the scene playing, then the last frame once it ends; the choice dock follows the focused choice's first picture; The end follows the final frame; Make your own follows the last mood picked. The share page takes the opening scene's night.
* A change of night cross fades over 450 ms (`Backdrop`). Each layer is one solid color.

Error text uses paper with a short plain sentence; no red.

## Type

* **Fraunces** (bundled, `assets/fonts/Fraunces.ttf`, one cut: semibold display): story titles, screen titles, "What happens next?", "The end". Never for body text or buttons.
* **System sans** (Amazon Ember on Fire TV): everything else.
* Scale at 1920x1080 (use `scaledPixels`): display 76, title 52, heading 36, body 28, label 24, small 22. Line height 1.25 for Fraunces, 1.4 for sans. Body text never below 24.
* Titles in Fraunces have slightly tight tracking (letterSpacing about -0.5) and wrap to at most 2 lines.

## Shape and spacing

* Radius: 14 on cards and panels, 999 on the few round buttons, 10 on images inside cards. Not everything gets the same radius: the hero plate uses 18.
* Spacing steps: 8, 16, 24, 32, 48, 72. Screen padding: 96 horizontal, 64 top (TV safe area).
* Focus: a 4px marigold frame drawn 4px outside the element plus scale 1.04 over 150 ms. No shadow, no glow. Unfocused cards have a 2px inkLine border.

## Iconography

Simple stroked icons drawn with react-native-svg: 2.5px stroke at 24 to 32px, round caps, paper color (marigold only when the parent is focused or primary). Needed: pen, microphone, play, pause, restart, home, plus, check, back arrow. The Spark is a small solid marigold coin (circle) with nothing inside; amounts are written as text next to it ("1 Spark", "12 Sparks").

## The mark

The forked Q in `assets/brand/mark.svg` (viewBox 0 0 120 120): a ring, a tail that crosses it, and two curved branches ending in dots. Use it at 44px in the top left next to the word StoryQuest set in Fraunces 40 in paper. Marigold on ink only.

## Screens

### Home
```
 [Q] StoryQuest          ::::::::::::::::::::::::::::::::::::::::::::|
                         ::::                                        |
                         ::::   poster, 1200 x 675, bleeding off     |
 The Clockwork Detective ::::   the top and right edges               |
 A detective and her     ::::                                        |
 clockwork owl chase...  :::::::::::::::::::::::::::::::::::::::::::::
 Mystery   For grown ups   312 played

 Tonight's stories                                  (o) 6 Sparks
 +--------+ +--------+ +--------+ +--------+ +---
 |  pen   | | poster | | poster | | poster | | po
 +--------+ +--------+ +--------+ +--------+ +---
 Make your   Clockwork  Snow Fox   Pumpkin    Moon
 own
```
* The billboard: the focused story's poster runs off the top and right edges and melts into the story's night on its left (42%) and bottom (46%) edges. The whole screen is one layer per story (night, poster, fades), so color and picture cross fade together in 350 ms with no seam. No Ken Burns.
* Left column over the night: title in Fraunces display, logline in sans body (max 2 lines), then plain text facts in paperDim separated by space (not dots). The column settles in with a 200 ms fade when the focused story changes.
* The row: posters 16:9 at 380 wide on surface, title below in sans 24. "Make your own" card: surface with a pen icon. Its billboard is a surface page with a large pen.
* The wallet sits at the right end of the row heading as plain text with the coin: "6 Sparks", "Your first scene is free". No pill.

### Make your own
Title "Make your own" in Fraunces. Input on surface with a 2px surfaceLine border (marigold when focused) and the mic hint below in paperDim with the mic icon. Mood and audience choices are text chips: surface background, paper text, the chosen one shows a check icon. One primary button "Start the story" in marigold with ink text; the cost line under it in paperDim ("Uses your free scene" or "Uses 1 Spark").

### Story
* Video full screen. Caption plate: solid scrim panel, radius 14, bottom center, sans 28, appears for 4 s at scene start. Progress as a folio "3 / 6" in paperDim at the plate's right. "Made in 5.8 s" only in the folio area, small.
* Choice dock (when the clip ends): the last frame stays, a night panel at 92% fills the bottom 46 percent, and the frame melts into it over a 200px soft edge. "What happens next?" in Fraunces title, then three picture first cards 440 wide: the next scene's first picture (radius 14, 2px surfaceLine border, the focus frame around the picture) with the label below in sans 28, and "Something else" (surface with a pen icon, label, "Say it or type it" in paperDim). The panel takes the night of the focused choice's picture, so moving between paths hints at their mood. Cost shown as the coin plus "1 Spark" in the picture's top right corner on a small solid night tag, only when it costs. When at least one choice is filmed and free, a quiet line under the heading counts down ("Picking one for you in 7") and after 10 seconds the app picks one of those at random, so a story carries on for a family that just watches. Any remote press stops it for that scene; it never picks a choice that costs Sparks or still needs filming.
* Waiting ("Drawing the next scene", "Filming your idea"): small solid scrim card with the text and three solid dots that pulse in opacity. Never a spinner, never shimmer.
* Pause menu: solid raised sheet in the scene's tone, centered, story title in Fraunces, three full width buttons (Resume primary).
* Placeholder for a missing thumbnail: surface with the mark at 40px in surfaceLine.

### Get more Sparks
A raised sheet in the current tone. Title in Fraunces: "Keep your story going". One sentence: "Scenes made only for your family use Sparks. Tonight's stories stay free." Two pack cards side by side (amount large, price below, "Best value" as plain paperDim text on the 25 pack). Note in small paperDim: "Amazon handles the payment." Button: "Not now".

### The end
On the final frame's night. Left: "The end" in Fraunces display, the story title below in Fraunces title, then up to three plain sentences of stats. Buttons: "Watch it as one movie" (primary), "New story", "Home". Right: the QR code on a solid paper card (radius 14, 24 padding), "Scan to share your story" below in sans. Along the bottom: the family's path as a strip of stills (236 wide), each with the choice that led to it in small paperDim ("The beginning" under the first).

### Loading and empty states
Skeletons are surface blocks whose opacity pulses between 0.6 and 1. Errors and empty states: one Fraunces line, one sans sentence that says what to do, one button.

## Motion
Focus scale and frame 150 ms. Overlays fade 200 ms. A change of night 450 ms, the Home billboard 350 ms. One orchestrated moment: when the choice dock appears, the three cards rise 24px and fade in with 60 ms stagger. Nothing else animates on its own.
