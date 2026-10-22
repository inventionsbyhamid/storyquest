# Friction log

Everything below happened while building StoryQuest between October 17 and October 23, 2026. Our setup: an Intel MacBook with 8 GB of free disk, a remote Ubuntu 22.04 server (x86_64, KVM) and no Fire TV hardware at the start.

Severity scale: High blocks progress, Medium costs more than an hour, Low is an annoyance.

## 1. Vega SDK installer needs jq, which the docs do not list

* Task: install the Vega SDK on a clean Ubuntu 22.04 machine.
* Steps: installed the documented prerequisites (curl, Node 22, lz4, libpython3.8-dev), then ran `curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash`.
* Expected: the installer runs.
* Actual: it exits with "jq is required. Please install jq and ensure it is on the PATH."
* Severity: Low.
* Workaround: `apt install jq`.
* Suggestion: add jq to the Linux prerequisites, or have the installer list every missing tool in one message up front.

## 2. Installer refuses to run as root, which is undocumented

* Task: install the SDK inside a container for a reproducible build machine.
* Steps: ran the installer as root, the default user in Docker and most CI runners.
* Expected: installs, or the docs mention the non root requirement.
* Actual: "This script must not be run as root", then exit.
* Severity: Low.
* Workaround: created a regular user with passwordless sudo and the kvm group.
* Suggestion: document it next to the prerequisites and offer an explicit flag for CI images.

## 3. Installer prompts cannot be answered when the script is piped

* Task: unattended install.
* Steps: `yes "" | bash -c "curl ... | bash"`.
* Expected: defaults accepted.
* Actual: "failed to get SDK path: failed to read input: EOF", because the script itself is read from stdin.
* Severity: Low.
* Workaround: download get_vvm.sh to a file first, then `yes "" | bash get_vvm.sh`.
* Suggestion: support `--yes` or environment variables for the install directory and components.

## 4. build-kepler hangs silently in a non interactive shell

* Task: build the Vega app from a script.
* Steps: `npx react-native build-kepler --build-type Release` in a non interactive shell.
* Expected: a build in under a minute.
* Actual: no output and almost no CPU use for over 10 minutes. Rerunning with `CI=true` and stdin closed (`</dev/null`), the same build finished in 45 seconds.
* Severity: Medium (anyone building in CI will hit this).
* Workaround: always run with `CI=true` and `</dev/null`.
* Suggestion: never wait for input when not attached to a TTY, and print what the tool is waiting for.

## 5. Vega Virtual Device cannot boot inside a container because it needs IPv6

* Task: run the Vega Virtual Device on a headless Ubuntu server so we could test without a Fire TV.
* Steps: `vega virtual-device start --no-gui` inside an Ubuntu 22.04 container with /dev/kvm.
* Expected: the device boots, or fails with a clear reason.
* Actual: after the full 600 second timeout the CLI only said "failed to access shell". The real cause was in the instance log: the emulator binds a gnss chardev to `::1` with IPv6 address resolution, which fails without an IPv6 address on a non loopback interface.
* Severity: High for us (no device, no simulator), since the error message pointed nowhere.
* Workaround: enable IPv6 in the container (`--sysctl net.ipv6.conf.all.disable_ipv6=0`) and attach it to a network with an IPv6 subnet.
* Suggestion: fall back to 127.0.0.1, and fail fast with the emulator's own error instead of waiting for the timeout.

## 6. Virtual device renders a black screen with graphics acceleration off

* Task: run the virtual device without a GPU.
* Steps: `vega virtual-device start --no-gl-accel` under Xvfb.
* Expected: software rendering.
* Actual: the device booted and our app was running, but every screenshot was fully black (the launch used `-gpu off`).
* Severity: Medium.
* Workaround: install Mesa (llvmpipe) and start with `--gl-accel` under `Xvfb +extension GLX`. Rendering then works on a CPU only server.
* Suggestion: document that `--no-gl-accel` disables rendering entirely, and point to software rendering for headless Linux.

