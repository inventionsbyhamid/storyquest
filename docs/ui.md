# StoryQuest UI: picture book at night

StoryQuest feels like a picture book read in a dark room: flat printed inks on deep night blue, warm paper type, AI scenes framed like illustrations on a page. Everything is flat. The memorable element is the story titles, set in Fraunces. Everything around them stays quiet.

## Hard rules

* No gradients anywhere: not on backgrounds, cards, overlays, scrims, skeletons, placeholders, buttons or images. Use solid colors and solid translucent panels.
* No glows, drop shadows, blurs or neon. Depth comes from tone (ink vs raised ink) and from the focus frame.
* No sparkle or star icons, no emoji. The brand symbol is the forked Q mark only.
* No ALL CAPS labels, no letter spaced eyebrows, no middle dot meta strings, no arrows appended to buttons.
* Sentence case everywhere. No dashes or hyphens in any user facing text.
* One accent: marigold, used for focus and the single primary action on a screen. Nothing else is marigold.

## Tokens

| Token | Hex | Use |
| --- | --- | --- |
| ink | #1C2240 | every screen background |
| inkRaised | #262D52 | cards, panels, sheets, image placeholders |
| inkLine | #3A4270 | 2px borders on unfocused cards and inputs |
| paper | #F1E6CF | primary text, the QR card, primary button text on marigold |
| paperDim | #B6AE9C | secondary text |
| marigold | #F0A830 | focus frame, primary button, the mark |
| scrim | rgba(28, 34, 64, 0.88) | solid panel behind text over video (caption plate, choice dock) |

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
 [Q] StoryQuest                                          (o) 6 Sparks
                                                          
 The Clockwork Detective                 +==========================+
 A detective and her clockwork owl       |                          |
 chase a stolen hour.                    |   poster, 16:9, framed   |
                                         |   in paper 10px          |
 Mystery   For grown ups   312 played    +==========================+

 Tonight's stories
 +--------+ +--------+ +--------+ +--------+ +--------+
 |  pen   | | poster | | poster | | poster | | poster |
 |        | |        | |        | |        | |        |
 +--------+ +--------+ +--------+ +--------+ +--------+
 Make your   Clockwork  Snow Fox   Pumpkin    Moon Door
 own
```
* Left column: title in Fraunces display, logline in sans body (max 2 lines), then plain text facts in paperDim separated by generous space (not dots).
* Right: the focused story's poster in a paper frame (10px paper border, radius 18), like a book plate. When the poster changes, cross fade 200 ms. No Ken Burns.
* The row: posters 16:9 at 340 wide, title below in sans 24. "Make your own" card: inkRaised with a pen icon and the label below like the others.
* The wallet sits top right as plain text with the coin: "6 Sparks", "Your first scene is free". No pill.

### Make your own
Title "Make your own" in Fraunces. Input on inkRaised with a 2px inkLine border (marigold when focused) and the mic hint below in paperDim with the mic icon. Mood and audience choices are text chips: inkRaised background, paper text, the chosen one shows a check icon. One primary button "Start the story" in marigold with ink text; the cost line under it in paperDim ("Uses your free scene" or "Uses 1 Spark").

### Story
* Video full screen. Caption plate: solid scrim panel, radius 14, bottom center, sans 28, appears for 4 s at scene start. Progress as a folio "3 / 6" in paperDim at the plate's right. "Made in 5.8 s" only in the folio area, small.
* Choice dock (when the clip ends): the last frame stays, a solid scrim panel fills the bottom 46 percent. "What happens next?" in Fraunces title, then three cards: two choices (thumbnail on top, label below in sans 28, inside an inkRaised card) and "Something else" (pen icon, label, "Say it or type it" in paperDim). Cost shown as the coin plus "1 Spark" in the card's top right corner on a small solid ink tag, only when it costs.
* Waiting ("Drawing the next scene", "Filming your idea"): small solid scrim card with the text and three solid dots that pulse in opacity. Never a spinner, never shimmer.
* Pause menu: solid inkRaised sheet centered, story title in Fraunces, three full width buttons (Resume primary).
* Placeholder for a missing thumbnail: inkRaised with the mark at 40px in inkLine color.

### Get more Sparks
A sheet on inkRaised. Title in Fraunces: "Keep your story going". One sentence: "Scenes made only for your family use Sparks. Tonight's stories stay free." Two pack cards side by side (amount large, price below, "Best value" as plain paperDim text on the 25 pack). Note in small paperDim: "Amazon handles the payment." Button: "Not now".

### The end
Left: "The end" in Fraunces display, the story title below in Fraunces title, then up to three plain sentences of stats. Buttons: "Watch it as one movie" (primary), "New story", "Home". Right: the QR code on a solid paper card (radius 14, 24 padding), "Scan to share your story" below in sans.

### Loading and empty states
Skeletons are solid inkRaised blocks whose opacity pulses between 0.6 and 1. Errors and empty states: one Fraunces line, one sans sentence that says what to do, one button.

## Motion
Focus scale and frame 150 ms. Overlays fade 200 ms. One orchestrated moment: when the choice dock appears, the three cards rise 24px and fade in with 60 ms stagger. Nothing else animates on its own.
