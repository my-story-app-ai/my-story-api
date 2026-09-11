# Story generation

`POST /api/story-render` generates one scene per request. The browser requests indices 0 through 3 sequentially, passing the first completed JPEG as `continuityImage` for indices 1-3. Source photos remain attached to every request. The complete approved plan is included for narrative continuity; only the indexed scene is illustrated. Snapshot generation uses its existing prompt unchanged.

Request: the approved Story package (`format`, `source`, `details`, `plan`, `images`, `outputPresetId`) plus `sceneIndex` and optional `continuityImage`. A plan must have exactly four complete scenes. Response: `{sceneIndex, image: {dataUrl, mimeType, width, height}}`. Each scene master is normalized to a square 1024px JPEG. No image is generated for the cover; the cover reuses all four scenes in a montage.

## Testing and payment

Generation is disabled by default. Until verified checkout exists, only an explicit server `DEV_BYPASS_PAYMENT=true` enables local or Vercel Preview tests. Vercel Production always rejects generation, even with that flag. Browser `payment.status` is not proof of payment. The frontend must also explicitly enable `devBypassPayment` in a local test configuration; the committed production config stays false. Never enable development bypass on a public paid service. Tests mock OpenAI and consume no credits.

Run `node --test tests/story-render.test.mjs` with backend dependencies installed and Node 22.15+ (or the bundled runtime via NODE_PATH). The tests cover validation, source preservation, payment enforcement, malformed upstream responses and image export. A real OpenAI test is still required to evaluate likeness, scene variety and visual consistency.

## Shared continuity

The Story Planner schema requires `character_continuity`, `visual_style` and `world_continuity` once per story. Each is nonempty and capped at 1800 characters during response validation. The fields describe visible non-sensitive character traits, a shared art direction and world rules. No identities or sensitive traits are inferred. Scene 1 stays closest to the event; scenes 2-4 may expand the narrative while retaining identity and changing at least three of location/time/action/framing/anchor between adjacent scenes.

For local previews or older approved plans without those fields, the gated renderer accepts `stage: "continuity"`. It derives only the shared brief from the original photos, original details and unchanged approved scenes. The browser caches it once in internal generation state, without changing `state.lastPlan`, original form data or public preview. All four scene requests use the exact same brief and original photo list. Scenes 2-4 also attach scene 1 as a style reference, with original photos taking precedence over any accidental generated inaccuracies. Retry reuses the brief and completed scenes. A missing/invalid brief blocks scene generation.

The image request transport lives in `lib/image-client.js`, shared by Snapshot and Story. The Snapshot creative prompt is unchanged. Multiple references are sent as multipart `image[]` fields. Continuity is prompt/reference based, not a guarantee of likeness. Its visual acceptance test requires a real funded four-scene run and manual inspection; mocked tests only verify the contract and request contents.

## PDF delivery

The frontend uses vendored pdf-lib 1.17.1 to construct the final PDF locally. Digital: five pages (montage cover and four scenes). Print: one four-panel poster, exactly 30x40 or 50x70 cm. Each print panel and text strip is rasterized at 300 pixels per placed inch. Panels are processed separately to avoid one huge mobile canvas. These exports upscale the 1024px masters; they do not add native image detail or use AI super-resolution. PDF dimensions are in physical units, not a single raster pixel grid. Use Actual size for printing. RGB, no bleed/crop marks or CMYK conversion.

Completed scenes are cached in browser memory during the current page lifetime. Retry keeps completed scenes, and changing only the output preset reuses them. Changing the approved plan, original memory, source or photos invalidates the cache. Refreshing/closing the page discards it. PDF export errors can be retried without new image requests. No automatic retries or background billing calls are made. There is no persistent order/job storage yet; do not offer paid fulfillment before adding payment verification and durable recovery.