## 7. Stale emulator processes block the next boot

* Task: restart the virtual device.
* Steps: stopped and started the device again in the same container.
* Expected: a fresh boot.
* Actual: "Running multiple emulators with the same AVD is an experimental feature", then a timeout. Zombie emulator processes kept the instance lock alive because the container's first process did not reap children.
* Severity: Low once understood.
* Workaround: run the container with `--init`, delete the instance folder before starting.
* Suggestion: `vega virtual-device start` could detect and clear stale locks whose process is a zombie.

## 8. run-app could not determine the app to launch

* Task: install and launch the sample app on the virtual device.
* Steps: `vega run-app build/x86_64-release/vega_x86_64.vpkg com.giolaq.multitv.vega.main -d VirtualDevice`.
* Expected: installed and launched.
* Actual: installed, then "Failed to launch the app: App could not be determined".
* Severity: Low.
* Workaround: `vega device launch-app -a com.giolaq.multitv.vega.main`.
* Suggestion: make run-app accept the same app name launch-app accepts, and print the names it found in the package.

## 9. Intel Mac support ends with SDK 0.24

* Task: develop on the machine we had.
* Actual: 0.24 is the last SDK with Intel Mac support (end of life December 15, 2026) and the Intel virtual device has no WebView. Together with a 20 GB disk requirement this pushed us to a remote Linux box.
* Severity: Medium.
* Suggestion: a documented, supported container image for builds and the virtual device would make Vega development possible on any laptop.

## 10. W3C media player rejects http URLs with an opaque error

* Task: play an MP4 from our development server over plain http on the Vega Virtual Device.
* Steps: set `src` on the W3C `VideoPlayer` to `http://10.0.6.50:8080/media/...mp4`. The same server's JSON (fetch) and images (Image) loaded fine over http.
* Expected: playback, or an error saying cleartext media is not allowed.
* Actual: `MediaPlayerImplLegacy open failed`, `set_src_uri: MPB Call failed with code: 50004`, then a generic media error code 4 in JavaScript.
* Severity: Medium (it looked like a codec problem first).
* Workaround: serve media over https (we used a tunnel in development). The same file then played with the hardware H.264 decoder.
* Suggestion: document that media must be https, and surface a clear message for code 50004.

## 11. The Vega port of expo-file-system needs expo-modules-core

* Task: download the next story clips to the device cache so a choice plays from a local file.
* Steps: added `@amazon-devices/expo-file-system` ~2.0.0 (listed as supported for React Native 0.72) and imported it.
* Expected: the documented Expo FileSystem API.
* Actual: the package entry requires `expo-modules-core`, which a plain React Native for Vega app does not ship. Its README says to add `expo` ~50 to the app, a heavy dependency just for file access.
* Severity: Medium.
* Workaround: load the Kepler module file inside the package (`build/ExponentFileSystem.kepler`) lazily, and turn caching off if the native module is missing. Downloads then worked and the W3C player played the local files.
* Suggestion: ship a standalone entry point for Vega ports that do not need the Expo runtime, or list the expo requirement on the supported libraries page.

## 12. App logs are suppressed under load

* Task: measure how long a choice takes to play using timing logs from `vega device start-log-stream`.
* Actual: some of our `console.info` lines never appeared, and the stream showed "Log suppression ended at level [info]. [319] logs were suppressed at this level."
* Severity: Low.
* Workaround: log fewer, denser lines and repeat runs.
* Suggestion: document the rate limits and offer a developer mode setting that disables suppression for one app.

## 13. One Back press arrives twice

* Task: go back from a screen to the previous one with the remote's Back button.
* Actual: on the Vega Virtual Device a single press arrives as a TVEventHandler key event and then as `hardwareBackPress`. Our screen handled the key event and navigated back, which removed its `hardwareBackPress` listener, so the second copy went unclaimed and the system sent the whole app to the background.
* Severity: Medium (the app looked like it crashed on Back).
* Workaround: an app wide `hardwareBackPress` listener that claims a press already handled as a key event in the last 700 ms.
* Suggestion: deliver Back once, or document the order of the two events and how they relate.

