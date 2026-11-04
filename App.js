// 118 — GlobalLink Trade Hub voice lead app
// v2 UI (2026-11-01): visual design ported from the "Voice Lead Matching"
// design canvas (green #007344 / amber #FBB040 / warm #FAF7F2 palette,
// RTL layout, pulsing mic, listening bars, result cards with badges,
// compare, detail, email preview and confirmation screens).
// All voice / matching / lead logic is unchanged from v1.
// v6 (2026-11-03): navigation fixes — screen history, Android back button
// goes to the previous screen instead of closing the app, back + home on
// every screen, cancel on loading screens.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
  Animated,
  Easing,
  StatusBar,
  SafeAreaView,
  Image,
  BackHandler,
} from 'react-native';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  createAudioPlayer,
} from 'expo-audio';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = 'http://137.184.169.205:3300';
const APP_VERSION = 'v7'; // shown on the home screen — bump on every delivered build
const FALLBACK_LOCATION = { lat: 43.8161, lng: -79.4633 };

// ---- Design tokens (from the design canvas theme.css) -------------------
const C = {
  green: '#007344',
  greenDark: '#00522f',
  greenTint: '#E7F1EB',
  orange: '#E28F2E',
  amber: '#FBB040',
  amberInk: '#3A2600',
  bg: '#FAF7F2',
  card: '#FFFFFF',
  ink: '#1B1B1B',
  muted: '#74706A',
  line: '#EAE3D6',
  speedBg: '#FFF3E1',
  speedInk: '#8A5A0A',
  priceBg: '#F2F0EA',
};
const AVATAR_COLORS = ['#007344', '#E28F2E', '#00522f', '#8A5A0A'];

// v6: how long after a request we ask the customer to rate the business.
// 2 minutes for testing — change to 24 * 60 * 60 * 1000 (one day) for launch.
const RATE_AFTER_MS = 2 * 60 * 1000;
const MY_LEADS_KEY = 'gl118.myLeads.v1';
const PROFILE_KEY = 'gl118.profile.v1'; // { name, phone } — asked once, remembered
const DEVICE_KEY = 'gl118.device.v1'; // anonymous id, no personal data

const QUICK_CATEGORIES = [
  { label: 'لوله‌کش', text: 'یک لوله‌کش فارسی‌زبان نزدیک من می‌خوام' },
  { label: 'مشاور املاک', text: 'یک مشاور املاک فارسی‌زبان نزدیک من می‌خوام' },
  { label: 'برق‌کار', text: 'یک برق‌کار فارسی‌زبان نزدیک من می‌خوام' },
  { label: 'وکیل', text: 'یک وکیل فارسی‌زبان نزدیک من می‌خوام' },
  { label: 'حسابدار', text: 'یک حسابدار فارسی‌زبان نزدیک من می‌خوام' },
  { label: 'آرایشگاه', text: 'یک آرایشگاه فارسی‌زبان نزدیک من می‌خوام' },
];

// ---- Small helpers --------------------------------------------------------
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
function fa(value) {
  return String(value ?? '').replace(/\d/g, (d) => FA_DIGITS[d]);
}
function formatKm(km) {
  const n = Number(km);
  if (!isFinite(n)) return '';
  if (n < 0.5) return 'خیلی نزدیک';
  return `${fa(n < 10 ? n.toFixed(1) : Math.round(n))} کیلومتر`;
}
function initialsOf(name) {
  const words = String(name || '')
    .replace(/[()\[\]«»"']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '؟';
  const first = words[0][0] || '';
  const second = words[1] ? words[1][0] : '';
  return /[A-Za-z]/.test(first) ? (first + second).toUpperCase() : second ? `${first}.${second}` : first;
}
function langLabel(languages) {
  const list = Array.isArray(languages) ? languages : String(languages || '').split(',');
  const names = list
    .map((l) => String(l).trim().toLowerCase())
    .filter(Boolean)
    .map((l) => (l === 'fa' ? 'فارسی' : l === 'en' ? 'English' : l));
  return [...new Set(names)].join(' · ');
}
function priceLabel(tier) {
  const t = Number(tier) || 2;
  return t <= 1 ? '$ اقتصادی' : t >= 3 ? '$$$ لوکس' : '$$ متوسط';
}
function speedLabel(min) {
  const m = Number(min);
  if (!m) return null;
  if (m < 60) return `پاسخ در ${fa(m)} دقیقه`;
  return `پاسخ در ${fa(Math.round(m / 60))} ساعت`;
}
function speaksPersian(biz) {
  const list = Array.isArray(biz?.languages) ? biz.languages : String(biz?.languages || '').split(',');
  return list.some((l) => String(l).trim().toLowerCase() === 'fa');
}

function Stars({ value = 0, size = 30, onChange }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity key={n} onPress={() => onChange && onChange(n)} disabled={!onChange} hitSlop={6} accessibilityLabel={`${n} ستاره`}>
          <Text style={{ fontSize: size, color: n <= value ? C.amber : '#E2DACB' }}>★</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ratingLabel(biz) {
  if (!biz?.gl_rating_count) return null;
  return `★ ${fa(biz.gl_rating)} (${fa(biz.gl_rating_count)} امتیاز GlobalLink)`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'شب بخیر';
  if (h < 12) return 'صبح بخیر';
  if (h < 17) return 'ظهر بخیر';
  if (h < 21) return 'عصر بخیر';
  return 'شب بخیر';
}

// ---- Small UI building blocks -------------------------------------------
function Btn({ title, onPress, variant = 'primary', disabled, style, small }) {
  const v = variant === 'secondary' ? s.btnSecondary : variant === 'amber' ? s.btnAmber : variant === 'white' ? s.btnWhite : s.btnPrimary;
  const tv =
    variant === 'secondary' ? s.btnSecondaryText : variant === 'amber' ? s.btnAmberText : variant === 'white' ? s.btnWhiteText : s.btnPrimaryText;
  return (
    <TouchableOpacity
      style={[s.btn, v, small && s.btnSmall, disabled && { opacity: 0.5 }, style]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <Text style={[s.btnText, tv, small && { fontSize: 14 }]}>{title}</Text>
    </TouchableOpacity>
  );
}

function Chip({ label, active, onPress, tint }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.8}
      style={[s.chip, active && s.chipActive, tint && s.chipTint]}
    >
      <Text style={[s.chipText, active && { color: '#fff' }, tint && { color: C.greenDark }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Badge({ label, kind }) {
  const bg = kind === 'lang' ? C.greenTint : kind === 'speed' ? C.speedBg : C.priceBg;
  const ink = kind === 'lang' ? C.greenDark : kind === 'speed' ? C.speedInk : C.muted;
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: ink }]}>{label}</Text>
    </View>
  );
}

function Avatar({ name, index = 0, size = 52, photo }) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return (
      <Image
        source={{ uri: photo }}
        onError={() => setBroken(true)}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.greenTint, borderWidth: 2, borderColor: '#fff' }}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }]}>
      <Text style={[s.avatarText, { fontSize: size * 0.32 }]}>{initialsOf(name)}</Text>
    </View>
  );
}

function TopBar({ title, onBack, right, onHome }) {
  if (onHome && !right) {
    right = (
      <TouchableOpacity onPress={onHome} accessibilityLabel="صفحه اصلی" hitSlop={12}>
        <Text style={s.homeIcon}>⌂</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={s.topBar}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} accessibilityLabel="بازگشت" hitSlop={12} style={s.backBtn}>
          <Text style={s.backArrow}>→</Text>
        </TouchableOpacity>
      ) : (
        <View style={s.backBtn} />
      )}
      <Text style={s.topBarTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={s.backBtn}>{right}</View>
    </View>
  );
}

// Microphone glyph drawn with plain Views (no icon library needed).
function MicGlyph({ color = '#fff', scale = 1 }) {
  return (
    <View style={{ alignItems: 'center', transform: [{ scale }] }}>
      <View style={{ width: 22, height: 34, borderRadius: 11, backgroundColor: color }} />
      <View
        style={{
          marginTop: -14,
          width: 38,
          height: 24,
          borderBottomLeftRadius: 19,
          borderBottomRightRadius: 19,
          borderWidth: 3.5,
          borderTopWidth: 0,
          borderColor: color,
        }}
      />
      <View style={{ width: 3.5, height: 9, backgroundColor: color }} />
      <View style={{ width: 18, height: 3.5, borderRadius: 2, backgroundColor: color }} />
    </View>
  );
}

