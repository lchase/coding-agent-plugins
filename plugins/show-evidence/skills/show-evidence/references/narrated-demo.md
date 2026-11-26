# Narrated demo (opt-in)

Read `SKILL.md` first. Use this only when the user asks for a narrated demo or a video
for humans to watch. It is never part of the default flow, and it does not replace the
Playwright evidence: it sits on top of it.

The output is one short MP4 (20 to 40 seconds) with a synthetic voice and on-screen
labels. The voice reads **claim text only**. A claim that is not PROVEN gets no scene, so
the narration cannot describe something the screen does not show.

Tools: [Argo](https://github.com/shreyaskarnik/argo) (`@argo-video/cli`, MIT) does
record, align, voice, and render. Kokoro (`kokoro-js`) is the local voice, no API key.
This skill writes no pipeline of its own.

## 0. Preconditions

Run the UI claims from `playwright-ui.md` first. Only PROVEN UI claims go in the video.
Then check the tools:

```bash
npx -y -p @argo-video/cli argo doctor
```

If it reports Kokoro missing, do not vendor it and do not skip silently. Tell the user
the install command (about 410 MB, one time) and stop the narrated part until they say
yes:

```bash
npm i -g kokoro-js@1 @huggingface/transformers@3
```

ffmpeg is also required. Put the scratch project in the gitignored output directory
(`evidence/out/narrated/`), not in the product repo, so no dependency lands in its
`package.json`:

```bash
mkdir -p evidence/out/narrated && cd evidence/out/narrated
npm init -y >/dev/null && npm i -D @argo-video/cli kokoro-js @playwright/test@latest
npx playwright install chromium
```

Install `@playwright/test` here even if the product repo has it. Argo needs a recent
Playwright (`page.screencast`), and a scratch dir inside the repo otherwise resolves the
repo's older copy and fails with `Cannot read properties of undefined (reading 'start')`.

## 1. Pick the app source

1. **Real app with a saved login.** The user creates a Playwright storageState file once,
   by logging in by hand in a browser the command opens:

   ```bash
   npx playwright codegen --save-storage=.auth/state.json <login url>
   ```

   Log in, close the window. `.auth/` must be gitignored (check with
   `git check-ignore -v .auth/state.json`; add `.auth/` if not). The file holds live
   session cookies: never commit it, never attach it, never read it aloud or into a
   scene. Point the demo at it with `test.use({ storageState: process.env.STATE })`
   (below). Use a sandbox or staging account only, never production.
2. **No state file: Storybook.** Use a story for the changed component
   (`/iframe.html?id=<story-id>&viewMode=story` on the Storybook port). Say in the
   Assumptions line that the video shows the component, not the full app. If there is
   no story and writing one is not small, report the narrated demo as NOT-EVIDENCED
   with that reason.

## 2. Write the two files

Scene names come from the claims, in the order a viewer should meet them. One scene per
PROVEN claim, plus an optional intro and outro that restate no behavior.

`demos/<name>.scenes.json`. `text` is the claim reworded for the ear. It may name UI
labels and fake fixture values, never on-screen user data (names, emails, ids, account
numbers), even when the screen shows it. Every scene needs an `overlay`: Argo throws on
`showOverlay` for a scene without one.

```json
[
  { "scene": "open", "text": "Voices now sit under their home language.",
    "overlay": { "type": "headline-card", "title": "Grouped by language", "placement": "top-right", "motion": "slide-in" } },
  { "scene": "search", "text": "Typing a language narrows the list to its voices.",
    "overlay": { "type": "callout", "text": "Search: french", "placement": "top-left", "motion": "fade-in" } }
]
```

`demos/<name>.demo.ts`. Reuse the selectors and steps from the claim's spec. Mark a scene
only when its action starts, so the voice and the screen move together. Use placements
that do not cover the control being used (top-right or top-left away from the input).

```ts
import { test, showOverlay, withOverlay, zoomTo } from '@argo-video/cli';

test.use({ storageState: process.env.STATE }); // omit for Storybook

test('<name>', async ({ page, narration }) => {
  await page.goto(process.env.START_URL!);
  await page.locator('<selector from the claim spec>').waitFor();
  await narration.startRecording(page);

  narration.mark('open');
  zoomTo(page, '<changed area selector>', { narration, scale: 1.3, duration: 3000 });
  await withOverlay(page, 'open', async () => {
    await page.click('<selector>');
    await page.waitForTimeout(narration.durationFor('open'));
  });
});
```

`zoomTo` with `{ narration }` is an ffmpeg post-export zoom, so overlays stay sharp. Skip
it when the changed area is already most of the screen. The `argo.config.mjs` and
`playwright.config.ts` that `npx argo init` writes are enough: set `baseURL` and keep
`tts.defaultVoice` at `af_heart`.

## 3. Render and self-review

```bash
START_URL=... STATE=.auth/state.json npx argo pipeline <name>
```

Argo's own thumbnails (`.argo/<name>/thumbs/`) are taken at the start of each scene, before
the action, so they miss the state the line describes. Pull one frame near the end of each
scene from the MP4 using Argo's scene report, then open each PNG:

```bash
mkdir -p frames && jq -r '.scenes[] | "\(.scene) \((.endMs-400)/1000)"' .argo/<name>/scene-report.json |
  while read s t; do ffmpeg -v error -y -ss $t -i videos/<name>.mp4 -frames:v 1 frames/$s.png; done
```

Check:

- the changed UI is on screen when its line is spoken;
- no label covers the control or text the scene is about;
- nothing on screen is real user data (if it is, switch to fixture data and re-record).

Fix selectors, placements, or zoom, then re-render **once**. If a frame is still wrong
after that, say so in the Why column instead of rendering again. A scene missing from
`scene-report.json` never started: that is a selector bug, not a render bug.

A Storybook story renders small in the corner of a 1080p frame. Scale it before
`startRecording` with
`await page.evaluate(() => { (document.body.style as any).zoom = '1.8'; });`
rather than relying on `zoomTo` alone.

## 4. Deliver

Add the MP4 path to the `## Evidence` block as one extra line, under the table:

```markdown
**Narrated demo:** `evidence/out/narrated/videos/<name>.mp4` (voice reads claim text only; real app | Storybook story)
```

To share it, attach it when the PR is created or edited. Check the installed `gh` first
(`rtk proxy gh pr create --help` if `rtk` rewrites help), since `--attach` is recent:

```bash
gh pr create --attach evidence/out/narrated/videos/<name>.mp4 ...
```

Do not commit the MP4, `.argo/`, `.auth/`, or `node_modules`. Ask before attaching: an
upload is a publish.

## Guards

- Local, sandbox, or fixture data only. A scene whose frame shows live customer data is
  deleted and re-recorded, not cropped.
- Narration and overlays come from claim text. Do not read a name, email, id, or message
  off the page into a scene.
- Kokoro is never vendored. Missing means ask, not skip.