## 14. A held key arrives as a quick press

* Task: a grown ups check where Select is held for three seconds, using `eventKeyAction` 0 (down) and 1 (up) from TVEventHandler.
* Actual: on the Vega Virtual Device, holding Select for 3.5 seconds arrived as key down and key up 6 ms apart, with nothing in between. A hold can never be detected there, and we could not confirm what a real remote sends.
* Severity: Medium (we rebuilt the check as a times table question on a number pad).
* Workaround: logged raw TVEventHandler events with `vega device start-log-stream` to find it, then used only single presses.
* Suggestion: pass held keys through in the virtual device, and document long press and key repeat behaviour for remotes.

## 15. The virtual device plays video at about half speed

* Task: record a demo of a story on the Vega Virtual Device, headless on a 40 core Linux server with Mesa software OpenGL.
* Steps: played 8 second H.264 clips (1344x768, 24 fps) with the W3C media player while recording the screen.
* Expected: real time playback, maybe with dropped frames.
* Actual: every 8 second clip took 15 to 18 seconds to play, sound included, and showed about 11 new frames per second. Raising the device to 8 cores and 8 GB in config.ini (it started with 6) changed nothing; the time goes into llvmpipe rendering.
* Severity: Medium (the demo could not show playback as it looks on a Fire TV).
* Workaround: recorded the interface on the virtual device and showed each scene at real speed from the same file the app plays.
* Suggestion: document the expected media performance of the virtual device without a GPU, and offer a hardware decode or a lighter render path for video on Linux.

## 16. Screen recording through X stalls; the emulator console records smoothly

* Task: capture the virtual device at 1080p for the demo.
* Steps: `ffmpeg -f x11grab` on the Xvfb display that hosts the device window.
* Actual: about 10 frames per second with gaps of 2 to 3 seconds whenever the device was drawing, because the capture and the device share one X server.
* Severity: Medium.
* Workaround: the device's own console command, `screenrecord start --time-limit 300 out.webm` on port 5554, records 1080p VP9 at 24 fps with device audio and no gaps.
* Suggestion: expose screen recording in `vega virtual-device` and the docs, since it is the only smooth way to film an app on Linux.

## 17. After long sessions the virtual device stops reacting to keys

* Task: keep one device session running for several hours of testing.
* Actual: the app stayed on screen but ignored every key, from xdotool and from the console's `event send` alike. The device log showed `stem-init` crashing with signal 6 about every 0.6 seconds (it does this on a fresh device too). Only a full restart of the device brought input back.
* Severity: Medium (a recorded take was lost).
* Workaround: restart the device with a clean instance and reinstall the app before recording.
* Suggestion: look into the `stem-init` crash loop in the virtual device image and surface a warning when input handling stops.

## 18. Building for Vega OS without a Vega OS device

* Task: build and tune a video app for Fire TV with Vega OS as a solo developer.
* Steps: looked for a way to test on real hardware. Vega OS ships only on the newest sticks (Fire TV Stick 4K Select, HD and 4K from 2025 and 2026), and many developers, including us, do not own one. Older Fire TV sticks run Fire OS and cannot run a Vega app.
* Expected: a way to see the app as a family would, on real hardware, without buying a device first.
* Actual: the Vega Virtual Device was the only option, and it cannot show real video, animation or audio performance (see 15, 19 and 20). Every decision about playback smoothness, clip loading and sound had to be made without knowing how a real stick behaves.
* Severity: High (we could never confirm how the app feels on a TV).
* Workaround: ran the virtual device headless on a Linux server, measured what we could, and designed for the worst case: a still frame that covers every clip change, and clips downloaded to the device ahead of time.
* Suggestion: a remote device lab for Vega OS (real sticks you can stream and control from the browser), loaner devices for hackathon teams, or a virtual device profile that matches a real stick's performance.

