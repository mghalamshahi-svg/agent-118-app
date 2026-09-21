import React, { useState, useEffect } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Linking,
} from 'react-native';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  createAudioPlayer,
} from 'expo-audio';
import * as Location from 'expo-location';

const API_BASE = 'http://137.184.169.205:3300';
const FALLBACK_LOCATION = { lat: 43.8161, lng: -79.4633 };

function PrimaryButton({ title, onPress, disabled, style }) {
  return (
    <TouchableOpacity
      style={[styles.primaryButton, disabled && styles.buttonDisabled, style]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <Text style={styles.primaryButtonText}>{title}</Text>
    </TouchableOpacity>
  );
}

function SecondaryButton({ title, onPress, style }) {
  return (
    <TouchableOpacity style={[styles.secondaryButton, style]} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.secondaryButtonText}>{title}</Text>
    </TouchableOpacity>
  );
}

function InfoButton({ icon, label, onPress }) {
  return (
    <TouchableOpacity style={styles.infoButton} onPress={onPress} activeOpacity={0.75}>
      <Text style={styles.infoButtonText}>
        {icon} {label}
      </Text>
    </TouchableOpacity>
  );
}

function ScreenHeader({ title, subtitle }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{title}</Text>
      {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function LoadingScreen({ label }) {
  return (
    <View style={styles.centerFill}>
      <ActivityIndicator size="large" color="#1E5B8C" />
      <Text style={styles.loadingLabel}>{label}</Text>
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState('record');
  const [recordingState, setRecordingState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [intent, setIntent] = useState(null);
  const [businesses, setBusinesses] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [leadId, setLeadId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => {
    requestRecordingPermissionsAsync().catch(() => {});
  }, []);

  // As soon as the detail screen opens for a business, run the voice
  // introduction (name -> "know more?" -> contact info -> directions ->
  // open follow-up) — this is on top of (not instead of) the tap-to-call /
  // tap-for-directions / contact buttons below, which still work as a
  // manual fallback.
  useEffect(() => {
    if (screen === 'detail' && selectedBusiness) {
      introduceBusiness();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, selectedBusiness]);

  function fail(message, err) {
    console.log('ERROR:', message, err);
    const detail = err?.message ? `\n\n${err.message}` : '';
    setErrorMsg(message + detail);
    Alert.alert('یه مشکلی پیش اومد', message + detail, [{ text: 'باشه' }]);
  }

  async function describeBadResponse(res) {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch (e) {
      bodyText = '(could not read response body)';
    }
    return `HTTP ${res.status} — ${bodyText}`.slice(0, 500);
  }

  function uploadRecording(uri) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/transcribe`);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            reject(new Error(`could not parse response: ${xhr.responseText}`.slice(0, 500)));
          }
        } else {
          reject(new Error(`HTTP ${xhr.status} — ${xhr.responseText}`.slice(0, 500)));
        }
      };
      xhr.onerror = () => reject(new Error('Network request failed'));
      xhr.ontimeout = () =>
        reject(
          new Error(
            'Request timed out after 60s — the Render free-tier service may still be waking up from being idle. Try again in a few seconds.'
          )
        );
      xhr.timeout = 60000;
      const formData = new FormData();
      formData.append('audio', { uri, name: 'recording.m4a', type: 'audio/m4a' });
      xhr.send(formData);
    });
  }

  async function handleMicPress() {
    if (recordingState === 'idle') return startRecording();
    if (recordingState === 'recording') return stopRecordingAndTranscribe();
  }

  async function startRecording() {
    try {
      setErrorMsg('');
      setRecordingState('preparing');
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setRecordingState('idle');
        return fail('برای ضبط صدا نیاز به اجازه‌ی میکروفون داریم.');
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      await audioRecorder.record();
      setRecordingState('recording');
    } catch (err) {
      setRecordingState('idle');
      fail('شروع ضبط صدا با خطا مواجه شد.', err);
    }
  }

  async function stopRecordingAndTranscribe() {
    try {
      setRecordingState('idle');
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) return;

      setScreen('transcribing');

      const data = await uploadRecording(uri);
      setTranscript(data.text || '');
      setScreen('confirm');
    } catch (err) {
      setScreen('record');
      fail('تبدیل صدا به متن با خطا مواجه شد. دوباره امتحان کن.', err);
    }
  }

  async function confirmAndExtractIntent() {
    if (!transcript.trim()) {
      return fail('اول باید یک پیام صوتی ضبط کنی یا متن رو بنویسی.');
    }
    try {
      setScreen('extracting');
      const res = await fetch(`${API_BASE}/extract-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      if (!res.ok) throw new Error(await describeBadResponse(res));
      const data = await res.json();
      setIntent(data);
      await runMatch(data);
    } catch (err) {
      setScreen('confirm');
      fail('تشخیص نوع درخواست با خطا مواجه شد.', err);
    }
  }

  async function runMatch(intentData) {
    try {
      setScreen('matching');
      let coords = FALLBACK_LOCATION;
      if (intentData.location_lat != null && intentData.location_lng != null) {
        coords = { lat: intentData.location_lat, lng: intentData.location_lng };
      } else {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await Location.getCurrentPositionAsync({});
            coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          }
        } catch (locErr) {
          console.log('location unavailable, using fallback', locErr);
        }
      }

      const params = new URLSearchParams({
        category_id: String(intentData.category_id),
        lat: String(coords.lat),
        lng: String(coords.lng),
        limit: '5',
      });
      if (intentData.language_requested) params.append('language', intentData.language_requested);

      const res = await fetch(`${API_BASE}/match?${params.toString()}`);
      if (!res.ok) throw new Error(await describeBadResponse(res));
      const data = await res.json();
      setBusinesses(data.results || []);
      setScreen('results');
    } catch (err) {
      setScreen('confirm');
      fail('پیدا کردن کسب‌وکارهای مناسب با خطا مواجه شد.', err);
    }
  }

  function pickBusiness(biz) {
    setSelectedBusiness(biz);
    setScreen('detail');
  }

  // --- Tap-to-call / tap-for-directions on the detail screen ------------
  function callPhone() {
    if (!selectedBusiness?.phone) {
      return fail('شماره تماسی برای این کسب‌وکار ثبت نشده.');
    }
    Linking.openURL(`tel:${selectedBusiness.phone}`);
  }

  function openDirections() {
    if (!selectedBusiness) return;
    const { lat, lng, address_text } = selectedBusiness;
    const url =
      lat && lng
        ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
        : address_text
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address_text)}`
        : null;
    if (!url) {
      return fail('آدرسی برای این کسب‌وکار ثبت نشده.');
    }
    Linking.openURL(url);
  }

  // --- Voice yes/no follow-up: "می‌خوای مسیر رو روی نقشه برات باز کنم؟" ---
  // We tried the phone's own built-in text-to-speech (expo-speech) first,
  // but most phones have no Persian voice installed, so it just produced a
  // tiny garbled blip instead of real speech. Fix: generate the audio on
  // our own server (OpenAI TTS, via the matching-engine's /speak endpoint)
  // and stream that MP3 back to play — this doesn't depend on anything
  // being installed on the customer's phone.
  //
  // Also: on iOS, if the audio session is still in "recording" mode (left
  // over from the push-to-talk button) when we try to play audio, the
  // speaker output comes out distorted (routed through the tiny earpiece
  // instead of the main speaker). So we explicitly switch to playback mode
  // right before speaking, then switch back to recording mode right before
  // listening for the yes/no answer.
  async function speak(text) {
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (err) {
      console.log('setAudioModeAsync (playback) error', err);
    }
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      try {
        const player = createAudioPlayer(`${API_BASE}/speak?text=${encodeURIComponent(text)}`);
        player.addListener('playbackStatusUpdate', (status) => {
          if (status.didJustFinish) {
            try {
              player.remove();
            } catch (e) {}
            finish();
          }
        });
        player.play();
        // Safety net in case the finish event never fires (network hiccup, etc.)
        setTimeout(finish, 15000);
      } catch (err) {
        console.log('speak (server TTS) error', err);
        finish();
      }
    });
  }

  function isAffirmative(text) {
    return /بله|بعله|آره|اره|باشه|حتما|حتماً|okay|^ok$|^yes$/i.test((text || '').trim());
  }

  function isNegative(text) {
    return /نه\b|نه‌?ممنون|نمی‌?خوام|نمیخوام|^no$/i.test((text || '').trim());
  }

  // Whisper sometimes mishears a very short بله/نه, or — when there was
  // actually silence — "hallucinates" a stock English phrase from its
  // training data (e.g. "please subscribe", "share this video..."). Since
  // this app only expects Persian speech, requiring at least one Persian/
  // Arabic-script character is a cheap, effective way to reject that kind
  // of noise instead of treating it as a real request.
  function looksLikePersianSpeech(text) {
    return /[؀-ۿ]/.test(text || '');
  }

  // Records for `windowMs` milliseconds and returns whatever Whisper
  // transcribed (empty string on any failure). Shared by the yes/no prompts
  // and the open-ended follow-up listener below, so there's one place that
  // handles the iOS "switch from playback to recording" timing.
  async function captureSpeech(windowMs) {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        console.log('CAPTURE: mic permission NOT granted');
        return '';
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      // Give iOS a moment to actually finish switching the audio session from
      // "playback" (whatever we just spoke) to "recording" before we start
      // capturing — starting too soon produces a corrupted/empty audio file
      // that Whisper then rejects as "could not be decoded". Trimmed from
      // 400ms to 300ms to shave a bit of perceived lag off every turn.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await audioRecorder.prepareToRecordAsync();
      await audioRecorder.record();
      await new Promise((resolve) => setTimeout(resolve, windowMs));
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) return '';
      const data = await uploadRecording(uri);
      return data.text || '';
    } catch (err) {
      console.log('captureSpeech error', err);
      return '';
    }
  }

  // Listens for a short بله/نه answer and returns 'yes' | 'no' | 'unclear'.
  // 2800ms is plenty for a one-or-two-word بله/نه answer and keeps the
  // back-and-forth feeling snappier than the previous 3500ms.
  async function listenYesNo() {
    console.log('YESNO: listening...');
    const answer = await captureSpeech(2800);
    console.log('YESNO TRANSCRIBED ANSWER:', JSON.stringify(answer));
    console.log('YESNO isAffirmative:', isAffirmative(answer), 'isNegative:', isNegative(answer));
    if (isAffirmative(answer)) return 'yes';
    if (isNegative(answer)) return 'no';
    return 'unclear';
  }

  // Builds a short spoken summary out of whatever fields this business
  // actually has (brokerage/company, languages, phone, address) so the
  // "know more" answer gives real information instead of just "check the
  // screen". If a field (like a real portfolio link) isn't in the data
  // yet, it's simply skipped here — nothing to read a website/portfolio
  // out loud until the backend actually sends one.
  function buildBusinessSummary(biz) {
    const parts = [];
    if (biz.brokerage_or_company) parts.push(`از ${biz.brokerage_or_company}`);
    if (biz.languages && biz.languages.length) {
      parts.push(`به زبان‌های ${biz.languages.join('، ')} صحبت می‌کنه`);
    }
    if (biz.phone) parts.push(`شماره تماسش ${biz.phone} هست`);
    if (biz.address_text) parts.push(`آدرسش ${biz.address_text} هست`);
    return parts.join('، ');
  }

  // As soon as the detail screen opens for a business, this runs the full
  // voice introduction:
  //   1) say the business's full name out loud
  //   2) ask "می‌خوای بیشتر در مورد <name> بدونی؟" and listen for بله/نه
  //   3) if بله: say the contact/website/portfolio info is shown below,
  //      then (if this business has a map location) ask about directions too
  //   4) finish with "من اینجا هستم..." and open a short window for the
  //      customer to immediately ask something new by voice — e.g. asking
  //      to be introduced to a different person — without tapping anything.
  // The tap-to-call / tap-for-directions / contact buttons on this screen
  // always keep working as a manual fallback no matter what happens here.
  async function introduceBusiness() {
    if (!selectedBusiness) return;
    const name = selectedBusiness.name;
    const hasRoute = selectedBusiness?.lat && selectedBusiness?.lng;
    try {
      console.log('INTRO: introducing', name);
      // One combined sentence instead of two separate TTS calls — cuts a
      // full network round-trip (and its playback-start delay) out of
      // every single business introduction.
      await speak(`${name} رو پیدا کردم. می‌خوای بیشتر در موردش بدونی؟ بگو بله یا نه.`);
      const wantsMore = await listenYesNo();
      console.log('INTRO wantsMore:', wantsMore);

      if (wantsMore === 'yes') {
        const summary = buildBusinessSummary(selectedBusiness);
        const extra = hasRoute
          ? ' می‌خوای مسیر رو هم روی نقشه برات باز کنم؟ بگو بله یا نه.'
          : ' اگه سوال دیگه‌ای داشتی بگو.';
        const infoText = summary
          ? `${summary}.`
          : 'اطلاعات تماسش رو هم اینجا روی صفحه برات گذاشتم.';
        await speak(`باشه، ${infoText}${extra}`);
        if (hasRoute) {
          const wantsDirections = await listenYesNo();
          console.log('INTRO wantsDirections:', wantsDirections);
          if (wantsDirections === 'yes') {
            openDirections();
          }
          await speak('باشه، اگه سوال دیگه‌ای داشتی بگو.');
        }
      } else if (wantsMore === 'no') {
        await speak('باشه، هر وقت خواستی دوباره صدام کن.');
      }

      await listenForFollowUp();
    } catch (err) {
      console.log('introduceBusiness error', err);
    }
  }

  // Open-ended follow-up: give the customer a few seconds to ask something
  // new by voice right here (e.g. "یکی دیگه رو هم نشونم بده"). Whatever gets
  // transcribed is dropped into the normal confirm screen, exactly like
  // tapping the big mic button on the home screen, so nothing about the
  // rest of the app needs to change to support it.
  async function listenForFollowUp() {
    console.log('FOLLOWUP: listening for a new request...');
    const text = await captureSpeech(4000);
    console.log('FOLLOWUP TRANSCRIBED:', JSON.stringify(text));
    if (text && text.trim() && looksLikePersianSpeech(text)) {
      setTranscript(text);
      setScreen('confirm');
    } else if (text && text.trim()) {
      console.log('FOLLOWUP: ignored — does not look like real Persian speech (likely silence or a mis-hearing)');
    }
  }

  async function chooseChannel(channel) {
    try {
      const res = await fetch(`${API_BASE}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: selectedBusiness.id,
          transcript,
          intent,
          channel,
        }),
      });
      if (!res.ok) throw new Error(await describeBadResponse(res));
      const data = await res.json();
      setLeadId(data.id || data.lead_id);

      if (channel === 'email') {
        setEmailDraft(data.email_draft || data.draft || '');
        setScreen('emailPreview');
      } else if (channel === 'call' && selectedBusiness.phone) {
        Linking.openURL(`tel:${selectedBusiness.phone}`);
        setScreen('sent');
      } else {
        setScreen('sent');
      }
    } catch (err) {
      fail('ثبت درخواست با خطا مواجه شد.', err);
    }
  }

  async function sendEmail() {
    try {
      const res = await fetch(`${API_BASE}/leads/${leadId}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: emailDraft }),
      });
      if (!res.ok) throw new Error(await describeBadResponse(res));
      setScreen('sent');
    } catch (err) {
      fail('ارسال ایمیل با خطا مواجه شد.', err);
    }
  }

  function startOver() {
    setScreen('record');
    setTranscript('');
    setIntent(null);
    setBusinesses([]);
    setSelectedBusiness(null);
    setEmailDraft('');
    setLeadId(null);
    setErrorMsg('');
  }

  return (
    <SafeAreaView style={styles.safe}>
      {screen === 'record' && (
        <View style={styles.centerFill}>
          <Text style={styles.companyLabel}>118</Text>
          <ScreenHeader
            title="118"
            subtitle="دکمه رو نگه دار، بگو دنبال چی می‌گردی، ول کن."
          />
          <TouchableOpacity
            style={[styles.micButton, recordingState === 'recording' && styles.micButtonActive]}
            onPress={handleMicPress}
            disabled={recordingState === 'preparing'}
            activeOpacity={0.85}
          >
            <Text style={styles.micButtonText}>
              {recordingState === 'recording'
                ? '⏺ در حال ضبط... (برای پایان دوباره بزن)'
                : recordingState === 'preparing'
                ? '... آماده‌سازی'
                : '🎤 بزن و صحبت کن'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.hint}>
            یک بار بزن تا ضبط شروع بشه، دوباره بزن تا تموم بشه. مثال: «دنبال یک مشاور املاک
            فارسی‌زبان نزدیک تورنهیل می‌گردم»
          </Text>
          {errorMsg ? (
            <ScrollView style={styles.errorBox}>
              <Text selectable style={styles.errorBoxTitle}>
                جزئیات فنی آخرین خطا (برای اسکرین‌شات):
              </Text>
              <Text selectable style={styles.errorBoxText}>
                {errorMsg}
              </Text>
            </ScrollView>
          ) : null}
        </View>
      )}

      {screen === 'transcribing' && (
        <LoadingScreen label={'در حال تبدیل صدا به متن...\nممکنه اولین بار تا ۶۰ ثانیه طول بکشه'} />
      )}

      {screen === 'confirm' && (
        <View style={styles.fill}>
          <ScreenHeader title="این چیزی بود که شنیدم" subtitle="اگه لازمه ویرایشش کن" />
          <ScrollView style={styles.body}>
            <TextInput
              style={styles.transcriptInput}
              value={transcript}
              onChangeText={setTranscript}
              multiline
              placeholder="متن درخواستت اینجا میاد..."
            />
          </ScrollView>
          <View style={styles.footer}>
            <SecondaryButton title="ضبط دوباره" onPress={startOver} />
            <PrimaryButton title="ادامه" onPress={confirmAndExtractIntent} />
          </View>
        </View>
      )}

      {screen === 'extracting' && <LoadingScreen label="در حال تشخیص نوع درخواست..." />}
      {screen === 'matching' && <LoadingScreen label="در حال پیدا کردن بهترین گزینه‌ها..." />}

      {screen === 'results' && (
        <View style={styles.fill}>
          <ScreenHeader
            title="نتایج پیشنهادی"
            subtitle={intent?.summary ? intent.summary : `${businesses.length} گزینه پیدا شد`}
          />
          <ScrollView style={styles.body}>
            {businesses.length === 0 && (
              <Text style={styles.hint}>متأسفانه فعلاً گزینه‌ای پیدا نشد.</Text>
            )}
            {businesses.map((biz) => (
              <TouchableOpacity key={biz.id} style={styles.card} onPress={() => pickBusiness(biz)}>
                <Text style={styles.cardTitle}>{biz.name}</Text>
                {biz.brokerage_or_company ? (
                  <Text style={styles.cardSubtitle}>{biz.brokerage_or_company}</Text>
                ) : null}
                <View style={styles.cardRow}>
                  <Text style={styles.cardMeta}>📍 {biz.distance_km} کیلومتر</Text>
                  <Text style={styles.cardMeta}>⭐ امتیاز تطبیق: {biz.match_score}</Text>
                </View>
                {biz.languages ? (
                  <Text style={styles.cardMeta}>🗣 {biz.languages.join(', ')}</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.footer}>
            <SecondaryButton title="شروع دوباره" onPress={startOver} />
          </View>
        </View>
      )}

      {screen === 'detail' && selectedBusiness && (
        <View style={styles.fill}>
          <ScreenHeader title={selectedBusiness.name} subtitle={selectedBusiness.brokerage_or_company} />
          <ScrollView style={styles.body}>
            <Text style={styles.cardMeta}>📍 {selectedBusiness.distance_km} کیلومتر با شما فاصله داره</Text>
            <Text style={styles.cardMeta}>⭐ امتیاز تطبیق: {selectedBusiness.match_score}</Text>
            {selectedBusiness.languages ? (
              <Text style={styles.cardMeta}>🗣 زبان‌ها: {selectedBusiness.languages.join(', ')}</Text>
            ) : null}
            {selectedBusiness.phone ? (
              <InfoButton icon="📞" label={`تماس با ${selectedBusiness.phone}`} onPress={callPhone} />
            ) : null}
            {(selectedBusiness.address_text || (selectedBusiness.lat && selectedBusiness.lng)) ? (
              <InfoButton
                icon="🗺"
                label={
                  selectedBusiness.address_text
                    ? `مسیریابی به ${selectedBusiness.address_text}`
                    : 'نمایش مسیر روی نقشه'
                }
                onPress={openDirections}
              />
            ) : null}
            {selectedBusiness.website ? (
              <InfoButton icon="🌐" label="مشاهده وب‌سایت" onPress={() => Linking.openURL(selectedBusiness.website)} />
            ) : null}
            {selectedBusiness.portfolio_url ? (
              <InfoButton
                icon="🖼"
                label="مشاهده پورتفولیو"
                onPress={() => Linking.openURL(selectedBusiness.portfolio_url)}
              />
            ) : null}
            <Text style={styles.sectionLabel}>چطور باهاش در ارتباط باشی؟</Text>
          </ScrollView>
          <View style={styles.channelRow}>
            <SecondaryButton title="📞 تماس" onPress={() => chooseChannel('call')} />
            <SecondaryButton title="✉️ ایمیل" onPress={() => chooseChannel('email')} />
            <SecondaryButton title="💬 واتس‌اپ" onPress={() => chooseChannel('whatsapp')} />
          </View>
          <View style={styles.footer}>
            <SecondaryButton title="بازگشت به نتایج" onPress={() => setScreen('results')} />
          </View>
        </View>
      )}

      {screen === 'emailPreview' && (
        <View style={styles.fill}>
          <ScreenHeader title="پیش‌نمایش ایمیل" subtitle="قبل از ارسال می‌تونی ویرایشش کنی" />
          <ScrollView style={styles.body}>
            <TextInput
              style={styles.transcriptInput}
              value={emailDraft}
              onChangeText={setEmailDraft}
              multiline
            />
          </ScrollView>
          <View style={styles.footer}>
            <SecondaryButton title="بازگشت" onPress={() => setScreen('detail')} />
            <PrimaryButton title="ارسال ایمیل" onPress={sendEmail} />
          </View>
        </View>
      )}

      {screen === 'sent' && (
        <View style={styles.centerFill}>
          <Text style={styles.successEmoji}>✅</Text>
          <ScreenHeader title="درخواستت ثبت شد!" subtitle="به‌زودی باهات تماس گرفته می‌شه." />
          <PrimaryButton title="جستجوی جدید" onPress={startOver} style={{ marginTop: 24 }} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9FC' },
  fill: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  body: { flex: 1, paddingHorizontal: 20 },
  companyLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A97A5',
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 8,
  },
  header: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12, alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#12314F', textAlign: 'center' },
  headerSubtitle: { fontSize: 14, color: '#5B6B7C', marginTop: 6, textAlign: 'center' },
  hint: { fontSize: 13, color: '#8A97A5', marginTop: 16, textAlign: 'center', paddingHorizontal: 24 },
  loadingLabel: { marginTop: 16, fontSize: 15, color: '#5B6B7C' },
  micButton: {
    marginTop: 30,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#1E5B8C',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  micButtonActive: { backgroundColor: '#C0392B' },
  micButtonText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  transcriptInput: {
    minHeight: 120,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#12314F',
    borderWidth: 1,
    borderColor: '#E1E7EE',
    textAlignVertical: 'top',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#1E5B8C',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D7DEE6',
  },
  secondaryButtonText: { color: '#1E5B8C', fontSize: 15, fontWeight: '600' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E1E7EE',
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#12314F' },
  cardSubtitle: { fontSize: 13, color: '#5B6B7C', marginTop: 2 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  cardMeta: { fontSize: 13, color: '#5B6B7C', marginTop: 6 },
  tapLink: { color: '#1E5B8C', textDecorationLine: 'underline', fontWeight: '600' },
  infoButton: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E5B8C',
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  infoButtonText: { color: '#1E5B8C', fontSize: 15, fontWeight: '700' },
  sectionLabel: { fontSize: 15, fontWeight: '600', color: '#12314F', marginTop: 20, marginBottom: 8 },
  channelRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 20, gap: 10 },
  successEmoji: { fontSize: 56, marginBottom: 8 },
  errorBox: {
    marginTop: 24,
    maxHeight: 220,
    width: '100%',
    backgroundColor: '#FDECEA',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F5C6C0',
    padding: 12,
  },
  errorBoxTitle: { fontSize: 12, fontWeight: '700', color: '#8A2E24', marginBottom: 6 },
  errorBoxText: { fontSize: 12, color: '#8A2E24' },
});