function PulseMic({ recording, onPress, disabled }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: recording ? 1100 : 2200, easing: Easing.out(Easing.quad), useNativeDriver: true })
    );
    pulse.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.32] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });
  const color = recording ? C.orange : C.green;
  return (
    <View style={s.micWrap}>
      <Animated.View style={[s.micRing, { backgroundColor: color, opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel={recording ? 'پایان ضبط' : 'شروع ضبط صدا'}
        style={[s.micBtn, { backgroundColor: color }]}
      >
        {recording ? <View style={s.stopSquare} /> : <MicGlyph />}
      </TouchableOpacity>
    </View>
  );
}

function ListeningBars({ color = C.amber }) {
  const vals = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const anims = vals.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
          Animated.timing(v, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [vals]);
  return (
    <View style={s.barsRow}>
      {vals.map((v, i) => (
        <Animated.View
          key={i}
          style={[s.bar, { backgroundColor: color, height: v.interpolate({ inputRange: [0, 1], outputRange: [6, 28] }) }]}
        />
      ))}
    </View>
  );
}

// Full-screen green "working" screen (transcribing / understanding / matching)
function WorkingScreen({ label, sub, quote, onCancel }) {
  return (
    <View style={[s.fill, { backgroundColor: C.green }]}>
      <View style={s.workingCenter}>
        <ListeningBars />
        <Text style={s.workingLabel}>{label}</Text>
        {quote ? (
          <View style={s.quoteBox}>
            <Text style={s.quoteText}>«{quote}»</Text>
          </View>
        ) : null}
        {sub ? <Text style={s.workingSub}>{sub}</Text> : null}
        {onCancel ? (
          <TouchableOpacity onPress={onCancel} style={s.cancelBtn} accessibilityRole="button" accessibilityLabel="لغو">
            <Text style={s.cancelText}>لغو</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export default function App() {
  const [screen, setScreenRaw] = useState('record');
  // ---- v5 navigation: history stack + cancel of in-flight steps ----------
  const TRANSIENT = ['transcribing', 'extracting', 'matching'];
  const historyRef = useRef([]);
  const screenRef = useRef('record');
  const navGenRef = useRef(0); // bumped on cancel/start-over; stale async steps are ignored
  function setScreen(next) {
    const cur = screenRef.current;
    if (next === cur) return;
    const hist = historyRef.current;
    const idx = hist.indexOf(next);
    if (idx >= 0) {
      historyRef.current = hist.slice(0, idx); // going back to a screen already in history
    } else if (!TRANSIENT.includes(cur)) {
      historyRef.current = [...hist, cur];
    }
    screenRef.current = next;
    setScreenRaw(next);
  }
  function goBack() {
    const hist = historyRef.current.filter((x) => !TRANSIENT.includes(x));
    const prev = hist.length ? hist[hist.length - 1] : 'record';
    historyRef.current = hist.slice(0, -1);
    screenRef.current = prev;
    setScreenRaw(prev);
  }
  // Only move screens if the user hasn't cancelled / started over meanwhile.
  function goIf(gen, next) {
    if (gen !== navGenRef.current) return false;
    setScreen(next);
    return true;
  }
  function cancelWorking() {
    navGenRef.current += 1;
    goBack();
  }
  const [recordingState, setRecordingState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [intent, setIntent] = useState(null);
  const [businesses, setBusinesses] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [leadId, setLeadId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [sortBy, setSortBy] = useState('match');
  const [compareIds, setCompareIds] = useState([]);
  // v3: "request a call via GlobalLink" form (for businesses whose contact is locked)
  const [showCallback, setShowCallback] = useState(false);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [sending, setSending] = useState(false);

  // v5: Android hardware back = go to previous screen (never close the app mid-flow)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showCallback) { setShowCallback(false); return true; }
      const cur = screenRef.current;
      if (TRANSIENT.includes(cur)) { cancelWorking(); return true; }
      if (cur === 'sent') { startOver(); return true; }
      if (cur === 'record') return false;
      goBack();
      return true;
    });
    return () => sub.remove();
  }, [showCallback]);
  const [lastLeadLocked, setLastLeadLocked] = useState(false);
  // v5: name search ("آقای رضا خادم مشاور املاک")
  const [searchMode, setSearchMode] = useState('category');
  // v6: "my requests" (kept on the phone) + rating prompt
  const [myLeads, setMyLeads] = useState([]);
  // v7: no-signup contact
  const deviceIdRef = useRef('');
  const [savedProfile, setSavedProfile] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [bridgeOn, setBridgeOn] = useState(false);
  const [calling, setCalling] = useState(false);
  const [rateLead, setRateLead] = useState(null); // lead being rated
  const [rateStep, setRateStep] = useState('ask'); // ask | stars | done
  const [rateOutcome, setRateOutcome] = useState('contacted');
  const [rateStars, setRateStars] = useState(0);
  const [rateComment, setRateComment] = useState('');
  const [queryName, setQueryName] = useState('');

  const transcriptRef = useRef('');
  transcriptRef.current = transcript;
  const transcriptState = () => transcriptRef.current;

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // v2 speed: phone location is fetched ONCE in the background at startup
  // (instead of after the AI step), so searches never wait for GPS.
  const phoneCoordsRef = useRef(null);
  const playerRef = useRef(null);
  const introducedRef = useRef(null);

  useEffect(() => {
    AsyncStorage.getItem(MY_LEADS_KEY)
      .then((raw) => setMyLeads(raw ? JSON.parse(raw) : []))
      .catch(() => {});
    AsyncStorage.getItem(PROFILE_KEY)
      .then((raw) => {
        const p = raw ? JSON.parse(raw) : null;
        if (p) {
          setSavedProfile(p);
          setCustName(p.name || '');
          setCustPhone(p.phone || '');
        }
      })
      .catch(() => {});
    AsyncStorage.getItem(DEVICE_KEY)
      .then((id) => {
        if (id) deviceIdRef.current = id;
        else {
          const nid = `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
          deviceIdRef.current = nid;
          AsyncStorage.setItem(DEVICE_KEY, nid).catch(() => {});
        }
      })
      .catch(() => {});
    fetch(`${API_BASE}/calls/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setBridgeOn(!!c?.bridge))
      .catch(() => {});
  }, []);

  function saveMyLeads(list) {
    setMyLeads(list);
    AsyncStorage.setItem(MY_LEADS_KEY, JSON.stringify(list.slice(0, 50))).catch(() => {});
  }

  // The oldest unrated request that is old enough to ask about.
  const pendingRating =
    screen === 'record'
      ? myLeads.find((l) => !l.rated && l.t && Date.now() - l.at >= RATE_AFTER_MS)
      : null;

  function openRating(lead) {
    setRateLead(lead);
    setRateStep('ask');
    setRateStars(0);
    setRateComment('');
  }

  async function submitRating(outcome, stars) {
    const lead = rateLead;
    if (!lead) return;
    try {
      const res = await fetch(`${API_BASE}/leads/${lead.id}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: lead.t, outcome, stars, comment: rateComment.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await describeBadResponse(res));
      saveMyLeads(myLeads.map((l) => (l.id === lead.id ? { ...l, rated: true } : l)));
      setRateStep('done');
      speakQuick(outcome === 'no_contact' ? 'سپاس از اطلاع‌رسانی شما. حتماً پیگیری می‌کنیم.' : 'سپاسگزارم. امتیاز شما ثبت شد.');
      setTimeout(() => setRateLead(null), 1800);
    } catch (err) {
      fail('ثبت امتیاز با خطا مواجه شد.', err);
    }
  }

  function skipRating() {
    if (rateLead) saveMyLeads(myLeads.map((l) => (l.id === rateLead.id ? { ...l, at: Date.now() } : l)));
    setRateLead(null);
  }

  useEffect(() => {
    requestRecordingPermissionsAsync().catch(() => {});
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const last = await Location.getLastKnownPositionAsync({}).catch(() => null);
        if (last?.coords) phoneCoordsRef.current = { lat: last.coords.latitude, lng: last.coords.longitude };
        const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cur?.coords) phoneCoordsRef.current = { lat: cur.coords.latitude, lng: cur.coords.longitude };
      } catch (e) {
        console.log('location warmup failed', e);
      }
    })();
  }, []);

  // As soon as the detail screen opens for a business, run the voice
  // introduction (name -> "know more?" -> contact info -> directions ->
  // open follow-up) — this is on top of (not instead of) the tap-to-call /
  // tap-for-directions / contact buttons below, which still work as a
  // manual fallback.
  // v2 speed: the old step-by-step voice dialogue (speak -> listen for
  // yes/no -> speak -> listen ...) took 20-40 seconds per business and
  // customers left. Now the detail screen speaks ONE short sentence that
  // doesn't block anything, and never opens the microphone by itself.
  // The audio was already pre-generated on the server while the results
  // list was showing (see prefetchSpeech), so it starts almost instantly.
  useEffect(() => {
    if (screen === 'detail' && selectedBusiness && introducedRef.current !== selectedBusiness.id) {
      introducedRef.current = selectedBusiness.id;
      speakQuick(introLine(selectedBusiness));
    }
    if (screen !== 'detail') stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, selectedBusiness]);

  function introLine(biz) {
    const fa = speaksPersian(biz) ? ' امکان گفت‌وگو به زبان فارسی هم وجود دارد.' : '';
    const tag = biz.tagline ? ` ${String(biz.tagline).replace(/[.。]$/, '')}.` : '';
    const top = biz.top_rated ? ' از برگزیدگان گلوبال‌لینک است.' : '';
    return `${biz.name}.${tag}${top}${fa} برای تماس، کافی است دکمهٔ سبز پایین صفحه را لمس کنید.`;
  }

  // Short spoken confirmation as soon as results appear (cached on the server
  // after first use, so it plays almost instantly).
  function announceResults(data) {
    const list = data?.results || [];
    let line;
    if (data?.mode === 'name' && list[0]) line = `${list[0].name} را برایتان پیدا کردم.`;
    else if (data?.intent?.name_not_found) line = 'موردی با این نام پیدا نشد. نزدیک‌ترین گزینه‌ها را برایتان آماده کرده‌ام.';
    else if (list.length === 0) line = 'متأسفانه در حال حاضر گزینهٔ مناسبی پیدا نشد.';
    else if (list.length === 1) line = 'یک گزینهٔ مناسب برایتان پیدا کردم.';
    else line = `${list.length} گزینهٔ مناسب برایتان پیدا کردم.`;
    speakQuick(line);
  }

  function speechUrl(text) {
    return `${API_BASE}/speak?text=${encodeURIComponent(text)}`;
  }

  // Warm the server's audio cache for the first few results, so tapping a
  // business plays its intro immediately instead of waiting ~2s for TTS.
  function prefetchSpeech(list) {
    (list || []).slice(0, 5).forEach((biz) => {
      fetch(speechUrl(introLine(biz)), { method: 'GET' }).catch(() => {});
    });
  }

  function stopSpeaking() {
    try {
      playerRef.current?.pause?.();
      playerRef.current?.remove?.();
    } catch (e) {}
    playerRef.current = null;
  }

  async function speakQuick(text) {
    stopSpeaking();
    try {
      // Playback-only mode routes audio to the loud main speaker on iOS
      // (after recording, it otherwise stays on the quiet earpiece).
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, interruptionMode: 'doNotMix' });
      const player = createAudioPlayer(speechUrl(text));
      playerRef.current = player;
      try {
        player.volume = 1.0;
      } catch (e) {}
      player.play();
    } catch (err) {
      console.log('speakQuick error', err);
    }
  }

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
    const gen = navGenRef.current;
    try {
      setRecordingState('idle');
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) return;

      setScreen('transcribing');

      const data = await uploadRecording(uri);
      if (gen !== navGenRef.current) return;
      const text = (data.text || '').trim();
      setTranscript(text);
      // v2 speed: no extra "confirm" tap — go straight to the search.
      // The customer can still edit the text from the results screen.
      if (text && looksLikePersianSpeech(text) || /[a-z]{3,}/i.test(text)) {
        confirmAndExtractIntent(text);
      } else {
        goIf(gen, 'confirm');
      }
    } catch (err) {
      if (gen !== navGenRef.current) return;
      setScreen('record');
      fail('تبدیل صدا به متن با خطا مواجه شد. دوباره امتحان کن.', err);
    }
  }

  async function confirmAndExtractIntent(textOverride) {
    const transcript = typeof textOverride === 'string' ? textOverride : transcriptState();
    if (!transcript.trim()) {
      return fail('اول باید یک پیام صوتی ضبط کنی یا متن رو بنویسی.');
    }
    const gen = navGenRef.current;
    try {
      setScreen('extracting');
      // v2 speed: one round trip for intent + matching (server route /search).
      try {
        const coords = phoneCoordsRef.current || FALLBACK_LOCATION;
        const sres = await fetch(`${API_BASE}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, lat: coords.lat, lng: coords.lng, limit: 8 }),
        });
        if (sres.ok) {
          const sdata = await sres.json();
          if (gen !== navGenRef.current) return;
          setIntent(sdata.intent || null);
          setBusinesses(sdata.results || []);
          setSearchMode(sdata.mode === 'name' ? 'name' : 'category');
          setQueryName(sdata.query_name || sdata.intent?.person_name_fa || '');
          setCompareIds([]);
          setSortBy('match');
          prefetchSpeech(sdata.results);
          setScreen('results');
          announceResults(sdata);
          return;
        }
        if (sres.status !== 404) throw new Error(await describeBadResponse(sres));
      } catch (e) {
        if (!String(e?.message || '').startsWith('HTTP 404')) {
          if (e?.message && e.message.startsWith('HTTP')) throw e;
        }
      }
      // Fallback for an older server without /search:
      const res = await fetch(`${API_BASE}/extract-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      if (!res.ok) throw new Error(await describeBadResponse(res));
      const data = await res.json();
      if (gen !== navGenRef.current) return;
      setIntent(data);
      // If the AI couldn't confidently map this request to a real category
      // in our system (or genuinely nothing fits yet), don't call /match at
      // all — sending a broken/empty category_id downstream used to come
      // back with an unrelated, generic set of businesses. Showing an
      // honest "nothing found" is better than a wrong-but-populated list.
      if (!data.category_id) {
        console.log('INTENT: no matching category (AI picked:', data.category_en, ') — skipping /match');
        setBusinesses([]);
        setScreen('results');
        return;
      }
      await runMatch(data);
    } catch (err) {
      if (gen !== navGenRef.current) return;
      setScreen('confirm');
      fail('تشخیص نوع درخواست با خطا مواجه شد.', err);
    }
  }

  async function runMatch(intentData) {
    const gen = navGenRef.current;
    try {
      setScreen('matching');
      let coords = phoneCoordsRef.current || FALLBACK_LOCATION;
      if (intentData.location_lat != null && intentData.location_lng != null) {
        coords = { lat: intentData.location_lat, lng: intentData.location_lng };
      } else if (!phoneCoordsRef.current) {
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
      if (gen !== navGenRef.current) return;
      setBusinesses(data.results || []);
      setCompareIds([]);
      setSortBy('match');
      prefetchSpeech(data.results);
      setScreen('results');
    } catch (err) {
      if (gen !== navGenRef.current) return;
      setScreen('confirm');
      fail('پیدا کردن کسب‌وکارهای مناسب با خطا مواجه شد.', err);
    }
  }

  function pickBusiness(biz) {
    setShowCallback(false);
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

  // Widened beyond a bare بله/نه: customers often answer a "بگو بله یا نه"
  // question with a full natural sentence instead, e.g. "می‌خوام بیشتر
  // بدونم" — so this also catches that shape of answer, not just the single
  // word.
  function isAffirmative(text) {
    const t = (text || '').trim();
    return /بله|بعله|آره|اره|باشه|حتما|حتماً|okay|^ok$|^yes$|می‌?خوام.*بدون|بیشتر.*بدون|بیشتر.*بگو|درسته|موافقم|بگو/i.test(
      t
    );
  }

  function isNegative(text) {
    const t = (text || '').trim();
    return /نه\b|نه‌?ممنون|نمی‌?خوام|نمیخوام|لازم نیست|کافیه|فعلاً? نه|^no$/i.test(t);
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
      await new Promise((resolve) => setTimeout(resolve, 450));
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
    const answer = await captureSpeech(3200);
    console.log('YESNO TRANSCRIBED ANSWER:', JSON.stringify(answer));
    console.log('YESNO isAffirmative:', isAffirmative(answer), 'isNegative:', isNegative(answer));
    // Negative is checked first: a garbled transcript that happens to
    // contain both a clear "نه" and something loosely matching the wider
    // affirmative pattern should still count as "no" — a customer's "no" is
    // a much stronger signal than an accidental overlap.
    if (isNegative(answer)) return 'no';
    if (isAffirmative(answer)) return 'yes';
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
      parts.push(`به زبان‌های ${biz.languages.join('، ')} صحبت می‌کنند`);
    }
    if (biz.phone) parts.push(`شمارهٔ تماس ${biz.phone} است`);
    if (biz.address_text) parts.push(`نشانی ${biz.address_text} است`);
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
      await speak(`${name} را برایتان پیدا کردم. مایلید اطلاعات بیشتری بشنوید؟ لطفاً بفرمایید بله یا نه.`);
      let wantsMore = await listenYesNo();
      console.log('INTRO wantsMore:', wantsMore);

      // If Whisper garbled the answer badly enough that we can't tell
      // بله/نه apart, give the customer ONE more clear chance instead of
      // silently moving on and leaving them talking to dead air.
      if (wantsMore === 'unclear') {
        await speak('پوزش می‌خواهم، متوجه نشدم. اگر مایلید بیشتر بدانید، بفرمایید «بله»؛ در غیر این صورت «نه».');
        wantsMore = await listenYesNo();
        console.log('INTRO wantsMore (retry):', wantsMore);
      }

      if (wantsMore === 'yes') {
        const summary = buildBusinessSummary(selectedBusiness);
        const extra = hasRoute
          ? ' مایلید مسیر را روی نقشه برایتان باز کنم؟ لطفاً بفرمایید بله یا نه.'
          : ' اگر پرسش دیگری دارید، در خدمتم.';
        const infoText = summary
          ? `${summary}.`
          : 'اطلاعات تماس روی صفحه در اختیارتان است.';
        await speak(`بسیار خب. ${infoText}${extra}`);
        if (hasRoute) {
          const wantsDirections = await listenYesNo();
          console.log('INTRO wantsDirections:', wantsDirections);
          if (wantsDirections === 'yes') {
            openDirections();
          }
          await speak('بسیار خب. اگر پرسش دیگری دارید، در خدمتم.');
        }
      } else if (wantsMore === 'no') {
        await speak('بسیار خب. هر زمان نیاز داشتید، در خدمتتان هستم.');
      } else {
        // Still unclear even after the retry — don't leave the customer
        // hanging in silence. The info is already visible on screen, so say
        // that much and move on gracefully instead of getting stuck.
        await speak('بسیار خب. اطلاعات کامل روی صفحه در اختیارتان است. هر زمان پرسشی داشتید، در خدمتم.');
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

  function rememberLead(data) {
    if (data?.rate_token && (data.id || data.lead_id)) {
      setMyLeads((prev) => {
        const list = [
          { id: data.id || data.lead_id, t: data.rate_token, bizId: selectedBusiness.id, bizName: selectedBusiness.name, at: Date.now(), rated: false },
          ...prev,
        ];
        AsyncStorage.setItem(MY_LEADS_KEY, JSON.stringify(list.slice(0, 50))).catch(() => {});
        return list;
      });
    }
  }

  // "Call via GlobalLink": no name, no phone number needed.
  // With the masked-number bridge on, the customer dials a GlobalLink number and
  // the business never sees their real number. Until it's on: paid businesses
  // are dialled directly; locked ones fall back to the call-me-back form.
  async function callViaGlobalLink() {
    if (calling) return;
    setCalling(true);
    try {
      const res = await fetch(`${API_BASE}/calls/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: selectedBusiness.id, device_id: deviceIdRef.current, transcript, intent }),
      });
      const data = res.ok ? await res.json() : {};
      rememberLead({ id: data.lead_id, rate_token: data.rate_token });
      if (data.bridge && data.dial) {
        Linking.openURL(`tel:${data.dial}`);
      } else if (!selectedBusiness.contact_locked && selectedBusiness.phone) {
        Linking.openURL(`tel:${selectedBusiness.phone}`);
      } else {
        setShowCallback(true);
      }
    } catch (err) {
      if (!selectedBusiness.contact_locked && selectedBusiness.phone) Linking.openURL(`tel:${selectedBusiness.phone}`);
      else setShowCallback(true);
    } finally {
      setCalling(false);
    }
  }

  async function chooseChannel(channelIn) {
    // 'callback' = "please call me back": always needs name + phone (asked once, remembered).
    const isCallback = channelIn === 'callback';
    const channel = isCallback ? 'call' : channelIn;
    const locked = !!selectedBusiness?.contact_locked || isCallback;
    if (locked) {
      const digits = custPhone.replace(/\D/g, '');
      if (!custName.trim() || digits.length < 10) {
        return fail('لطفاً نام و شماره‌ی تلفن کامل خودت رو وارد کن تا کسب‌وکار بتونه باهات تماس بگیره.');
      }
    }
    if (locked && custName.trim()) {
      const p = { name: custName.trim(), phone: custPhone.trim() };
      setSavedProfile(p);
      setEditingProfile(false);
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p)).catch(() => {});
    }
    try {
      setSending(true);
      const coords = phoneCoordsRef.current;
      const res = await fetch(`${API_BASE}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: selectedBusiness.id,
          transcript,
          intent,
          channel,
          customer_name: custName.trim() || undefined,
          customer_phone: custPhone.trim() || undefined,
          device_id: deviceIdRef.current,
          customer_lat: coords?.lat,
          customer_lng: coords?.lng,
        }),
      });
      setSending(false);
      if (!res.ok) throw new Error(await describeBadResponse(res));
      const data = await res.json();
      setLeadId(data.id || data.lead_id);
      setLastLeadLocked(!!selectedBusiness?.contact_locked || !!data.contact_locked);
      rememberLead(data);
      setShowCallback(false);
      if (locked) {
        setScreen('sent');
        return;
      }

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
      setSending(false);
      fail('ثبت درخواست با خطا مواجه شد.', err);
    }
  }

  async function sendEmail() {
    try {
      const res = await fetch(`${API_BASE}/leads/${leadId}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_draft: emailDraft }),
      });
      if (!res.ok) throw new Error(await describeBadResponse(res));
      setScreen('sent');
    } catch (err) {
      fail('ارسال ایمیل با خطا مواجه شد.', err);
    }
  }

  function startOver() {
    stopSpeaking();
    setShowCallback(false);
    setLastLeadLocked(false);
    setSearchMode('category');
    setQueryName('');
    introducedRef.current = null;
    navGenRef.current += 1;
    historyRef.current = [];
    screenRef.current = 'record';
    setScreenRaw('record');
    setTranscript('');
    setIntent(null);
    setBusinesses([]);
    setSelectedBusiness(null);
    setEmailDraft('');
    setLeadId(null);
    setErrorMsg('');
    setCompareIds([]);
  }

  function quickSearch(text) {
    setTranscript(text);
    confirmAndExtractIntent(text);
  }

  // ---- Derived data for the results / compare screens --------------------
  const sortedBusinesses = useMemo(() => {
    const list = businesses.map((b, i) => ({ ...b, _i: i }));
    if (sortBy === 'distance') list.sort((a, b) => (Number(a.distance_km) || 0) - (Number(b.distance_km) || 0));
    else if (sortBy === 'rating') list.sort((a, b) => (Number(b.google_rating) || 0) - (Number(a.google_rating) || 0));
    else if (sortBy === 'price') list.sort((a, b) => (Number(a.price_tier) || 2) - (Number(b.price_tier) || 2));
    else if (sortBy === 'lang') list.sort((a, b) => Number(speaksPersian(b)) - Number(speaksPersian(a)));
    return list;
  }, [businesses, sortBy]);

  const compareList = businesses.filter((b) => compareIds.includes(b.id));

  function toggleCompare(id) {
    setCompareIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id]));
  }

  const summaryChip = [
    intent?.category_en ? null : null,
    intent?.location_text || null,
    intent?.language_requested === 'fa' ? 'فارسی‌زبان' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const avatarIndexOf = (biz) => Math.max(0, businesses.findIndex((b) => b.id === biz?.id));

  const SORTS = [
    { id: 'match', label: 'بهترین تطبیق' },
    { id: 'distance', label: 'فاصله' },
    { id: 'rating', label: 'امتیاز گوگل' },
    { id: 'price', label: 'قیمت' },
    { id: 'lang', label: 'فارسی‌زبان' },
  ];

  const recording = recordingState === 'recording';

  return (
    <SafeAreaView style={[s.safe, screen === 'transcribing' || screen === 'extracting' || screen === 'matching' ? { backgroundColor: C.green } : null]}>
      <StatusBar barStyle={screen === 'transcribing' || screen === 'extracting' || screen === 'matching' ? 'light-content' : 'dark-content'} />

      {/* 1. Home — start with voice */}
      {screen === 'record' && (
        <View style={s.fill}>
          <View style={s.homeHeader}>
            <View style={s.brandRow}>
              <View style={s.brandMark}>
                <View style={s.brandDiamond} />
              </View>
              <Text style={s.brandText}>GlobalLink Trade Hub</Text>
            </View>
            <Chip label="تورنتو بزرگ (GTA)" tint />
          </View>

          <ScrollView contentContainerStyle={s.homeCenter} keyboardShouldPersistTaps="handled">
            {!recording ? <Text style={s.greet}>{greeting()}، خوش اومدی</Text> : null}
            <Text style={s.homeTitle}>{recording ? 'دارم گوش می‌دم...' : 'امروز چه کمکی از دستمون برمیاد؟'}</Text>
            <Text style={s.homeSub}>
              {recording
                ? 'نیازت رو بگو، بعد دوباره دکمه رو بزن تا تموم بشه'
                : 'نیازت رو بگو — مثلاً «یک لوله‌کش نزدیک من» — یا اسم کسی رو که دنبالشی: «آقای رضا خادم، مشاور املاک»'}
            </Text>

            <PulseMic recording={recording} onPress={handleMicPress} disabled={recordingState === 'preparing'} />

            <Text style={s.homeHint}>
              {recording ? 'برای پایان لمس کن' : recordingState === 'preparing' ? 'آماده‌سازی...' : 'برای شروع لمس کن'}
            </Text>
            {recording ? <ListeningBars color={C.orange} /> : null}

            {!recording && pendingRating && !rateLead ? (
              <TouchableOpacity style={s.rateCard} onPress={() => openRating(pendingRating)} activeOpacity={0.85}>
                <Text style={s.warmTitle}>با {pendingRating.bizName} در ارتباط بودی؟</Text>
                <Text style={s.warmText}>با امتیازت به هم‌زبان‌هات کمک کن بهترین‌ها رو پیدا کنن.</Text>
                <Stars value={0} size={24} />
              </TouchableOpacity>
            ) : null}

            {rateLead ? (
              <View style={s.rateCard}>
                {rateStep === 'ask' ? (
                  <>
                    <Text style={s.warmTitle}>درخواستت برای {rateLead.bizName} به کجا رسید؟</Text>
                    <Btn title="کارم رو انجام دادن" small onPress={() => { setRateOutcome('hired'); setRateStep('stars'); }} />
                    <Btn title="صحبت کردیم" small variant="secondary" onPress={() => { setRateOutcome('contacted'); setRateStep('stars'); }} />
                    <Btn title="هنوز باهام تماس نگرفتن" small variant="secondary" onPress={() => submitRating('no_contact', 0)} />
                    <TouchableOpacity onPress={skipRating} style={{ alignSelf: 'center', padding: 6 }}>
                      <Text style={s.meta}>بعداً</Text>
                    </TouchableOpacity>
                  </>
                ) : rateStep === 'stars' ? (
                  <>
                    <Text style={[s.warmTitle, { textAlign: 'center' }]}>به {rateLead.bizName} چند ستاره می‌دی؟</Text>
                    <Stars value={rateStars} onChange={setRateStars} size={36} />
                    <TextInput
                      style={s.input}
                      value={rateComment}
                      onChangeText={setRateComment}
                      placeholder="یک جمله درباره‌ی تجربه‌ات (اختیاری)"
                      placeholderTextColor={C.muted}
                      textAlign="right"
                    />
                    <Btn title="ثبت امتیاز" small disabled={!rateStars} onPress={() => submitRating(rateOutcome, rateStars)} />
                  </>
                ) : (
                  <Text style={[s.warmTitle, { textAlign: 'center', color: C.greenDark }]}>ممنون! امتیازت ثبت شد ✓</Text>
                )}
              </View>
            ) : null}

            {!recording && !errorMsg && !rateLead && !pendingRating ? (
              <View style={s.warmCard}>
                <Text style={s.warmTitle}>بیش از ۲٬۳۰۰ کسب‌وکار فارسی‌زبان در تورنتو بزرگ</Text>
                <Text style={s.warmText}>از مشاور املاک و لوله‌کش تا شیرینی‌فروشی محله — هم‌زبان و نزدیک خودت. جستجو برای شما همیشه رایگانه.</Text>
                <View style={s.stepsRow}>
                  {['بگو', 'پیدا می‌کنیم', 'وصل می‌شی'].map((t, i) => (
                    <View key={t} style={s.stepItem}>
                      <View style={[s.stepDot, { backgroundColor: [C.green, C.amber, C.orange][i] }]}>
                        <Text style={s.stepNum}>{fa(i + 1)}</Text>
                      </View>
                      <Text style={s.stepText}>{t}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {errorMsg ? (
              <View style={s.errorBox}>
                <Text selectable style={s.errorBoxTitle}>
                  جزئیات فنی آخرین خطا (برای اسکرین‌شات):
                </Text>
                <Text selectable style={s.errorBoxText}>
                  {errorMsg}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={s.homeFooter}>
            <Text style={s.sectionMini}>پرتقاضاترین دسته‌ها</Text>
            <View style={s.chipsRow}>
              {QUICK_CATEGORIES.map((c, i) => (
                <Chip key={c.label} label={c.label} active={i === 1} onPress={() => quickSearch(c.text)} />
              ))}
            </View>
          </View>
          <Text style={s.versionTag}>{`نسخه ${APP_VERSION}`}</Text>
        </View>
      )}

      {/* 2. Listening / analysing */}
      {screen === 'transcribing' && (
        <WorkingScreen label="در حال شنیدن و تبدیل صدا به متن..." sub="اولین بار ممکنه چند ثانیه بیشتر طول بکشه" onCancel={cancelWorking} />
      )}
      {screen === 'extracting' && (
        <WorkingScreen label="در حال تحلیل نیاز شما با هوش مصنوعی" quote={transcript} onCancel={cancelWorking} />
      )}
      {screen === 'matching' && (
        <WorkingScreen label="در حال پیدا کردن بهترین گزینه‌ها" quote={intent?.summary || transcript} onCancel={cancelWorking} />
      )}

      {/* 2b. Confirm what we heard */}
      {screen === 'confirm' && (
        <View style={s.fill}>
          <TopBar title="این چیزی بود که شنیدم" onBack={goBack} />
          <ScrollView style={s.body} contentContainerStyle={{ paddingVertical: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={s.helpText}>اگه چیزی اشتباه شنیده شده، همین‌جا درستش کن.</Text>
            <View style={[s.card, { marginTop: 12 }]}>
              <TextInput
                style={s.transcriptInput}
                value={transcript}
                onChangeText={setTranscript}
                multiline
                placeholder="متن درخواستت اینجا میاد..."
                placeholderTextColor={C.muted}
              />
            </View>
          </ScrollView>
          <View style={s.footerBar}>
            <Btn title="ضبط دوباره" variant="secondary" onPress={startOver} style={{ flex: 1 }} />
            <Btn title="پیدا کن" onPress={() => confirmAndExtractIntent()} style={{ flex: 1.4 }} />
          </View>
        </View>
      )}

      {/* 3. Results */}
      {screen === 'results' && (
        <View style={s.fill}>
          <View style={s.resultsHeader}>
            <TopBar
              title={
                searchMode === 'name' && queryName
                  ? `نتیجه برای «${queryName}»`
                  : businesses.length
                  ? `${fa(businesses.length)} گزینه پیدا شد`
                  : 'نتیجه‌ای پیدا نشد'
              }
              onBack={goBack}
              onHome={startOver}
            />
            <View style={[s.rowRtl, { paddingHorizontal: 20, paddingBottom: 12, justifyContent: 'space-between' }]}>
              {intent?.summary ? <Chip label={summaryChip || intent.summary} tint /> : <View />}
              <TouchableOpacity onPress={() => setScreen('confirm')} hitSlop={10}>
                <Text style={[s.metaStrong, { color: C.green }]}>ویرایش درخواست</Text>
              </TouchableOpacity>
            </View>
          </View>

          {intent?.name_not_found ? (
            <View style={[s.freeNote, { marginHorizontal: 20, marginTop: 12, backgroundColor: C.speedBg }]}>
              <Text style={[s.freeNoteText, { color: C.speedInk }]}>
                کسی با اسم «{intent.person_name_fa || intent.person_name_en}» در دیتابیس پیدا نشد. این‌ها نزدیک‌ترین گزینه‌ها هستن.
              </Text>
            </View>
          ) : null}
          {businesses.length > 1 && searchMode !== 'name' ? (
            <View style={s.sortRow}>
              {SORTS.map((o) => (
                <Chip key={o.id} label={o.label} active={sortBy === o.id} onPress={() => setSortBy(o.id)} />
              ))}
            </View>
          ) : null}

          <ScrollView style={s.body} contentContainerStyle={{ paddingTop: 4, paddingBottom: 110, gap: 12 }}>
            {businesses.length === 0 && (
              <View style={[s.card, { alignItems: 'center', paddingVertical: 28 }]}>
                <Text style={s.cardTitle}>فعلاً گزینه‌ای پیدا نشد</Text>
                <Text style={[s.helpText, { textAlign: 'center', marginTop: 8 }]}>
                  درخواستت رو کمی کلی‌تر بگو، یا یک شهر نزدیک‌تر رو امتحان کن.
                </Text>
                <Btn title="جستجوی دوباره" onPress={startOver} style={{ marginTop: 16, alignSelf: 'stretch' }} />
              </View>
            )}
            {sortedBusinesses.map((biz) => {
              const selected = compareIds.includes(biz.id);
              const speed = speedLabel(biz.avg_response_min);
              return (
                <View key={biz.id} style={[s.card, selected && s.cardSelected]}>
                  <View style={s.rowRtl}>
                    <Avatar name={biz.name} index={biz._i} photo={biz.photo_url} />
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <View style={[s.rowRtl, { alignItems: 'flex-start' }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.cardTitle}>{biz.name}</Text>
                          {biz.brokerage_or_company ? <Text style={s.cardSubtitle}>{biz.brokerage_or_company}</Text> : null}
                          {biz.tagline ? <Text style={[s.cardSubtitle, { color: C.greenDark, fontWeight: '600' }]}>{biz.tagline}</Text> : null}
                          {ratingLabel(biz) ? <Text style={[s.cardSubtitle, { color: C.speedInk, fontWeight: '700' }]}>{ratingLabel(biz)}</Text> : null}
                          {biz.name_match && (biz.category_fa || biz.subcategory) ? (
                            <Text style={s.cardSubtitle}>{[biz.category_fa, biz.subcategory].filter(Boolean).join(' · ')}</Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          onPress={() => toggleCompare(biz.id)}
                          accessibilityLabel="افزودن به مقایسه"
                          hitSlop={10}
                          style={[s.checkbox, selected && s.checkboxOn]}
                        >
                          {selected ? <Text style={s.checkMark}>✓</Text> : null}
                        </TouchableOpacity>
                      </View>
                      <View style={[s.rowRtl, { marginTop: 8, flexWrap: 'wrap' }]}>
                        {biz.google_rating ? (
                          <Text style={s.metaStrong}>
                            ★ {fa(biz.google_rating)}{' '}
                            <Text style={s.meta}>({fa(biz.google_review_count || 0)} نظر گوگل)</Text>
                          </Text>
                        ) : null}
                        <Text style={s.meta}>
                          {biz.google_rating ? '  ·  ' : ''}
                          {biz.distance_km != null ? formatKm(biz.distance_km) : ''}
                          {biz.contact_locked && biz.area && biz.area !== 'GTA' ? `  ·  ${biz.area}` : ''}
                        </Text>
                      </View>
                      <View style={s.badgeRow}>
                        {biz.top_rated ? <Badge label="برترین امتیاز" kind="speed" /> : null}
                        {biz.is_verified ? <Badge label="✓ تأییدشده GlobalLink" kind="lang" /> : null}
                        {speed ? <Badge label={speed} kind="speed" /> : null}
                        <Badge label={priceLabel(biz.price_tier)} kind="price" />
                        {langLabel(biz.languages) ? <Badge label={langLabel(biz.languages)} kind="lang" /> : null}
                      </View>
                    </View>
                  </View>
                  <Btn title="مشاهده و درخواست تماس" onPress={() => pickBusiness(biz)} small style={{ marginTop: 14 }} />
                </View>
              );
            })}
          </ScrollView>

          {businesses.length > 1 ? (
            <View style={s.compareBar}>
              <Text style={s.meta}>
                <Text style={s.metaStrong}>{fa(compareIds.length)}</Text> گزینه برای مقایسه انتخاب شد
              </Text>
              <Btn
                title="مقایسه کن"
                variant="amber"
                small
                disabled={compareIds.length < 2}
                onPress={() => setScreen('compare')}
                style={{ paddingHorizontal: 22 }}
              />
            </View>
          ) : null}
        </View>
      )}

      {/* 4. Compare */}
      {screen === 'compare' && (
        <View style={s.fill}>
          <TopBar title="مقایسه گزینه‌های انتخاب‌شده" onBack={goBack} onHome={startOver} />
          <ScrollView style={s.body} contentContainerStyle={{ paddingVertical: 16, gap: 14 }}>
            {compareList.map((biz, i) => {
              const rows = [
                ['امتیاز گوگل', biz.google_rating ? `★ ${fa(biz.google_rating)} (${fa(biz.google_review_count || 0)})` : 'هنوز ثبت نشده'],
                ['قیمت', priceLabel(biz.price_tier)],
                ['فاصله', formatKm(biz.distance_km)],
                ['سرعت پاسخ', speedLabel(biz.avg_response_min) || 'هنوز داده‌ای نیست'],
                ['زبان', langLabel(biz.languages) || '—'],
              ];
              return (
                <View key={biz.id} style={[s.card, i === 0 && s.cardSelected]}>
                  <View style={[s.rowRtl, { marginBottom: 12 }]}>
                    <Avatar name={biz.name} index={avatarIndexOf(biz)} size={48} photo={biz.photo_url} />
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text style={s.cardTitle}>{biz.name}</Text>
                      {biz.brokerage_or_company ? <Text style={s.cardSubtitle}>{biz.brokerage_or_company}</Text> : null}
                    </View>
                  </View>
                  {rows.map(([k, v]) => (
                    <View key={k} style={s.compareRow}>
                      <Text style={s.meta}>{k}</Text>
                      <Text style={s.metaStrong}>{v}</Text>
                    </View>
                  ))}
                  <Btn title="انتخاب این گزینه" small onPress={() => pickBusiness(biz)} style={{ marginTop: 12 }} />
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* 5. Detail + channel choice */}
      {screen === 'detail' && selectedBusiness && (
        <View style={s.fill}>
          <TopBar title="" onBack={() => (showCallback ? setShowCallback(false) : goBack())} onHome={startOver} />
          <ScrollView style={s.body} contentContainerStyle={{ paddingVertical: 22 }}>
            <View style={{ alignItems: 'center' }}>
              <Avatar name={selectedBusiness.name} index={avatarIndexOf(selectedBusiness)} size={92} photo={selectedBusiness.photo_url} />
              <Text style={[s.detailName, { marginTop: 10 }]}>{selectedBusiness.name}</Text>
              {selectedBusiness.brokerage_or_company ? (
                <Text style={[s.meta, { marginTop: 4, textAlign: 'center' }]}>{selectedBusiness.brokerage_or_company}</Text>
              ) : null}
              <Text style={[s.meta, { marginTop: 6 }]}>
                {selectedBusiness.google_rating ? (
                  <Text style={s.metaStrong}>
                    ★ {fa(selectedBusiness.google_rating)} ({fa(selectedBusiness.google_review_count || 0)} نظر گوگل) ·{' '}
                  </Text>
                ) : null}
                {formatKm(selectedBusiness.distance_km)}
              </Text>
              {selectedBusiness.tagline ? (
                <Text style={[s.metaStrong, { color: C.greenDark, marginTop: 6, textAlign: 'center' }]}>{selectedBusiness.tagline}</Text>
              ) : null}
              {ratingLabel(selectedBusiness) ? (
                <Text style={[s.metaStrong, { color: C.speedInk, marginTop: 4 }]}>{ratingLabel(selectedBusiness)}</Text>
              ) : null}
              <View style={[s.badgeRow, { justifyContent: 'center' }]}>
                {selectedBusiness.top_rated ? <Badge label="برترین امتیاز" kind="speed" /> : null}
                {selectedBusiness.is_verified ? <Badge label="✓ تأییدشده GlobalLink" kind="lang" /> : null}
                {speedLabel(selectedBusiness.avg_response_min) ? (
                  <Badge label={speedLabel(selectedBusiness.avg_response_min)} kind="speed" />
                ) : null}
                <Badge label={priceLabel(selectedBusiness.price_tier)} kind="price" />
                {langLabel(selectedBusiness.languages) ? <Badge label={langLabel(selectedBusiness.languages)} kind="lang" /> : null}
              </View>
              <View style={{ marginTop: 12 }}>
                <Chip label="▶  پخش معرفی صوتی" onPress={() => speakQuick(introLine(selectedBusiness))} />
              </View>
            </View>

            {selectedBusiness.contact_locked ? (
              <View style={[s.card, { marginTop: 22, gap: 2 }]}>
                {selectedBusiness.has_phone ? (
                  <View style={s.infoRow}>
                    <Text style={s.meta}>تلفن</Text>
                    <Text style={[s.metaStrong, { letterSpacing: 1 }]}>{fa(selectedBusiness.phone_masked || '***-***-****')}</Text>
                  </View>
                ) : null}
                <TouchableOpacity style={s.infoRow} onPress={openDirections}>
                  <Text style={s.meta}>محدوده</Text>
                  <Text style={s.infoLink}>
                    {selectedBusiness.area && selectedBusiness.area !== 'GTA' ? selectedBusiness.area : 'تورنتو بزرگ'} · حدود ۱ کیلومتر
                  </Text>
                </TouchableOpacity>
                {selectedBusiness.has_website || selectedBusiness.has_email ? (
                  <View style={[s.infoRow, { borderBottomWidth: 0 }]}>
                    <Text style={s.meta}>وب‌سایت و ایمیل</Text>
                    <Text style={s.meta}>از طریق درخواست تماس</Text>
                  </View>
                ) : null}
                <Text style={[s.helpText, { marginTop: 8 }]}>
                  اطلاعات تماس مستقیم این کسب‌وکار هنوز در GlobalLink فعال نشده. درخواستت رو بفرست تا ما به دستش برسونیم و باهات تماس بگیرن.
                </Text>
              </View>
            ) : (
            <View style={[s.card, { marginTop: 22, gap: 2 }]}>
                {selectedBusiness.phone ? (
                  <TouchableOpacity style={s.infoRow} onPress={callPhone}>
                    <Text style={s.meta}>تلفن</Text>
                    <Text style={s.infoLink}>{fa(selectedBusiness.phone)}</Text>
                  </TouchableOpacity>
                ) : null}
                {selectedBusiness.address_text || (selectedBusiness.lat && selectedBusiness.lng) ? (
                  <TouchableOpacity style={s.infoRow} onPress={openDirections}>
                    <Text style={s.meta}>آدرس</Text>
                    <Text style={s.infoLink} numberOfLines={2}>
                      {selectedBusiness.address_text && selectedBusiness.address_text !== 'GTA'
                        ? selectedBusiness.address_text
                        : 'مسیریابی روی نقشه'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {selectedBusiness.website ? (
                  <TouchableOpacity style={s.infoRow} onPress={() => Linking.openURL(selectedBusiness.website)}>
                    <Text style={s.meta}>وب‌سایت</Text>
                    <Text style={s.infoLink} numberOfLines={1}>
                      {String(selectedBusiness.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {selectedBusiness.email ? (
                  <View style={[s.infoRow, { borderBottomWidth: 0 }]}>
                    <Text style={s.meta}>ایمیل</Text>
                    <Text style={s.metaStrong} numberOfLines={1}>
                      {selectedBusiness.email}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}

            {selectedBusiness.about || (selectedBusiness.services && selectedBusiness.services.length) ? (
              <View style={[s.card, { marginTop: 14, gap: 8 }]}>
                <Text style={s.cardTitle}>درباره‌ی {selectedBusiness.name}</Text>
                {selectedBusiness.about ? <Text style={s.helpText}>{selectedBusiness.about}</Text> : null}
                {selectedBusiness.services && selectedBusiness.services.length ? (
                  <View style={s.badgeRow}>
                    {selectedBusiness.services.map((sv) => (
                      <Badge key={sv} label={sv} kind="price" />
                    ))}
                  </View>
                ) : null}
                {selectedBusiness.experience || selectedBusiness.hours ? (
                  <Text style={s.meta}>
                    {selectedBusiness.experience ? `${fa(selectedBusiness.experience)} سال سابقه` : ''}
                    {selectedBusiness.experience && selectedBusiness.hours ? '  ·  ' : ''}
                    {selectedBusiness.hours || ''}
                  </Text>
                ) : null}
                {selectedBusiness.has_voice_profile ? <Text style={[s.meta, { fontSize: 11.5 }]}>این معرفی را خودِ کسب‌وکار با صدای خودش ثبت کرده است.</Text> : null}
              </View>
            ) : null}

            <View style={s.freeNote}>
              <Text style={s.freeNoteText}>درخواست شما کاملاً رایگانه — GlobalLink چیزی از شما دریافت نمی‌کنه.</Text>
            </View>
          </ScrollView>

          <View style={s.detailFooter}>
            {showCallback ? (
              <View style={{ gap: 10 }}>
                <Text style={s.cardTitle}>{selectedBusiness.name} با شما تماس می‌گیره</Text>
                {savedProfile && !editingProfile ? (
                  <View style={[s.rowRtl, { justifyContent: 'space-between' }]}>
                    <Text style={s.metaStrong}>
                      {savedProfile.name} · {fa(savedProfile.phone)}
                    </Text>
                    <TouchableOpacity onPress={() => setEditingProfile(true)} hitSlop={8}>
                      <Text style={[s.metaStrong, { color: C.green }]}>تغییر</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TextInput style={s.input} value={custName} onChangeText={setCustName} placeholder="اسم کوچک شما" placeholderTextColor={C.muted} textAlign="right" />
                    <TextInput style={[s.input, { textAlign: 'left' }]} value={custPhone} onChangeText={setCustPhone} placeholder="416-000-0000" placeholderTextColor={C.muted} keyboardType="phone-pad" />
                  </>
                )}
                <Text style={[s.meta, { fontSize: 11.5 }]}>شماره‌ی شما فقط به همین کسب‌وکار داده می‌شه — یک بار وارد می‌کنید، دفعه‌های بعد یادمون می‌مونه.</Text>
                <View style={[s.rowRtl, { gap: 10 }]}>
                  <Btn title={sending ? 'در حال ارسال...' : 'ارسال درخواست'} onPress={() => chooseChannel('callback')} disabled={sending} style={{ flex: 1.4 }} />
                  <Btn title="انصراف" variant="secondary" onPress={() => setShowCallback(false)} style={{ flex: 1 }} />
                </View>
              </View>
            ) : (
              <>
                <Btn title={calling ? 'در حال اتصال...' : 'تماس از طریق GlobalLink'} onPress={callViaGlobalLink} disabled={calling} />
                <Btn title="با من تماس بگیرید" variant="secondary" onPress={() => setShowCallback(true)} />
                <Text style={[s.meta, { textAlign: 'center', fontSize: 11.5 }]}>
                  {bridgeOn ? 'شماره‌ی شما برای کسب‌وکار نمایش داده نمی‌شه.' : 'بدون ثبت‌نام — شماره‌ی شما فقط وقتی خودتان بخواهید داده می‌شه.'}
                </Text>
              </>
            )}
          </View>
        </View>
      )}

      {/* 6. Email preview */}
      {screen === 'emailPreview' && (
        <View style={s.fill}>
          <TopBar title="پیش‌نویس ایمیل شما" onBack={goBack} onHome={startOver} />
          <ScrollView style={s.body} contentContainerStyle={{ paddingVertical: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
            <Text style={s.helpText}>GlobalLink این ایمیل رو بر اساس درخواست صوتی‌ت آماده کرده. قبل از ارسال می‌تونی ویرایشش کنی.</Text>
            <View style={s.card}>
              <View style={s.emailMetaRow}>
                <Text style={s.meta}>به:</Text>
                <Text style={s.metaStrong} numberOfLines={1}>
                  {selectedBusiness?.name}
                  {selectedBusiness?.brokerage_or_company ? ` · ${selectedBusiness.brokerage_or_company}` : ''}
                </Text>
              </View>
              <TextInput
                style={[s.transcriptInput, { minHeight: 220 }]}
                value={emailDraft}
                onChangeText={setEmailDraft}
                multiline
              />
              <Text style={s.emailFoot}>ارسال‌شده از طرف GlobalLink Trade Hub — لغو اشتراک یا حذف اطلاعات در هر زمان</Text>
            </View>
          </ScrollView>
          <View style={s.footerBar}>
            <Btn title="ارسال ایمیل" onPress={sendEmail} style={{ flex: 1 }} />
          </View>
        </View>
      )}

      {/* 7. Confirmation */}
      {screen === 'sent' && (
        <View style={s.fill}>
          <TopBar title="" onBack={goBack} onHome={startOver} />
          <View style={s.sentCenter}>
            <View style={s.sentIcon}>
              <Text style={s.sentCheck}>✓</Text>
            </View>
            <Text style={s.homeTitle}>درخواست شما ارسال شد!</Text>
            <Text style={s.homeSub}>
              {lastLeadLocked
                ? `درخواستت برای ${selectedBusiness?.name || 'این کسب‌وکار'} ثبت شد. تیم GlobalLink درخواستت رو به دستشون می‌رسونه و باهات تماس می‌گیرن.`
                : selectedBusiness?.name
                ? `${selectedBusiness.name} به‌زودی باهات تماس می‌گیره یا پاسخ ایمیلت رو می‌فرسته.`
                : 'به‌زودی باهات تماس گرفته می‌شه.'}
            </Text>
            <View style={[s.card, { alignSelf: 'stretch', marginTop: 12, gap: 8 }]}>
              <View style={s.compareRow}>
                <Text style={s.meta}>وضعیت</Text>
                <Text style={[s.metaStrong, { color: C.greenDark }]}>در انتظار پاسخ</Text>
              </View>
              {leadId ? (
                <View style={[s.compareRow, { borderBottomWidth: 0 }]}>
                  <Text style={s.meta}>شماره پیگیری</Text>
                  <Text style={s.metaStrong}>{fa(leadId)}</Text>
                </View>
              ) : null}
            </View>
          </View>
          <View style={[s.footerBar, { borderTopWidth: 0, backgroundColor: 'transparent' }]}>
            <Btn title="جستجوی جدید" onPress={startOver} style={{ flex: 1 }} />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  versionTag: { textAlign: 'center', color: '#9AA3A0', fontSize: 11, paddingVertical: 6 },
  safe: { flex: 1, backgroundColor: C.bg },
  fill: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 20 },
  rowRtl: { flexDirection: 'row-reverse', alignItems: 'center' },

  // buttons
  btn: { borderRadius: 14, paddingVertical: 15, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { paddingVertical: 11 },
  btnText: { fontSize: 15, fontWeight: '700' },
  btnPrimary: { backgroundColor: C.green },
  btnPrimaryText: { color: '#fff' },
  btnSecondary: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.green },
  btnSecondaryText: { color: C.green },
  btnAmber: { backgroundColor: C.amber },
  btnAmberText: { color: C.amberInk },
  btnWhite: { backgroundColor: '#fff' },
  btnWhiteText: { color: C.greenDark },

  // chips & badges
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, alignSelf: 'flex-start' },
  chipActive: { backgroundColor: C.green, borderColor: C.green },
  chipTint: { backgroundColor: C.greenTint, borderColor: C.greenTint, alignSelf: 'flex-end' },
  chipText: { fontSize: 13, fontWeight: '600', color: C.muted },
  badge: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 8 },
  badgeText: { fontSize: 11.5, fontWeight: '700' },
  badgeRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800' },

  // top bar
  topBar: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  backBtn: { minWidth: 32, alignItems: 'center' },
  homeIcon: { fontSize: 24, color: C.green, fontWeight: '700' },
  cancelBtn: { marginTop: 28, paddingVertical: 10, paddingHorizontal: 22, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' },
  cancelText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  backArrow: { fontSize: 22, color: C.ink },
  topBarTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '800', color: C.ink },

  // home
  homeHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  brandRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  brandMark: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  brandDiamond: { width: 13, height: 13, borderWidth: 2, borderColor: '#fff', transform: [{ rotate: '45deg' }], borderRadius: 2 },
  brandText: { fontWeight: '800', fontSize: 15, color: C.ink },
  homeCenter: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 18, paddingVertical: 20 },
  greet: { fontSize: 14, fontWeight: '700', color: C.orange, textAlign: 'center' },
  rateCard: { alignSelf: 'stretch', backgroundColor: '#fff', borderColor: C.amber, borderWidth: 1.5, borderRadius: 18, padding: 16, marginTop: 6, gap: 10 },
  warmCard: { alignSelf: 'stretch', backgroundColor: '#FFF8EC', borderColor: '#F3E2C3', borderWidth: 1, borderRadius: 18, padding: 16, marginTop: 6, gap: 6 },
  warmTitle: { fontSize: 14, fontWeight: '800', color: C.ink, textAlign: 'right' },
  warmText: { fontSize: 12.5, color: C.muted, lineHeight: 22, textAlign: 'right' },
  stepsRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 8 },
  stepItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  stepDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stepNum: { color: '#fff', fontSize: 12, fontWeight: '800' },
  stepText: { fontSize: 12.5, fontWeight: '700', color: C.ink },
  homeTitle: { fontSize: 22, fontWeight: '800', color: C.ink, textAlign: 'center', lineHeight: 36 },
  homeSub: { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 26 },
  homeHint: { fontSize: 13.5, fontWeight: '700', color: C.greenDark },
  homeFooter: { paddingTop: 4, paddingBottom: 18 },
  sectionMini: { fontSize: 12.5, fontWeight: '700', color: C.muted, marginBottom: 10, paddingHorizontal: 20, textAlign: 'right' },
  chipsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 },
  micWrap: { width: 190, height: 190, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  micRing: { position: 'absolute', width: 148, height: 148, borderRadius: 74 },
  micBtn: { width: 148, height: 148, borderRadius: 74, alignItems: 'center', justifyContent: 'center', shadowColor: '#00522f', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  stopSquare: { width: 38, height: 38, borderRadius: 8, backgroundColor: '#fff' },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 30 },
  bar: { width: 5, borderRadius: 3 },

  // working (green) screens
  workingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, gap: 24 },
  workingLabel: { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center', opacity: 0.92 },
  workingSub: { color: C.amber, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  quoteBox: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)', borderWidth: 1, borderRadius: 18, padding: 20, alignSelf: 'stretch' },
  quoteText: { color: '#fff', fontSize: 17, lineHeight: 32, fontWeight: '600', textAlign: 'right', writingDirection: 'rtl' },

  // cards & text
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 16 },
  cardSelected: { borderColor: C.green, borderWidth: 2 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: C.ink, textAlign: 'right' },
  cardSubtitle: { fontSize: 12.5, color: C.muted, marginTop: 2, textAlign: 'right' },
  meta: { fontSize: 13, color: C.muted, textAlign: 'right' },
  metaStrong: { fontSize: 13, color: C.ink, fontWeight: '700', textAlign: 'right' },
  helpText: { fontSize: 12.5, color: C.muted, lineHeight: 24, textAlign: 'right' },
  checkbox: { width: 26, height: 26, borderRadius: 7, borderWidth: 1.6, borderColor: '#D8D2C4', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  checkboxOn: { backgroundColor: C.green, borderColor: C.green },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 15 },
  transcriptInput: { minHeight: 130, fontSize: 16, lineHeight: 28, color: C.ink, textAlign: 'right', writingDirection: 'rtl', textAlignVertical: 'top' },

  // results
  resultsHeader: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  sortRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  compareBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line },
  compareRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line, gap: 12 },

  // detail
  detailName: { fontSize: 19, fontWeight: '800', color: C.ink, textAlign: 'center' },
  infoRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line, gap: 16 },
  infoLink: { fontSize: 13.5, color: C.greenDark, fontWeight: '700', flexShrink: 1, textAlign: 'left' },
  freeNote: { marginTop: 18, backgroundColor: C.greenTint, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  freeNoteText: { color: C.greenDark, fontWeight: '600', fontSize: 12.5, textAlign: 'right', lineHeight: 22 },
  detailFooter: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18, gap: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line },

  // email
  emailMetaRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 10, marginBottom: 10, gap: 12 },
  emailFoot: { fontSize: 11, color: C.muted, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8, marginTop: 8, textAlign: 'right' },

  // footer & confirmation
  footerBar: { flexDirection: 'row-reverse', gap: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line },
  sentCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, gap: 14 },
  sentIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.greenTint, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.green },
  sentCheck: { color: C.green, fontSize: 34, fontWeight: '900' },

  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.ink },

  // error box
  errorBox: { marginTop: 8, alignSelf: 'stretch', backgroundColor: '#FDECEA', borderRadius: 12, borderWidth: 1, borderColor: '#F5C6C0', padding: 12 },
  errorBoxTitle: { fontSize: 12, fontWeight: '700', color: '#8A2E24', marginBottom: 6, textAlign: 'right' },
  errorBoxText: { fontSize: 12, color: '#8A2E24', textAlign: 'left' },
});
