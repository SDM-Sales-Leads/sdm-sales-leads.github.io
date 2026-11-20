# Lara video avatar + Gemini Live voice — plan (20 Nov 2026)

Goal (Walid): when a customer opens a call with Lara, they **see her** — a real-looking woman (dark tailored suit, hair pulled back,
modern office behind her) — who **speaks** with natural head, face and mouth movement, while a **live transcript** shows what both
say. Very high quality, very cost-efficient, Gemini Live for the voice.

Nothing here changes the hold rules: Lara stays on hold for real customers (test lock on) until Walid says tests are finished.

---

## 1. The two parts and the cost of each

| Part | What does it | Cost per call minute |
|---|---|---|
| **Voice + understanding + transcript** | Gemini Live API (speech in → speech out, both transcribed) | paid per audio token — **the only running cost** |
| **Her face moving** | Pre-made video clips of Lara, played in the browser and driven by her voice | **$0** (made once) |

The cheap trick that makes it look real: Lara is not generated live. We make **short, high-quality video clips of the same woman
once** (idle, listening, talking, nodding, smiling), and the browser switches and blends them in real time following Gemini's
audio. A live "talking-head" service (HeyGen / Tavus / Simli type) syncs lips exactly but charges per minute on top of Gemini;
it stays an optional upgrade (section 6), not the start.

---

## 2. Her look — made once

