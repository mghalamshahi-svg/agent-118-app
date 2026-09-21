const express = require('express');
const OpenAI = require('openai');
const config = require('../config');

const router = express.Router();

/**
 * Server-side text-to-speech.
 *
 * Why this exists: the customer's phone (iOS in particular) usually has NO
 * Persian voice installed for on-device text-to-speech (expo-speech), so
 * asking the OS to speak Farsi text produces a tiny garbled blip instead of
 * real speech. Generating the audio here with OpenAI's TTS and streaming an
 * MP3 back to the app sidesteps that entirely — it doesn't depend on
 * whatever voices happen to be installed on the customer's device.
 *
 * Using gpt-4o-mini-tts (instead of the older tts-1) because it accepts an
 * `instructions` field that steers accent/tone/pace — tts-1 does not
 * support that field at all. We use it to push toward a natural Tehrani
 * Persian accent instead of the Afghan/Dari-leaning default, and to keep
 * the pace brisk so the voice back-and-forth doesn't feel sluggish.
 */
let openaiClient = null;
function getOpenAI() {
  if (!openaiClient) {
    if (!config.stt.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is not set — required for TTS (see .env.example)');
    }
    openaiClient = new OpenAI({ apiKey: config.stt.openaiApiKey });
  }
  return openaiClient;
}

const VOICE_INSTRUCTIONS =
  'Speak in natural, clearly-articulated Iranian (Tehrani) Persian — not an Afghan or Dari accent. ' +
  'Use a warm, professional, friendly customer-service tone. ' +
  'Keep a brisk, efficient pace: do not drag out words or pause dramatically between sentences. ' +
  'Pronounce every Persian word accurately and naturally, the way a native Tehran speaker would.';

router.get('/speak', async (req, res) => {
  const text = req.query.text;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'query param "text" (string) is required' });
  }
  try {
    const openai = getOpenAI();
    const response = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: 'shimmer',
      input: text,
      instructions: VOICE_INSTRUCTIONS,
      response_format: 'mp3',
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch (err) {
    req.log?.error?.(err);
    res.status(502).json({ error: 'tts_failed', detail: err.message });
  }
});

module.exports = router;