## 19. Switching the video source blocks the app for about a second

* Task: play the three clips of a chapter back to back with no black frame between them.
* Steps: one W3C `VideoPlayer`; when a clip ends, set `src` to the next clip and call `load()`. A still image of the next clip's first frame covers the video while it loads.
* Expected: the cover appears at once and hides the reload.
* Actual: on the virtual device `src` plus `load()` blocked the JavaScript thread for 0.8 to 1 second. The video surface went black at once, but the cover image could not appear until the call returned, so every clip change inside a chapter showed about a second of black. Choices made from the menu looked fine, because the cover was already up.
* Severity: Medium (it took timing logs from `vega device start-log-stream` to find).
* Workaround: show the cover in a layout effect, and start loading the next clip one animation frame later, so the cover is drawn before the thread blocks.
* Suggestion: make source changes asynchronous, or document the cost, and offer a playlist or gapless queue in the media player for apps that play clips back to back.

## 20. Menus stutter and sounds break up at 1080p on the virtual device

* Task: record the menus and remote sounds smoothly for the demo.
* Actual: at the default 1920x1080 display, menu animations drew about 12 frames per second and short interface sounds came out broken, because software rendering starved the emulator's audio. The container was also being throttled at its CPU limit.
* Severity: Medium.
* Workaround: start the device with `--display-res 1280,720` and give the container 16 CPUs. Menus then recorded at a full 24 frames per second, sounds played cleanly and clips played at about real speed. The app lays out the same at 720p.
* Suggestion: document recommended settings for running the virtual device without a GPU, and a lighter default for headless and CI use.

## 21. The console recorder drops audio during silence

* Task: edit recordings of the virtual device into a demo with sound in sync.
* Actual: the `screenrecord` file leaves gaps in its audio track whenever the device is silent. Editing tools that read the audio as continuous slide everything after a gap earlier, and in our first cut the sound ran seconds ahead of the picture.
* Severity: Medium (hours of sync debugging).
* Workaround: place audio by its timestamps and fill the gaps (`ffmpeg -af aresample=async=1:first_pts=0`), then verify sync by cross correlating the clip audio.
* Suggestion: have the recorder write silence instead of skipping, or note it in the docs.

## 22. No microphone in the virtual device

* Task: test the voice flow, where the family presses the microphone on the remote and says an idea.
* Actual: the virtual device has no way to feed speech into dictation, so the voice path could only be tested by typing on the on screen keyboard.
* Severity: Low.
* Workaround: typed the idea; the demo plays a recorded child's voice line over the typing.
* Suggestion: let the virtual device inject text or an audio file into speech input, so voice features can be tested without hardware.

## 23. The simulator needs a strong local machine, so we built vega-headless

* Task: run the Vega Virtual Device every day while building the app.
* Steps: tried to set up the SDK and virtual device on our laptop, an Intel MacBook with about 8 GB of free disk.
* Expected: the simulator runs locally like the Android TV emulator does.
* Actual: the SDK and virtual device need about 20 GB of disk, SDK 0.24 is the last one for Intel Macs, and the Intel virtual device has no WebView and boots slowly. Our laptop could not run it in a usable way. The only machine we had with room to spare was a Linux server, and it has no graphics card, so the device draws everything in software. That is the root of the slow video, choppy menus and broken sounds in 15, 19 and 20.
* Severity: High (without a workaround we could not have tested the app at all).
* Workaround: we made the SDK and virtual device run headless in Docker on the Linux server, with scripts to build, install, press remote keys, take screenshots and record, and published it as an open source project, vega-headless, so other developers without a strong machine or a Fire TV can do the same.
* Suggestion: an official headless image or cloud hosted virtual device, lighter system requirements for the simulator, and a GPU accelerated path on Linux.