1. **One master portrait** (original AI person, not the woman in the screenshot — we must not copy someone's face):
   late 20s–30s, dark hair pulled back, black tailored suit + dark blouse, small earrings, warm natural smile, glass-walled office
   with soft ceiling lights, plants and beige chairs behind, 16:9, eye level, looking at the camera. Generated with Gemini image
   (Nano Banana / gemini-3-pro-image on our key), 2–3 options for Walid to pick.
2. **Video clips from that portrait** (Veo image-to-video, same framing, locked camera, 1080p, 8 s each, loopable):
   - `idle` ×2 — breathing, small blinks, tiny head tilt, mouth closed (when nobody speaks)
   - `listen` ×2 — attentive, small nods, slight smile (customer is speaking)
   - `talk` ×4 — natural speaking, mouth moving, small head/eyebrow motion (different energy levels)
   - `think` ×1 — short glance aside (Lara is looking something up)
   - `smile/greet` ×1 — first hello; `bye` ×1 — end of call
   About 12 clips ≈ 96 s of video, **one-time** generation. Cost: check Veo price/quota on Walid's key before generating
   (or use the free Flow / Gemini-app quota if his account has it). Clips are compressed to ~1–2 MB each (H.264 + WebM) and
   served from GitHub Pages — no streaming cost.
3. Walid approves the clips before anything goes live.

## 3. How she "comes alive" in the browser (no extra cost)

- **Two `<video>` layers** with 250 ms cross-fades, so switching clips never jumps.
- **State machine** from Gemini Live events: `greet → listen → think → talk → listen … → bye`.
- **Mouth follows the voice**: a Web Audio analyser reads Lara's audio level every frame.
  Voice on → a `talk` clip (louder speech → livelier clip); short pause inside a sentence → slow the clip so the mouth settles;
  silence > 400 ms → blend to `idle`/`listen`. Clips start at random points, so the motion never repeats visibly.
- **Head and face** are already in the clips (filmed motion), plus a very light CSS sway, so it never looks frozen.
- Bottom bar like the screenshot: "Lara is speaking / listening", a live waveform, volume + full screen.
- **Live transcript** under the video: Gemini sends text of what the customer said and what Lara says; shown as captions,
  Arabic right-to-left, and saved to the conversation (Interactions → channel "call") like today's calls.
- Phones: video sized 16:9 on top, transcript below; slow networks get a still photo + waveform instead of video.

Honest limit: the lips move with her voice but are **not word-perfect**. In a video tile with live voice this reads as natural;
if Walid wants exact lip shapes for close-ups, see section 6.

## 4. The voice — Gemini Live, set up to be cheap and safe

- **Model**: a native-audio Live model, for the most natural Arabic/English voice and the lowest delay. Candidates on our key:
  `gemini-3.1-flash-live-preview`, `gemini-2.5-flash-native-audio-latest`, `gemini-3.8-live`. **Step 0 checks the current price per
  audio minute of each in AI Studio and picks the cheapest with good Egyptian Arabic** (a short A/B test call with each).
  No price is promised before that check (lesson of Oct 2026).
- **Key never in the browser**: our edge function makes a short-lived **ephemeral token** (one call, expires in minutes).
- **What she may say** (same rules as chat): the Live session gets **tools** that call our server — Land Bank plot +
  initial offer, approved Q&A answers, call-me hand-over. She must not invent prices or dates; anything else = "I'll pass it to
  your account manager" + the question goes to Missed questions. Website text is not used for customers (suggestions only).
- **Hard stops (cost guard)**:
  - max **5 min** per call (warning at 4:30), then a polite goodbye;
  - **20 s** with no customer speech → she asks "are you still there?", 10 s more → call ends;
  - tab hidden / screen locked → call ends at once;
  - the browser's noise gate + Gemini's own voice detection, so room noise does not keep the session open;
  - **daily minute cap** on the server (e.g. 60 min/day): the token is refused when the cap is reached → text chat instead;
  - every call logged with its minutes; first live test followed by a **billing check** before Walid opens it to anyone.
- Languages: Arabic (Egyptian-friendly) and English by default; the chat's French/Turkish/Chinese stay text.

## 5. Build steps

| # | Step | Who | Est. |
|---|---|---|---|
| 0 | Price check of the Live models + Veo on Walid's key; pick model | Claude + Walid looks at AI Studio | 0.5 day |
| 1 | Master portrait options → Walid picks one | Claude, Walid approves | 0.5 day |
| 2 | 12 video clips from the portrait, compress, Walid approves | Claude, Walid approves | 1 day |
| 3 | Edge function: ephemeral token, daily cap, call log, Live tools (plots/offer, Q&A, hand-over) | Claude | 1.5 days |
| 4 | `chat.html` call screen: video avatar + state machine + audio-driven clips + transcript + controls | Claude | 2 days |
| 5 | Safari + Chrome + iPhone tests with the voice test harness (full spoken Arabic + English calls), cost measured in billing | Claude | 1 day |
| 6 | Settings: model, voice, minute cap, avatar on/off (in Lara → Settings → web chat) | Claude | 0.5 day |
| 7 | Walid's own test calls → go/no-go (Lara still on hold for customers until he says) | Walid | — |

About **7 working days**. Works without the avatar too: if video fails to load, the call continues with photo + waveform.

## 6. Optional upgrade: exact lip-sync

If after step 7 the mouth is not convincing enough, a real-time lip-sync service can drive the same portrait from Gemini's audio
(the face is redrawn live to match each sound). Better close-up realism, but a **second per-minute bill**; prices to be checked
and shown to Walid before any trial. Plan keeps the switch in one place (`avatar: clips | live-lipsync`).

## 7. What Walid needs to give / decide

1. OK to generate the portrait + clips (one-time Veo/image cost or free quota) — step 0 shows the number first.
2. Pick the portrait (step 1) and approve the clips (step 2).
3. Daily minute cap and max call length (proposed: 60 min/day, 5 min/call).
4. Confirm the Google key's project is the one to bill Live minutes to (free tier has small Live limits; real calls will likely
   need the paid tier — measured in step 0).

---

## Step 0 result (20 Nov 2026) — prices checked on Google's pricing page, test calls made on Walid's key

**Key tier:** very likely the **free tier** (Google stopped it after ~80 embedding calls in 6 s; paid keys allow far more).
AI Studio was signed out in the pane, so Walid confirms on aistudio.google.com/apikey ("Free tier" vs "Paid").

**Live voice — test: the same Arabic sales greeting from each model** (audio in `docs/lara-voice-test/`):

| Model | First sound after | Thinking tokens | Arabic | Verdict |
|---|---|---|---|---|
| **gemini-3.1-flash-live-preview** | **0.88 s** | 0 | natural Egyptian, said "2585 متر" right | **chosen** |
| gemini-3.8-live | 1.30 s | 222 | natural | fallback |
| gemini-2.5-flash-native-audio-preview-12-2025 | 4.55 s | 358 | good, but the session hung | no |

Prices (pricing page, paid tier; free tier = "Free of charge" for all three, with Google allowed to use the data):
audio in **$0.005/min**, audio out **$0.018/min**, text in $0.75 / text out $4.50 per 1M tokens (same for 3.1 flash live and 3.8 live).
Measured: 11.3 s of her speech = 289 audio tokens (~26 tokens/s).

**Cost of one call (paid tier), estimate from these numbers:** mic streamed the whole call (5 min × $0.005 = $0.025) + Lara
speaking ~half (2.5 min × $0.018 = $0.045) + instructions/tools re-read each turn (~15 turns × ~1,500 tokens × $0.75/M ≈ $0.017)
≈ **$0.09 per 5-minute call ≈ 2 US cents a minute**. With the 60 min/day cap: at most ≈ **$1.1 a day**. Free tier: $0, but
Google's free Live limits are not published (only shown in AI Studio) — measured in step 5. Real numbers are checked in billing
after the first live calls, as always.

**Her look — one-time cost (all paid-tier only; the free key cannot make images or video):**
- Portrait options: `gemini-3-pro-image` $0.134 per image (3 options ≈ $0.40), or `gemini-nano-banana-2.1` $0.05 per 2K image.
- Video clips: Veo is **not on the API pricing page** any more; the listed video model is `gemini-omni-1.2-flash`:
  ~$0.07/s at 720p, $0.104/s at 1080p. 12 clips × 8 s = 96 s → **≈ $6.7 (720p) or ≈ $10 (1080p), once.**
- Free alternative: Walid makes the portrait + clips himself in the Gemini app / Flow with his own Google account quota,
  following our prompt sheet; we only need the files.

**Decision needed from Walid:** (a) pay ≈ $10 once on a paid key for the look (we generate), or (b) free via his Gemini app /
Flow quota (he generates, we give the exact prompts); and free vs paid tier for the live calls.

## Free route (Walid 20 Nov: "can't you make it for me free?")

- **Portrait**: Gemini app (gemini.google.com) — Nano Banana 2 image generation is "Available for free" (limits not published).
  Walid signs in once in the built-in pane; Claude writes the prompt and picks/edits. Note: Gemini-app images carry a **visible
  watermark** + SynthID; we keep it (no removal). Without watermark = API image on a paid key (~$0.05 one image).
- **Video clips**: Gemini app video (Gemini Omni, replaced Veo) needs a paid Google AI plan → not free.
  Free instead: **LivePortrait** (open source, MIT, runs on Mac Apple Silicon, slower than a GPU) animates the still portrait with
  the head / face / mouth motion of a **driving video**. Its InsightFace face detector is "for non-commercial research purposes
  only" → we replace it with Google MediaPipe face detection (Apache 2.0) so business use is allowed.
- **Driving video**: 1–2 min phone video of a consenting person (Walid or a colleague) talking, listening, nodding, smiling,
  plain wall, steady phone. Only the movement is used; the face on screen is Lara's.
- Downloads needed on the Mac (with Walid's OK): LivePortrait code (GitHub), its weights (HuggingFace KlingTeam/LivePortrait),
  PyTorch, MediaPipe — a few GB in total, in their own folder, removable after.
- Running cost stays the Live voice only.
